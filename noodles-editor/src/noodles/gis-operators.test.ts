import * as turf from '@turf/turf'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AggregateOp,
  AlongOp,
  AreaOp,
  BufferOp,
  CentroidOp,
  ClipOp,
  ConvexHullOp,
  DBScanClusterOp,
  DifferenceOp,
  DissolveOp,
  ExplodeOp,
  GeoEditorOp,
  GeoParquetOp,
  HexGridOp,
  IntersectOp,
  KMeansClusterOp,
  LengthOp,
  LineSliceOp,
  LineToPolygonOp,
  NearestPointOp,
  PMTilesOp,
  PointGridOp,
  PointInPolygonOp,
  PolygonToLineOp,
  ReprojectOp,
  ShapefileOp,
  SpatialJoinOp,
  SquareGridOp,
  TinOp,
  TransformRotateOp,
  TransformScaleOp,
  TransformTranslateOp,
  UnionOp,
  VoronoiOp,
  XYZTileOp,
} from './operators'

beforeAll(() => {
  ;(globalThis as unknown as Record<string, unknown>).turf = turf
})

const polygon = turf.polygon([
  [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ],
])
const polygon2 = turf.polygon([
  [
    [5, 5],
    [15, 5],
    [15, 15],
    [5, 15],
    [5, 5],
  ],
])
const polygonFC = turf.featureCollection([polygon])
const polygon2FC = turf.featureCollection([polygon2])
const twoPolygonsFC = turf.featureCollection([polygon, polygon2])

const points = turf.featureCollection([
  turf.point([1, 1], { value: 10 }),
  turf.point([2, 2], { value: 20 }),
  turf.point([8, 8], { value: 30 }),
  turf.point([9, 9], { value: 40 }),
  turf.point([5, 5], { value: 50 }),
])

const line = turf.lineString([
  [0, 0],
  [5, 5],
  [10, 0],
])
const lineFC = turf.featureCollection([line])

describe('GeoEditor Operator', () => {
  it('parses FeatureCollection from JSON string', () => {
    const op = new GeoEditorOp('/geo-editor')
    const fc = JSON.stringify({ type: 'FeatureCollection', features: [polygon] })
    const result = op.execute({ geojson: fc })
    expect(result.featureCollection.type).toBe('FeatureCollection')
    expect(result.featureCollection.features).toHaveLength(1)
  })

  it('wraps a single Feature into FeatureCollection', () => {
    const op = new GeoEditorOp('/geo-editor')
    const result = op.execute({ geojson: JSON.stringify(polygon) })
    expect(result.featureCollection.type).toBe('FeatureCollection')
    expect(result.featureCollection.features).toHaveLength(1)
  })

  it('wraps raw geometry into Feature and FeatureCollection', () => {
    const op = new GeoEditorOp('/geo-editor')
    const geometry = { type: 'Point', coordinates: [0, 0] }
    const result = op.execute({ geojson: JSON.stringify(geometry) })
    expect(result.featureCollection.features[0].type).toBe('Feature')
    expect(result.featureCollection.features[0].geometry.type).toBe('Point')
  })

  it('returns empty collection for invalid JSON', () => {
    const op = new GeoEditorOp('/geo-editor')
    const result = op.execute({ geojson: 'not valid json' })
    expect(result.featureCollection.features).toHaveLength(0)
  })
})

describe('Buffer Operator', () => {
  it('creates a buffer around a polygon', () => {
    const op = new BufferOp('/buffer')
    const result = op.execute({ geojson: polygonFC, radius: 1, units: 'kilometers', steps: 64 })
    expect(result.featureCollection.type).toBe('FeatureCollection')
    expect(result.featureCollection.features.length).toBeGreaterThan(0)
  })

  it('returns empty for empty input', () => {
    const op = new BufferOp('/buffer')
    const result = op.execute({
      geojson: { type: 'FeatureCollection', features: [] },
      radius: 1,
      units: 'kilometers',
      steps: 64,
    })
    expect(result.featureCollection.features).toHaveLength(0)
  })
})

