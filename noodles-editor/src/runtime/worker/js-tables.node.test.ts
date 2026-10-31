// Code nodes on DuckDB: JavaScript rows that become a table every later node plans over.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { ProgramRuntime } from '../program-runtime'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 30_000)

const runs = () => (globalThis as { __codeRuns?: number }).__codeRuns ?? 0

function doc(
  code: string,
  opts: { input?: boolean; layer?: 'scatter' | 'polygon' } = {}
): EditorDoc {
  const input = opts.input ?? true
  const layer = opts.layer ?? 'scatter'
  return {
    version: 1,
    name: 'code',
    nodes: [
      ...(input
        ? [
            {
              id: 'src',
              op: 'sql',
              x: 0,
              y: 0,
              params: { query: 'SELECT i * 1.0 AS x FROM range(5) t(i)' },
            },
          ]
        : []),
      { id: 'code', op: 'code', x: 0, y: 0, params: { code } },
      ...(layer === 'polygon'
        ? [
            { id: 'shapes', op: 'geojson', x: 0, y: 0, params: {} },
            {
              id: 'fill',
              op: 'polygon',
              x: 0,
              y: 0,
              params: { position: '[lng, lat]', pathId: 'id', ringId: 'ring', order: 'vertex' },
            },
          ]
        : [
            {
              id: 'dots',
              op: 'scatter',
              x: 0,
              y: 0,
              params: { position: '[x, y]', radiusScale: 1 },
            },
          ]),
      { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
    ],
    edges: [
      ...(input
        ? [{ id: 'e1', source: 'src', sourcePort: 'out', target: 'code', targetPort: 'in' }]
        : []),
      ...(layer === 'polygon'
        ? [
            { id: 'e2', source: 'code', sourcePort: 'out', target: 'shapes', targetPort: 'in' },
            {
              id: 'e3',
              source: 'shapes',
              sourcePort: 'polygons',
              target: 'fill',
              targetPort: 'in',
            },
            { id: 'e4', source: 'fill', sourcePort: 'out', target: 'map', targetPort: 'layers' },
          ]
        : [
            { id: 'e2', source: 'code', sourcePort: 'out', target: 'dots', targetPort: 'in' },
            { id: 'e3', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
          ]),
    ],
  }
}

async function run(runtime: ProgramRuntime, d: EditorDoc) {
  const lowered = lowerDocument(d)
  expect(lowered.errors).toEqual([])
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  return runtime.layers()[0]
}

describe('code nodes', () => {
  it("make rows from their input's rows, with d3 in scope, once per code and input", async () => {
    const runtime = new ProgramRuntime(duck)
    const code =
      'globalThis.__codeRuns = (globalThis.__codeRuns ?? 0) + 1\nreturn d.map(r => ({ x: r.x, y: d3.sum([r.x, r.x]) }))'
    const before = runs()
    const layer = await run(runtime, doc(code))
    expect(layer.data?.rows).toBe(5)
    const position = layer.data?.attributes.get(layer.plan.plan.layer?.bindings[0].attribute ?? '')
    const w = position?.width ?? 2
    // Row 3: x = 3, y = d3.sum([3, 3])
    expect([position?.data[3 * w], position?.data[3 * w + 1]]).toEqual([3, 6])
    // A recompile of the same graph runs nothing again
    await run(runtime, doc(code))
    expect(runs() - before).toBe(1)
    // An edit to the code is a new table
    const edited = await run(runtime, doc(`${code}.slice(0, 2)`))
    expect(edited.data?.rows).toBe(2)
  })

  it('make rows from nothing', async () => {
    const layer = await run(
      new ProgramRuntime(duck),
      doc('return [{ x: 1, y: 2 }, { x: 3, y: 4 }]', { input: false })
    )
    expect(layer.data?.rows).toBe(2)
  })

  it('return GeoJSON a geojson node reads as features', async () => {
    const code = `return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: turf.bboxPolygon([0, 0, 1, 1]).geometry }],
    }`
    const layer = await run(new ProgramRuntime(duck), doc(code, { input: false, layer: 'polygon' }))
    expect(layer.data?.rows).toBe(4)
  })

  it('report what their code threw', async () => {
    const lowered = lowerDocument(doc('throw new Error("bad rows")'))
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.program()?.errors).toContainEqual({ nodeId: 'code', message: 'Code: bad rows' })
  })
})
