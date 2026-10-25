# Operator Reference

<!-- gen:begin coverage -->
134 operators in 10 categories. 5 of 134 have written Remarks.
<!-- gen:end coverage -->

One page per operator. The ports and parameters tables are generated from the operator catalog; Remarks and Examples are written by hand.

<!-- gen:begin operators -->
## Data

- [Code](./operators/code.md): Rows made by JavaScript: `d` is the input's rows as objects (an empty array with nothing wired), or a JSON file parsed whole when a URL is set, and the body returns an array of rows or GeoJSON.
- [File](./operators/file.md): Read a CSV, JSON or Parquet file by URL.
- [Generate](./operators/generate.md): N rows numbered 0…N−1.
- [GeoJSON](./operators/geojson.md): A GeoJSON file, or any vector file DuckDB spatial reads (shapefile, GeoPackage…), as rows: `features` has one row per feature with its geometry; polygons, lines and points have one row per vertex, ready for a layer; `all` has every vertex row with a `kind` column.
- [Overpass](./operators/overpass.md): OpenStreetMap features an Overpass QL query finds, as a table of features: tagged nodes as points, ways as lines or polygons, multipolygon relations.
- [DuckDB SQL](./operators/sql.md): Any SELECT.
- [Table](./operators/table.md): Rows you type in, kept in the document: a table the engine loads once per edit.

## Tables

- [Aggregate](./operators/aggregate.md): GROUP BY with aggregates, one per line: name = count(), total = sum(pop).
- [Grid Bin](./operators/grid.md): Count rows per square cell and emit one row per cell at its center (P), with n and the weight sum w.
- [Join](./operators/join.md): Match rows of two tables on key columns.
- [Limit](./operators/limit.md): The first N rows.
- [Sort](./operators/sort.md): Order rows by a column; with a limit, keep the top N.
- [Time Series](./operators/time-series.md): Each path's place at one time, interpolated between the two vertices around it, holding the first and last vertex outside the path's span.
- [Union](./operators/union.md): All rows of every input, columns matched by name.
- [Unnest](./operators/unnest.md): List columns to rows, in lockstep.

## Geometry

