// Shared helpers for the tasks built on tasks/fixtures/flights-fixture.csv
// (made-up flights; see make-flights-fixture.ts). Two jobs:
//   1. derive the expected flight sets from the fixture itself, by the rule
//      each task states, so the checks never drift from the data;
//   2. detect which fixture flights a layer actually received at run time,
//      from the frozen get_node_output probe (07 D5: facts measured at run
//      time, never re-executed at grading).
// Detection uses two signals: FLT-#### ids anywhere in the layer data, and
// coordinate fingerprints (a flight counts as present when at least half of
// its interior samples appear), so a session that drops the flight_id column
// is still measured.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { TASKS_ROOT } from '../config'
import type { ProjectJson } from './types'

export const FLIGHTS_FIXTURE = 'fixtures/flights-fixture.csv'
export const NEW_YORK_SITES = new Set(['NYHP', 'JFK', 'EWR', 'LGA', 'HPN', 'EEND'])
// The export is pulled Monday 2026-10-19; "last week" is Mon 10-12 to Sun 10-18.
export const LAST_WEEK = { start: '2026-10-12', endExclusive: '2026-10-19' }
export const ROUTE_FLIGHT_ID = 'FLT-1018'

export interface FixtureFlight {
  id: string
  aircraft: string
  origin: string
  destination: string
  departure: string
  samples: Array<[number, number]>
}

let cached: Map<string, FixtureFlight> | null = null

export function fixtureFlights(): Map<string, FixtureFlight> {
  if (cached) return cached
  const lines = fs.readFileSync(path.join(TASKS_ROOT, FLIGHTS_FIXTURE), 'utf-8').trim().split('\n')
  const header = lines[0].split(',')
  const col = (name: string) => header.indexOf(name)
  const flights = new Map<string, FixtureFlight>()
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const id = cells[col('flight_id')]
    let flight = flights.get(id)
    if (!flight) {
      flight = {
        id,
        aircraft: cells[col('aircraft')],
        origin: cells[col('origin')],
        destination: cells[col('destination')],
        departure: cells[col('timestamp')],
        samples: [],
      }
      flights.set(id, flight)
    }
    flight.samples.push([Number(cells[col('lng')]), Number(cells[col('lat')])])
  }
  cached = flights
  return flights
}

export function expectedLastWeekNewYorkHelicopters(): Set<string> {
  const ids = new Set<string>()
  for (const f of fixtureFlights().values()) {
    const day = f.departure.slice(0, 10)
    const inWeek = day >= LAST_WEEK.start && day < LAST_WEEK.endExclusive
    const inNewYork = NEW_YORK_SITES.has(f.origin) || NEW_YORK_SITES.has(f.destination)
    if (f.aircraft === 'helicopter' && inWeek && inNewYork) ids.add(f.id)
  }
  return ids
}

const ID_RE = /\bFLT-\d{4}\b/g
const LNG_KEYS = new Set(['lng', 'lon', 'long', 'longitude', 'x'])
const LAT_KEYS = new Set(['lat', 'latitude', 'y'])

