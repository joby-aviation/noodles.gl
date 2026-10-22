// FIXTURE GENERATOR: MADE-UP FLIGHTS. Nothing in flights-fixture.csv is real
// flight data. It stands in for what a flight-data tool would return for "the
// last two weeks of flights", so the map-flights-last-week and
// animate-flight-route tasks run with no external data source.
//
//   npx tsx tasks/fixtures/make-flights-fixture.ts   # rewrites flights-fixture.csv
//
// Deterministic (seeded PRNG), so re-running reproduces the committed file
// byte for byte. Changing the output is a task change for both tasks (07 D7).
//
// Shape: one row per position sample, every 30 s.
//   flight_id,operator,timestamp,lng,lat,alt_m,origin,destination
// The export is "pulled Monday 2026-10-19", so "last week" is 2026-10-12
// through 2026-10-18. All departures are 12:00-23:00 UTC (8am-7pm New York
// time), so the UTC and local calendar day agree and either reading of "last
// week" selects the same flights. Distractors: the week before, Blade flights
// outside New York, and another operator's flights inside New York.
// Each flight's path bows by its own seeded amount, so its interior samples
// fingerprint it even when a session drops the flight_id column.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SITES: Record<string, [number, number]> = {
  JRA: [-74.009, 40.7546], // West 30th Street Heliport
  JFK: [-73.7781, 40.6413],
  EWR: [-74.1745, 40.6895],
  HPN: [-73.7076, 41.067],
  HTO: [-72.2518, 40.9596], // East Hampton
  NCE: [7.2159, 43.6584], // Nice
  MCM: [7.4197, 43.7262], // Monaco heliport
  OAR: [-121.7634, 36.6819], // Marina, CA
}

// [operator, origin, destination, departure (UTC)]
const SCHEDULE: Array<[string, string, string, string]> = [
  // week before (2026-10-05 to 2026-10-11): Blade, New York
  ['Blade', 'JRA', 'JFK', '2026-10-05T13:20:00Z'],
  ['Blade', 'EWR', 'JRA', '2026-10-06T16:05:00Z'],
  ['Blade', 'JRA', 'HPN', '2026-10-07T21:40:00Z'],
  ['Blade', 'JRA', 'HTO', '2026-10-09T19:10:00Z'],
  ['Blade', 'HTO', 'JRA', '2026-10-11T20:30:00Z'],
  ['Blade', 'JFK', 'JRA', '2026-10-11T22:00:00Z'],
  // last week (2026-10-12 to 2026-10-18): Blade, New York (the target set)
  ['Blade', 'JRA', 'JFK', '2026-10-12T13:10:00Z'],
  ['Blade', 'JFK', 'JRA', '2026-10-12T14:05:00Z'],
  ['Blade', 'JRA', 'EWR', '2026-10-13T15:30:00Z'],
  ['Blade', 'JRA', 'JFK', '2026-10-14T12:40:00Z'],
  ['Blade', 'HPN', 'JRA', '2026-10-15T13:00:00Z'],
  ['Blade', 'JRA', 'HPN', '2026-10-15T21:15:00Z'],
  ['Blade', 'JRA', 'HTO', '2026-10-16T19:00:00Z'],
  ['Blade', 'HTO', 'JRA', '2026-10-17T14:30:00Z'],
  ['Blade', 'JRA', 'EWR', '2026-10-17T16:45:00Z'],
  ['Blade', 'JRA', 'JFK', '2026-10-18T17:20:00Z'],
  ['Blade', 'EWR', 'JRA', '2026-10-18T18:05:00Z'],
  ['Blade', 'JFK', 'JRA', '2026-10-18T22:10:00Z'],
  // last week: Blade outside New York
  ['Blade', 'NCE', 'MCM', '2026-10-14T12:00:00Z'],
  ['Blade', 'MCM', 'NCE', '2026-10-14T13:30:00Z'],
  ['Blade', 'NCE', 'MCM', '2026-10-17T12:15:00Z'],
  // last week: another operator, one of them inside New York
  ['Joby', 'JFK', 'JRA', '2026-10-15T15:00:00Z'],
  ['Joby', 'OAR', 'OAR', '2026-10-13T17:00:00Z'],
  ['Joby', 'OAR', 'OAR', '2026-10-16T18:30:00Z'],
]

const SAMPLE_SECONDS = 30
const CRUISE_MPS = 65 // ~126 kt
const CRUISE_ALT_M = 450

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function distanceMeters([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

export function generateRows(): string[] {
  const rand = mulberry32(20261019)
  const flights = SCHEDULE.map(([operator, origin, destination, departure]) => ({
    operator,
    origin,
    destination,
    departure,
  })).sort((a, b) => a.departure.localeCompare(b.departure))

  const rows = ['flight_id,operator,timestamp,lng,lat,alt_m,origin,destination']
  flights.forEach((f, i) => {
    const id = `FLT-${1001 + i}`
    const from = SITES[f.origin]
    const to = SITES[f.destination]
    const loop = f.origin === f.destination
    // A test loop flies out ~12 km and back; a route bows to one side.
    const bow = (loop ? 0.11 : 0.004 + rand() * 0.012) * (rand() < 0.5 ? -1 : 1)
    const length = loop ? 24000 : distanceMeters(from, to)
    const steps = Math.max(8, Math.round(length / CRUISE_MPS / SAMPLE_SECONDS))
    const start = Date.parse(f.departure)
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const norm = Math.hypot(dx, dy) || 1
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const lateral = Math.sin(Math.PI * t) * bow
      // perpendicular offset (or, for a loop, an out-and-back ellipse to the east)
      const lng = loop ? from[0] + lateral * 1.2 : from[0] + dx * t + (-dy / norm) * lateral
      const lat = loop
        ? from[1] + Math.sin(2 * Math.PI * t) * 0.03
        : from[1] + dy * t + (dx / norm) * lateral
      const climb = Math.min(1, t / 0.2, (1 - t) / 0.2)
      const alt =
        s === 0 || s === steps ? 0 : Math.round(CRUISE_ALT_M * climb + (rand() - 0.5) * 30)
      const timestamp = new Date(start + s * SAMPLE_SECONDS * 1000)
        .toISOString()
        .replace('.000Z', 'Z')
      rows.push(
        [
          id,
          f.operator,
          timestamp,
          lng.toFixed(6),
          lat.toFixed(6),
          Math.max(0, alt),
          f.origin,
          f.destination,
        ].join(',')
      )
    }
  })
  return rows
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'flights-fixture.csv')
  fs.writeFileSync(out, `${generateRows().join('\n')}\n`)
  console.log(`wrote ${out}`)
}