describe('Union Operator', () => {
  it('merges overlapping polygons', () => {
    const op = new UnionOp('/union')
    const result = op.execute({ geojson: twoPolygonsFC })
    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].geometry.type).toMatch(/Polygon/)
  })

  it('skips non-polygon features', () => {
    const op = new UnionOp('/union')
    const mixed = turf.featureCollection([turf.point([0, 0])])
    const result = op.execute({ geojson: mixed })
    expect(result.featureCollection.features).toHaveLength(0)
  })
})

describe('Difference Operator', () => {
  it('subtracts polygon B from polygon A', () => {
    const op = new DifferenceOp('/diff')
    const result = op.execute({ a: polygonFC, b: polygon2FC })
    expect(result.featureCollection.features.length).toBeGreaterThan(0)
    const diffArea = turf.area(result.featureCollection.features[0])
    const origArea = turf.area(polygon)
    expect(diffArea).toBeLessThan(origArea)
  })
})

describe('Intersect Operator', () => {
  it('finds overlap between two polygons', () => {
    const op = new IntersectOp('/intersect')
    const result = op.execute({ a: polygonFC, b: polygon2FC })
    expect(result.featureCollection.features).toHaveLength(1)
    const intArea = turf.area(result.featureCollection.features[0])
    expect(intArea).toBeGreaterThan(0)
  })

  it('returns empty for non-overlapping polygons', () => {
    const op = new IntersectOp('/intersect')
    const far = turf.featureCollection([
      turf.polygon([
        [
          [100, 100],
          [110, 100],
          [110, 110],
          [100, 110],
          [100, 100],
        ],
      ]),
    ])
    const result = op.execute({ a: polygonFC, b: far })
    expect(result.featureCollection.features).toHaveLength(0)
  })
})

describe('Centroid Operator', () => {
  it('calculates centroid of features', () => {
    const op = new CentroidOp('/centroid')
    const result = op.execute({ geojson: polygonFC })
    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].geometry.type).toBe('Point')
    const [lng, lat] = result.featureCollection.features[0].geometry.coordinates
    expect(lng).toBeCloseTo(5, 0)
    expect(lat).toBeCloseTo(5, 0)
  })
})

describe('ConvexHull Operator', () => {
  it('computes convex hull of scattered points', () => {
    const op = new ConvexHullOp('/hull')
    const scatteredPoints = turf.featureCollection([
      turf.point([0, 0]),
      turf.point([10, 0]),
      turf.point([5, 10]),
      turf.point([3, 3]),
    ])
    const result = op.execute({ geojson: scatteredPoints })
    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].geometry.type).toBe('Polygon')
  })

  it('returns empty for insufficient points', () => {
    const op = new ConvexHullOp('/hull')
    const twoPoints = turf.featureCollection([turf.point([0, 0]), turf.point([1, 1])])
    const result = op.execute({ geojson: twoPoints })
    expect(result.featureCollection.features).toHaveLength(0)
  })
})

describe('Voronoi Operator', () => {
  it('generates voronoi polygons from points', () => {
    const op = new VoronoiOp('/voronoi')
    const result = op.execute({ geojson: points })
    expect(result.featureCollection.features.length).toBeGreaterThanOrEqual(points.features.length)
  })
})

describe('Dissolve Operator', () => {
  it('dissolves polygons', () => {
    const op = new DissolveOp('/dissolve')
    const result = op.execute({ geojson: twoPolygonsFC, propertyName: '' })
    expect(result.featureCollection.type).toBe('FeatureCollection')
  })
})

describe('Clip Operator', () => {
  it('clips features to a mask polygon', () => {
    const op = new ClipOp('/clip')
    const mask = turf.featureCollection([
      turf.polygon([
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
          [0, 0],
        ],
      ]),
    ])
    const result = op.execute({ geojson: points, mask })
    expect(result.featureCollection.features.length).toBeLessThan(points.features.length)
  })
})

describe('SpatialJoin Operator', () => {
  it('joins attributes from polygon to points', () => {
    const op = new SpatialJoinOp('/sjoin')
    const polys = turf.featureCollection([
      turf.polygon(
        [
          [
            [0, 0],
            [6, 0],
            [6, 6],
            [0, 6],
            [0, 0],
          ],
        ],
        { zone: 'A' }
      ),
    ])
    const result = op.execute({ target: points, join: polys, relationship: 'within' })
    expect(result.featureCollection.features).toHaveLength(points.features.length)
  })
})

