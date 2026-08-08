import type { OpType } from '../../operators'
import { nodeId as defaultNodeId } from '../../utils/id-utils'

// Recipes are declarative descriptions of a single-purpose GIS flow. The wizard renders
// them as a form, and buildRecipe() turns the answers into real nodes and edges so the
// result is an ordinary graph the user can keep editing.

export type RecipeParam =
  | {
      key: string
      label: string
      type: 'number'
      default: number
      min?: number
      max?: number
      step?: number
      hint?: string
    }
  | {
      key: string
      label: string
      type: 'select'
      default: string
      options: string[]
      hint?: string
    }
  | {
      key: string
      label: string
      type: 'text'
      default: string
      placeholder?: string
      hint?: string
    }
  | { key: string; label: string; type: 'boolean'; default: boolean; hint?: string }
  | {
      key: string
      label: string
      type: 'bbox'
      default: [number, number, number, number]
      hint?: string
    }
  | { key: string; label: string; type: 'point'; default: [number, number]; hint?: string }
  | { key: string; label: string; type: 'numbers'; default: number[]; hint?: string }

export interface RecipeInput {
  key: string
  label: string
  hint?: string
}

export type RecipeGroup = 'geometry' | 'combine' | 'analysis' | 'grid' | 'transform' | 'source'

export interface GeoRecipe {
  // Stable identifier, used as the React key and in analytics
  id: string
  name: string
  summary: string
  opType: OpType
  // Base name for the generated node id (e.g. 'buffer' -> '/buffer', '/buffer-1', ...)
  nodeName: string
  group: RecipeGroup
  icon: string
  inputs: RecipeInput[]
  params: RecipeParam[]
  // Output handle to chain downstream (also the one wired into a layer)
  output: string
  // Whether the output can be dropped straight onto a GeoJsonLayer
  layerable: boolean
}

export const GROUP_LABELS: Record<RecipeGroup, string> = {
  geometry: 'Geometry',
  combine: 'Combine',
  analysis: 'Analysis',
  grid: 'Grids',
  transform: 'Transform',
  source: 'Sources',
}

export const GROUP_ICONS: Record<RecipeGroup, string> = {
  geometry: 'pi pi-stop',
  combine: 'pi pi-clone',
  analysis: 'pi pi-chart-bar',
  grid: 'pi pi-th-large',
  transform: 'pi pi-refresh',
  source: 'pi pi-database',
}

const DISTANCE_UNITS = ['kilometers', 'miles', 'meters']
const WORLD_BBOX: [number, number, number, number] = [-125, 25, -66, 50]

