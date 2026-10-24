# Essential Operators

Operators are the nodes of a project. Most take a table on `in`, change it, and pass it on from `out`; layers draw a table, and the deck node shows the layers. Press `Tab` in the network editor to add one. Each is listed here by its menu label and its type (the `op` in a project file).

This page covers the ones you'll use most. The [Operator Reference](../reference/operators.md) lists every operator with its ports and parameters.

## Data

- **File** (`file`): Read a CSV, JSON or Parquet file by URL, or `@/name.csv` from the project's data directory
- **GeoJSON** (`geojson`): A GeoJSON file, or any vector file DuckDB spatial reads (Shapefile, GeoPackage...). Its `features` output has one row per feature with a `geom` column; `polygons`, `lines` and `points` have one row per vertex
- **DuckDB SQL** (`sql`): Any SELECT. `{{input0}}` is the table wired into `in0`
- **Code** (`code`): JavaScript that returns rows or GeoJSON. `d` is the input's rows; `d3`, `turf` and `utils` are in scope
- **Table** (`table`): Rows you type in, kept in the project
- **Generate** (`generate`): N numbered rows
- **Overpass** (`overpass`): OpenStreetMap features from an Overpass QL query

## Tables and Rows

- **Filter** (`filter`): Keep rows that compare a number, match text, or pass an expression
- **Range Filter** (`range`), **Region Filter** (`region`): Keep rows between two values, or inside, outside or near a polygon
- **Brushable Histogram** (`brushable-histogram`): Keep rows whose column lies in a range you brush over the column's histogram, which the parameter pane draws. Drag the brush's ends, or switch Brush to Center and width; keyframe Brush min and Brush max to animate it. Its Bins output is the histogram as a table
- **Attribute Create** (`attribute`): One new column from an [expression](./expressions.md)
- **Attribute Wrangle** (`wrangle`): Several columns from a few lines of code
- **Map Range** (`map-range`): Rescale a value linearly, on a log scale or a square root
- **Color Ramp** (`color-ramp`): A value through a color ramp into an RGB column
- **Sort**, **Limit**, **Join**, **Union**, **Aggregate** (`sort`, `limit`, `join`, `union`, `aggregate`): Order, cut, match, stack and group tables
- **Unnest** (`unnest`): List columns to one row per item
- **Time Series** (`time-series`): Each path's position at one time
- **Extent** (`extent`): The minimum and maximum of a column, to wire into another node's parameter

## Geometry

GIS steps over tables of features: **Buffer**, **Centroid**, **Simplify**, **Clip**, **Dissolve**, **Spatial Join**, **Nearest**, **Voronoi**, **Grid Cells** (H3, S2, A5, geohash, quadkey), **Choropleth Join**, **Smooth Lines** and more. **Point**, **Rectangle** and **Features** make geometry from parameters or from what you draw on the map.

## Layers

> For developers familiar with deck.gl and MapLibre, see the [deck.gl and MapLibre Guide](./deckgl-maplibre-guide.md) for how Noodles.gl builds on these libraries.

Layers take a table and draw a mark per row: **Scatterplot** (`scatter`), **Arc** (`arc`), **Line** (`line`), **Path** (`path`), **Trips** (`trips`), **Polygon** (`polygon`), **Choropleth** (`choropleth`), **Column** (`column`), **Text** (`text`), **Icon** (`icon`), **Point Cloud** (`point-cloud`), **Heatmap** (`heatmap`), **Hexagon** (`hexagon`), **Grid** (`grid-layer`), **Grid Cell** (`grid-cell`), **Screen Grid** (`screen-grid`), **Contour** (`contour`), **Simple Mesh** (`mesh`) and **Scenegraph** (`scenegraph`).

A layer's channels (Position, Color, Radius...) are column names or expressions over the table's columns. **Bitmap**, **MVT**, **Raster Tile**, **Terrain** and **Tile 3D** layers load their own data from a URL and take no table.

## Output

- **Deck** (`deck`): The map. Layers wire into its `layers` port, bottom to top. It holds the basemap style, the camera (longitude, latitude, zoom, pitch, bearing) and the export settings
- **Map Style** (`map-style`): A basemap style with layers hidden or recolored, wired into the deck's map style
- **Views** (Map, Globe, Orbit, Orthographic, First Person) and **View State**: other cameras, wired into the deck's `views` and `viewState` ports
- **Widgets**: Compass, Zoom, Scale, Fullscreen, Screenshot, FPS, Legend and Bitmap Overlay, wired into the deck's `widgets` port
- **Extensions**: Brightness / Contrast, Hue / Saturation, Vibrance, Clip, Mask, Path Style, Fill Style, Collision Filter, Brushing and Terrain, wired into a layer's Extensions
- **Fit Bounds** (`fit-bounds`): The camera that fits a table's rows into the render surface. Wire rows into its Data and its view state into the deck, or its longitude, latitude and zoom into a View State. Position is a position column, a geometry column or an expression such as `[lng, lat]`
- **Merge** (`merge`): One object from several, later ones winning: view states, say
- **Layer Props** (`layer-props`): Props added to a layer, such as operation `mask` for a mask layer or `beforeId` to draw under a MapLibre layer

## Numbers

**Number**, **Time** (the timeline clock), **Math**, **Expression**, **Bezier Curve** and **Ramp** make one number. Wire it into any parameter that has a port, or keyframe it. **Mouse** gives the pointer's x and y over the map, in pixels.

## Routing

- **Directions**: Get a route between two points, as a path with timestamps for animating along it

Each mode uses a different routing service, and some inputs and outputs only work with one of them. Inputs that don't apply to the selected mode are hidden.

| Mode | Service | API key | Extra inputs | Extra outputs |
|------|---------|---------|--------------|---------------|
| Driving (Mapbox / OSRM) | Mapbox Directions; without a Mapbox key, the free [OSRM](https://project-osrm.org/) demo server | Mapbox (optional) | None | None |
| Driving with traffic (Google) | Google Routes API | Google Maps | Departure time, traffic model, avoid tolls | `hasTolls`, `tollAmount`, `tollCurrency` |
| Transit (Google) | Google Directions | Google Maps | None | None |

All modes output `distance` (meters), `duration` (seconds), `durationFormatted`, `path` and `timestamps`. The toll outputs are blank in other modes.

Notes on Driving with traffic:
- **Departure time** is local time at the origin. Scheduled departures must be in the future.
- **Traffic model** sets the assumption Google uses for traffic. *Best guess* is the typical time and matches Google Maps. *Pessimistic* is a heavy-traffic estimate and *Optimistic* a light-traffic one.
- **Tolls**: `tollAmount` is Google's estimated cash price. If `hasTolls` is true but `tollAmount` is blank, Google expects tolls but doesn't know the price.

See [API Keys](./api-keys.md) for which Google APIs to enable.

## Structure

- **Switch** (`switch`): Pass one of several layers through, chosen by an index
- **Comment** (`comment`): A resizable note that explains the nodes beside it. Double-click to edit it. See [Comments](./workflows-intro.md#comments)
- **Subnetwork** (`subnet`): A network inside a node. Select nodes and press `Shift+C` to collapse them into one, and promote parameters to control the inside from outside
