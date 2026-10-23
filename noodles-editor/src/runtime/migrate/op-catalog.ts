// What every Noodles operator becomes in a document. The migrator converts operator by operator;
// this table is the plan it follows and the test's checklist: every operator class has an entry,
// and an operator still waiting on a later step says which.
//
//   planner  lowers to planner operators: SQL, DuckDB spatial, a layer fed binary attributes
//   rows     row nodes (attribute, map-range, color-ramp…) on the data edge of what reads it
//   deck     a parameter of the deck node: a view, widget, effect, extension or basemap
//   code     JavaScript the engine worker runs: a code node's table, or a JS function per row
//   subnet   a subnet of the document
//   dropped  nothing: the operator only showed something in the old editor
//   host     still a host operator, for the reason given

export type Becomes = 'planner' | 'rows' | 'deck' | 'code' | 'subnet' | 'dropped' | 'host'

// The R3 step converting an operator, while it is still to do
export type Pending = 'R3c' | 'R3d' | 'R3e' | 'R4'

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
const subnet = (): OpPlan => ({ becomes: 'subnet', ops: ['subnet'], pending: 'R4' })

export const OP_CATALOG: Record<string, OpPlan> = {
  // --- code ------------------------------------------------------------------------------
  AccessorOp: rows(['attribute', 'js-function']),
  CodeOp: {
    ...code(['code']),
    hostWhen:
      'its code reads op(), the timeline or `this`, or returns layers or DOM objects rather than rows',
  },
  DuckDbOp: planner(['sql']),
  JSONOp: code(['code'], 'R3c'),
  ExpressionOp: planner(['expression', 'generate']),

  // --- grouping --------------------------------------------------------------------------
  ContainerOp: subnet(),
  ForLoopBeginOp: subnet(),
  ForLoopEndOp: subnet(),
  ForLoopMetaOp: subnet(),
  GraphInputOp: { becomes: 'subnet', ops: ['subnet-input'], pending: 'R4' },
  GraphOutputOp: { becomes: 'subnet', ops: ['subnet-output'], pending: 'R4' },

  // --- color -----------------------------------------------------------------------------
  CategoricalColorRampOp: rows(['color-ramp']),
  ColorOp: planner(['color']),
  ColorRampOp: rows(['color-ramp']),
  CombineRGBAOp: rows(['attribute', 'expression'], 'R3d'),
  HSLOp: rows(['attribute', 'expression'], 'R3d'),
  SplitRGBAOp: planner(['expression'], 'R3d'),

  // --- data ------------------------------------------------------------------------------
  ArcOp: code(['code'], 'R3c'),
  BoundingBoxOp: planner(['extent', 'expression'], 'R3d'),
  BoundsOp: planner(['expression'], 'R3d'),
  ChartOp: host('draws an Observable Plot chart into the page'),
  ConcatOp: planner(['union'], 'R3c'),
  CrossOp: planner(['join'], 'R3c'),
  DateTimeOp: planner(['number'], 'R3d'),
  DeckRendererOp: deck(),
  DirectionsOp: host('calls the Google Directions API with the user’s key'),
  FileOp: {
    ...planner(['file', 'geojson', 'code']),
    hostWhen: 'a host operator reads it as the object FileOp parsed',
  },
  FilterOp: planner(['filter'], 'R3c'),
  GeocoderOp: host('calls a geocoding API with the user’s key'),
  GeoParquetOp: planner(['file', 'geojson'], 'R3c'),
  MergeOp: host('merges JavaScript objects (layer props, view states), which are not rows'),
  NetworkOp: planner(['join', 'sql'], 'R3c'),
  OutOp: deck(),
  OverpassOp: code(['code'], 'R3c'),
  RandomizeAttributeOp: rows(['attribute'], 'R3c'),
  ScatterOp: planner(['generate', 'attribute'], 'R3c'),
  SelectOp: planner(['limit'], 'R3c'),
  ShapefileOp: planner(['geojson'], 'R3c'),
  SliceOp: planner(['limit'], 'R3c'),
  SortOp: planner(['sort'], 'R3c'),
  SwitchOp: planner(['switch']),
  TableEditorOp: planner(['sql'], 'R3c'),
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
  ColumnLayerOp: planner(['column'], 'R3e'),
  ContourLayerOp: planner(['contour'], 'R3e'),
  GeoJsonLayerOp: planner(['geojson', 'polygon', 'path', 'scatter', 'text']),
  GreatCircleLayerOp: planner(['arc'], 'R3e'),
  GridCellLayerOp: planner(['column'], 'R3e'),
  GridLayerOp: planner(['grid']),
  HeatmapLayerOp: planner(['heatmap']),
  HexagonLayerOp: planner(['hexagon']),
  IconLayerOp: planner(['icon'], 'R3e'),
  LineLayerOp: planner(['line'], 'R3e'),
  PathLayerOp: planner(['path', 'unnest'], 'R3e'),
  PointCloudLayerOp: planner(['point-cloud'], 'R3e'),
  PolygonLayerOp: planner(['polygon', 'unnest'], 'R3e'),
  ScatterplotLayerOp: planner(['scatter']),
  ScenegraphLayerOp: planner(['scenegraph']),
  ScreenGridLayerOp: planner(['screen-grid'], 'R3e'),
  SimpleMeshLayerOp: planner(['mesh']),
  SolidPolygonLayerOp: planner(['polygon', 'unnest'], 'R3e'),
  TextLayerOp: planner(['text'], 'R3e'),
  TripsLayerOp: planner(['trips', 'unnest']),
  // Cell ids become polygon vertices in a JS table: DuckDB-Wasm has no H3, S2 or A5
  A5LayerOp: code(['code', 'polygon'], 'R3e'),
  GeohashLayerOp: code(['code', 'polygon'], 'R3e'),
  H3ClusterLayerOp: code(['code', 'polygon'], 'R3e'),
  H3HexagonLayerOp: code(['code', 'polygon'], 'R3e'),
  QuadkeyLayerOp: code(['code', 'polygon'], 'R3e'),
  S2LayerOp: code(['code', 'polygon'], 'R3e'),

  // --- layers without rows: deck loads their tiles or image itself -----------------------
  BitmapLayerOp: planner(['bitmap'], 'R3d'),
  MVTLayerOp: planner(['mvt'], 'R3d'),
  RasterTileLayerOp: planner(['raster-tiles'], 'R3d'),
  TerrainLayerOp: planner(['terrain'], 'R3d'),
  Tile3DLayerOp: planner(['tile-3d'], 'R3d'),
  TileLayerOp: host('renders sublayers with a JavaScript function per tile'),
  CustomMapLibreLayerOp: host('runs the user’s WebGL code in MapLibre, on the main thread'),

  // --- extensions ------------------------------------------------------------------------
  BrightnessContrastExtensionOp: deck('R3d'),
  ClipExtensionOp: deck('R3d'),
  HueSaturationExtensionOp: deck('R3d'),
  Mask3DExtensionOp: deck('R3d'),
  MaskExtensionOp: deck('R3d'),
  TerrainExtensionOp: deck('R3d'),
  VibranceExtensionOp: deck('R3d'),
  // Extensions with per-row values bind attributes on the layer they extend
  BrushingExtensionOp: rows(['attribute'], 'R3e'),
  CollisionFilterExtensionOp: rows(['attribute'], 'R3e'),
  DataFilterExtensionOp: rows(['attribute', 'filter'], 'R3e'),
  FillStyleExtensionOp: rows(['attribute'], 'R3e'),
  PathStyleExtensionOp: rows(['attribute'], 'R3e'),

  // --- numbers, strings, vectors ---------------------------------------------------------
  BezierCurveOp: planner(['expression'], 'R3d'),
  BooleanOp: planner(['number'], 'R3d'),
  ExtentOp: planner(['extent']),
  MapRangeOp: rows(['map-range']),
  MathOp: rows(['math']),
  NumberOp: planner(['number']),
  RampOp: planner(['expression'], 'R3d'),
  StringOp: planner(['expression'], 'R3d'),
  TimeOp: planner(['time']),
  CombineXYOp: rows(['attribute', 'expression'], 'R3d'),
  SplitXYOp: planner(['expression'], 'R3d'),
  SplitXYZOp: planner(['expression'], 'R3d'),

  // --- utility ---------------------------------------------------------------------------
  BlendingOp: deck(),
  ConsoleOp: dropped('logs a value in the old editor'),
  LayerPropsOp: host('overrides arbitrary props of a built layer object'),
  MapStyleConfiguratorOp: deck('R3d'),
  MouseOp: host('reads the pointer'),
  ProjectOp: planner(['expression'], 'R3d'),
  UnprojectOp: planner(['expression'], 'R3d'),
  RerouteOp: dropped('a wire bend; the migrator wires through it'),

  // --- views and basemaps ----------------------------------------------------------------
  FirstPersonViewOp: deck('R3d'),
  GlobeViewOp: deck('R3d'),
  MapViewOp: deck('R3d'),
  MapViewStateOp: deck('R3d'),
  MaplibreBasemapOp: deck(),
  OrbitViewOp: deck('R3d'),
  OrthographicViewOp: deck('R3d'),
  PMTilesOp: deck('R3d'),
  SplitMapViewStateOp: planner(['expression'], 'R3d'),
  XYZTileOp: deck('R3d'),

  // --- widgets ---------------------------------------------------------------------------
  BitmapOverlayWidgetOp: deck('R3d'),
  CompassWidgetOp: deck('R3d'),
  FpsWidgetOp: deck('R3d'),
  FullscreenWidgetOp: deck('R3d'),
  LegendWidgetOp: deck('R3d'),
  ScaleWidgetOp: deck('R3d'),
  ScreenshotWidgetOp: deck('R3d'),
  ZoomWidgetOp: deck('R3d'),

  UnknownOperator: dropped('an operator this version of Noodles does not know'),
}

// The plan for an operator type; throws for one the catalog has no entry for
export function planOf(type: string): OpPlan {
  const plan = OP_CATALOG[type]
  if (!plan) throw new Error(`No conversion plan for ${type}`)
  return plan
}
