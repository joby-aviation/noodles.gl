import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  type EditorDoc,
  lowerDocument,
  parameterValues,
  registerOperator,
} from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import {
  CONVERTED_SCHEMA,
  type NoodlesProject,
  toEditorDoc,
  translateAccessor,
} from './to-editor-doc'

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
    // Radius is √Magnitude × 1700 metres, per row: the sqrt MathOp feeds the multiply
    const radius = layer?.data?.attributes.get('multiply')
    expect(radius?.data[0]).toBeGreaterThan(1700)
    // Dragging the MapRange minimum rebinds; it never recompiles.
    const name = lowered.slotParams['/map-range.inMin'][0]
    const compiles = runtime.counters.compiles
    await runtime.setValues({ ...parameterValues(lowered, { T: 0, F: 0 }).values, [name]: 3 })
    expect(runtime.counters.compiles).toBe(compiles)
    expect(warnings.filter(w => w.includes('/sqrt'))).toEqual([])
  })

  it('converts uk-commute without running it (its data is remote)', () => {
    const { doc } = toEditorDoc(example('uk-commute'))
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const arc = doc.nodes.find(n => n.id === '/arc-layer')
    expect(arc?.params).toMatchObject({ widthUnits: 'meters', widthScale: 80, height: 0.7 })
    expect(arc?.params.fromColor).toEqual({ ref: 'source-color/color' })
  })

  it('makes a layer without rows a deck operator, keeping its parameters', () => {
    const { doc } = toEditorDoc(example('bitmap-layer'))
    const bitmap = doc.nodes.find(n => n.id === '/bitmap-layer')
    expect(bitmap?.op).toBe('bitmap')
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
    expect(hubble.doc.nodes.map(n => n.op).sort()).toEqual(['CodeOp', 'deck', 'tile-3d'])
    // The basemap's camera keyframes drive the deck's camera.
    expect(hubble.doc.timeline?.tracks.map(t => t.target)).toEqual(
      ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'].map(k => `/renderer.${k}`)
    )
  })

  it('refuses accessors that read more than columns, rather than keeping them as accessors', () => {
    const project = example('nyc-taxis')
    const accessor = project.nodes.find(n => n.type === 'AccessorOp')
    if (accessor?.data?.inputs) accessor.data.inputs.expression = 'Object.keys(d).length'
    expect(() => toEditorDoc(project)).toThrow(/can't express/)
  })

  it('runs JS the expression language cannot say as a JS function DuckDB calls per row', async () => {
    const project = example('nyc-taxis')
    // The hour of the pickup, from the timestamp's text, plus the passengers
    project.nodes.push({
      id: '/pickup-radius',
      type: 'AccessorOp',
      position: { x: 0, y: 0 },
      data: {
        inputs: { expression: 'd.tpep_pickup_datetime.slice(11, 13) * 0.5 + d.passenger_count' },
      },
    })
    project.edges.push({
      id: '/pickup-radius.out.accessor->/pickup-layer.par.getRadius',
      source: '/pickup-radius',
      target: '/pickup-layer',
      sourceHandle: 'out.accessor',
      targetHandle: 'par.getRadius',
    })
    const { doc } = toEditorDoc(project)
    const fn = doc.nodes.find(n => n.op === 'js-function')
    expect(fn?.params).toMatchObject({ params: 'tpep_pickup_datetime, passenger_count', width: 1 })
    expect(doc.nodes.find(n => n.id === '/pickup-radius')?.params.expression).toBe(
      'pickup_radius_fn(tpep_pickup_datetime, passenger_count)'
    )

    duck.registerText(
      '@/data.csv',
      readFileSync(resolve('src/examples/nyc-taxis/data.csv'), 'utf8')
    )
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.error()).toBeUndefined()
    expect(runtime.program()?.errors).toEqual([])
    const layer = runtime.layers().find(l => l.id === '/pickup-layer')
    const radius = layer?.data?.attributes.get('pickup_radius')?.data
    const [first] = await duck.rows(
      "SELECT CAST(substr(CAST(tpep_pickup_datetime AS VARCHAR), 12, 2) AS DOUBLE) * 0.5 + passenger_count AS r FROM read_csv_auto('@/data.csv') LIMIT 1"
    )
    expect(radius?.[0]).toBeCloseTo(Number(first.r))
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

  it('converts chargers: a geocoded query, host operators reading its rows, and a camera', () => {
    const { doc, warnings } = toEditorDoc(example('chargers'))
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const op = (id: string) => doc.nodes.find(n => n.id === id)?.op
    expect(op('/centroid')).toBe('GeocoderOp')
    expect(op('/charger-query')).toBe('sql')
    expect(String(doc.nodes.find(n => n.id === '/charger-query')?.params.query)).toContain(
      "ch('centroid/out.location.lat')"
    )
    // The query binds the geocoder's location as a parameter, a value from the host.
    expect(lowered.slotParams['/centroid.out.location.lat']).toHaveLength(1)
    expect(op('/charger-bounds')).toBe('BoundingBoxOp')
    expect(doc.edges).toContainEqual(
      expect.objectContaining({
        source: '/charger-query',
        target: '/charger-bounds',
        targetPort: 'par:data',
      })
    )
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/auto-view', target: '/deck', targetPort: 'viewState' })
    )
    expect(op('/layer-toggle')).toBe('switch')
    expect(op('/charger-heatmap')).toBe('heatmap')
    expect(lowered.outputs['/layer-toggle'].out).toBe('/charger-points')
    // Nothing it read was dropped for want of a conversion.
    expect(warnings.filter(w => w.includes('not converted'))).toEqual([])
  })

  it('converts orbit: a scenegraph over generated rows, under its own OrbitView', () => {
    const { doc } = toEditorDoc(example('orbit'))
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    expect(doc.nodes.find(n => n.id === '/dummy-data')).toMatchObject({
      op: 'generate',
      params: { count: 1 },
    })
    expect(doc.nodes.find(n => n.id === '/scene')).toMatchObject({
      op: 'scenegraph',
      params: { position: '[0.0, 0.0, 0.0]', sizeMinPixels: 10 },
    })
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/camera', targetPort: 'views' })
    )
  })

  it('runs simple-mesh-example: list positions, an RGB color and a random yaw per row', async () => {
    const { doc } = toEditorDoc(example('simple-mesh-example'))
    // The stations file is remote; a local one with its shape stands in.
    const url = 'bart-stations.json'
    const source = doc.nodes.find(n => n.id === '/data-source')
    if (source) source.params.url = url
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    duck.registerText(
      url,
      JSON.stringify([
        { name: 'A', coordinates: [-122.4, 37.79], exits: 400 },
        { name: 'B', coordinates: [-122.41, 37.78], exits: 900 },
      ])
    )
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.program()?.errors).toEqual([])
    const mesh = runtime.layers()[0]
    expect(mesh.plan.kind).toBe('mesh')
    expect(mesh.error).toBeUndefined()
    const at = (name: string) => [...(mesh.data?.attributes.get(name)?.data ?? [])]
    expect(at('position_accessor').map(v => +v.toFixed(2))).toEqual([-122.4, 37.79, -122.41, 37.78])
    // [sqrt(exits), 140, 0] in 0–255, divided down to 0–1 for the planner.
    const color = mesh.data?.attributes.get(
      mesh.plan.plan.layer?.bindings.find(b => b.channel === 'color')?.attribute ?? ''
    )
    expect([...(color?.data.slice(0, 3) ?? [])].map(v => Math.round(v * 255))).toEqual([20, 140, 0])
    const yaw = at('orientation_accessor').filter((_, i) => i % 3 === 1)
    expect(yaw.every(v => v >= 0 && v < 180)).toBe(true)
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
    // Each sublayer draws its kind of each feature's geometry: a row per feature, no vertex rows
    expect(doc.nodes.find(n => n.id === '/geojson-layer')?.params.position).toBe('geom')
    expect(doc.nodes.some(n => n.op === 'filter' || n.op === 'unnest')).toBe(false)
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

describe('toEditorDoc with time', () => {
  // world-flights' CodeOp output, as the engine hands host rows to DuckDB (properties as columns).
  const flights = [
    {
      path: [
        [0, 0, 100],
        [1, 0, 200],
        [2, 0, 300],
      ],
      timestamps: [1000, 1010, 1020],
      origin_country: 'A',
    },
    {
      path: [
        [10, 10, 0],
        [11, 10, 0],
      ],
      timestamps: [1005, 1015],
      origin_country: 'B',
    },
  ]
  const geojson = {
    type: 'FeatureCollection',
    features: flights.map(f => ({
      type: 'Feature',
      properties: { origin_country: f.origin_country },
      geometry: {
        type: 'LineString',
        coordinates: f.path.map((p, k) => [...p, f.timestamps[k]]),
      },
    })),
  }

  beforeAll(() => {
    for (const type of ['CodeOp', 'FileOp']) {
      registerOperator({
        type,
        label: type,
        category: 'host',
        description: '',
        inputs: [],
        outputs: [{ name: 'data', type: 'table' }],
        params: [],
      })
    }
  })

  const at = (doc: EditorDoc, time: number): EditorDoc => ({
    ...doc,
    timeline: undefined,
    nodes: doc.nodes.map(n => (n.id === '/time' ? { ...n, params: { value: time } } : n)),
  })

  it('converts world-flights: trails and heads from a code node, colored by category', async () => {
    const { doc, warnings } = toEditorDoc(example('world-flights'))
    expect(warnings).toEqual(["/scatterplot-layer: dropped 'getLineColor'"])
    // The keyframed clock is a planner track on the number it drove.
    expect(doc.timeline?.tracks.map(t => t.target)).toEqual(['/time.value'])
    // The CodeOp runs in the engine, reading the GeoJSON file whole as FileOp parsed it
    const code = doc.nodes.find(n => n.id === '/transform-flights')
    expect(code?.op).toBe('code')
    const url = String(doc.nodes.find(n => n.op === 'geojson')?.params.url)
    expect(code?.params.url).toBe(url)
    expect(doc.nodes.some(n => n.op === 'FileOp')).toBe(false)

    // DuckDB in Node cannot open a registered https:// name, so both readers get a local one
    for (const n of doc.nodes) if (n.params.url === url) n.params.url = 'flights.geojson'
    duck.registerText('flights.geojson', JSON.stringify(geojson))
    const lowered = lowerDocument(at(doc, 1005))
    expect(lowered.errors).toEqual([])
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.program()?.errors).toEqual([])

    const heads = async () => {
      const rel = runtime.program()?.relations.find(r => r.id === '/time-series')
      const rows = await duck.rows(`SELECT lng, alt FROM ${rel?.ref} ORDER BY lng`)
      return rows.map(r => [r.lng, r.alt])
    }
    // Halfway along the first flight's first leg; the second flight at its first vertex.
    expect(await heads()).toEqual([
      [0.5, 150],
      [10, 0],
    ])
    // A row per flight throughout: the paths are never unnested
    expect(doc.nodes.some(n => n.op === 'unnest')).toBe(false)
    const layers = Object.fromEntries(runtime.layers().map(l => [l.id, l]))
    expect(layers['/trips-layer'].data?.rows).toBe(5)
    expect(layers['/trips-layer'].data?.starts?.length).toBe(2)
    expect(layers['/geojson-layer-lines'].data?.rows).toBe(5)
    // One color per category, the same on trails and heads.
    const color = layers['/scatterplot-layer'].data?.attributes.get('color_ramp')?.data
    const trail = layers['/trips-layer'].data?.attributes.get('color_ramp')?.data
    expect(color && trail && [...color.slice(0, 3)]).toEqual(trail && [...trail.slice(0, 3)])

    // After both flights end, each holds its last vertex.
    const later = lowerDocument(at(doc, 1030))
    await runtime.setValues(parameterValues(later, { T: 0, F: 0 }).values)
    await runtime.idle()
    expect(await heads()).toEqual([
      [2, 300],
      [11, 0],
    ])
  })
})

