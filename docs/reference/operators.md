# Operator Reference

<!-- gen:begin coverage -->
176 operators in 15 categories. 6 of 176 have written Remarks.
<!-- gen:end coverage -->

One page per operator, grouped by the category it has in the Add Node menu. Each page gives the type name a node uses in `noodles.json`, the operator's inputs with their field types and defaults, and its outputs. The tables are generated from the operator classes, so they match the editor built from the same commit. Remarks and Examples are written by hand and cover what the tables can't: which input wins when two disagree, defaults that differ from deck.gl, and mistakes that are easy to make.

To update the pages after changing an operator, run `npm run generate:registry` and then `npm run generate:op-docs` in `noodles-editor/`. The generator rewrites each page's title and the text between its `gen:begin` and `gen:end` markers. Add `## Remarks` and `## Examples` anywhere else on the page and they're kept. `npm test` fails when a page is out of date or when a JSON example on it doesn't pass [noodles-validate](https://github.com/joby-aviation/noodles.gl/tree/main/noodles-validate).

<!-- gen:begin operators -->
## Code

- [Accessor](./operators/accessor.md): A function called for each row of your data and passed to Deck.gl layer properties.
- [Code](./operators/code.md): Run custom JavaScript code to transform your data.
- [DuckDB](./operators/duck-db.md): Query a DuckDB database using sql.
- [Expression](./operators/expression.md): Evaluate a JavaScript expression to compute a single value.
- [JSON](./operators/json.md): Parse a JSON string.

## Grouping

- [Container](./operators/container.md): Encapsulates a subgraph of operators.
- [ForLoopBegin](./operators/for-loop-begin.md): Start a loop that processes each item in an array.
- [ForLoopEnd](./operators/for-loop-end.md): End a loop started by ForLoopBegin.
- [GraphInput](./operators/graph-input.md): Receives input from the parent Container.
- [GraphOutput](./operators/graph-output.md): Provides output to the parent Container.

## Color

- [CategoricalColorRamp](./operators/categorical-color-ramp.md): Map a string category to a color.
- [Color](./operators/color.md): A color.
- [ColorRamp](./operators/color-ramp.md): Interpolate a color from a color ramp, value range 0-1.
- [CombineRGBA](./operators/combine-rgba.md): Combine r, g, b, and a into a color (range 0-255).
- [HSL](./operators/hsl.md): A color in HSL (hue, saturation, lightness) format.
- [SplitRGBA](./operators/split-rgba.md): Split a color into its red, green, blue, and alpha components (range 0-255).

## Data

- [Arc](./operators/arc.md): Generate an arc path between two points at a given altitude.
- [BoundingBox](./operators/bounding-box.md): Calculate the geographic bounds of your points (with lat/lng keys) or GeoJSON and get a camera position (center, zoom) that fits them all in view.
- [Bounds](./operators/bounds.md): Create a bounding box from two points.
- [BrushableHistogram](./operators/brushable-histogram.md): Interactive histogram with brushable range selection for data filtering.
- [Chart](./operators/chart.md): Create charts using Observable Plot (bar, histogram, scatter).
- [Concat](./operators/concat.md): Concatenate multiple arrays into a single array.
- [Cross](./operators/cross.md): Generate all unique pairs from an array.
- [DateTime](./operators/date-time.md): A date and time.
- [DeckRenderer](./operators/deck-renderer.md): Render a deck.gl visualization with layers and effects.
- [Directions](./operators/directions.md): Get driving, traffic-aware driving, or transit directions between points.
- [File](./operators/file.md): Fetch a file from a URL or text.
- [FilterOp](./operators/filter.md): Filter an array of data based on a condition.
- [GeoParquet](./operators/geo-parquet.md): Load a GeoParquet file and output GeoJSON FeatureCollection via DuckDB Spatial.
- [Geocoder](./operators/geocoder.md): Get the location of a query string.
- [Merge](./operators/merge.md): Merge multiple objects into one (think Object.assign).
- [Network](./operators/network.md): Generate a network of routes between a set of points (usually skyports).
- [Out](./operators/out.md): Output a visualization.
- [Overpass](./operators/overpass.md): Query OpenStreetMap data using Overpass API.
- [RandomizeAttribute](./operators/randomize-attribute.md): Randomize a numeric attribute on data elements within a given range.
- [Scatter](./operators/scatter.md): Scatter points randomly within a bounding box.
- [Select](./operators/select.md): Select an element from an array using an index (clamped to array bounds by default, or wrapped around array bounds).
- [Shapefile](./operators/shapefile.md): Load a Shapefile (.shp) and convert to GeoJSON.
- [Slice](./operators/slice.md): Slice an array of data.
- [Sort](./operators/sort.md): Sort an array of data based on a key.
- [Switch](./operators/switch.md): Select one value from a list using an index (0, 1, 2...).
- [TableEditor](./operators/table-editor.md): Edit a table with typed columns.
- [TimeSeries](./operators/time-series.md): Interpolate time-varying data at a given time.
- [Viewer](./operators/viewer.md): Inspect data in the viewer.

