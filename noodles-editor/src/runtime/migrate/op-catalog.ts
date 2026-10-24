// What every Noodles operator becomes in a document. The migrator converts operator by operator;
// this table is the plan it follows and the test's checklist: every operator class has an entry,
// and an operator still waiting on a later step says which.
//
//   planner  lowers to planner operators: SQL, DuckDB spatial, a layer fed binary attributes
//   rows     row nodes (attribute, map-range, color-ramp…) on the data edge of what reads it
//   deck     a deck operator (deck-ops.ts) or a deck node parameter: a view, widget, extension,
//            a layer deck loads itself, a basemap
//   code     JavaScript the engine worker runs: a code node's table, or a JS function per row
//   subnet   a subnet of the document
//   folded   computed by the conversion from literal inputs and written into what reads it
//   dropped  nothing: the operator only showed something in the old editor
//   refused  a migration error, for the reason given
//   host     still a host operator, for the reason given

export type Becomes =
  | 'planner'
  | 'rows'
  | 'deck'
  | 'code'
  | 'subnet'
  | 'folded'
  | 'dropped'
  | 'refused'
  | 'host'

// The R3 step converting an operator, while it is still to do
export type Pending = never

export interface OpPlan {
  becomes: Becomes
  // Planner operators it lowers to
  ops?: string[]
  // Why it stays a host operator, or is dropped
  reason?: string
  // When an operator that otherwise converts stays a host operator
  hostWhen?: string
  pending?: Pending
}

const planner = (ops: string[], pending?: Pending): OpPlan => ({
  becomes: 'planner',
  ops,
  ...(pending ? { pending } : {}),
})
const rows = (ops: string[], pending?: Pending): OpPlan => ({
  becomes: 'rows',
  ops,
  ...(pending ? { pending } : {}),
})
const deck = (pending?: Pending): OpPlan => ({
  becomes: 'deck',
  ops: ['deck'],
  ...(pending ? { pending } : {}),
})
const code = (ops: string[], pending?: Pending): OpPlan => ({
  becomes: 'code',
  ops,
  ...(pending ? { pending } : {}),
})
const host = (reason: string, pending?: Pending): OpPlan => ({
  becomes: 'host',
  reason,
  ...(pending ? { pending } : {}),
})
const dropped = (reason: string): OpPlan => ({ becomes: 'dropped', reason })
const subnet = (ops = ['subnet']): OpPlan => ({ becomes: 'subnet', ops })
const refused = (reason: string): OpPlan => ({ becomes: 'refused', reason })