describe('toEditorDoc with an operator this build does not know', () => {
  it('keeps it as it was, so the project opens and saves it back', () => {
    const { doc, warnings } = toEditorDoc({
      version: 19,
      timeline: {},
      nodes: [
        {
          id: '/mystery',
          type: 'NoSuchOp',
          data: { inputs: { a: 1, b: 'x' } },
          position: { x: 5, y: 6 },
        },
        { id: '/deck', type: 'DeckRendererOp', data: {}, position: { x: 0, y: 0 } },
        { id: '/out', type: 'OutOp', data: {}, position: { x: 0, y: 0 } },
      ],
      edges: [
        {
          id: 'e',
          source: '/deck',
          target: '/out',
          sourceHandle: 'out.vis',
          targetHandle: 'par.vis',
        },
      ],
    } as never)
    expect(doc.nodes.find(n => n.id === '/mystery')).toMatchObject({
      op: 'NoSuchOp',
      name: 'mystery',
      x: 5,
      y: 6,
      params: { a: 1, b: 'x' },
    })
    expect(warnings).toContain('/mystery: NoSuchOp is not a known operator; kept as it was')
    // The rest of the document still lowers
    const lowered = lowerDocument(doc)
    expect(lowered.errors.filter(e => e.nodeId !== '/mystery')).toEqual([])
  })
})

describe('the schema conversion reads', () => {
  it('is the latest migration: a new migration must update the conversion too', async () => {
    const { NOODLES_VERSION } = await import('../../noodles/utils/migrate-schema')
    expect(CONVERTED_SCHEMA).toBe(NOODLES_VERSION)
  })
})