## GeoJSON

- [ChoroplethJoin](./operators/choropleth-join.md): Join tabular data onto geographic boundaries (US states, world countries, Canadian provinces) to produce a colored FeatureCollection.
- [ChoroplethLayer](./operators/choropleth-layer.md): All-in-one choropleth: joins tabular data onto geographic boundaries and renders with a color scale.
- [Clip](./operators/clip.md): Clip features to a bounding polygon (mask).
- [Explode](./operators/explode.md): Break multi-part geometries into individual features, or extract all vertices as points.
- [GeoEditor](./operators/geo-editor.md): Draw and edit GeoJSON geometry with a visual editor.
- [GeoJson](./operators/geo-json.md): Create a GeoJSON FeatureCollection from a list of features.
- [GeoJsonTransform](./operators/geo-json-transform.md): Transform a GeoJSON feature with scale, translate, and rotate operations.
- [KmlToGeoJson](./operators/kml-to-geo-json.md): Convert KML string to GeoJSON FeatureCollection.
- [Line Interpolation](./operators/line-interpolation.md): Interpolate GeoJSON lines with D3 curves or round corners with a physical turn radius.
- [LineToPolygon](./operators/line-to-polygon.md): Convert closed LineString features to Polygon features.
- [Point](./operators/point.md): Create a GeoJSON Point feature from coordinates.
- [PolygonToLine](./operators/polygon-to-line.md): Convert Polygon features to LineString features (extract boundaries).
- [Rectangle](./operators/rectangle.md): Generate a rectangle GeoJSON geometry from a center point and dimensions in kilometers.
- [Reproject](./operators/reproject.md): Transform coordinates between WGS84 and Web Mercator projections.
- [Smooth](./operators/smooth.md): Apply smoothing to LineString coordinates using Gaussian or boxcar kernel.

## Geometry

- [Buffer](./operators/buffer.md): Create a buffer zone around input geometry at a given distance.
- [Centroid](./operators/centroid.md): Calculate the centroid (center of mass) of each feature.
- [ConvexHull](./operators/convex-hull.md): Calculate the convex hull (smallest enclosing polygon) of features.
- [Difference](./operators/difference.md): Subtract one polygon from another (A minus B).
- [Dissolve](./operators/dissolve.md): Dissolve polygons that share a common property value into single features.
- [HexGrid](./operators/hex-grid.md): Generate a hexagonal grid within a bounding box.
- [Intersect](./operators/intersect.md): Find the overlapping area between two polygons.
- [PointGrid](./operators/point-grid.md): Generate a regular grid of points within a bounding box.
- [Simplify](./operators/simplify.md): Simplify GeoJSON geometries using Ramer-Douglas-Peucker algorithm.
- [SquareGrid](./operators/square-grid.md): Generate a square grid within a bounding box.
- [TransformRotate](./operators/transform-rotate.md): Rotate features by an angle around a pivot point.
- [TransformScale](./operators/transform-scale.md): Scale features by a factor around their center.
- [TransformTranslate](./operators/transform-translate.md): Move features by a distance in a direction.
- [Union](./operators/union.md): Merge multiple polygons into a single combined polygon.
- [Voronoi](./operators/voronoi.md): Generate Voronoi polygons from a set of points.

