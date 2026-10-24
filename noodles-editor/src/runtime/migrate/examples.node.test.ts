// Every example converted: what it lowers to, and for the ones whose data is in the repo, what
// it draws, row for row.
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { registerDeckOperators } from '../deck-ops'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import { UNCONVERTIBLE } from './__fixtures__/unconvertible'
import { OP_CATALOG } from './op-catalog'
import { type NoodlesProject, toEditorDoc } from './to-editor-doc'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  registerDeckOperators()
  duck = await openNodeDuck()
}, 30_000)

// The examples as operator-graph files (__fixtures__): what each converts to is checked here; the
// documents in src/examples are what they converted to, run below
const EXAMPLES = readdirSync('src/runtime/migrate/__fixtures__')
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))
const project = (name: string) =>
  JSON.parse(
    readFileSync(resolve(`src/runtime/migrate/__fixtures__/${name}.json`), 'utf8')
  ) as NoodlesProject

describe('every example', () => {
  it.each(Object.keys(UNCONVERTIBLE))('%s says why it does not convert', name => {
    expect(() => toEditorDoc(project(name))).toThrow(UNCONVERTIBLE[name])
  })

  it.each(EXAMPLES.filter(n => !UNCONVERTIBLE[n]))(
    '%s converts and lowers, keeping only the host operators it must',
    name => {
      const { doc } = toEditorDoc(project(name))
      expect(lowerDocument(doc).errors).toEqual([])
      const host = doc.nodes.filter(n => OP_CATALOG[n.op]).map(n => n.op)
      expect(
        host.filter(op => OP_CATALOG[op].becomes !== 'host' && !OP_CATALOG[op].hostWhen)
      ).toEqual([])
    }
  )
})

// Examples whose data files are in the repo, by the file their `@/` URL names, and what each
// layer draws
// layer draws: a CSV's rows, or a GeoJSON file's polygon vertices less each ring's closing one
const LOCAL: Record<string, { files: string[]; rows: Record<string, number> }> = {
  'nyc-taxis': {
    files: ['data.csv'],
    rows: { 'arc-layer': 97986, 'pickup-layer': 97986, 'dropoff-layer': 97986 },
  },
  'california-earthquakes': { files: ['data.csv'], rows: { 'scatterplot-layer': 54936 } },
  'nyc-census': {
    files: ['data.json'],
    rows: { 'geojson-layer': 45629, 'geojson-layer-lines': 0, 'geojson-layer-points': 0 },
  },
  'us-county-unemployment': {
    files: ['data.geojson'],
    rows: { 'geojson-layer': 52588, 'geojson-layer-lines': 0, 'geojson-layer-points': 0 },
  },
  // One model at a literal [null] row
  orbit: { files: [], rows: { scene: 1 } },
}

describe('the examples with their data', () => {
  it.each(Object.keys(LOCAL))('%s draws its rows', async name => {
    // The document in src/examples, as the editor opens it
    const doc = JSON.parse(readFileSync(resolve(`src/examples/${name}/noodles.json`), 'utf8'))
    for (const file of LOCAL[name].files) {
      duck.registerText(`@/${file}`, readFileSync(resolve(`src/examples/${name}/${file}`), 'utf8'))
    }
    const lowered = lowerDocument(doc)
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.error()).toBeUndefined()
    expect(runtime.program()?.errors).toEqual([])
    const rows = Object.fromEntries(runtime.layers().map(l => [l.id, l.error ?? l.data?.rows ?? 0]))
    expect(rows).toEqual(LOCAL[name].rows)
  })
})