describe('PointInPolygon Operator', () => {
  it('filters points inside a polygon', () => {
    const op = new PointInPolygonOp('/pip')
    const result = op.execute({ points, polygon: polygonFC, invert: false })
    expect(result.inside.features.length).toBeGreaterThan(0)
    expect(result.outside.features.length).toBeGreaterThanOrEqual(0)
    expect(result.inside.features.length + result.outside.features.length).toBe(
      points.features.length
    )
  })

  it('inverts selection when invert=true', () => {
    const op = new PointInPolygonOp('/pip')
    const normal = op.execute({ points, polygon: polygonFC, invert: false })
    const inverted = op.execute({ points, polygon: polygonFC, invert: true })
    expect(inverted.inside.features.length).toBe(normal.outside.features.length)
  })
})

describe('NearestPoint Operator', () => {
  it('finds nearest point to target', () => {
    const op = new NearestPointOp('/nearest')
    const result = op.execute({ targetPoint: [0.5, 0.5], points })
    expect(result.nearest.features).toHaveLength(1)
    expect(result.distance).toBeGreaterThan(0)
  })
})

describe('Area Operator', () => {
  it('calculates area of polygons', () => {
    const op = new AreaOp('/area')
    const result = op.execute({ geojson: polygonFC, units: 'squareKilometers' })
    expect(result.totalArea).toBeGreaterThan(0)
    expect(result.featureCollection.features[0].properties.area).toBeGreaterThan(0)
  })
})

describe('Length Operator', () => {
  it('calculates length of lines', () => {
    const op = new LengthOp('/length')
    const result = op.execute({ geojson: lineFC, units: 'kilometers' })
    expect(result.totalLength).toBeGreaterThan(0)
    expect(result.featureCollection.features[0].properties.length).toBeGreaterThan(0)
  })
})

describe('Reproject Operator', () => {
  it('transforms WGS84 to Web Mercator', () => {
    const op = new ReprojectOp('/reproj')
    const pt = turf.featureCollection([turf.point([0, 0])])
    const result = op.execute({ geojson: pt, from: 'EPSG:4326', to: 'EPSG:3857' })
    const coords = result.featureCollection.features[0].geometry.coordinates
    expect(coords[0]).toBeCloseTo(0, 1)
    expect(coords[1]).toBeCloseTo(0, 1)
  })

  it('no-ops when from === to', () => {
    const op = new ReprojectOp('/reproj')
    const result = op.execute({ geojson: points, from: 'EPSG:4326', to: 'EPSG:4326' })
    expect(result.featureCollection).toBe(points)
  })
})

describe('Grid Operators', () => {
  it('PointGrid generates points', () => {
    const op = new PointGridOp('/pgrid')
    const result = op.execute({ bbox: [0, 0, 1, 1], cellSize: 50, units: 'kilometers' })
    expect(result.featureCollection.features.length).toBeGreaterThan(0)
    expect(result.featureCollection.features[0].geometry.type).toBe('Point')
  })

  it('HexGrid generates hexagons', () => {
    const op = new HexGridOp('/hgrid')
    const result = op.execute({ bbox: [0, 0, 1, 1], cellSize: 50, units: 'kilometers' })
    expect(result.featureCollection.features.length).toBeGreaterThan(0)
    expect(result.featureCollection.features[0].geometry.type).toBe('Polygon')
  })

  it('SquareGrid generates squares', () => {
    const op = new SquareGridOp('/sgrid')
    const result = op.execute({ bbox: [0, 0, 1, 1], cellSize: 50, units: 'kilometers' })
    expect(result.featureCollection.features.length).toBeGreaterThan(0)
    expect(result.featureCollection.features[0].geometry.type).toBe('Polygon')
  })
})