- [Aggregate Within](./operators/aggregate-within.md): Each polygon with a count, sum, mean, min or max of the points inside it, as a new column `<operation>_<column>` (0 for none).
- [Along](./operators/along.md): The point a distance along each line, as turf.along; past the end is the end.
- [Area](./operators/area.md): A column with each feature’s area on the spheroid, as turf.area; 0 for points and lines.
- [Buffer](./operators/buffer.md): Each feature grown by a distance on the ground (shrunk, for a negative one), as turf.buffer.
- [Grid Cells](./operators/cells.md): Rows with a grid cell id (H3, S2, A5, geohash or quadkey) as polygon features of their cells, keeping their columns; a column of H3 id lists draws each list’s merged outline.
- [Centroid](./operators/centroid.md): Each feature as a point at its center of mass, keeping its properties.
- [Choropleth Join](./operators/choropleth-join.md): Rows joined onto boundaries by a key: US states, world countries or Canadian provinces.
- [Clip](./operators/clip.md): Each feature cut by a mask (the union of its features): the part inside, as turf.intersect and a clip do, or the part outside, as turf.difference does.
- [Cluster](./operators/cluster.md): Points labeled with a `cluster` number by k-means (turf.clustersKmeans) or by density (turf.clustersDbscan, with `dbscan` noise/core/edge).
- [Convex Hull](./operators/convex-hull.md): One polygon enclosing every feature, as turf.convex.
- [Dissolve](./operators/dissolve.md): Polygons merged: all of them, or those sharing a value of a column (turf.dissolve, turf.union).
- [Explode](./operators/explode.md): Each multi-part feature as one row per part (turf.flatten), or every feature as one point row per vertex (turf.explode).
- [Features](./operators/features.md): GeoJSON written into the node (a FeatureCollection, a Feature or a bare geometry) or WKT, as a table of features.
- [Grid Features](./operators/geo-grid.md): Hexagons, squares or points of one cell size covering a bounding box, as turf.hexGrid, squareGrid and pointGrid make them.
- [Inside / Outside](./operators/inside.md): Features split by whether they touch any feature of a second table (a point inside a polygon, on its edge included, as turf.booleanPointInPolygon): `inside` and `outside`.
- [Interpolate](./operators/interpolate.md): A grid of points valued by inverse-distance weighting of a column of the input points, as turf.interpolate.
- [Isolines](./operators/isolines.md): Contour lines through a grid of points at each break value of a column, as turf.isolines (the input must be a point grid, such as Interpolate makes).
- [Length](./operators/length.md): A column with each feature’s length on the spheroid (a polygon’s perimeter), as turf.length.
- [Line Slice](./operators/line-slice.md): The part of each line between two distances from its start, as turf.lineSliceAlong.
- [Line to Polygon](./operators/line-to-polygon.md): Each line as the polygon it outlines, closed if it is open, as turf.lineToPolygon.
- [Nearest](./operators/nearest.md): The feature nearest a point, with its distance in kilometers in `distanceToPoint`, as turf.nearestPoint.
- [Point](./operators/point.md): One point feature at a longitude and latitude, which numbers can drive.
- [Polygon to Line](./operators/polygon-to-line.md): Each polygon as its outline, holes included, as turf.polygonToLine.
- [Rectangle](./operators/rectangle.md): One rectangle feature of a width and height on the ground, centered on a point.
- [Reproject](./operators/reproject.md): Coordinates from one CRS to another, as PROJ names them (EPSG:4326 is lng/lat).
- [Simplify](./operators/simplify.md): Fewer vertices: Douglas–Peucker with a tolerance in degrees, as turf.simplify.
- [Smooth Lines](./operators/smooth-lines.md): Lines with their corners rounded: a moving average of each vertex and its neighbors (gaussian or boxcar), or a spline through the vertices (Catmull–Rom, cardinal, basis, natural, monotone, or a fixed turn radius).
- [Spatial Join](./operators/spatial-join.md): Each feature with the columns of a feature of the other table it intersects, lies within, or contains, as Noodles' spatial join: the first match, and a same-named column takes the match's value.
- [TIN](./operators/tin.md): Triangles joining the input points (Delaunay), as turf.tin; with a column, each triangle has its corners’ values as a, b and c.
- [Transform](./operators/transform.md): Each feature rotated (degrees clockwise), scaled about its centroid or bounding-box center, then moved a distance along a compass bearing, as turf.transformRotate, transformScale and transformTranslate.
- [Voronoi](./operators/voronoi.md): One cell per point, the area nearer it than any other, clipped to the points' bounding box and carrying the point's properties, as turf.voronoi.

## Rows

- [Attribute Create](./operators/attribute.md): Create or overwrite one attribute from an expression.
- [Brushable Histogram](./operators/brushable-histogram.md): Keep rows whose column lies in a brushed range, drawn over the column's histogram in the parameter pane.
- [Distance](./operators/distance.md): Great-circle distance in km between two lng/lat points (haversine).
- [Extent](./operators/extent.md): The minimum and maximum of an expression over the rows that reach it, computed in SQL.
- [Filter](./operators/filter.md): Keep rows matching a condition.
- [Distance to Geometry](./operators/geo-distance.md): Distance from each row's point to a line, polygon or set of points: zero inside a polygon.
- [JS Function](./operators/js-function.md): A JavaScript function any expression can call by name, run by DuckDB per row.
- [Map Range](./operators/map-range.md): Rescale a value from one range to another, linearly, on a log scale or a square root.
- [Point Position](./operators/position.md): Build the position attribute P from longitude, latitude and altitude.
- [Range Filter](./operators/range.md): Keep rows whose column lies between two values.
- [Region Filter](./operators/region.md): Keep rows inside, outside or near a polygon.
- [Attribute Wrangle](./operators/wrangle.md): A VEX-style body: @name = expr; var t = expr; fn f(x) = expr;.

## Color

- [Color](./operators/color.md): A color other parameters reference, so several layers can share one.
- [Color Ramp](./operators/color-ramp.md): Map a value through a color ramp into an RGB attribute.

