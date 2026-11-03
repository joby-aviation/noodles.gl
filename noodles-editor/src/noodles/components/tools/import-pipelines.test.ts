import { describe, expect, it } from 'vitest'
import { parseWkt } from '../../../utils/wkt'
import { opTypes } from '../../operators'
import { type CoordinateDetection, detectCoordinates, type Row } from './detect-coordinates'
import {
  createImportPipeline,
  type DetectedFormat,
  detectFormat,
  detectFormatFromUrl,
  isBinaryFormat,
  isImportable,
  positionExpression,
  propertyAccess,
  radiusExpression,
  toGeoJsonCode,
} from './import-pipelines'

const basePosition = { x: 100, y: 200 }

function detectRows(rows: Row[]): CoordinateDetection {
  return detectCoordinates(Object.keys(rows[0] ?? {}), rows)
}

const latLng = detectRows([
  { name: 'NYC', Latitude: 40.7, Longitude: -74 },
  { name: 'LDN', Latitude: 51.5, Longitude: -0.1 },
])
const latLngSized = detectRows([
  { lat: 40.7, lng: -74, population: 8_000_000 },
  { lat: 51.5, lng: -0.1, population: 9_000_000 },
])
const wktPoints = detectRows([{ WKT: 'POINT (1 2)' }, { WKT: 'POINT (3 4)' }])
const wktShapes = detectRows([{ geom: 'POLYGON ((0 0, 1 0, 1 1, 0 0))' }])
const noCoordinates = detectRows([{ region: 'North', units: 3 }])

// Evaluate a generated accessor or CodeOp body the way the operators do
function evaluate(body: string, d: unknown) {
  return new Function('d', 'utils', body)(d, { parseWkt })
}

// Deterministic ids so tests don't depend on the operator store
function makeCountingNodeId() {
  const counts = new Map<string, number>()
  return (baseName: string) => {
    const count = counts.get(baseName) ?? 0
    counts.set(baseName, count + 1)
    return count === 0 ? `/${baseName}` : `/${baseName}-${count}`
  }
}

function build(format: DetectedFormat, extra: Record<string, unknown> = {}) {
  return createImportPipeline({
    url: '@/data',
    format,
    basePosition,
    makeNodeId: makeCountingNodeId(),
    ...extra,
  })
}

describe('detectFormat', () => {
  it('maps extensions to formats', () => {
    expect(detectFormat('a.csv')).toBe('csv')
    expect(detectFormat('a.tsv')).toBe('tsv')
    expect(detectFormat('a.geojson')).toBe('geojson')
    expect(detectFormat('a.shp')).toBe('shapefile')
    expect(detectFormat('a.parquet')).toBe('geoparquet')
    expect(detectFormat('a.pmtiles')).toBe('pmtiles')
    expect(detectFormat('a.json')).toBe('json')
  })

  it('is case insensitive', () => {
    expect(detectFormat('CITIES.CSV')).toBe('csv')
    expect(detectFormat('Shapes.GeoJSON')).toBe('geojson')
  })

  it('sniffs GeoJSON out of a .json file', () => {
    const fc = JSON.stringify({ type: 'FeatureCollection', features: [] })
    expect(detectFormat('a.json', fc)).toBe('geojson')
    expect(detectFormat('a.json', '[{"lng":1,"lat":2}]')).toBe('json')
  })

  it('falls back to json on unparseable contents', () => {
    expect(detectFormat('a.json', 'not json at all')).toBe('json')
    expect(detectFormat('noextension')).toBe('json')
  })
})

describe('detectFormatFromUrl', () => {
  it('ignores query strings and fragments', () => {
    expect(detectFormatFromUrl('https://x.test/a.csv?token=1')).toBe('csv')
    expect(detectFormatFromUrl('https://x.test/a.tsv?token=1')).toBe('tsv')
    expect(detectFormatFromUrl('https://x.test/a.geojson#frag')).toBe('geojson')
  })

  it('handles relative paths and unparseable urls', () => {
    expect(detectFormatFromUrl('@/local.parquet')).toBe('geoparquet')
    expect(detectFormatFromUrl('::::')).toBe('json')
  })
})

describe('isImportable / isBinaryFormat', () => {
  it('accepts supported extensions only', () => {
    expect(isImportable('a.csv')).toBe(true)
    expect(isImportable('a.pmtiles')).toBe(true)
    expect(isImportable('a.png')).toBe(false)
    expect(isImportable('README')).toBe(false)
  })

  it('marks formats that must be read as bytes', () => {
    expect(isBinaryFormat('shapefile')).toBe(true)
    expect(isBinaryFormat('geoparquet')).toBe(true)
    expect(isBinaryFormat('pmtiles')).toBe(true)
    expect(isBinaryFormat('csv')).toBe(false)
    expect(isBinaryFormat('geojson')).toBe(false)
  })
})