const coordKey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`
const asNumber = (v: unknown): number | null => {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : null
}

/** Which fixture flights appear in a probed value (any JSON shape). */
export function detectFlights(value: unknown): { ids: Set<string>; fingerprinted: Set<string> } {
  const ids = new Set<string>()
  const coords = new Set<string>()
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || v === null || v === undefined) return
    if (typeof v === 'string') {
      for (const m of v.matchAll(ID_RE)) ids.add(m[0])
      return
    }
    if (typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) {
      if (v.length >= 2 && v.length <= 4) {
        const lng = asNumber(v[0])
        const lat = asNumber(v[1])
        if (lng !== null && lat !== null) coords.add(coordKey(lng, lat))
      }
      for (const item of v) walk(item, depth + 1)
      return
    }
    const entries = Object.entries(v as Record<string, unknown>)
    let lng: number | null = null
    let lat: number | null = null
    for (const [k, item] of entries) {
      const key = k.toLowerCase()
      if (LNG_KEYS.has(key)) lng = asNumber(item)
      if (LAT_KEYS.has(key)) lat = asNumber(item)
    }
    if (lng !== null && lat !== null) coords.add(coordKey(lng, lat))
    for (const [, item] of entries) walk(item, depth + 1)
  }
  walk(value, 0)

  const fingerprinted = new Set<string>()
  for (const f of fixtureFlights().values()) {
    const interior = f.samples.slice(1, -1)
    const hits = interior.filter(([lng, lat]) => coords.has(coordKey(lng, lat))).length
    if (interior.length > 0 && hits / interior.length >= 0.5) fingerprinted.add(f.id)
  }
  return { ids, fingerprinted }
}

/** Flights the probe saw, preferring ids; falls back to fingerprints when no
 * fixture id is visible in the data at all. */
export function flightsSeen(value: unknown): {
  flights: Set<string>
  via: 'ids' | 'fingerprint' | 'none'
} {
  const { ids, fingerprinted } = detectFlights(value)
  if (ids.size > 0) return { flights: ids, via: 'ids' }
  if (fingerprinted.size > 0) return { flights: fingerprinted, via: 'fingerprint' }
  return { flights: new Set(), via: 'none' }
}

export function describeSetDiff(seen: Set<string>, expected: Set<string>): string {
  const missing = [...expected].filter(id => !seen.has(id))
  const extra = [...seen].filter(id => !expected.has(id))
  return `${seen.size} seen, ${expected.size} expected; missing [${missing.join(', ')}]; extra [${extra.join(', ')}]`
}

// ---- graph helpers ----

/** Layer nodes (type *LayerOp) with an edge path into a DeckRendererOp. */
export function renderedLayerIds(project: ProjectJson): string[] {
  const renderers = new Set(
    (project.nodes ?? []).filter(n => n.type === 'DeckRendererOp').map(n => n.id as string)
  )
  const reachesRenderer = (start: string): boolean => {
    const visited = new Set<string>()
    const queue = [start]
    while (queue.length) {
      const id = queue.shift() as string
      if (renderers.has(id)) return true
      if (visited.has(id)) continue
      visited.add(id)
      for (const e of project.edges ?? []) if (e.source === id && e.target) queue.push(e.target)
    }
    return false
  }
  return (project.nodes ?? [])
    .filter(
      n => typeof n.type === 'string' && /LayerOp$/.test(n.type) && reachesRenderer(n.id as string)
    )
    .map(n => n.id as string)
}

// op('/path') and {{/path.par.x}} references. The mustache path is one run of
// non-delimiter characters (slashes included) up to the first '.': a single
// character class with no nested quantifier, so it cannot backtrack
// exponentially on a long unterminated '{{a/a/a/...' (CodeQL js/redos). '{' is
// excluded too, so a run of '{{{{...' fails at each start in constant time.
const REF_RES = [/op\(\s*['"]([^'"]+)['"]\s*\)/g, /\{\{\s*([^{}.\s]+)\./g]

/** Raw paths named by op()/mustache references in a text, in match order. */
export function referencedPaths(text: string): string[] {
  const paths: string[] = []
  for (const re of REF_RES) for (const m of text.matchAll(re)) paths.push(m[1])
  return paths
}

/** Every node an input depends on: upstream edges, op()/mustache references
 * in upstream inputs, and the children of any container on the way. */
export function upstreamClosure(
  project: ProjectJson,
  nodeId: string,
  targetHandle?: string
): Set<string> {
  const ids = new Set((project.nodes ?? []).map(n => n.id as string))
  const out = new Set<string>()
  const queue: string[] = []
  for (const e of project.edges ?? []) {
    if (e.target === nodeId && (!targetHandle || e.targetHandle === targetHandle) && e.source)
      queue.push(e.source)
  }
  if (targetHandle) {
    // a literal on the target input itself may carry references
    const literal = (project.nodes ?? []).find(n => n.id === nodeId)?.data?.inputs?.[
      targetHandle.replace(/^par\./, '')
    ]
    for (const ref of references(literal, nodeId, ids)) queue.push(ref)
  }
  while (queue.length) {
    const id = queue.shift() as string
    if (out.has(id) || id === nodeId) continue
    out.add(id)
    for (const e of project.edges ?? []) if (e.target === id && e.source) queue.push(e.source)
    const node = (project.nodes ?? []).find(n => n.id === id)
    for (const v of Object.values(node?.data?.inputs ?? {}))
      for (const ref of references(v, id, ids)) queue.push(ref)
    for (const child of ids) if (child.startsWith(`${id}/`)) queue.push(child)
  }
  return out
}

function references(value: unknown, fromId: string, ids: Set<string>): string[] {
  const text = typeof value === 'string' ? value : Array.isArray(value) ? value.join('\n') : ''
  if (!text) return []
  const container = fromId.split('/').slice(0, -1).join('/')
  const found: string[] = []
  for (const raw of referencedPaths(text)) {
    const candidates = raw.startsWith('/')
      ? [raw]
      : [`${container}/${raw.replace(/^\.\//, '')}`, `/${raw.replace(/^\.\//, '')}`]
    const hit = candidates.find(c => ids.has(c))
    if (hit) found.push(hit)
  }
  return found
}

/** Node ids carrying at least one timeline track with two or more keyframes. */
export function keyframedNodeIds(project: ProjectJson): Set<string> {
  const out = new Set<string>()
  const sheets = (project.timeline as { sheetsById?: Record<string, unknown> })?.sheetsById ?? {}
  for (const sheet of Object.values(sheets)) {
    const tracksByObject = ((sheet as { sequence?: { tracksByObject?: Record<string, unknown> } })
      ?.sequence?.tracksByObject ?? {}) as Record<
      string,
      { trackData?: Record<string, { keyframes?: unknown[] }> }
    >
    for (const [objectKey, entry] of Object.entries(tracksByObject)) {
      const animated = Object.values(entry.trackData ?? {}).some(
        t => (t.keyframes?.length ?? 0) >= 2
      )
      if (animated) out.add(`/${objectKey.split(' / ').join('/')}`)
    }
  }
  return out
}