## Layers

- [Arc Layer](./operators/arc.md): An arc per row between two positions.
- [Bitmap Layer](./operators/bitmap.md): Render a raster image at specified boundaries.
- [Choropleth Layer](./operators/choropleth.md): Rows joined onto boundaries (as Choropleth Join does) and filled by a color ramp over a column, its domain the column's minimum to maximum; a boundary with no value is gray.
- [Column Layer](./operators/column.md): An extruded column per row: bars on a map.
- [Contour Layer](./operators/contour.md): Rows binned into a grid of a cell size in meters, drawn as iso-lines at thresholds or bands between them.
- [Grid Cell Layer](./operators/grid-cell.md): A square column per row, of a cell size in meters, raised by a per-row elevation.
- [Grid Layer](./operators/grid-layer.md): Rows binned into square cells, colored and raised by per-row weights deck sums per bin.
- [Heatmap Layer](./operators/heatmap.md): A density surface of the rows' positions, weighted per row.
- [Hexagon Layer](./operators/hexagon.md): Rows binned into hexagons, colored and raised by per-row weights deck sums per bin.
- [Icon Layer](./operators/icon.md): An icon per row from an atlas image: a string column names each row’s icon in the mapping.
- [Line Layer](./operators/line.md): A straight segment per row between two positions.
- [Simple Mesh Layer](./operators/mesh.md): A 3D model per row, positioned, oriented (pitch, yaw, roll in degrees), scaled and colored by channels.
- [MVT Layer](./operators/mvt.md): Render Mapbox Vector Tiles (MVT).
- [Path Layer](./operators/path.md): A path per row when Position reads a list of positions or a geometry; otherwise rows are vertices, grouped into paths by an id column and ordered by another.
- [Point Cloud Layer](./operators/point-cloud.md): A lit point per row, sized in pixels or meters.
- [Polygon Layer](./operators/polygon.md): A polygon per row when Position reads a geometry (holes and multi-polygons included); otherwise rows are vertices, grouped into polygons by an id, into rings by another (the first ring is the outline, the rest are holes), ordered by a third.
- [Raster Tile Layer](./operators/raster-tiles.md): Render a raster tile layer on the map.
- [Scatterplot Layer](./operators/scatter.md): A circle per row.
- [Scenegraph Layer](./operators/scenegraph.md): A 3D model per row, positioned, oriented (pitch, yaw, roll in degrees), scaled and colored by channels.
- [Screen Grid Layer](./operators/screen-grid.md): Rows binned into square cells of a size on screen, colored by their summed or averaged weight.
- [Terrain Layer](./operators/terrain.md): Render a terrain mesh from heightmap tiles.
- [Text Layer](./operators/text.md): A label per row from a string column.
- [Tile 3D Layer](./operators/tile-3d.md): Render 3D tiles on the map (Google, Cesium, or a custom tileset URL).
- [Trips Layer](./operators/trips.md): Animated trails: a trip per row when Position reads a list of positions and Timestamp a list of times; otherwise vertex rows with a timestamp each.

## Numbers

- [Bezier Curve](./operators/bezier-curve.md): A number from a curve: the curve’s height at a factor from 0 to 1.
- [Expression](./operators/expression.md): A number from an expression over a, b, T (seconds), F (frame) and ch() references.
- [Math](./operators/math.md): Combine two numbers.
- [Mouse](./operators/mouse.md): The pointer over the map, in pixels from its top left.
- [Number](./operators/number.md): A constant, a slider, or a keyframed value.
- [Ramp](./operators/ramp.md): A number from stops: the value at a position, between stops linearly, smoothly (monotone) or held.
- [Time](./operators/time.md): Timeline seconds × speed + offset.

## Output