describe('propertyAccess', () => {
  it('uses dot access for identifiers and brackets otherwise', () => {
    expect(propertyAccess('Latitude')).toBe('d.Latitude')
    expect(propertyAccess('lat (deg)')).toBe('d["lat (deg)"]')
    expect(propertyAccess('2020')).toBe('d["2020"]')
    expect(propertyAccess('say "hi"', 'row')).toBe('row["say \\"hi\\""]')
  })
})

describe('positionExpression', () => {
  it('reads the detected columns', () => {
    const expression = positionExpression(latLng)
    expect(expression).toBe('[d.Longitude, d.Latitude]')
    expect(evaluate(`return ${expression}`, { Latitude: 40.7, Longitude: -74 })).toEqual([
      -74, 40.7,
    ])
  })

  it('parses WKT and GeoJSON point columns', () => {
    const wkt = positionExpression(wktPoints)
    expect(wkt).toBe('utils.parseWkt(d.WKT).coordinates')
    expect(evaluate(`return ${wkt}`, { WKT: 'POINT (1 2)' })).toEqual([1, 2])

    const geojson = positionExpression(
      detectRows([{ geometry: '{"type":"Point","coordinates":[5,6]}' }])
    )
    expect(geojson).toBe('JSON.parse(d.geometry).coordinates')
    expect(
      evaluate(`return ${geojson}`, { geometry: '{"type":"Point","coordinates":[5,6]}' })
    ).toEqual([5, 6])
  })

  it("falls back to today's default without coordinates", () => {
    expect(positionExpression(noCoordinates)).toBe('[d.lng, d.lat]')
    expect(positionExpression(undefined)).toBe('[d.lng, d.lat]')
  })
})

describe('radiusExpression', () => {
  it('maps the column range onto a pixel radius by area', () => {
    const expression = radiusExpression({ column: 'mag', min: 2, max: 6 }, 100)
    const radius = (mag: unknown) => evaluate(`return ${expression}`, { mag })
    expect(radius(2)).toBe(16)
    expect(radius(6)).toBe(48)
    expect(radius(3)).toBeCloseTo(16 + 32 * Math.sqrt(0.25))
    // Missing and out of range values stay at the base size instead of NaN
    expect(radius(null)).toBe(16)
    expect(radius(undefined)).toBe(16)
    expect(radius('n/a')).toBe(16)
    expect(radius(-10)).toBe(16)
    expect(radius('6')).toBe(48)
  })

  it('uses smaller points for larger datasets', () => {
    expect(radiusExpression({ column: 'v', min: 0, max: 1 }, 50_000)).toMatch(/\? 4 \+ 8 /)
  })
})

describe('toGeoJsonCode', () => {
  it('turns rows into a FeatureCollection, dropping unreadable geometries', () => {
    if (wktShapes.kind !== 'geometry') throw new Error('expected a geometry detection')
    const rows = [{ geom: 'POLYGON ((0 0, 1 0, 1 1, 0 0))', name: 'a' }, { geom: 'nope' }]
    const result = evaluate(toGeoJsonCode(wktShapes), rows)
    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.type).toBe('Polygon')
    expect(result.features[0].properties.name).toBe('a')
  })

  it('skips GeoJSON strings that do not parse instead of throwing', () => {
    const detection = detectRows([
      { geometry: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}' },
    ])
    if (detection.kind !== 'geometry') throw new Error('expected a geometry detection')
    const rows = [
      { geometry: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}' },
      { geometry: 'n/a' },
      { geometry: '123' },
    ]
    expect(evaluate(toGeoJsonCode(detection), rows).features).toHaveLength(1)
  })

  it('never runs text from a column name', () => {
    const column = 'geom\nglobalThis.__injected = true;//'
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    }
    const detection = detectRows([{ [column]: polygon }])
    if (detection.kind !== 'geometry') throw new Error('expected a geometry detection')
    const g = globalThis as { __injected?: boolean }
    delete g.__injected
    const result = evaluate(toGeoJsonCode(detection), [{ [column]: polygon }])
    expect(g.__injected).toBeUndefined()
    expect(result.features).toHaveLength(1)
  })
})

