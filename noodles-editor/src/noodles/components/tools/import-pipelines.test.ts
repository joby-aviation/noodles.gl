import { describe, expect, it } from 'vitest'
import { opTypes } from '../../operators'
import {
  createImportPipeline,
  type DetectedFormat,
  detectFormat,
  detectFormatFromUrl,
  detectPositionAccessor,
  isBinaryFormat,
  isImportable,
} from './import-pipelines'

const basePosition = { x: 100, y: 200 }

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
    expect(detectFormat('a.tsv')).toBe('csv')
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

describe('detectPositionAccessor', () => {
  it('finds longitude and latitude columns by name', () => {
    expect(detectPositionAccessor('name,Longitude,Latitude\nNYC,-74,40')).toBe(
      '[d["Longitude"], d["Latitude"]]'
    )
    expect(detectPositionAccessor('lon\tlat\n1\t2')).toBe('[d["lon"], d["lat"]]')
  })

  it('strips quotes from header cells', () => {
    expect(detectPositionAccessor('"lng","lat"\n1,2')).toBe('[d["lng"], d["lat"]]')
  })

  it('falls back when columns are unrecognized or missing', () => {
    expect(detectPositionAccessor('a,b\n1,2')).toBe('[d.lng, d.lat]')
    expect(detectPositionAccessor('')).toBe('[d.lng, d.lat]')
    expect(detectPositionAccessor(undefined)).toBe('[d.lng, d.lat]')
  })
})

describe('createImportPipeline', () => {
  it('references only registered operator types with valid handles', () => {
    const formats: DetectedFormat[] = ['csv', 'json', 'geojson', 'shapefile', 'geoparquet']
    for (const format of formats) {
      const { nodes, edges } = build(format)
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

  it('builds a scatterplot pipeline for CSV', () => {
    const { nodes, primaryNodeId } = build('csv', { contents: 'lng,lat\n1,2' })
    expect(nodes.map(n => n.type)).toEqual([
      'FileOp',
      'AccessorOp',
      'ScatterplotLayerOp',
      'MaplibreBasemapOp',
      'DeckRendererOp',
      'BoundingBoxOp',
    ])
    expect(primaryNodeId).toBe('/data')
    expect(nodes[0].data.inputs).toEqual({ format: 'csv', url: '@/data' })
    expect(nodes[1].data.inputs.expression).toBe('[d["lng"], d["lat"]]')
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