## Analysis

- [Aggregate](./operators/aggregate.md): Aggregate point data into polygons (count, sum, mean, min, max per zone).
- [Along](./operators/along.md): Find a point at a specified distance along a line.
- [Area](./operators/area.md): Calculate the area of polygon features in specified units.
- [DBScanCluster](./operators/db-scan-cluster.md): Cluster points using DBSCAN density-based algorithm.
- [Interpolate](./operators/interpolate.md): Interpolate scattered point data to a regular grid (IDW).
- [Isoline](./operators/isoline.md): Generate isolines (contour lines) from point data with Z values.
- [KMeansCluster](./operators/k-means-cluster.md): Cluster points into k groups using k-means algorithm.
- [Length](./operators/length.md): Calculate the length of line features in specified units.
- [LineSlice](./operators/line-slice.md): Extract a segment of a line between two distances along it.
- [NearestPoint](./operators/nearest-point.md): Find the nearest point in a collection to a target point.
- [PointInPolygon](./operators/point-in-polygon.md): Filter points that fall within a polygon boundary.
- [SpatialJoin](./operators/spatial-join.md): Join attributes from one layer to another based on spatial relationship.
- [Tin](./operators/tin.md): Generate a Triangulated Irregular Network (TIN) from points.

## Layer

- [A5Layer](./operators/a5-layer.md): Render filled and/or stroked polygons using the A5 geospatial indexing system.
- [ArcLayer](./operators/arc-layer.md): Render a set of arcs on the map.
- [BitmapLayer](./operators/bitmap-layer.md): Render a raster image at specified boundaries.
- [ColumnLayer](./operators/column-layer.md): Render extruded cylinders (columns) at given positions.
- [ContourLayer](./operators/contour-layer.md): Aggregate data and render contour lines or filled contour bands.
- [GeoJsonLayer](./operators/geo-json-layer.md): Render GeoJSON data with points, lines, and polygons.
- [GeohashLayer](./operators/geohash-layer.md): Render filled and/or stroked polygons based on geohash strings.
- [GreatCircleLayer](./operators/great-circle-layer.md): Render great circle arcs between pairs of source and target coordinates.
- [GridCellLayer](./operators/grid-cell-layer.md): Render a grid of cells at specified coordinates.
- [GridLayer](./operators/grid-layer.md): Aggregate data into a grid and render as columns.
- [H3ClusterLayer](./operators/h3-cluster-layer.md): Render hexagons from H3 hexagon indices and cluster them by density.
- [H3HexagonLayer](./operators/h3-hexagon-layer.md): Render a hexagon grid on the map using the H3 grid system.
- [HeatmapLayer](./operators/heatmap-layer.md): Render a heatmap from points on the map.
- [HexagonLayer](./operators/hexagon-layer.md): Aggregate data into hexagonal bins and render as hexagonal columns.
- [IconLayer](./operators/icon-layer.md): Render a set of icons on the map.
- [LineLayer](./operators/line-layer.md): Render straight lines between source and target coordinates.
- [MVTLayer](./operators/mvt-layer.md): Render Mapbox Vector Tiles (MVT).
- [PathLayer](./operators/path-layer.md): Render a path on the map.
- [PointCloudLayer](./operators/point-cloud-layer.md): Render a point cloud with millions of 3D points.
- [PolygonLayer](./operators/polygon-layer.md): Render filled and/or stroked polygons.
- [QuadkeyLayer](./operators/quadkey-layer.md): Render filled and/or stroked polygons based on quadkey strings.
- [RasterTileLayer](./operators/raster-tile-layer.md): Render a raster tile layer on the map.
- [S2Layer](./operators/s2-layer.md): Render filled and/or stroked polygons based on S2 tokens.
- [ScatterplotLayer](./operators/scatterplot-layer.md): Render a scatterplot of points as circles on the map.
- [ScenegraphLayer](./operators/scenegraph-layer.md): Render a 3D model on the map.
- [ScreenGridLayer](./operators/screen-grid-layer.md): Aggregate data into a grid in screen space and visualize as a heatmap.
- [SimpleMeshLayer](./operators/simple-mesh-layer.md): Render simple 3D meshes/models at specified positions.
- [SolidPolygonLayer](./operators/solid-polygon-layer.md): Render a set of solid polygons on the map.
- [TerrainLayer](./operators/terrain-layer.md): Render a terrain mesh from heightmap tiles.
- [TextLayer](./operators/text-layer.md): Render a set of text labels on the map.
- [TileLayer](./operators/tile-layer.md): Render data organized in a tiled format (generic tile layer).
- [Tile3DLayer](./operators/tile3d-layer.md): Render 3D tiles on the map (Google, Cesium, or a custom tileset URL).
- [TripsLayer](./operators/trips-layer.md): Render a set of trips with timestamps for animation on the map.

