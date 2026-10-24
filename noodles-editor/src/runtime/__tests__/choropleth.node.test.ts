// Choropleths: rows joined onto boundaries in the engine, filled by a ramp over a column.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { clearBoundaryCache } from '../../noodles/utils/choropleth-boundaries'
import { registerDeckOperators } from '../deck-ops'
import { type NoodlesProject, toEditorDoc } from '../migrate/to-editor-doc'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
const square = (x: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 0],
    ],
  ],
})
// California, Texas and New York by FIPS id, as us-atlas has them
const STATES = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: '06', properties: {}, geometry: square(0) },
    { type: 'Feature', id: '48', properties: {}, geometry: square(2) },
    { type: 'Feature', id: '36', properties: {}, geometry: square(4) },
  ],
}

beforeAll(async () => {
  registerNoodlesRamps()
  registerDeckOperators()
  clearBoundaryCache()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(STATES), { status: 200 }))
  )
  duck = await openNodeDuck()
}, 60_000)
afterAll(() => vi.unstubAllGlobals())

const ROWS =
  "SELECT * FROM (VALUES ('CA', 39000000), ('TX', 29000000)) t(state, population)"

async function draw(doc: EditorDoc) {
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.program()?.errors).toEqual([])
  return runtime
}

describe('choropleths', () => {
  it('fills each state by its value, and a state with none gray', async () => {
    const runtime = await draw({
      version: 1,
      name: 'c',
      nodes: [
        { id: 'rows', op: 'sql', x: 0, y: 0, params: { query: ROWS } },
        {
          id: 'map',
          op: 'choropleth',
          x: 0,
          y: 0,
          params: { joinKey: 'state', valueColumn: 'population', colorScheme: 'blues' },
        },
        { id: 'deck', op: 'deck', x: 0, y: 0, params: {} },
      ],
      edges: [
        { id: 'e1', source: 'rows', sourcePort: 'out', target: 'map', targetPort: 'in' },
        { id: 'e2', source: 'map', sourcePort: 'out', target: 'deck', targetPort: 'layers' },
      ],
    })
    const [layer] = runtime.layers()
    expect(layer.error).toBeUndefined()
    expect(layer.data?.starts?.length).toBe(3)
    const color = layer.data?.attributes.get(
      layer.plan.plan.layer?.bindings.find(b => b.channel === 'color')?.attribute ?? ''
    )
    // The first vertex of each state: California, Texas, New York
    const at = (v: number) =>
      Array.from(color?.data.subarray(v * color.width, v * color.width + 3) ?? []).map(
        c => +c.toFixed(3)
      )
    const [ca, tx, ny] = [0, 3, 6].map(at)
    expect(ca).not.toEqual(tx)
    expect(ny).toEqual([0.706, 0.706, 0.706])
  })

  it('joins rows onto boundaries, a row per boundary with its codes', async () => {
    const runtime = await draw({
      version: 1,
      name: 'j',
      nodes: [
        { id: 'rows', op: 'sql', x: 0, y: 0, params: { query: ROWS } },
        { id: 'join', op: 'choropleth-join', x: 0, y: 0, params: { joinKey: 'state' } },
      ],
      edges: [{ id: 'e1', source: 'rows', sourcePort: 'out', target: 'join', targetPort: 'in' }],
    })
    const preview = await runtime.preview('join')
    const rows = preview.rows as Record<string, unknown>[]
    expect(rows.map(r => [r.abbrev, r.population])).toEqual([
      ['CA', 39000000],
      ['TX', 29000000],
      ['NY', null],
    ])
  })

  it("converts main's ChoroplethJoin and ChoroplethLayer", () => {
    const project = JSON.parse(
      readFileSync(resolve('src/runtime/migrate/__fixtures__/us-state-population.json'), 'utf8')
    ) as NoodlesProject
    const { doc } = toEditorDoc(project)
    expect(doc.nodes.find(n => n.id === '/population-choropleth')).toMatchObject({
      op: 'choropleth',
      params: { geography: 'us-states', joinKey: 'state', geoKey: 'abbrev', valueColumn: 'population' },
    })
    expect(doc.nodes.find(n => n.id === '/state-join')?.op).toBe('choropleth-join')
  })

  it('draws the us-state-population example: filled states and their labels', async () => {
    const doc = JSON.parse(
      readFileSync(resolve('src/examples/us-state-population/noodles.json'), 'utf8')
    ) as EditorDoc
    duck.registerText(
      '@/data.csv',
      readFileSync(resolve('src/examples/us-state-population/data.csv'), 'utf8')
    )
    const runtime = await draw(doc)
    const layers = Object.fromEntries(runtime.layers().map(l => [l.id, l]))
    expect(layers['population-choropleth'].data?.starts?.length).toBe(3)
    const labels = layers.labels
    expect(labels.error).toBeUndefined()
    expect(labels.data?.strings.get('label')?.slice(0, 2)).toEqual(['CA 39.5M', 'TX 29.1M'])
  })
})