export const OP_CATALOG: Record<string, OpPlan> = {
  // --- code ------------------------------------------------------------------------------
  AccessorOp: rows(['attribute', 'js-function']),
  CodeOp: {
    ...code(['code']),
    hostWhen:
      'its code reads op(), the timeline or `this`, or returns layers or DOM objects rather than rows',
  },
  DuckDbOp: planner(['sql']),
  JSONOp: code(['code']),
  ExpressionOp: planner(['expression', 'generate']),

  // --- grouping --------------------------------------------------------------------------
  ContainerOp: subnet(),
  ForLoopBeginOp: refused(
    'per-item work is a row operation in a document; a loop over operators has no plan'
  ),
  ForLoopEndOp: refused(
    'per-item work is a row operation in a document; a loop over operators has no plan'
  ),
  ForLoopMetaOp: refused(
    'per-item work is a row operation in a document; a loop over operators has no plan'
  ),
  GraphInputOp: subnet(['subnet-input']),
  GraphOutputOp: subnet(['subnet-output']),

  // --- color -----------------------------------------------------------------------------
  CategoricalColorRampOp: rows(['color-ramp']),
  ChoroplethJoinOp: planner(['choropleth-join']),
  ChoroplethLayerOp: planner(['choropleth']),
  ColorOp: planner(['color']),
  ColorRampOp: rows(['color-ramp']),
  CombineRGBAOp: { becomes: 'folded' },
  HSLOp: { becomes: 'folded' },
  SplitRGBAOp: { becomes: 'folded' },

  // --- data ------------------------------------------------------------------------------
  ArcOp: code(['code']),
  BoundingBoxOp: { becomes: 'deck', ops: ['fit-bounds'] },
  BoundsOp: { becomes: 'folded' },
  ChartOp: host('draws an Observable Plot chart into the page'),
  ConcatOp: planner(['union']),
  CrossOp: planner(['sql']),
  DateTimeOp: { becomes: 'folded' },
  DeckRendererOp: deck(),
  DirectionsOp: host('calls the Google Directions API with the user’s key'),
  FileOp: planner(['file', 'geojson', 'code']),
  FilterOp: planner(['filter', 'sql']),
  GeocoderOp: host('calls a geocoding API with the user’s key'),
  GeoParquetOp: planner(['sql']),
  MergeOp: { becomes: 'deck', ops: ['merge'] },
  NetworkOp: planner(['sql']),
  OutOp: deck(),
  OverpassOp: planner(['overpass']),
  RandomizeAttributeOp: planner(['sql']),
  ScatterOp: planner(['sql']),
  SelectOp: planner(['sql']),
  ShapefileOp: planner(['geojson']),
  SliceOp: planner(['limit', 'sql']),
  SortOp: planner(['sort']),
  SwitchOp: planner(['switch']),
  TableEditorOp: planner(['table']),
  TimeSeriesOp: planner(['time-series', 'unnest']),
  ViewerOp: dropped('shows a value in the old editor; the spreadsheet shows any node’s rows'),

  // --- geojson: turf on GeoJSON becomes DuckDB spatial on tables of features (gis-conversions)
  ClipOp: planner(['clip']),
  ExplodeOp: planner(['explode']),
  GeoEditorOp: planner(['features']),
  GeoJsonOp: planner(['union']),
  GeoJsonTransformOp: planner(['transform']),
  KmlToGeoJsonOp: planner(['geojson']),
  LineInterpolationOp: planner(['smooth-lines']),
  LineToPolygonOp: planner(['line-to-polygon']),
  PointOp: planner(['point']),
  PolygonToLineOp: planner(['polygon-to-line']),
  RectangleOp: planner(['rectangle']),
  ReprojectOp: planner(['reproject']),
  SmoothOp: planner(['smooth-lines']),

  // --- geometry --------------------------------------------------------------------------
  BufferOp: planner(['buffer']),
  CentroidOp: planner(['centroid']),
  ConvexHullOp: planner(['convex-hull']),
  DifferenceOp: planner(['clip']),
  DissolveOp: planner(['dissolve']),
  HexGridOp: planner(['geo-grid']),
  IntersectOp: planner(['clip']),
  PointGridOp: planner(['geo-grid']),
  SimplifyOp: planner(['simplify']),
  SquareGridOp: planner(['geo-grid']),
  TransformRotateOp: planner(['transform']),
  TransformScaleOp: planner(['transform']),
  TransformTranslateOp: planner(['transform']),
  UnionOp: planner(['dissolve']),
  VoronoiOp: planner(['voronoi']),

  // --- analysis --------------------------------------------------------------------------
  AggregateOp: planner(['aggregate-within']),
  AlongOp: planner(['along']),
  AreaOp: planner(['area']),
  // DuckDB spatial has no clustering, interpolation or triangulation: these run turf in the worker
  DBScanClusterOp: planner(['cluster']),
  InterpolateOp: planner(['interpolate']),
  IsolineOp: planner(['isolines']),
  KMeansClusterOp: planner(['cluster']),
  LengthOp: planner(['length']),
  LineSliceOp: planner(['line-slice']),
  NearestPointOp: planner(['nearest']),
  PointInPolygonOp: planner(['inside']),
  SpatialJoinOp: planner(['spatial-join']),
  TinOp: planner(['tin']),

  // --- layers with rows ------------------------------------------------------------------
  ArcLayerOp: planner(['arc']),
  ColumnLayerOp: planner(['column']),
  ContourLayerOp: planner(['contour']),
  GeoJsonLayerOp: planner(['geojson', 'polygon', 'path', 'scatter', 'text']),
  GreatCircleLayerOp: planner(['arc']),
  GridCellLayerOp: planner(['grid-cell']),
  GridLayerOp: planner(['grid']),
  HeatmapLayerOp: planner(['heatmap']),
  HexagonLayerOp: planner(['hexagon']),
  IconLayerOp: planner(['icon']),
  LineLayerOp: planner(['line']),
  PathLayerOp: planner(['path', 'sql', 'geojson']),
  PointCloudLayerOp: planner(['point-cloud']),
  PolygonLayerOp: planner(['polygon', 'sql', 'geojson']),
  ScatterplotLayerOp: planner(['scatter']),
  ScenegraphLayerOp: planner(['scenegraph']),
  ScreenGridLayerOp: planner(['screen-grid']),
  SimpleMeshLayerOp: planner(['mesh']),
  SolidPolygonLayerOp: planner(['polygon', 'sql', 'geojson']),
  TextLayerOp: planner(['text']),
  TripsLayerOp: planner(['trips', 'unnest']),
  // Cell ids become polygons in a JS table (DuckDB-Wasm has no H3, S2 or A5), then vertex rows
  A5LayerOp: planner(['cells', 'geojson', 'polygon']),
  GeohashLayerOp: planner(['cells', 'geojson', 'polygon']),
  H3ClusterLayerOp: planner(['cells', 'geojson', 'polygon']),
  H3HexagonLayerOp: planner(['cells', 'geojson', 'polygon']),
  QuadkeyLayerOp: planner(['cells', 'geojson', 'polygon']),
  S2LayerOp: planner(['cells', 'geojson', 'polygon']),

  // --- layers without rows: deck loads their tiles or image itself -----------------------
  BitmapLayerOp: { becomes: 'deck', ops: ['bitmap'] },
  MVTLayerOp: { becomes: 'deck', ops: ['mvt'] },
  RasterTileLayerOp: { becomes: 'deck', ops: ['raster-tiles'] },
  TerrainLayerOp: { becomes: 'deck', ops: ['terrain'] },
  Tile3DLayerOp: { becomes: 'deck', ops: ['tile-3d'] },
  TileLayerOp: host('renders sublayers with a JavaScript function per tile'),
  CustomMapLibreLayerOp: host('runs the user’s WebGL code in MapLibre, on the main thread'),

  // --- extensions ------------------------------------------------------------------------
  BrightnessContrastExtensionOp: { becomes: 'deck', ops: ['brightness-contrast'] },
  ClipExtensionOp: { becomes: 'deck', ops: ['clip-extension'] },
  HueSaturationExtensionOp: { becomes: 'deck', ops: ['hue-saturation'] },
  Mask3DExtensionOp: { becomes: 'deck', ops: ['mask-3d-extension'] },
  MaskExtensionOp: { becomes: 'deck', ops: ['mask-extension'] },
  TerrainExtensionOp: { becomes: 'deck', ops: ['terrain-extension'] },
  VibranceExtensionOp: { becomes: 'deck', ops: ['vibrance'] },
  // Extensions deck gives per-row values take constants; a DataFilter is a filter on the rows
  BrushingExtensionOp: { becomes: 'deck', ops: ['brushing'] },
  CollisionFilterExtensionOp: { becomes: 'deck', ops: ['collision-filter'] },
  DataFilterExtensionOp: planner(['filter']),
  FillStyleExtensionOp: { becomes: 'deck', ops: ['fill-style'] },
  PathStyleExtensionOp: { becomes: 'deck', ops: ['path-style'] },

  // --- numbers, strings, vectors ---------------------------------------------------------
  BezierCurveOp: planner(['bezier-curve']),
  BooleanOp: { becomes: 'folded' },
  ExtentOp: planner(['extent']),
  MapRangeOp: rows(['map-range']),
  MathOp: rows(['math']),
  NumberOp: planner(['number']),
  RampOp: planner(['ramp']),
  StringOp: { becomes: 'folded' },
  TimeOp: planner(['time']),
  CombineXYOp: { becomes: 'folded' },
  SplitXYOp: { becomes: 'folded' },
  SplitXYZOp: { becomes: 'folded' },

  // --- utility ---------------------------------------------------------------------------
  BlendingOp: deck(),
  ConsoleOp: dropped('logs a value in the old editor'),
  LayerPropsOp: { becomes: 'deck', ops: ['layer-props'] },
  MapStyleConfiguratorOp: { becomes: 'deck', ops: ['map-style'] },
  MouseOp: planner(['mouse']),
  ProjectOp: { becomes: 'folded' },
  UnprojectOp: { becomes: 'folded' },
  RerouteOp: dropped('a wire bend; the migrator wires through it'),

  // --- views and basemaps ----------------------------------------------------------------
  FirstPersonViewOp: { becomes: 'deck', ops: ['first-person-view'] },
  GlobeViewOp: { becomes: 'deck', ops: ['globe-view'] },
  MapViewOp: { becomes: 'deck', ops: ['map-view'] },
  MapViewStateOp: { becomes: 'deck', ops: ['view-state'] },
  MaplibreBasemapOp: deck(),
  OrbitViewOp: { becomes: 'deck', ops: ['orbit-view'] },
  OrthographicViewOp: { becomes: 'deck', ops: ['orthographic-view'] },
  PMTilesOp: { becomes: 'deck', ops: ['pmtiles'] },
  SplitMapViewStateOp: { becomes: 'folded' },
  XYZTileOp: { becomes: 'deck', ops: ['xyz-tiles'] },

  // --- widgets ---------------------------------------------------------------------------
  BitmapOverlayWidgetOp: { becomes: 'deck', ops: ['bitmap-overlay-widget'] },
  CompassWidgetOp: { becomes: 'deck', ops: ['compass-widget'] },
  FpsWidgetOp: { becomes: 'deck', ops: ['fps-widget'] },
  FullscreenWidgetOp: { becomes: 'deck', ops: ['fullscreen-widget'] },
  LegendWidgetOp: { becomes: 'deck', ops: ['legend-widget'] },
  ScaleWidgetOp: { becomes: 'deck', ops: ['scale-widget'] },
  ScreenshotWidgetOp: { becomes: 'deck', ops: ['screenshot-widget'] },
  ZoomWidgetOp: { becomes: 'deck', ops: ['zoom-widget'] },

  UnknownOperator: dropped('an operator this version of Noodles does not know'),
}

// The plan for an operator type; throws for one the catalog has no entry for
export function planOf(type: string): OpPlan {
  const plan = OP_CATALOG[type]
  if (!plan) throw new Error(`No conversion plan for ${type}`)
  return plan
}