## Extension

- [BrightnessContrastExtension](./operators/brightness-contrast-extension.md): Adjust brightness and contrast of a layer.
- [BrushingExtension](./operators/brushing-extension.md): Only render the points within a given radius of the mouse position.
- [ClipExtension](./operators/clip-extension.md): Clip layers by a rectangular bounds.
- [CollisionFilterExtension](./operators/collision-filter-extension.md): Hide overlapping objects (e.g., labels).
- [DataFilterExtension](./operators/data-filter-extension.md): Filter data by one or more numeric ranges.
- [FillStyleExtension](./operators/fill-style-extension.md): Add patterns and styles to polygon fills.
- [HueSaturationExtension](./operators/hue-saturation-extension.md): Adjust hue and saturation of a layer.
- [MaskExtension](./operators/mask-extension.md): Show/hide layer objects by a geofence.
- [Mask3DExtension](./operators/mask3d-extension.md): Show only a sphere around a lng/lat/alt (meters) of a Tile3DLayer, fading to white at the edge.
- [PathStyleExtension](./operators/path-style-extension.md): Style a path (used with PathLayer, PolygonLayer, and GeoJSONLayer).
- [TerrainExtension](./operators/terrain-extension.md): Render a terrain layer on the map.
- [VibranceExtension](./operators/vibrance-extension.md): Adjust vibrance of a layer.

## Number

- [BezierCurve](./operators/bezier-curve.md): Bezier curve for mapping input values using an interactive graph editor.
- [DateMath](./operators/date-math.md): Add, subtract, compare, or interpolate dates.
- [DateParts](./operators/date-parts.md): Split a date into year, month, day, hour, and other components.
- [Extent](./operators/extent.md): Find the minimum and maximum values in your data (e.g., to set color scale ranges or determine data bounds).
- [MapRange](./operators/map-range.md): Remap a number from one range to another (e.g., map 0-100 to 0-1, or temperature to color intensity).
- [Math](./operators/math.md): Perform a mathematical operation.
- [Number](./operators/number.md): A number.
- [Ramp](./operators/ramp.md): Map a position (0–1) to a value using a user-defined curve.
- [Time](./operators/time.md): Get the current clock, timeline, and session time.

## String

- [DateFormat](./operators/date-format.md): Format a date as a string, e.g.
- [String](./operators/string.md): A string.

## Utility

- [Blending](./operators/blending.md): Configure WebGL blending mode for layers (additive, normal, subtractive).
- [Boolean](./operators/boolean.md): A boolean.
- [Comment](./operators/comment.md): A note that explains the nodes beside it.
- [Console](./operators/console.md): Log data to the console.
- [ForLoopMeta](./operators/for-loop-meta.md): Access iteration metadata and accumulator within a ForLoop scope.
- [LayerProps](./operators/layer-props.md): Add additional props to a layer (e.g., operation: "mask" for mask layers, beforeId for maplibre layer ordering).
- [MapStyleConfigurator](./operators/map-style-configurator.md): Visually edit Maplibre style layer colors, fonts, and visibility.
- [Mouse](./operators/mouse.md): Get the current mouse position on the screen.
- [Project](./operators/project.md): Project a lat/lng point to a screen position.
- [Reroute](./operators/reroute.md): Pass-through for organizing graph layout.
- [Unproject](./operators/unproject.md): Unproject a screen position to a lat/lng point.