describe('Tin Operator', () => {
  it('generates TIN from non-collinear points', () => {
    const op = new TinOp('/tin')
    const nonCollinear = turf.featureCollection([
      turf.point([0, 0], { elevation: 100 }),
      turf.point([10, 0], { elevation: 200 }),
      turf.point([5, 10], { elevation: 300 }),
      turf.point([3, 5], { elevation: 150 }),
    ])
    const result = op.execute({ geojson: nonCollinear, zProperty: 'elevation' })
    expect(result.featureCollection.features.length).toBeGreaterThan(0)
    expect(result.featureCollection.features[0].geometry.type).toBe('Polygon')
  })

  it('returns empty for insufficient points', () => {
    const op = new TinOp('/tin')
    const twoPoints = turf.featureCollection([turf.point([0, 0]), turf.point([1, 1])])
    const result = op.execute({ geojson: twoPoints, zProperty: '' })
    expect(result.featureCollection.type).toBe('FeatureCollection')
  })
})

describe('LineToPolygon / PolygonToLine', () => {
  it('converts a closed line to polygon', () => {
    const op = new LineToPolygonOp('/l2p')
    const closedLine = turf.featureCollection([
      turf.lineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]),
    ])
    const result = op.execute({ geojson: closedLine })
    expect(result.featureCollection.features[0].geometry.type).toBe('Polygon')
  })

  it('converts polygon to line', () => {
    const op = new PolygonToLineOp('/p2l')
    const result = op.execute({ geojson: polygonFC })
    expect(result.featureCollection.features[0].geometry.type).toBe('LineString')
  })
})

describe('Explode Operator', () => {
  it('explodes to vertices', () => {
    const op = new ExplodeOp('/explode')
    const result = op.execute({ geojson: polygonFC, mode: 'vertices' })
    expect(result.featureCollection.features.length).toBeGreaterThan(1)
    expect(result.featureCollection.features[0].geometry.type).toBe('Point')
  })

  it('explodes to parts (flatten)', () => {
    const op = new ExplodeOp('/explode')
    const result = op.execute({ geojson: twoPolygonsFC, mode: 'parts' })
    expect(result.featureCollection.features).toHaveLength(2)
  })
})

describe('Aggregate Operator', () => {
  it('counts points in polygons', () => {
    const op = new AggregateOp('/agg')
    const result = op.execute({ polygons: polygonFC, points, field: '', operation: 'count' })
    expect(result.featureCollection.features[0].properties.count_points).toBeGreaterThan(0)
  })

  it('sums a field value', () => {
    const op = new AggregateOp('/agg')
    const result = op.execute({ polygons: polygonFC, points, field: 'value', operation: 'sum' })
    expect(result.featureCollection.features[0].properties.sum_value).toBeGreaterThan(0)
  })

  it('computes mean of a field', () => {
    const op = new AggregateOp('/agg')
    const result = op.execute({ polygons: polygonFC, points, field: 'value', operation: 'mean' })
    expect(result.featureCollection.features[0].properties.mean_value).toBeGreaterThan(0)
  })
})

describe('Clustering Operators', () => {
  it('KMeansCluster groups points', () => {
    const op = new KMeansClusterOp('/kmeans')
    const result = op.execute({ geojson: points, numberOfClusters: 2 })
    expect(result.featureCollection.features).toHaveLength(points.features.length)
    const clusters = new Set(
      result.featureCollection.features.map((f: GeoJSON.Feature) => f.properties?.cluster)
    )
    expect(clusters.size).toBeGreaterThanOrEqual(2)
  })

  it('DBScanCluster groups by density', () => {
    const op = new DBScanClusterOp('/dbscan')
    const result = op.execute({
      geojson: points,
      maxDistance: 200,
      units: 'kilometers',
      minPoints: 2,
    })
    expect(result.featureCollection.features).toHaveLength(points.features.length)
  })
})

describe('Along Operator', () => {
  it('finds point along a line at given distance', () => {
    const op = new AlongOp('/along')
    const result = op.execute({ geojson: lineFC, distance: 100, units: 'kilometers' })
    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].geometry.type).toBe('Point')
  })
})