describe('createImportPipeline', () => {
  it('references only registered operator types with valid handles', () => {
    const cases: [DetectedFormat, CoordinateDetection?][] = [
      ['csv'],
      ['tsv'],
      ['json'],
      ['geojson'],
      ['shapefile'],
      ['geoparquet'],
      ['csv', latLng],
      ['csv', latLngSized],
      ['csv', wktPoints],
      ['csv', wktShapes],
      ['csv', noCoordinates],
      ['tsv', latLng],
    ]
    for (const [format, detection] of cases) {
      const { nodes, edges } = build(format, { detection })
      const byId = new Map(nodes.map(n => [n.id, n]))
      for (const node of nodes) {
        expect(opTypes, `${format} -> ${node.type}`).toHaveProperty(node.type)
        const OpClass = opTypes[node.type]
        const op = new OpClass(`/probe-${format}-${node.type}`)
        for (const key of Object.keys(node.data.inputs)) {
          expect(op.inputs, `${node.type}.${key}`).toHaveProperty(key)
        }
      }
      // Every edge endpoint must be a node we created, with a handle that exists
      for (const edge of edges) {
        const sourceNode = byId.get(edge.source)
        const targetNode = byId.get(edge.target)
        expect(sourceNode, `${format}: missing source ${edge.source}`).toBeDefined()
        expect(targetNode, `${format}: missing target ${edge.target}`).toBeDefined()
        const sourceOp = new opTypes[sourceNode!.type](`/probe-src-${format}-${edge.id}`)
        const targetOp = new opTypes[targetNode!.type](`/probe-tgt-${format}-${edge.id}`)
        expect(sourceOp.outputs, edge.id).toHaveProperty(edge.sourceHandle.replace('out.', ''))
        expect(targetOp.inputs, edge.id).toHaveProperty(edge.targetHandle.replace('par.', ''))
      }
    }
  })

  it('builds a fitted scatterplot map from detected lat / lng columns', () => {
    const { nodes, edges, primaryNodeId, viewState } = build('csv', { detection: latLng })
    expect(nodes.map(n => n.type)).toEqual([
      'FileOp',
      'AccessorOp',
      'ScatterplotLayerOp',
      'MaplibreBasemapOp',
      'DeckRendererOp',
    ])
    expect(primaryNodeId).toBe('/data')
    expect(nodes[0].data.inputs).toEqual({ format: 'csv', url: '@/data' })
    expect(nodes[1].data.inputs.expression).toBe('[d.Longitude, d.Latitude]')
    expect(nodes[2].data.inputs).toMatchObject({ getRadius: 16 })

    // The camera is set from the data bounds, so no BoundingBox is needed
    expect(viewState?.latitude).toBeGreaterThan(40)
    expect(viewState?.latitude).toBeLessThan(52)
    expect(nodes[3].data.inputs).toEqual({ viewState })
    expect(edges.some(e => e.targetHandle === 'par.viewState')).toBe(false)
  })

  it('reads a TSV file as TSV so FileOp splits on tabs', () => {
    const { nodes } = build('tsv', { detection: latLng })
    expect(nodes[0]).toMatchObject({ type: 'FileOp', data: { inputs: { format: 'tsv' } } })
    expect(nodes.map(n => n.type)).toEqual(
      build('csv', { detection: latLng }).nodes.map(n => n.type)
    )
  })

  it('sizes points by an obvious numeric column', () => {
    const { nodes, edges } = build('csv', { detection: latLngSized })
    expect(nodes).toHaveLength(6)
    const radius = nodes.find(n => n.id === '/scatter-radius')
    expect(radius?.type).toBe('AccessorOp')
    expect(radius?.data.inputs.expression).toContain('d.population')
    expect(nodes.find(n => n.id === '/scatter')?.data.inputs).not.toHaveProperty('getRadius')
    expect(edges).toContainEqual(
      expect.objectContaining({
        source: '/scatter-radius',
        target: '/scatter',
        targetHandle: 'par.getRadius',
      })
    )
  })

  it('draws WKT points with a ScatterplotLayer', () => {
    const { nodes } = build('csv', { detection: wktPoints })
    expect(nodes.map(n => n.type)).toContain('ScatterplotLayerOp')
    expect(nodes[1].data.inputs.expression).toBe('utils.parseWkt(d.WKT).coordinates')
  })

  it('converts WKT shapes to GeoJSON for a GeoJsonLayer', () => {
    const { nodes, edges } = build('csv', { detection: wktShapes })
    expect(nodes.map(n => n.type)).toEqual([
      'FileOp',
      'CodeOp',
      'GeoJsonLayerOp',
      'MaplibreBasemapOp',
      'DeckRendererOp',
    ])
    expect(edges.map(e => `${e.source}->${e.target}`)).toEqual([
      '/data->/to-geojson',
      '/to-geojson->/geojson-layer',
      '/basemap->/deck',
      '/geojson-layer->/deck',
    ])
  })

  it("keeps today's pipeline when no coordinates were found", () => {
    const { nodes, viewState } = build('csv', { detection: noCoordinates })
    expect(nodes.map(n => n.type)).toEqual([
      'FileOp',
      'AccessorOp',
      'ScatterplotLayerOp',
      'MaplibreBasemapOp',
      'DeckRendererOp',
      'BoundingBoxOp',
    ])
    expect(nodes[1].data.inputs.expression).toBe('[d.lng, d.lat]')
    expect(viewState).toBeUndefined()
  })

  it('returns the camera for an existing renderer to apply', () => {
    const { nodes, viewState } = build('csv', { detection: latLng, rendererId: '/deck' })
    expect(nodes.map(n => n.type)).toEqual(['FileOp', 'AccessorOp', 'ScatterplotLayerOp'])
    expect(viewState).toBeDefined()
  })

  it('fits the camera to GeoJSON bounds', () => {
    const detection: CoordinateDetection = {
      kind: 'geojson',
      rowCount: 1,
      bounds: { west: 10, east: 11, south: 50, north: 51 },
    }
    const { nodes, viewState } = build('geojson', { detection })
    expect(viewState?.longitude).toBeCloseTo(10.5)
    expect(nodes.find(n => n.type === 'MaplibreBasemapOp')?.data.inputs).toEqual({ viewState })
  })

  it('builds a GeoJsonLayer pipeline for GeoJSON', () => {
    const { nodes } = build('geojson')
    expect(nodes.map(n => n.type)).toEqual([
      'FileOp',
      'GeoJsonLayerOp',
      'MaplibreBasemapOp',
      'DeckRendererOp',
    ])
    // BoundingBox only accepts point arrays, so it is not wired for geo sources
    expect(nodes.some(n => n.type === 'BoundingBoxOp')).toBe(false)
  })

  it('uses the format-specific source operator and output handle', () => {
    expect(build('shapefile').nodes[0].type).toBe('ShapefileOp')
    expect(build('geoparquet').nodes[0].type).toBe('GeoParquetOp')
    expect(build('geoparquet').edges[0].sourceHandle).toBe('out.featureCollection')
    expect(build('csv').edges.find(e => e.source === '/data')?.sourceHandle).toBe('out.data')
  })

  it('creates every node an edge refers to', () => {
    // Regression: the old CSV builder wired edges to a /deck node it never created
    for (const format of [
      'csv',
      'json',
      'geojson',
      'shapefile',
      'geoparquet',
    ] as DetectedFormat[]) {
      const { nodes, edges } = build(format)
      const ids = new Set(nodes.map(n => n.id))
      for (const edge of edges) {
        expect(ids.has(edge.source), `${format}: ${edge.id}`).toBe(true)
        expect(ids.has(edge.target), `${format}: ${edge.id}`).toBe(true)
      }
    }
  })

  it('attaches to an existing renderer instead of scaffolding another', () => {
    const { nodes, edges } = build('geojson', { rendererId: '/deck' })
    expect(nodes.map(n => n.type)).toEqual(['FileOp', 'GeoJsonLayerOp'])
    expect(edges.at(-1)).toEqual({
      id: '/geojson-layer.out.layer->/deck.par.layers',
      source: '/geojson-layer',
      target: '/deck',
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    })
  })

  it('creates PMTiles on its own since no layer consumes a source config', () => {
    const { nodes, edges, primaryNodeId } = build('pmtiles', { rendererId: '/deck' })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('PMTilesOp')
    expect(edges).toHaveLength(0)
    expect(primaryNodeId).toBe('/pmtiles')
  })

  it('generates unique edge ids and lays nodes out left to right', () => {
    const { nodes, edges } = build('csv')
    expect(new Set(edges.map(e => e.id)).size).toBe(edges.length)

    const source = nodes.find(n => n.type === 'FileOp')!
    const layer = nodes.find(n => n.type === 'ScatterplotLayerOp')!
    const renderer = nodes.find(n => n.type === 'DeckRendererOp')!
    expect(source.position.x).toBeLessThan(layer.position.x)
    expect(layer.position.x).toBeLessThan(renderer.position.x)
    expect(source.position).toEqual(basePosition)
  })
})