## Vector

- [CombineXY](./operators/combine-xy.md): Combine x and y into a 2D vector.
- [SplitXY](./operators/split-xy.md): Split a 2D vector into its x and y components.
- [SplitXYZ](./operators/split-xyz.md): Split a 3D vector into its x, y, and z components.

## View

- [CustomMapLibreLayer](./operators/custom-map-libre-layer.md): Define a custom MapLibre GL layer with WebGL rendering.
- [FirstPersonView](./operators/first-person-view.md): A deck.gl first person view.
- [GlobeView](./operators/globe-view.md): A deck.gl globe view.
- [MapView](./operators/map-view.md): A deck.gl map view.
- [MapViewState](./operators/map-view-state.md): Create a react-map-gl MapViewState for controlling the camera.
- [MaplibreBasemap](./operators/maplibre-basemap.md): A MapLibre basemap with sky and lighting settings.
- [OrbitView](./operators/orbit-view.md): A deck.gl orbit view.
- [OrthographicView](./operators/orthographic-view.md): A deck.gl orthographic view.
- [PMTiles](./operators/pm-tiles.md): Load a PMTiles archive as a MapLibre vector or raster source.
- [SplitMapViewState](./operators/split-map-view-state.md): Split a viewState object into its individual components.
- [XYZTile](./operators/xyz-tile.md): Configure a raster XYZ tile source from a URL template (\{z\}/\{x\}/\{y\}).

## Widget

- [Bitmap Overlay](./operators/bitmap-overlay-widget.md): Display a bitmap image as a screen-space overlay.
- [CompassWidget](./operators/compass-widget.md): Compass and bearing reset widget.
- [FpsWidget](./operators/fps-widget.md): Display frames per second (FPS) and rendering stats widget.
- [FullscreenWidget](./operators/fullscreen-widget.md): Enter/exit fullscreen widget.
- [LegendWidget](./operators/legend-widget.md): Display a color scale legend overlay on the visualization.
- [ScaleWidget](./operators/scale-widget.md): Display a map distance scale widget.
- [ScreenshotWidget](./operators/screenshot-widget.md): Download current frame as PNG widget.
- [ZoomWidget](./operators/zoom-widget.md): Zoom in/out buttons widget.
<!-- gen:end operators -->

## Field types

The Type column names the field class of each input and output. The ones that come up most:

| Type | Holds |
|------|-------|
| `DataField` | Any array or object, usually rows of data, from one connection. |
| `ListField` | A list built from several connections. Each edge into it adds one item, in connection order, like `layers` on [DeckRenderer](./operators/deck-renderer.md). |
| `ArrayField` | One array whose items all have the same field type, from a single connection. |
| `GeoJsonField` | A GeoJSON object. The default is an empty FeatureCollection. |
| `CompoundPropsField` | An object of named sub-fields, such as a camera's `latitude`, `longitude` and `zoom`. The Default column shows the whole object. |
| `StringLiteralField` | One string from a fixed set of values. |
| `CodeField`, `ExpressionField` | Source text the operator compiles: JavaScript, or SQL for DuckDB. |
| `FunctionField` | A function, such as an Accessor's output. |
| `LayerField`, `ViewField`, `ExtensionField` | deck.gl layer, view and extension descriptions from the matching operators. |
| `UnknownField` | Any value. Nothing checks it. |

Layer inputs whose names start with `get`, such as `getPosition`, take either a constant of the listed type or a per-row function from an [Accessor](./operators/accessor.md). For how fields work inside the editor, see [Field System](../developers/field-system.md).