export const GEO_RECIPES: GeoRecipe[] = [
  // ==================== Geometry ====================
  {
    id: 'buffer',
    name: 'Buffer',
    summary: 'Grow or shrink features by a distance to make catchment zones.',
    opType: 'BufferOp',
    nodeName: 'buffer',
    group: 'geometry',
    icon: 'pi pi-circle',
    inputs: [{ key: 'geojson', label: 'Features to buffer' }],
    params: [
      { key: 'radius', label: 'Radius', type: 'number', default: 1, min: 0, step: 0.1 },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: [...DISTANCE_UNITS, 'degrees'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'simplify',
    name: 'Simplify',
    summary: 'Drop vertices to lighten heavy geometry. Higher tolerance is coarser.',
    opType: 'SimplifyOp',
    nodeName: 'simplify',
    group: 'geometry',
    icon: 'pi pi-filter',
    inputs: [{ key: 'feature', label: 'Features to simplify' }],
    params: [
      {
        key: 'tolerance',
        label: 'Tolerance',
        type: 'number',
        default: 0.01,
        min: 0.0001,
        max: 1,
        step: 0.005,
        hint: 'Degrees of allowed deviation.',
      },
      { key: 'highQuality', label: 'High quality', type: 'boolean', default: false },
    ],
    output: 'feature',
    layerable: true,
  },
  {
    id: 'smooth',
    name: 'Smooth Lines',
    summary: 'Round off jagged LineStrings with a moving-average kernel.',
    opType: 'SmoothOp',
    nodeName: 'smooth',
    group: 'geometry',
    icon: 'pi pi-chart-line',
    inputs: [{ key: 'feature', label: 'Lines to smooth' }],
    params: [
      {
        key: 'windowSize',
        label: 'Window size',
        type: 'number',
        default: 5,
        min: 1,
        max: 99,
        step: 2,
      },
      {
        key: 'method',
        label: 'Method',
        type: 'select',
        default: 'gaussian',
        options: ['gaussian', 'boxcar'],
      },
    ],
    output: 'feature',
    layerable: true,
  },
  {
    id: 'centroid',
    name: 'Centroid',
    summary: 'Collapse each feature to a single point at its center of mass.',
    opType: 'CentroidOp',
    nodeName: 'centroid',
    group: 'geometry',
    icon: 'pi pi-map-marker',
    inputs: [{ key: 'geojson', label: 'Features' }],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'convex-hull',
    name: 'Convex Hull',
    summary: 'Wrap all features in the smallest enclosing polygon.',
    opType: 'ConvexHullOp',
    nodeName: 'hull',
    group: 'geometry',
    icon: 'pi pi-expand',
    inputs: [{ key: 'geojson', label: 'Features' }],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'union',
    name: 'Union',
    summary: 'Merge overlapping polygons into one outline.',
    opType: 'UnionOp',
    nodeName: 'union',
    group: 'geometry',
    icon: 'pi pi-plus-circle',
    inputs: [{ key: 'geojson', label: 'Polygons to merge' }],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'dissolve',
    name: 'Dissolve',
    summary: 'Merge neighbouring polygons that share a property value.',
    opType: 'DissolveOp',
    nodeName: 'dissolve',
    group: 'geometry',
    icon: 'pi pi-objects-column',
    inputs: [{ key: 'geojson', label: 'Polygons' }],
    params: [
      {
        key: 'propertyName',
        label: 'Group by property',
        type: 'text',
        default: '',
        placeholder: 'state',
        hint: 'Leave blank to dissolve everything together.',
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'polygon-to-line',
    name: 'Polygon to Line',
    summary: 'Extract polygon boundaries as lines so you can style outlines separately.',
    opType: 'PolygonToLineOp',
    nodeName: 'polygon-to-line',
    group: 'geometry',
    icon: 'pi pi-minus',
    inputs: [{ key: 'geojson', label: 'Polygons' }],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'line-to-polygon',
    name: 'Line to Polygon',
    summary: 'Close LineStrings into fillable polygons.',
    opType: 'LineToPolygonOp',
    nodeName: 'line-to-polygon',
    group: 'geometry',
    icon: 'pi pi-stop',
    inputs: [{ key: 'geojson', label: 'Closed lines' }],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'explode',
    name: 'Explode',
    summary: 'Split multi-part geometry into parts, or pull out every vertex as a point.',
    opType: 'ExplodeOp',
    nodeName: 'explode',
    group: 'geometry',
    icon: 'pi pi-sitemap',
    inputs: [{ key: 'geojson', label: 'Features' }],
    params: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'vertices',
        options: ['vertices', 'parts'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },

  // ==================== Combine ====================
  {
    id: 'difference',
    name: 'Difference',
    summary: 'Punch one polygon out of another (A minus B).',
    opType: 'DifferenceOp',
    nodeName: 'difference',
    group: 'combine',
    icon: 'pi pi-minus-circle',
    inputs: [
      { key: 'a', label: 'Keep (A)' },
      { key: 'b', label: 'Subtract (B)' },
    ],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'intersect',
    name: 'Intersect',
    summary: 'Keep only the area where two polygons overlap.',
    opType: 'IntersectOp',
    nodeName: 'intersect',
    group: 'combine',
    icon: 'pi pi-clone',
    inputs: [
      { key: 'a', label: 'First polygon (A)' },
      { key: 'b', label: 'Second polygon (B)' },
    ],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'clip',
    name: 'Clip to Mask',
    summary: 'Trim a whole layer down to a study-area polygon.',
    opType: 'ClipOp',
    nodeName: 'clip',
    group: 'combine',
    icon: 'pi pi-crop',
    inputs: [
      { key: 'geojson', label: 'Features to clip' },
      { key: 'mask', label: 'Clip boundary' },
    ],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'spatial-join',
    name: 'Spatial Join',
    summary: 'Copy properties from one layer onto whatever it spatially matches.',
    opType: 'SpatialJoinOp',
    nodeName: 'spatial-join',
    group: 'combine',
    icon: 'pi pi-link',
    inputs: [
      { key: 'target', label: 'Features to enrich' },
      { key: 'join', label: 'Features supplying properties' },
    ],
    params: [
      {
        key: 'relationship',
        label: 'Relationship',
        type: 'select',
        default: 'within',
        options: ['within', 'intersects', 'contains'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },

  // ==================== Analysis ====================
  {
    id: 'area',
    name: 'Area',
    summary: 'Write an area property onto every polygon and report the total.',
    opType: 'AreaOp',
    nodeName: 'area',
    group: 'analysis',
    icon: 'pi pi-table',
    inputs: [{ key: 'geojson', label: 'Polygons' }],
    params: [
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'squareKilometers',
        options: ['squareMeters', 'squareKilometers', 'squareMiles', 'acres', 'hectares'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'length',
    name: 'Length',
    summary: 'Write a length property onto every line and report the total.',
    opType: 'LengthOp',
    nodeName: 'length',
    group: 'analysis',
    icon: 'pi pi-arrows-h',
    inputs: [{ key: 'geojson', label: 'Lines' }],
    params: [
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: [...DISTANCE_UNITS, 'nauticalmiles'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'point-in-polygon',
    name: 'Point in Polygon',
    summary: 'Split points into inside and outside a boundary.',
    opType: 'PointInPolygonOp',
    nodeName: 'point-in-polygon',
    group: 'analysis',
    icon: 'pi pi-check-circle',
    inputs: [
      { key: 'points', label: 'Points' },
      { key: 'polygon', label: 'Boundary polygon' },
    ],
    params: [
      {
        key: 'invert',
        label: 'Invert',
        type: 'boolean',
        default: false,
        hint: 'Swaps which side counts as inside.',
      },
    ],
    output: 'inside',
    layerable: true,
  },
  {
    id: 'aggregate',
    name: 'Aggregate to Zones',
    summary: 'Roll point values up into polygons (count, sum, mean, min, max).',
    opType: 'AggregateOp',
    nodeName: 'aggregate',
    group: 'analysis',
    icon: 'pi pi-chart-bar',
    inputs: [
      { key: 'polygons', label: 'Zones' },
      { key: 'points', label: 'Points to aggregate' },
    ],
    params: [
      {
        key: 'operation',
        label: 'Operation',
        type: 'select',
        default: 'count',
        options: ['count', 'sum', 'mean', 'min', 'max'],
      },
      {
        key: 'field',
        label: 'Value property',
        type: 'text',
        default: '',
        placeholder: 'population',
        hint: 'Ignored when the operation is count.',
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'kmeans',
    name: 'K-Means Clusters',
    summary: 'Group points into a fixed number of clusters.',
    opType: 'KMeansClusterOp',
    nodeName: 'kmeans',
    group: 'analysis',
    icon: 'pi pi-share-alt',
    inputs: [{ key: 'geojson', label: 'Points' }],
    params: [
      {
        key: 'numberOfClusters',
        label: 'Clusters',
        type: 'number',
        default: 5,
        min: 2,
        max: 100,
        step: 1,
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'dbscan',
    name: 'DBSCAN Clusters',
    summary: 'Find dense point clusters without picking a cluster count up front.',
    opType: 'DBScanClusterOp',
    nodeName: 'dbscan',
    group: 'analysis',
    icon: 'pi pi-asterisk',
    inputs: [{ key: 'geojson', label: 'Points' }],
    params: [
      {
        key: 'maxDistance',
        label: 'Neighbour distance',
        type: 'number',
        default: 1,
        min: 0,
        step: 0.1,
      },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: DISTANCE_UNITS,
      },
      { key: 'minPoints', label: 'Minimum points', type: 'number', default: 3, min: 1, step: 1 },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'nearest-point',
    name: 'Nearest Point',
    summary: 'Find the closest point in a layer to a coordinate.',
    opType: 'NearestPointOp',
    nodeName: 'nearest',
    group: 'analysis',
    icon: 'pi pi-directions',
    inputs: [{ key: 'points', label: 'Points to search' }],
    params: [{ key: 'targetPoint', label: 'Target', type: 'point', default: [-74.006, 40.7128] }],
    output: 'nearest',
    layerable: true,
  },
  {
    id: 'voronoi',
    name: 'Voronoi',
    summary: 'Carve space into the region nearest each point.',
    opType: 'VoronoiOp',
    nodeName: 'voronoi',
    group: 'analysis',
    icon: 'pi pi-th-large',
    inputs: [{ key: 'geojson', label: 'Points' }],
    params: [],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'tin',
    name: 'TIN Surface',
    summary: 'Triangulate points into a surface mesh, optionally carrying a Z value.',
    opType: 'TinOp',
    nodeName: 'tin',
    group: 'analysis',
    icon: 'pi pi-sitemap',
    inputs: [{ key: 'geojson', label: 'Points' }],
    params: [
      {
        key: 'zProperty',
        label: 'Z property',
        type: 'text',
        default: '',
        placeholder: 'elevation',
        hint: 'Leave blank for a flat triangulation.',
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'isolines',
    name: 'Isolines',
    summary: 'Draw contour lines through point data at chosen break values.',
    opType: 'IsolineOp',
    nodeName: 'isolines',
    group: 'analysis',
    icon: 'pi pi-chart-line',
    inputs: [{ key: 'geojson', label: 'Points with Z values' }],
    params: [
      { key: 'zProperty', label: 'Z property', type: 'text', default: 'elevation' },
      {
        key: 'breaks',
        label: 'Breaks',
        type: 'numbers',
        default: [100, 200, 500, 1000, 2000],
        hint: 'Comma-separated values.',
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'interpolate',
    name: 'Interpolate Grid',
    summary: 'Fill gaps between sampled points with inverse-distance weighting.',
    opType: 'InterpolateOp',
    nodeName: 'interpolate',
    group: 'analysis',
    icon: 'pi pi-th-large',
    inputs: [{ key: 'geojson', label: 'Sampled points' }],
    params: [
      { key: 'cellSize', label: 'Cell size', type: 'number', default: 1, min: 0.01, step: 0.1 },
      { key: 'property', label: 'Value property', type: 'text', default: 'value' },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: DISTANCE_UNITS,
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'along',
    name: 'Point Along Line',
    summary: 'Place a point a set distance down a line — keyframe the distance to animate it.',
    opType: 'AlongOp',
    nodeName: 'along',
    group: 'analysis',
    icon: 'pi pi-map-marker',
    inputs: [{ key: 'geojson', label: 'Lines' }],
    params: [
      { key: 'distance', label: 'Distance', type: 'number', default: 1, min: 0, step: 0.1 },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: DISTANCE_UNITS,
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'line-slice',
    name: 'Slice Line',
    summary: 'Cut a segment out of a line between two distances — animate for a draw-on effect.',
    opType: 'LineSliceOp',
    nodeName: 'line-slice',
    group: 'analysis',
    icon: 'pi pi-scissors',
    inputs: [{ key: 'geojson', label: 'Lines' }],
    params: [
      {
        key: 'startDistance',
        label: 'Start distance',
        type: 'number',
        default: 0,
        min: 0,
        step: 0.1,
      },
      {
        key: 'stopDistance',
        label: 'Stop distance',
        type: 'number',
        default: 1,
        min: 0,
        step: 0.1,
      },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: DISTANCE_UNITS,
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },

  // ==================== Grids ====================
  {
    id: 'hex-grid',
    name: 'Hex Grid',
    summary: 'Fill a bounding box with hexagons, ready to aggregate into.',
    opType: 'HexGridOp',
    nodeName: 'hex-grid',
    group: 'grid',
    icon: 'pi pi-th-large',
    inputs: [],
    params: [
      { key: 'bbox', label: 'Bounds', type: 'bbox', default: WORLD_BBOX },
      { key: 'cellSize', label: 'Cell size', type: 'number', default: 50, min: 0.001, step: 1 },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: [...DISTANCE_UNITS, 'degrees'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'square-grid',
    name: 'Square Grid',
    summary: 'Fill a bounding box with square cells.',
    opType: 'SquareGridOp',
    nodeName: 'square-grid',
    group: 'grid',
    icon: 'pi pi-table',
    inputs: [],
    params: [
      { key: 'bbox', label: 'Bounds', type: 'bbox', default: WORLD_BBOX },
      { key: 'cellSize', label: 'Cell size', type: 'number', default: 50, min: 0.001, step: 1 },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: [...DISTANCE_UNITS, 'degrees'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'point-grid',
    name: 'Point Grid',
    summary: 'Sample a bounding box on a regular point lattice.',
    opType: 'PointGridOp',
    nodeName: 'point-grid',
    group: 'grid',
    icon: 'pi pi-ellipsis-h',
    inputs: [],
    params: [
      { key: 'bbox', label: 'Bounds', type: 'bbox', default: WORLD_BBOX },
      { key: 'cellSize', label: 'Spacing', type: 'number', default: 50, min: 0.001, step: 1 },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: [...DISTANCE_UNITS, 'degrees'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },

  // ==================== Transform ====================
  {
    id: 'rotate',
    name: 'Rotate',
    summary: 'Spin features around their own centre. Keyframe the angle to animate.',
    opType: 'TransformRotateOp',
    nodeName: 'rotate',
    group: 'transform',
    icon: 'pi pi-refresh',
    inputs: [{ key: 'geojson', label: 'Features' }],
    params: [
      { key: 'angle', label: 'Angle', type: 'number', default: 45, min: -360, max: 360, step: 1 },
      {
        key: 'pivot',
        label: 'Pivot',
        type: 'select',
        default: 'centroid',
        options: ['centroid', 'center'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'scale',
    name: 'Scale',
    summary: 'Grow or shrink features in place. Keyframe the factor for a pop-in.',
    opType: 'TransformScaleOp',
    nodeName: 'scale',
    group: 'transform',
    icon: 'pi pi-expand',
    inputs: [{ key: 'geojson', label: 'Features' }],
    params: [
      {
        key: 'factor',
        label: 'Factor',
        type: 'number',
        default: 1.5,
        min: 0.01,
        max: 100,
        step: 0.1,
      },
      {
        key: 'origin',
        label: 'Origin',
        type: 'select',
        default: 'centroid',
        options: ['centroid', 'center', 'sw', 'se', 'nw', 'ne'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'translate',
    name: 'Translate',
    summary: 'Shift features by a distance and bearing.',
    opType: 'TransformTranslateOp',
    nodeName: 'translate',
    group: 'transform',
    icon: 'pi pi-arrows-alt',
    inputs: [{ key: 'geojson', label: 'Features' }],
    params: [
      { key: 'distance', label: 'Distance', type: 'number', default: 10, min: 0, step: 0.1 },
      { key: 'direction', label: 'Bearing', type: 'number', default: 0, min: 0, max: 360, step: 1 },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        default: 'kilometers',
        options: DISTANCE_UNITS,
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'reproject',
    name: 'Reproject',
    summary: 'Convert between WGS84 lat/lng and Web Mercator metres.',
    opType: 'ReprojectOp',
    nodeName: 'reproject',
    group: 'transform',
    icon: 'pi pi-globe',
    inputs: [{ key: 'geojson', label: 'Features' }],
    params: [
      {
        key: 'from',
        label: 'From',
        type: 'select',
        default: 'EPSG:4326',
        options: ['EPSG:4326', 'EPSG:3857'],
      },
      {
        key: 'to',
        label: 'To',
        type: 'select',
        default: 'EPSG:3857',
        options: ['EPSG:4326', 'EPSG:3857'],
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },

  // ==================== Sources ====================
  {
    id: 'geoparquet',
    name: 'GeoParquet',
    summary: 'Query a .parquet file with DuckDB Spatial and get GeoJSON back.',
    opType: 'GeoParquetOp',
    nodeName: 'geoparquet',
    group: 'source',
    icon: 'pi pi-database',
    inputs: [],
    params: [
      {
        key: 'url',
        label: 'File or URL',
        type: 'text',
        default: '',
        placeholder: 'https://…/data.parquet',
      },
      { key: 'geometryColumn', label: 'Geometry column', type: 'text', default: 'geometry' },
      {
        key: 'limit',
        label: 'Row limit',
        type: 'number',
        default: 0,
        min: 0,
        step: 1000,
        hint: '0 loads every row.',
      },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'shapefile',
    name: 'Shapefile',
    summary: 'Read a .shp archive in the browser and convert it to GeoJSON.',
    opType: 'ShapefileOp',
    nodeName: 'shapefile',
    group: 'source',
    icon: 'pi pi-file',
    inputs: [],
    params: [
      {
        key: 'url',
        label: 'File or URL',
        type: 'text',
        default: '',
        placeholder: 'https://…/roads.shp',
      },
      { key: 'encoding', label: 'Encoding', type: 'text', default: 'utf-8' },
    ],
    output: 'featureCollection',
    layerable: true,
  },
  {
    id: 'pmtiles',
    name: 'PMTiles',
    summary: 'Point MapLibre at a single-file PMTiles archive.',
    opType: 'PMTilesOp',
    nodeName: 'pmtiles',
    group: 'source',
    icon: 'pi pi-map',
    inputs: [],
    params: [
      {
        key: 'url',
        label: 'Archive URL',
        type: 'text',
        default: '',
        placeholder: 'https://…/tiles.pmtiles',
      },
      { key: 'sourceLayer', label: 'Source layer', type: 'text', default: '' },
      { key: 'minZoom', label: 'Min zoom', type: 'number', default: 0, min: 0, max: 22, step: 1 },
      { key: 'maxZoom', label: 'Max zoom', type: 'number', default: 14, min: 0, max: 22, step: 1 },
    ],
    output: 'sourceConfig',
    layerable: false,
  },
  {
    id: 'xyz-tiles',
    name: 'XYZ Tiles',
    summary: 'Add any {z}/{x}/{y} raster tile service as a source.',
    opType: 'XYZTileOp',
    nodeName: 'xyz-tiles',
    group: 'source',
    icon: 'pi pi-th-large',
    inputs: [],
    params: [
      {
        key: 'url',
        label: 'URL template',
        type: 'text',
        default: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      },
      { key: 'subdomains', label: 'Subdomains', type: 'text', default: 'abc' },
      {
        key: 'tileSize',
        label: 'Tile size',
        type: 'number',
        default: 256,
        min: 64,
        max: 1024,
        step: 64,
      },
      { key: 'minZoom', label: 'Min zoom', type: 'number', default: 0, min: 0, max: 22, step: 1 },
      { key: 'maxZoom', label: 'Max zoom', type: 'number', default: 19, min: 0, max: 22, step: 1 },
    ],
    output: 'sourceConfig',
    layerable: false,
  },
]

export const RECIPES_BY_GROUP = (
  ['geometry', 'combine', 'analysis', 'transform', 'grid', 'source'] as const
).map(group => ({ group, recipes: GEO_RECIPES.filter(r => r.group === group) }))

export function getRecipe(id: string): GeoRecipe | undefined {
  return GEO_RECIPES.find(r => r.id === id)
}

export function defaultValuesFor(recipe: GeoRecipe): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const param of recipe.params) {
    values[param.key] = param.default
  }
  return values
}

export interface SourceRef {
  source: string
  sourceHandle: string
}

// A source is stored in the wizard as a single string so it can live in a <select>
export function encodeSourceRef(ref: SourceRef): string {
  return `${ref.source}|${ref.sourceHandle}`
}

export function decodeSourceRef(value: string): SourceRef | null {
  const separator = value.lastIndexOf('|')
  if (separator <= 0) return null
  return { source: value.slice(0, separator), sourceHandle: value.slice(separator + 1) }
}

interface BuiltNode {
  id: string
  type: OpType
  data: { inputs: Record<string, unknown> }
  position: { x: number; y: number }
}

interface BuiltEdge {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

export interface BuildRecipeOptions {
  recipe: GeoRecipe
  values: Record<string, unknown>
  // Input key -> upstream output to connect, or null to leave the handle open
  sources?: Record<string, SourceRef | null>
  basePosition: { x: number; y: number }
  containerId?: string
  // Scaffold a GeoJsonLayer (and a renderer, if the graph has none) downstream
  addLayer?: boolean
  // Existing DeckRendererOp to attach the layer to
  rendererId?: string | null
  // Injectable for tests so id generation doesn't need the operator store
  makeNodeId?: (baseName: string, containerId: string) => string
}

export interface BuiltRecipe {
  nodes: BuiltNode[]
  edges: BuiltEdge[]
  // The node holding the recipe's parameters — selected after creation so the
  // user can see exactly where to change their answers
  primaryNodeId: string
}

function makeEdge(edge: Omit<BuiltEdge, 'id'>): BuiltEdge {
  return { ...edge, id: `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}` }
}

export function buildRecipe({
  recipe,
  values,
  sources = {},
  basePosition,
  containerId = '/',
  addLayer = false,
  rendererId = null,
  makeNodeId = defaultNodeId,
}: BuildRecipeOptions): BuiltRecipe {
  const inputs: Record<string, unknown> = {}
  for (const param of recipe.params) {
    const value = values[param.key]
    if (value !== undefined) inputs[param.key] = value
  }

  const primaryNodeId = makeNodeId(recipe.nodeName, containerId)
  const nodes: BuiltNode[] = [
    { id: primaryNodeId, type: recipe.opType, data: { inputs }, position: { ...basePosition } },
  ]
  const edges: BuiltEdge[] = []

  for (const input of recipe.inputs) {
    const ref = sources[input.key]
    if (!ref) continue
    edges.push(
      makeEdge({
        source: ref.source,
        target: primaryNodeId,
        sourceHandle: ref.sourceHandle,
        targetHandle: `par.${input.key}`,
      })
    )
  }

  if (!addLayer || !recipe.layerable) return { nodes, edges, primaryNodeId }

  const layerId = makeNodeId(`${recipe.nodeName}-layer`, containerId)
  nodes.push({
    id: layerId,
    type: 'GeoJsonLayerOp',
    data: {
      inputs: {
        stroked: true,
        filled: true,
        getFillColor: '#3b82f6',
        getLineColor: '#1e40af',
        getLineWidth: 2,
        getPointRadius: 5,
      },
    },
    position: { x: basePosition.x + 450, y: basePosition.y },
  })
  edges.push(
    makeEdge({
      source: primaryNodeId,
      target: layerId,
      sourceHandle: `out.${recipe.output}`,
      targetHandle: 'par.data',
    })
  )

  let targetRendererId = rendererId
  if (!targetRendererId) {
    targetRendererId = makeNodeId('deck', containerId)
    const basemapId = makeNodeId('basemap', containerId)
    nodes.push({
      id: basemapId,
      type: 'MaplibreBasemapOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 450, y: basePosition.y + 280 },
    })
    nodes.push({
      id: targetRendererId,
      type: 'DeckRendererOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 900, y: basePosition.y + 120 },
    })
    edges.push(
      makeEdge({
        source: basemapId,
        target: targetRendererId,
        sourceHandle: 'out.maplibre',
        targetHandle: 'par.basemap',
      })
    )
  }
  edges.push(
    makeEdge({
      source: layerId,
      target: targetRendererId,
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    })
  )

  return { nodes, edges, primaryNodeId }
}
