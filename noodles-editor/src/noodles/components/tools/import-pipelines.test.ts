import { type EditorDoc, lowerDocument, OPERATOR_INDEX } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { validConnection } from '../../../editor/doc-ops'
import { registerHostOperators } from '../../../runtime/host/host-ops'
import { type CoordinateDetection, detectCoordinates, type Row } from './detect-coordinates'
import {
  createImportDoc,
  type DetectedFormat,
  detectFormat,
  detectFormatFromUrl,
  isBinaryFormat,
  isImportable,
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

const oddColumns = detectRows([
  { 'Lon (deg)': -74, 'Lat (deg)': 40.7 },
  { 'Lon (deg)': -0.1, 'Lat (deg)': 51.5 },
])

const EMPTY: EditorDoc = { version: 1, name: 'import', nodes: [], edges: [] }

function build(format: DetectedFormat, extra: Partial<Parameters<typeof createImportDoc>[0]> = {}) {
  return createImportDoc({ doc: EMPTY, url: '@/data', format, basePosition, ...extra })
}

/** A document with what an import built, as it would land. */
function landed(built: ReturnType<typeof build>, doc = EMPTY): EditorDoc {
  return { ...doc, nodes: [...doc.nodes, ...built.nodes], edges: [...doc.edges, ...built.edges] }
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

describe('createImportDoc', () => {
  beforeAll(() => {
    registerHostOperators()
  })

  const cases: [DetectedFormat, CoordinateDetection?][] = [
    ['csv'],
    ['tsv'],
    ['json'],
    ['geojson'],
    ['shapefile'],
    ['geoparquet'],
    ['pmtiles'],
    ['csv', latLng],
    ['csv', latLngSized],
    ['csv', wktPoints],
    ['csv', wktShapes],
    ['csv', noCoordinates],
    ['csv', oddColumns],
  ]

  it.each(cases)(
    'builds %s (%o) from real operators, parameters and ports',
    (format, detection) => {
      const built = build(format, { detection })
      const doc = landed(built)
      for (const node of built.nodes) {
        const op = OPERATOR_INDEX.get(node.op)
        expect(op, node.op).toBeDefined()
        for (const key of Object.keys(node.params)) {
          expect(
            op?.params.map(p => p.name),
            `${node.op}.${key}`
          ).toContain(key)
        }
      }
      for (const e of built.edges) {
        expect(
          validConnection(
            { ...doc, edges: doc.edges.filter(x => x !== e) },
            e.source,
            e.sourcePort,
            e.target,
            e.targetPort
          ),
          `${e.source}.${e.sourcePort} -> ${e.target}.${e.targetPort}`
        ).toBe(true)
      }
      // A host reader's rows reach DuckDB when it runs; here a stand-in table does
      const hostTable = () => 'SELECT ST_Point(0, 0) AS geom, 0.0 AS lng, 0.0 AS lat'
      expect(lowerDocument(doc, { hostTable }).errors).toEqual([])
    }
  )

  it('draws lat / lng columns as points, framed on the data', () => {
    const { nodes, viewState, newDeck } = build('csv', { detection: latLng })
    expect(nodes.map(n => n.op)).toEqual(['deck', 'file', 'scatter'])
    expect(nodes[1].params).toEqual({ url: '@/data', format: 'csv' })
    expect(nodes[2].params).toMatchObject({ position: '[Longitude, Latitude]', radiusScale: 16 })
    expect(newDeck).toBe(true)
    expect(viewState?.latitude).toBeGreaterThan(40)
    expect(nodes[0].params).toMatchObject({ latitude: viewState?.latitude })
  })

  it('sizes points by an obvious numeric column, by area', () => {
    const scatter = build('csv', { detection: latLngSized }).nodes.find(n => n.op === 'scatter')
    expect(scatter?.params.radius).toMatch(
      /sqrt\(max\(0\.0, \(population - 8000000\) \/ 1000000\)\)/
    )
  })

  it('renames columns the expression language cannot name, in SQL', () => {
    const { nodes } = build('csv', { detection: oddColumns })
    expect(nodes.find(n => n.op === 'sql')?.params.query).toBe(
      'SELECT *, "Lon (deg)" AS __lng, "Lat (deg)" AS __lat FROM {{input0}}'
    )
    expect(nodes.find(n => n.op === 'scatter')?.params.position).toBe('[__lng, __lat]')
  })

  it('reads WKT points and shapes in DuckDB spatial', () => {
    const points = build('csv', { detection: wktPoints }).nodes.find(n => n.op === 'sql')
    expect(points?.params.query).toContain('ST_X(TRY(ST_GeomFromText("WKT")))')
    const shapes = build('csv', { detection: wktShapes })
    expect(shapes.nodes.map(n => n.op)).toEqual([
      'deck',
      'file',
      'sql',
      'geojson',
      'polygon',
      'path',
      'scatter',
    ])
  })

  it('reads shapefiles on the host and draws their features through DuckDB', () => {
    const { nodes, edges } = build('shapefile')
    const reader = nodes.find(n => n.op === 'ShapefileOp')
    expect(edges).toContainEqual(
      expect.objectContaining({
        source: reader?.id,
        sourcePort: 'featureCollection',
        targetPort: 'in',
      })
    )
  })

  it('fits the camera to the rows when nothing gave bounds', () => {
    const { nodes, edges } = build('csv')
    const bbox = nodes.find(n => n.op === 'BoundingBoxOp')
    expect(edges).toContainEqual(
      expect.objectContaining({
        source: bbox?.id,
        sourcePort: 'viewState',
        targetPort: 'viewState',
      })
    )
  })

  it("adds layers to the document's deck after the ones it draws", () => {
    const first = build('csv', { detection: latLng })
    const doc = landed(first)
    const second = createImportDoc({ doc, url: '@/more', format: 'geojson', basePosition })
    expect(second.newDeck).toBe(false)
    expect(second.nodes.some(n => n.op === 'deck')).toBe(false)
    expect(second.edges.filter(e => e.targetPort === 'layers').map(e => e.index)).toEqual([1, 2, 3])
    // Names stay unique across imports
    const names = landed(second, doc).nodes.map(n => n.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps a PMTiles reader on its own', () => {
    expect(build('pmtiles').nodes.map(n => n.op)).toEqual(['PMTilesOp'])
  })
})
