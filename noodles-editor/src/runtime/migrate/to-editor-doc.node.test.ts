import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import { type NoodlesProject, toEditorDoc, translateAccessor } from './to-editor-doc'

const example = (name: string) =>
  JSON.parse(readFileSync(resolve(`src/examples/${name}/noodles.json`), 'utf8')) as NoodlesProject

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 30_000)

async function run(name: string) {
  const { doc, warnings } = toEditorDoc(example(name))
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  duck.registerText('@/data.csv', readFileSync(resolve(`src/examples/${name}/data.csv`), 'utf8'))
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.program()?.errors).toEqual([])
  return { doc, warnings, lowered, runtime }
}

describe('translateAccessor', () => {
  it('reads row columns and Math', () => {
    expect(translateAccessor('[d.pickup_longitude, d.pickup_latitude]')).toBe(
      '[pickup_longitude, pickup_latitude]'
    )
    expect(translateAccessor('Math.sqrt(d.Magnitude) * 2')).toBe('sqrt(Magnitude) * 2')
    expect(translateAccessor('d.v === 1 ? 2 : 3')).toBe('v == 1 ? 2 : 3')
    expect(translateAccessor('Math.log(d.pop)')).toBe('ln(pop)')
  })

  it('refuses what only JS can do', () => {
    expect(translateAccessor('d.name.toUpperCase()')).toBeUndefined()
    expect(translateAccessor('data.length')).toBeUndefined()
    expect(translateAccessor("op('/x').out.val")).toBeUndefined()
    expect(translateAccessor('d')).toBeUndefined()
  })
})

describe('toEditorDoc', () => {
  it('converts nyc-taxis to three layers over one file', async () => {
    const { doc, warnings, runtime } = await run('nyc-taxis')
    expect(doc.nodes.map(n => `${n.id}:${n.op}`).sort()).toEqual([
      '/arc-layer:arc',
      '/data-source:file',
      '/deck:deck',
      '/dropoff-layer:scatter',
      '/dropoff-position:attribute',
      '/dropoff:color',
      '/pickup-layer:scatter',
      '/pickup-position:attribute',
      '/pickup:color',
    ])
    const rows = Object.fromEntries(runtime.layers().map(l => [l.id, l.data?.rows]))
    expect(rows).toEqual({ '/arc-layer': 97986, '/pickup-layer': 97986, '/dropoff-layer': 97986 })
    // The constant radius of 10 is deck's radius 1, scaled.
    const pickup = runtime.layers().find(l => l.id === '/pickup-layer')
    expect(pickup?.props.radiusScale).toBe(10)
    expect(pickup?.props.blend).toBe('additive')
    expect(pickup?.props.fillColor).toEqual([0x8d, 0x12, 0xaf])
    expect(warnings.filter(w => !w.includes("dropped 'getLineColor'"))).toEqual([])
  })

  it('converts california-earthquakes, keeping MapRange numbers as parameters', async () => {
    const { doc, warnings, lowered, runtime } = await run('california-earthquakes')
    const range = doc.nodes.find(n => n.id === '/map-range')
    expect(range?.op).toBe('map-range')
    expect(range?.params).toMatchObject({ inMin: 2.5, inMax: 7, clamp: false })
    const layer = runtime.layers().find(l => l.id === '/scatterplot-layer')
    expect(layer?.data?.rows).toBeGreaterThan(0)
    expect(layer?.props.radiusUnits).toBe('meters')
    // Radius is Magnitude × 1000 metres, per row.
    const radius = layer?.data?.attributes.get('multiply')
    expect(radius?.data[0]).toBeGreaterThan(1000)
    // Dragging the MapRange minimum rebinds; it never recompiles.
    const name = lowered.slotParams['/map-range.inMin'][0]
    const compiles = runtime.counters.compiles
    await runtime.setValues({ ...parameterValues(lowered, { T: 0, F: 0 }).values, [name]: 3 })
    expect(runtime.counters.compiles).toBe(compiles)
    expect(warnings).toContain('/sqrt: dropped MathOp; nothing drawn reads it')
  })

  it('converts uk-commute without running it (its data is remote)', () => {
    const { doc } = toEditorDoc(example('uk-commute'))
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const arc = doc.nodes.find(n => n.id === '/arc-layer')
    expect(arc?.params).toMatchObject({ widthUnits: 'meters', widthScale: 80, height: 0.7 })
    expect(arc?.params.fromColor).toEqual({ ref: 'source-color/color' })
  })

  it('refuses projects it cannot convert yet, rather than dropping layers', () => {
    expect(() => toEditorDoc(example('world-flights'))).toThrow()
  })
})
