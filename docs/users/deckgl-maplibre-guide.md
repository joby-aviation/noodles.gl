# deck.gl and Maplibre Guide

For developers familiar with [deck.gl](https://deck.gl) and [Maplibre GL JS](https://maplibre.org).

## Overview

Noodles.gl is built on deck.gl (WebGL visualization framework) and Maplibre GL JS (vector tile rendering). If you're already familiar with these libraries, you'll feel right at home—Noodles.gl adds a node-based workflow layer that makes building complex visualizations easier, with built-in timeline animation support.

## Relationship to Kepler.gl

Like [Kepler.gl](https://kepler.gl), Noodles.gl is built on deck.gl and Maplibre. Kepler.gl focuses on rapid data exploration, while Noodles.gl adds:

- **Timeline animations**: Keyframe any parameter
- **Node-based workflows**: Visual data processing pipelines
- **Full deck.gl access**: All [layer types](https://deck.gl/docs/api-reference/layers), not just Kepler.gl presets
- **Custom basemaps**: Programmatically edit Maplibre style specs
- **Export**: Videos, images, and embeddable applications

Many Noodles.gl [examples](https://github.com/visgl/kepler.gl/tree/master/examples/demo-app/public) are adapted from Kepler.gl to show the same visualizations with animation.

## Architecture

Here's how the pieces fit together:

```
┌─────────────────────────────────────────┐
│         Noodles.gl Node Graph           │
│  (Data processing & visualization flow) │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼──────┐  ┌──────▼──────────┐
│   deck.gl   │  │    Maplibre     │
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

Data flows through operators to create layers that render together:

1. **Data Sources** (FileOp, JSONOp) load your geospatial data
2. **Processing** (CodeOp, DuckDbOp, AccessorOp) transform and prepare data
3. **Layers** (ScatterplotLayerOp, ArcLayerOp, etc.) configure deck.gl visualizations
4. **Basemap** (MaplibreBasemapOp) provides the map foundation
5. **Renderer** (DeckRendererOp) composites everything to a WebGL canvas

## deck.gl Layers

Noodles.gl provides access to all standard deck.gl layers as operators. Here are the main categories:

**Core Layers:**

- ScatterplotLayerOp - Points and circles
- LineLayerOp - Line segments between points
- ArcLayerOp - Arcs connecting origin-destination pairs
- PathLayerOp - Multi-segment paths
- PolygonLayerOp - Filled polygons with optional extrusion
- IconLayerOp - Icon markers
- TextLayerOp - Text labels

**Aggregation Layers:**

- HexagonLayerOp - Hexagonal binning
- GridLayerOp - Square grid aggregation
- HeatmapLayerOp - Continuous density visualization
- ContourLayerOp - Isoline/isoband visualization
- ScreenGridLayerOp - Screen-space aggregation

**GeoJSON & Tiles:**

- GeoJsonLayerOp - Renders any GeoJSON geometry type
- MVTLayerOp - Mapbox Vector Tiles

**3D Layers:**

- ColumnLayerOp - Extruded cylinders
- SimpleMeshLayerOp - 3D mesh rendering
- ScenegraphLayerOp - glTF 3D models
- TerrainLayerOp - 3D terrain with heightmaps

**Special Layers:**

- TripsLayerOp - Animated path trails
- GreatCircleLayerOp - Great circle routes
- S2LayerOp - S2 geometry cells
- TileLayerOp - Custom tile-based layers

### Layer Configuration

Each layer operator exposes the same properties as its deck.gl counterpart. For example, `ScatterplotLayerOp` accepts `data`, `getPosition`, `getRadius`, `getFillColor`, `radiusScale`, etc.

### Accessors

In native deck.gl, you write accessor functions in JavaScript: `d => [d.longitude, d.latitude]`

In Noodles.gl, you can use `AccessorOp` with simple expression strings like `[d.longitude, d.latitude]`, or switch to `CodeOp` when you need more complex logic. CodeOp gives you access to special variables: `data` (the full input list), `d` (the first element), and `op()` (to reference other operators).

**Color mapping operators:**

- `CategoricalColorRampOp` - Assign colors to discrete categories
- `SequentialColorRampOp` - Map numeric ranges to color gradients
- `DivergingColorRampOp` - Two-color diverging scales

## Maplibre Basemaps

The `MaplibreBasemapOp` controls your base map and camera position:

- **mapStyle**: A Maplibre style specification (JSON object or URL)
- **viewState**: Camera position (latitude, longitude, zoom, pitch, bearing)

### Importing and Editing Hosted Styles

One of the most powerful features is the ability to import style specifications from map hosting providers like [MapTiler](https://www.maptiler.com/) or Mapbox, then modify them programmatically before rendering:

```
FileOp (style URL) → CodeOp (edit layers) → MaplibreBasemapOp.mapStyle
```

Example CodeOp to modify a style:

```javascript
// CodeOp receives style JSON in `d` variable (first input)
const style = d
let layers = style.layers.filter(l => !l.id.includes('building')) // Filter layers

// Update existing layer
const waterLayer = layers.find(l => l.id === 'water')
if (waterLayer) waterLayer.paint['fill-color'] = '#1a1a2e'

return { ...style, layers }
```

This pattern enables dynamic styling, layer filtering, custom overlays, branding, and performance optimization.

**Common providers:** [MapTiler](https://www.maptiler.com/), [Mapbox](https://www.mapbox.com/), [CARTO](https://carto.com/basemaps/), [OpenMapTiles](https://openmaptiles.org/), [Stadia Maps](https://stadiamaps.com/)

## Workflow Examples

Here are some common patterns to get you started:

**Point visualization:**

```
FileOp → AccessorOp (position/color) → ScatterplotLayerOp → DeckRendererOp → OutOp
MaplibreBasemapOp ↗
```

**Origin-destination flow (similar to Kepler.gl arcs):**

```
FileOp → AccessorOp (source/target positions & colors) → ArcLayerOp → DeckRendererOp → OutOp
MaplibreBasemapOp ↗
```

**Animated trips (the key difference: you can keyframe currentTime!):**

```
FileOp → AccessorOp (path/timestamps/color) → TripsLayerOp → DeckRendererOp → OutOp
NumberOp (currentTime - keyframe this!) ↗
MaplibreBasemapOp ↗
```

**Custom basemap styling:**

```
StringOp (style URL) → FileOp → CodeOp (edit layers) → MaplibreBasemapOp → DeckRendererOp → OutOp
ScatterplotLayerOp ↗
```

## Deck.gl Views

Beyond the standard `MapViewOp`, you can use `FirstPersonViewOp`, `OrbitViewOp`, and `OrthographicViewOp` for different camera perspectives. You can even render multiple views simultaneously for side-by-side comparisons.

## Comparison

### vs Pure deck.gl Code

If you're used to writing deck.gl code directly, Noodles.gl offers visual workflows, built-in timeline animation, and live parameter editing—all without code/rebuild cycles.

### vs Kepler.gl

Both tools share the same foundation, so choosing between them depends on your use case:

**Use Kepler.gl for:** Quick data exploration, simpler interface, built-in filter UI

**Use Noodles.gl for:** Timeline animations, full deck.gl layer library, custom data processing (CodeOp/DuckDbOp), programmatic basemap editing, video/image export, motion graphics

## Learn More

**External Resources:**

- [deck.gl Documentation](https://deck.gl/docs)
- [Maplibre GL JS Documentation](https://maplibre.org/maplibre-gl-js/docs/)
- [Maplibre Style Specification](https://maplibre.org/maplibre-style-spec/)
- [Kepler.gl](https://kepler.gl) - Many examples adapted in Noodles.gl

**Noodles.gl Guides:**

- [Animation and Rendering](./animation-and-rendering.md) - Create animated visualizations
- [Operators Guide](./operators-guide.md) - Complete reference for all layer types
- [Data Guide](./data-guide.md) - Data loading and processing techniques
