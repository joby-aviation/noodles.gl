# deck.gl and MapLibre Guide

For developers who know [deck.gl](https://deck.gl) and [MapLibre GL JS](https://maplibre.org).

## Overview

Noodles.gl draws deck.gl layers over a MapLibre basemap. In front of them it adds a node editor, runs your data through DuckDB, and keyframes any number parameter on a timeline.

A project is a graph of nodes, and tables flow along its wires:

1. **Data nodes** (`file`, `geojson`, `sql`, `code`) load tables
2. **Row nodes** (`filter`, `attribute`, `map-range`, `color-ramp`, `aggregate`, `join`, `sort`, `limit`...) shape the tables and add columns
3. **Layers** (`scatter`, `arc`, `path`, `trips`, `polygon`...) draw a table
4. **The deck node** (`deck`) shows the layers over the basemap, and holds the basemap style, the camera and the render settings

Noodles compiles the graph and runs it in DuckDB in a background worker. Layer data reaches deck.gl as binary attribute buffers, and moving a slider re-runs only the part of the plan it affects.

## Relationship to Kepler.gl

Like [Kepler.gl](https://kepler.gl), Noodles.gl is built on deck.gl and MapLibre. Kepler.gl is made for quick exploration; Noodles.gl adds a keyframe timeline, a node graph with SQL and JavaScript where you need them, more deck.gl layers, basemap style editing, and video export. See [How Noodles.gl compares](./comparison.md).

Many Noodles.gl examples are adapted from the [Kepler.gl demo app](https://github.com/visgl/kepler.gl/tree/master/examples/demo-app/public) to show the same data with animation.

<OpenInEditor example="world-flights" label="Open World Flights">

World Flights is one of them. It draws flight routes with a Path Layer, replays them with a Trips Layer, and animates the trails on the timeline.

</OpenInEditor>

## deck.gl Layers

| Noodles layer (`op`) | deck.gl layer |
|----------------------|---------------|
| Scatterplot Layer (`scatter`) | ScatterplotLayer |
| Line Layer (`line`) | LineLayer |
| Arc Layer (`arc`), with a Great circle option | ArcLayer |
| Path Layer (`path`) | PathLayer |
| Trips Layer (`trips`) | TripsLayer |
| Polygon Layer (`polygon`) | SolidPolygonLayer, with PathLayer outlines when stroked |
| Icon Layer (`icon`) | IconLayer |
| Text Layer (`text`) | TextLayer |
| Point Cloud Layer (`point-cloud`) | PointCloudLayer |
| Column Layer (`column`), Grid Cell Layer (`grid-cell`) | ColumnLayer, GridCellLayer |
| Simple Mesh Layer (`mesh`) | SimpleMeshLayer |
| Scenegraph Layer (`scenegraph`) | ScenegraphLayer |
| Hexagon Layer (`hexagon`), Grid Layer (`grid-layer`) | HexagonLayer, GridLayer |
| Heatmap Layer (`heatmap`) | HeatmapLayer |
| Contour Layer (`contour`) | ContourLayer |
| Screen Grid Layer (`screen-grid`) | ScreenGridLayer |
| MVT Layer (`mvt`) | MVTLayer |
| Raster Tile Layer (`raster-tiles`) | RasterTileLayer |
| Bitmap Layer (`bitmap`) | BitmapLayer |
| Terrain Layer (`terrain`) | TerrainLayer |
| Tile 3D Layer (`tile-3d`): Google, Cesium or a custom tileset | Tile3DLayer |

Each layer has its deck.gl counterpart's props under plain names: a Scatterplot Layer has Radius scale (`radiusScale`), Units (`radiusUnits`), Fill color (`fillColor`), Opacity (`opacity`) and so on. Some defaults differ from deck.gl's: a Scatterplot Layer's radius is in pixels, not meters. Each layer's page in the [Operator Reference](../reference/operators.md) lists its parameters and their defaults. Blending and Extensions are on every layer that draws a table. MVT, Raster Tile, Bitmap, Terrain and Tile 3D layers load their own data from a URL and take no table.

### Per-row values

deck.gl takes accessor functions: `getPosition: d => [d.longitude, d.latitude]`. Noodles.gl has none. Per-row values are columns: a layer's channels (Position, Color, Radius, Width...) take a column name or an [expression](./expressions.md) over the table's columns, and Noodles computes it for every row:

```json
{ "op": "scatter", "params": {
  "position": "[longitude, latitude]",
  "radius": "sqrt(population) / 100.0",
  "color": "ramp(fit(magnitude, 0, 8, 0, 1))" } }
```

A value several layers share goes in an Attribute Create node, which writes a column the layers then name. For colors, a Color Ramp node turns a number column into an RGB column through a ramp (viridis, magma, turbo, cividis, categorical schemes and more), and `ramp(t)` in any channel reads the layer's own Color ramp. For logic an expression can't express, use a `sql` node, a `code` node, or a JS Function that expressions call by name.

### Paths and polygons

A Path, Trips or Polygon layer whose Position reads a list of positions or a geometry column draws one path or polygon per row, such as a GeoJSON node's `features` output with its `geom` column. Otherwise its rows are vertices, grouped by a Path id column and ordered by a Vertex order column. A Scatterplot or Text layer on a geometry column draws a mark per point.

### Views

The deck draws one map view by default. Wire Map, Globe, First Person, Orbit or Orthographic view nodes into its `views` port for another projection, or several of them for side-by-side views.

## MapLibre Basemaps

The deck node holds the basemap and the camera:

- **Map style**: click the style's name to pick from the basemap gallery (CARTO, OpenFreeMap, Stadia, Protomaps, Esri). For any other MapLibre style, paste its URL or style JSON into the gallery's search, or drop a URL on the row.
- **Camera**: Longitude, Latitude, Zoom, Pitch and Bearing
- **Projection**: Mercator or Globe

### Editing styles

Click the sliders beside the style's name to open the style editor. Its layers are on the left, each with its eye and colors; pick one there, or click the map, to edit its paint and layout properties. **z** beside a property makes it change with the zoom: edit its stops and the curve between them (linear, exponential, bezier or step). **Whole style** scales every label and line width at once. ↺ puts back the style's own value.

The changes are kept on the deck, listed as **Changes**; click × to drop them. They reach the project's map when the editor closes, as one undo step. Turn on **Live update** in the editor's header to see them on the project's map as you go.

To share a style between decks or projects, right-click **Map style** and choose **Drive with › Map Style**. That moves the style and its changes into a **Map Style** node (`map-style`) wired into the deck. Anything else that makes style JSON, such as a Code node, can be wired into the row's port the same way; a wired style replaces the deck's own, and **Disconnect input** in the same menu removes it.

## Workflow Examples

**Points** (<EditorLink example="california-earthquakes">California Earthquakes</EditorLink>):

```
file → attribute (position) → map-range → color-ramp → scatter → deck
```

**Origin-destination arcs** (<EditorLink example="nyc-taxis">NYC Taxis</EditorLink>):

```
file → attribute (pickup position) → attribute (dropoff position) → arc → deck
```

**Animated trips** (<EditorLink example="world-flights">World Flights</EditorLink>), with the Time node driving the Trips Layer's Current time:

```
code (a row per flight: path, timestamps) → attribute → color-ramp → trips → deck
time ─────────────────────────────────────────────────────────────→ trips (par:currentTime)
```

**A shared basemap style:**

```
map-style → deck (par:mapStyle)
```

## Text Rendering

The Text Layer (`text`) draws a label per row from a text column (Text). Its Style folder sets Size, Text color, Offset, Angle, Anchor and Baseline; the Font folder sets the family, weight and an outline; the Background folder adds a background behind each label. Per-row Color and Size channels take expressions like any other layer's.

To label GeoJSON points, wire the GeoJSON node's `points` output into a Text Layer with Position `[lng, lat]`, and set Text to a property column such as `name`. For polygons, put a Centroid node on the `features` output and set the Text Layer's Position to `geom`.

## Learn More

- [deck.gl documentation](https://deck.gl/docs)
- [MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs/) and [style specification](https://maplibre.org/maplibre-style-spec/)
- [Operators Guide](./operators-guide.md): the layers and operators you'll use most
- [Data Guide](./data-guide.md) and [Animation and Rendering](./animation-and-rendering.md)