- [Bitmap Overlay](./operators/bitmap-overlay-widget.md): Display a bitmap image as a screen-space overlay.
- [Brightness / Contrast](./operators/brightness-contrast.md): Adjust brightness and contrast of a layer.
- [Brushing](./operators/brushing.md): Show only objects near the pointer.
- [Clip Extension](./operators/clip-extension.md): Clip layers by a rectangular bounds.
- [Collision Filter](./operators/collision-filter.md): Hide overlapping objects, keeping the higher priority one.
- [Compass Widget](./operators/compass-widget.md): Compass and bearing reset widget.
- [Deck](./operators/deck.md): The map: layers bottom to top, the basemap, and the camera.
- [Fill Style](./operators/fill-style.md): Fill polygons with a pattern from an atlas.
- [FirstPerson View](./operators/first-person-view.md): A deck.gl first person view.
- [Fit Bounds](./operators/fit-bounds.md): The camera that fits rows into the render surface: wire its view state into the deck, or its longitude, latitude and zoom into a View State.
- [FPS Widget](./operators/fps-widget.md): Display frames per second (FPS) and rendering stats widget.
- [Fullscreen Widget](./operators/fullscreen-widget.md): Enter/exit fullscreen widget.
- [Globe View](./operators/globe-view.md): A deck.gl globe view.
- [Hue / Saturation](./operators/hue-saturation.md): Adjust hue and saturation of a layer.
- [Layer Props](./operators/layer-props.md): Props added to a layer: operation "mask" for a mask layer, beforeId to draw under a MapLibre layer, or any others as JSON.
- [Legend Widget](./operators/legend-widget.md): Display a color scale legend overlay on the visualization.
- [Map Style](./operators/map-style.md): A basemap style with your changes: layers hidden or recolored, from the style editor.
- [Map View](./operators/map-view.md): A deck.gl map view.
- [Mask 3D Extension](./operators/mask-3d-extension.md): Show only a sphere around a lng/lat/alt (meters) of a Tile3DLayer, fading to white at the edge.
- [Mask Extension](./operators/mask-extension.md): Show/hide layer objects by a geofence.
- [Merge](./operators/merge.md): One object from several, later ones winning, as Object.assign does: view states, layer props.
- [Orbit View](./operators/orbit-view.md): A deck.gl orbit view.
- [Orthographic View](./operators/orthographic-view.md): A deck.gl orthographic view.
- [Path Style](./operators/path-style.md): Dashed and offset paths.
- [PMTiles](./operators/pmtiles.md): Load a PMTiles archive as a MapLibre vector or raster source.
- [Scale Widget](./operators/scale-widget.md): Display a map distance scale widget.
- [Screenshot Widget](./operators/screenshot-widget.md): Download current frame as PNG widget.
- [Terrain Extension](./operators/terrain-extension.md): Render a terrain layer on the map.
- [Vibrance](./operators/vibrance.md): Adjust vibrance of a layer.
- [View State](./operators/view-state.md): A camera: longitude, latitude, zoom, pitch and bearing, which numbers can drive.
- [XYZ Tiles](./operators/xyz-tiles.md): Configure a raster XYZ tile source from a URL template (\{z\}/\{x\}/\{y\}).
- [Zoom Widget](./operators/zoom-widget.md): Zoom in/out buttons widget.

## Structure

- [Comment](./operators/comment.md): A note that explains the nodes beside it.
- [Subnetwork](./operators/subnet.md): A network inside a node.
- [Subnet Input](./operators/subnet-input.md): Inside a subnet: what is connected to the subnet's input.
- [Subnet Output](./operators/subnet-output.md): Inside a subnet: what the subnet outputs.
- [Switch](./operators/switch.md): Pass one of several layers through, chosen by index.

## Host operators

- [Chart](./operators/chart.md): Create charts using Observable Plot (bar, histogram, scatter).
- [Code](./operators/code-host.md): Run custom JavaScript code to transform your data.
- [CustomMapLibreLayer](./operators/custom-map-libre-layer.md): Define a custom MapLibre GL layer with WebGL rendering.
- [Directions](./operators/directions.md): Get driving, traffic-aware driving, or transit directions between points.
- [Geocoder](./operators/geocoder.md): Get the location of a query string.
- [TileLayer](./operators/tile-layer.md): Render data organized in a tiled format (generic tile layer).
<!-- gen:end operators -->
