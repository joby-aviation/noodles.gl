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

  it('keeps operators without per-row values as host nodes, wired by par: handles', () => {
    const { doc } = toEditorDoc(example('bitmap-layer'))
    const bitmap = doc.nodes.find(n => n.id === '/bitmap-layer')
    expect(bitmap?.op).toBe('BitmapLayerOp')
    expect(bitmap?.params.image).toBe('@/sf-districts.png')
    expect(doc.edges).toContainEqual(
      expect.objectContaining({
        source: '/bitmap-layer',
        sourcePort: 'layer',
        target: '/deck',
        targetPort: 'layers',
      })
    )
    expect(lowerDocument(doc).errors).toEqual([])
  })

  it('passes MapLibre layers and code-built layers through the deck', () => {
    const custom = toEditorDoc(example('custom-maplibre-layer-test')).doc
    expect(custom.edges).toContainEqual(
      expect.objectContaining({
        source: '/test-layer',
        target: '/deck-renderer',
        targetPort: 'maplibreLayers',
      })
    )
    const hubble = toEditorDoc(example('cesium-hubble'))
    expect(hubble.doc.nodes.map(n => n.op).sort()).toEqual(['CodeOp', 'Tile3DLayerOp', 'deck'])
    expect(hubble.warnings).toContain('timeline keyframes are not converted yet')
  })

  it('refuses accessors it cannot express, rather than keeping them as accessors', () => {
    expect(() => toEditorDoc(example('world-flights'))).toThrow()
  })

  it('converts aggregation-example: a switch between hexagon and grid layers over JSON rows', () => {
    const { doc, warnings } = toEditorDoc(example('aggregation-example'))
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    expect(doc.nodes.find(n => n.id === '/switch')).toMatchObject({
      op: 'switch',
      params: { index: 0 },
    })
    expect(doc.nodes.find(n => n.id === '/data-source')).toMatchObject({
      op: 'file',
      params: { format: 'json' },
    })
    // A [lng, lat] list column, indexed in SQL.
    expect(doc.nodes.find(n => n.id === '/position-accessor')?.params.expression).toBe(
      '[item(COORDINATES, 0.0), item(COORDINATES, 1.0)]'
    )
    expect(doc.nodes.find(n => n.id === '/hexagon-layer')).toMatchObject({
      op: 'hexagon',
      params: { radius: 200, extruded: true, elevationScale: 4, colorWeight: 'spaces_accessor' },
    })
    // Switch index 0 is the first value wired in, the hexagon layer.
    expect(lowered.outputs['/switch'].out).toBe('/hexagon-layer')
    expect(warnings).toEqual([])
  })

  it('reads a per-feature hex color string through hex_color', () => {
    const { doc } = toEditorDoc(example('geojson-example'))
    expect(lowerDocument(doc).errors).toEqual([])
    expect(doc.nodes.find(n => n.id === '/line-color-accessor')?.params.expression).toBe(
      "hex_color(coalesce(color, '#000'))"
    )
    expect(doc.nodes.find(n => n.id === '/geojson-layer-labels')?.params.text).toBe('name')
  })
})

describe('toEditorDoc with GeoJSON', () => {
  async function runGeojson(name: string, file: string) {
    const { doc, warnings } = toEditorDoc(example(name))
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const source = doc.nodes.find(n => n.op === 'geojson')
    const url = String(source?.params.url)
    duck.registerText(url, readFileSync(resolve(`src/examples/${name}/${file}`), 'utf8'))
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.program()?.errors).toEqual([])
    const layers = Object.fromEntries(runtime.layers().map(l => [l.id, l]))
    return { doc, warnings, layers }
  }

  it('converts nyc-census to extruded polygons colored and raised by population', async () => {
    const { doc, layers } = await runGeojson('nyc-census', 'data.json')
    const fill = layers['/geojson-layer']
    expect(fill.error).toBeUndefined()
    expect(fill.plan.kind).toBe('polygon')
    expect(fill.props).toMatchObject({ extruded: true, elevationScale: 11, stroked: false })
    // One deck polygon per census tract polygon (2,125 Polygons + 41 MultiPolygons' parts).
    expect(fill.data?.starts?.length).toBeGreaterThan(2166)
    expect(fill.data?.attributes.has('population_to_elevation')).toBe(true)
    expect(fill.data?.attributes.has('population_color')).toBe(true)
    // The file has no lines or points; those layers draw nothing.
    expect(layers['/geojson-layer-lines'].data?.rows ?? 0).toBe(0)
    expect(doc.nodes.find(n => n.id === '/geojson-layer-polygon-rows')?.params.expression).toBe(
      "kind == 'polygon'"
    )
  })

  it('converts us-county-unemployment, with the color domain from an Extent in SQL', async () => {
    const { doc, layers } = await runGeojson('us-county-unemployment', 'data.geojson')
    expect(doc.nodes.find(n => n.id === '/extent')).toMatchObject({
      op: 'extent',
      params: { input: 'coalesce(unemployment_rate, 0)' },
    })
    const fill = layers['/geojson-layer']
    expect(fill.error).toBeUndefined()
    const stats = fill.plan.plan.stats
    expect(stats.map(st => st.outputs.map(o => o.param))).toEqual([['_extent_min', '_extent_max']])
    const color = fill.data?.attributes.get('unemployment_color')
    expect(color && [...color.data].some(Number.isNaN)).toBe(false)
  })

  it('converts sf-elevation-contours, with fill and outline colored by elevation', () => {
    const { doc } = toEditorDoc(example('sf-elevation-contours'))
    expect(lowerDocument(doc).errors).toEqual([])
    expect(doc.nodes.find(n => n.id === '/geojson-layer')?.params).toMatchObject({
      color: 'elevation_color',
      lineColorChannel: 'elevation_color',
      lineWidthScale: 8,
      lineWidthMinPixels: 0.2,
      opacity: 0.38,
    })
  })
})
