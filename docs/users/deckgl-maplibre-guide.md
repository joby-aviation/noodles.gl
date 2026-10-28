# deck.gl and MapLibre Guide

For developers familiar with [deck.gl](https://deck.gl) and [MapLibre GL JS](https://maplibre.org).

## Overview

Noodles.gl draws with deck.gl (GPU visualization layers) over a MapLibre GL JS basemap (vector tiles). If you already know these libraries, most of what you see will be familiar. Noodles.gl adds a node editor in front of them, runs your data through DuckDB, and adds timeline animation.

## Relationship to Kepler.gl

Like [Kepler.gl](https://kepler.gl), Noodles.gl is built on deck.gl and MapLibre. Kepler.gl focuses on rapid data exploration, while Noodles.gl adds:

- **Timeline animations**: Keyframe any number parameter
- **Node-based workflows**: Visual data processing pipelines, with SQL and JavaScript where you need them
- **More deck.gl layers**: Including trips, mesh, scenegraph, terrain and 3D tiles
- **Custom basemaps**: Hide or recolor the layers of a MapLibre style
- **Export**: Videos and images

Many Noodles.gl [examples](https://github.com/visgl/kepler.gl/tree/master/examples/demo-app/public) are adapted from Kepler.gl to show the same visualizations with animation.

<OpenInEditor example="world-flights" label="Open World Flights">

World Flights is one of them. It draws flight routes with a Path Layer, replays them with a Trips Layer, and animates the trails on the timeline.

</OpenInEditor>

## Architecture

Here's how the pieces fit together:

```
┌─────────────────────────────────────────┐
│          Noodles.gl project             │
│   (nodes and wires, compiled to DuckDB) │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼──────┐  ┌──────▼──────────┐
│   deck.gl   │  │    MapLibre     │
│   Layers    │  │    Basemap      │
└──────┬──────┘  └──────┬──────────┘
       │                │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │  WebGL Canvas  │
       │   (Rendered)   │
       └────────────────┘
```

Tables flow along the wires and become layers:

1. **Data nodes** (`file`, `geojson`, `sql`, `code`) load your data as tables
2. **Row nodes** (`filter`, `attribute`, `map-range`, `color-ramp`, `aggregate`, `join`, `sort`, `limit`) shape the tables and add columns
3. **Layers** (`scatter`, `arc`, `path`, `trips`, `polygon`, `heatmap`, `hexagon`, `text`...) draw a table
4. **The deck node** (`deck`) shows the layers over the basemap, and holds the basemap style, the camera and the render settings

Noodles compiles the project and runs it in DuckDB in a background worker. Layer data reaches deck.gl as binary attribute buffers, and changing a slider re-runs only the part of the plan it affects.

## deck.gl Layers

**Core Layers:**

- Scatterplot Layer (`scatter`): Points and circles
- Line Layer (`line`): Line segments between points
- Arc Layer (`arc`): Arcs connecting origin and destination, with a Great circle option
- Path Layer (`path`): Multi-segment paths
- Polygon Layer (`polygon`): Filled polygons with optional extrusion
- Icon Layer (`icon`): Icon markers from an atlas
- Text Layer (`text`): Text labels (see [Text Rendering](#text-rendering) below)
- Point Cloud Layer (`point-cloud`): Lit points

**Aggregation Layers:**

- Hexagon Layer (`hexagon`): Hexagonal binning
- Grid Layer (`grid-layer`): Square grid aggregation
- Heatmap Layer (`heatmap`): Continuous density
- Contour Layer (`contour`): Isolines and isobands
- Screen Grid Layer (`screen-grid`): Screen-space aggregation

**Tiles and Images:**

- MVT Layer (`mvt`): Mapbox Vector Tiles
- Raster Tile Layer (`raster-tiles`): Raster tiles from a URL template
- Bitmap Layer (`bitmap`): An image stretched over bounds

**3D Layers:**

- Column Layer (`column`) and Grid Cell Layer (`grid-cell`): Extruded columns
- Simple Mesh Layer (`mesh`): A 3D mesh per row
- Scenegraph Layer (`scenegraph`): A glTF model per row
- Terrain Layer (`terrain`): 3D terrain from heightmap tiles
- Tile 3D Layer (`tile-3d`): Google, Cesium or custom 3D tilesets

**Animation:**

- Trips Layer (`trips`): Animated path trails

### Layer Configuration

Each layer has the props of its deck.gl counterpart under plain names: a Scatterplot Layer has Radius scale (`radiusScale`), Units (`radiusUnits`), Fill color (`fillColor`), Opacity (`opacity`) and so on. Blending and Extensions are on every layer that draws a table.

### Per-row Values

In deck.gl you write accessor functions in JavaScript: `getPosition: d => [d.longitude, d.latitude]`.

In Noodles.gl, per-row values are columns. A layer's channels (Position, Color, Radius, Width...) take a column name or an [expression](./expressions.md) over the table's columns, and Noodles computes the column for every row:

```json
{ "op": "scatter", "params": {
  "position": "[longitude, latitude]",
  "radius": "sqrt(population) / 100.0",
  "color": "ramp(fit(magnitude, 0, 8, 0, 1))" } }
```

A value several layers share goes in an Attribute Create node, which writes a column the layers then name. For logic an expression can't express, use a `sql` node, a `code` node, or a JS Function that expressions call by name.

**Color mapping:**

- Color Ramp (`color-ramp`): a numeric column through a ramp (viridis, magma, turbo, cividis, categorical ramps) into an RGB column
- Map Range (`map-range`): a column rescaled to a new range, linearly, on a log scale or a square root
- `ramp(t)` in any channel: a color from the layer's own Color ramp parameter

### Paths and Polygons

A Path, Trips or Polygon layer whose Position reads a list of positions or a geometry column draws one path or polygon per row. A GeoJSON node's `features` output, with its `geom` column, draws that way. Otherwise rows are vertices, grouped by an id column and ordered by another. A Scatterplot or Text layer on a geometry column draws a mark per point.

## MapLibre Basemaps

The deck node controls the basemap and the camera:

- **Map style**: the basemap. Click the style's name to pick from the basemap gallery, with styles from CARTO, OpenFreeMap and others. To use any other MapLibre style, paste its URL or style JSON into the gallery's search, or drop a URL on the row.
- **Camera**: Longitude, Latitude, Zoom, Pitch and Bearing
- **Projection**: Mercator or Globe

### Editing Styles

Click the sliders beside the style's name to open the style editor on the deck's own style. Its layers are on the left, each with its eye and colors; pick one there, or click the map on the right, to edit its properties in the middle. Every paint and layout property the layer's type takes is listed, the ones the style sets first: numbers with a slider in their units, colors, menus, toggles and lists, and JSON for expressions over feature data. **z** beside a property makes it change with the zoom: edit its stops (a zoom and the value there) and the curve between them (linear, exponential or step), and add a stop at the map's zoom. ↺ puts back the style's own value.

**Whole style** scales every label and line width at once, zoom ramps included. The changes are kept on the deck, listed as **Changes**; click × to drop them.

To share a style between decks or projects, right-click **Map style** and choose **Drive with › Map Style**. It moves the style and its changes into a **Map Style** node (`map-style`) wired into the deck. Anything else that makes style JSON, such as a Code node, can be wired into the row's port the same way; a wired style takes the place of the deck's own, and **Disconnect input** on the same menu takes it off.

The same menu drives other properties: a number can be driven by a new **Number**, **Time**, **Math** or **Expression** node, which starts from the property's value.

**Common providers:** [MapTiler](https://www.maptiler.com/), [Mapbox](https://www.mapbox.com/), [CARTO](https://carto.com/basemaps/), [OpenMapTiles](https://openmaptiles.org/), [Stadia Maps](https://stadiamaps.com/)

## Workflow Examples

Here are some common patterns to get you started:

**Point visualization:**

```
file → attribute (position) → map-range → color-ramp → scatter → deck
```

See it in the <EditorLink example="california-earthquakes">California Earthquakes example</EditorLink>.

**Origin-destination flow (similar to Kepler.gl arcs):**

```
file → attribute (pickup position) → attribute (dropoff position) → arc → deck
```

See it in the <EditorLink example="nyc-taxis">NYC Taxis example</EditorLink>.

**Animated trips (the key difference: you can keyframe currentTime):**

```
code (a row per flight: path, timestamps) → attribute → color-ramp → trips → deck
time ─────────────────────────────────────────────────────────────→ trips (par:currentTime)
```

See it in the <EditorLink example="world-flights">World Flights example</EditorLink>.

**Custom basemap styling:**

```
map-style (base style URL, edited) → deck (par:mapStyle)
```

## Deck.gl Views

The deck draws one map view by default. Wire Map, Globe, First Person, Orbit or Orthographic view nodes into its `views` port for other camera perspectives, or several of them for side-by-side comparisons.

## Comparison

### vs Pure deck.gl Code

If you're used to writing deck.gl code directly, Noodles.gl offers visual workflows, built-in timeline animation, and live parameter editing, all without code and rebuild cycles.

### vs Kepler.gl

Both tools share the same foundation, so choosing between them depends on your use case:

**Use Kepler.gl for:** Quick data exploration, simpler interface, built-in filter UI

**Use Noodles.gl for:** Timeline animations, more deck.gl layers, custom data processing (SQL and JavaScript), basemap style editing, video and image export, motion graphics

## Text Rendering

### Text Layer

The Text Layer (`text`) draws a label per row from a text column (Text). Its Style folder sets Size (px), Size units, Text color, Offset X and Y, Angle, Anchor (`start`, `middle`, `end`) and Baseline (`top`, `center`, `bottom`). The Font folder sets the Font family, Weight, Face the camera, and an Outline width and color; the Background folder adds a background color behind each label. Per-row Color and Size channels take expressions like any other layer's.

### Labels for GeoJSON

To label GeoJSON point features, wire the GeoJSON node's `points` output into a Text Layer with Position `[lng, lat]`, and set Text to a property column such as `name`. For polygons, put a Centroid node on the `features` output and set the Text Layer's Position to `geom`.

## Learn More

**External Resources:**

- [deck.gl Documentation](https://deck.gl/docs)
- [MapLibre GL JS Documentation](https://maplibre.org/maplibre-gl-js/docs/)
- [MapLibre Style Specification](https://maplibre.org/maplibre-style-spec/)
- [Kepler.gl](https://kepler.gl): many examples adapted in Noodles.gl

**Noodles.gl Guides:**

- [Animation and Rendering](./animation-and-rendering.md): create animated visualizations
- [Operators Guide](./operators-guide.md): every layer type and operator
- [Data Guide](./data-guide.md): data loading and processing techniques