describe('LineSlice Operator', () => {
  it('extracts segment of a line', () => {
    const op = new LineSliceOp('/slice')
    const result = op.execute({
      geojson: lineFC,
      startDistance: 0,
      stopDistance: 100,
      units: 'kilometers',
    })
    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].geometry.type).toBe('LineString')
  })
})

describe('Transform Operators', () => {
  it('TransformRotate rotates features', () => {
    const op = new TransformRotateOp('/rotate')
    const result = op.execute({ geojson: polygonFC, angle: 45, pivot: 'centroid' })
    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].geometry.coordinates).not.toEqual(
      polygon.geometry.coordinates
    )
  })

  it('TransformScale scales features', () => {
    const op = new TransformScaleOp('/scale')
    const result = op.execute({ geojson: polygonFC, factor: 2, origin: 'centroid' })
    expect(result.featureCollection.features).toHaveLength(1)
    const scaledArea = turf.area(result.featureCollection.features[0])
    const originalArea = turf.area(polygon)
    expect(scaledArea).toBeGreaterThan(originalArea * 3)
  })

  it('TransformTranslate moves features', () => {
    const op = new TransformTranslateOp('/translate')
    const result = op.execute({
      geojson: polygonFC,
      distance: 100,
      direction: 90,
      units: 'kilometers',
    })
    const centroid = turf.centroid(result.featureCollection.features[0])
    const origCentroid = turf.centroid(polygon)
    expect(centroid.geometry.coordinates[0]).toBeGreaterThan(origCentroid.geometry.coordinates[0])
  })

  it('TransformRotate no-ops at angle=0', () => {
    const op = new TransformRotateOp('/rotate')
    const result = op.execute({ geojson: polygonFC, angle: 0, pivot: 'centroid' })
    expect(result.featureCollection).toEqual(polygonFC)
  })
})

describe('Format Support Operators', () => {
  it('PMTilesOp generates vector source config', () => {
    const op = new PMTilesOp('/pmtiles')
    const result = op.execute({
      url: 'https://example.com/tiles.pmtiles',
      sourceLayer: 'buildings',
      minZoom: 0,
      maxZoom: 14,
    })
    expect(result.sourceConfig.type).toBe('vector')
    expect(result.sourceConfig.url).toBe('pmtiles://https://example.com/tiles.pmtiles')
    expect(result.sourceConfig.sourceLayer).toBe('buildings')
  })

  it('PMTilesOp returns null for empty URL', () => {
    const op = new PMTilesOp('/pmtiles')
    const result = op.execute({ url: '', sourceLayer: '', minZoom: 0, maxZoom: 14 })
    expect(result.sourceConfig).toBeNull()
  })

  it('XYZTileOp generates raster source config', () => {
    const op = new XYZTileOp('/xyz')
    const result = op.execute({
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      subdomains: 'abc',
      tileSize: 256,
      minZoom: 0,
      maxZoom: 19,
      attribution: '© OSM',
    })
    expect(result.sourceConfig.type).toBe('raster')
    expect(result.sourceConfig.tiles).toHaveLength(3)
    expect(result.sourceConfig.tiles[0]).toContain('a.tile')
    expect(result.sourceConfig.tileSize).toBe(256)
    expect(result.sourceConfig.attribution).toBe('© OSM')
  })

  it('XYZTileOp handles no subdomains', () => {
    const op = new XYZTileOp('/xyz')
    const result = op.execute({
      url: 'https://tile.example.com/{z}/{x}/{y}.png',
      subdomains: '',
      tileSize: 256,
      minZoom: 0,
      maxZoom: 19,
      attribution: '',
    })
    expect(result.sourceConfig.tiles).toHaveLength(1)
  })

  it('GeoParquetOp returns empty for no URL', async () => {
    const op = new GeoParquetOp('/geoparquet')
    const result = await op.execute({ url: '', geometryColumn: 'geometry', limit: 0 })
    expect(result.featureCollection.features).toHaveLength(0)
    expect(result.data).toHaveLength(0)
  })

  it('ShapefileOp returns empty for no URL', async () => {
    const op = new ShapefileOp('/shp')
    const result = await op.execute({ url: '', encoding: 'utf-8' })
    expect(result.featureCollection.features).toHaveLength(0)
  })
})
