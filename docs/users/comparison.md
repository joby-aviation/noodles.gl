# How Noodles.gl compares

Noodles.gl sits at the intersection of geospatial tools, motion design software, and data visualization libraries. Here's how it relates to tools you may already know.

## The short version

If you need **animated, data-driven map stories** — camera flythroughs, temporal data reveals, parameter-driven transitions exported as video — Noodles.gl is purpose-built for that workflow. Other tools handle pieces of it, but none combine reactive data pipelines, a full keyframe timeline, and GPU-rendered cartography in a single browser-based editor.

## Detailed comparison

### vs. Kepler.gl / Studio

Kepler is excellent for fast geospatial exploration — drop a CSV, see points on a map, adjust filters. But it produces **static views**. There's no timeline, no keyframeable parameters, no way to animate a camera move or export a video. When you need the visualization to *move*, Kepler is the starting point you outgrow.

| | Kepler.gl | Noodles.gl |
|---|---|---|
| Drop CSV and explore | Instant | Instant (via Import Data) |
| Animate camera | No | Keyframeable with curves |
| Animate data over time | Time filter widget only | Full timeline, any parameter |
| Composable pipeline | No | Reactive node graph |
| Export video | No | MP4, any resolution |
| Custom code | Limited expressions | Full JavaScript, DuckDB SQL |

### vs. After Effects / Motion Design

After Effects is the gold standard for motion graphics — but it has no concept of geospatial data, map projections, or reactive data flow. To animate a map in AE, you'd export frames from a GIS tool, import them as assets, and manually keyframe everything. If the data changes, you start over.

Noodles.gl gives you AE-style keyframing (bezier curves, timeline scrubbing, easing) applied directly to a live data pipeline. Change the underlying query and every frame of your animation updates automatically.

| | After Effects | Noodles.gl |
|---|---|---|
| Keyframe timeline | Full, professional | Full, with bezier curves |
| Data-driven | Manual import | Live reactive pipeline |
| Map projections | None (raster only) | Globe, Mercator, Orthographic |
| 40+ geo layer types | No | Arc, hex, heatmap, trips, etc. |
| Update when data changes | Re-do manually | Automatic propagation |
| Runs in browser | No | Yes, no install |

### vs. D3.js / Observable

D3 gives you complete control, but every visualization is code from scratch. There's no built-in timeline, no GPU-rendered layers, and no visual editor for iteration. Noodles includes D3 as a utility inside CodeOp nodes — you get the library's power without maintaining a custom rendering stack.

| | D3.js | Noodles.gl |
|---|---|---|
| Custom visualization | Unlimited (code) | 40+ layers + CodeOp for custom |
| Visual editor | No | Full node graph + timeline |
| GPU rendering | No (SVG/Canvas) | WebGL via Deck.gl |
| Large datasets (1M+ rows) | Difficult | Handled natively |
| Animation | Code your own | Built-in timeline |
| Shareable projects | Deploy as app | JSON file or embed |

### vs. QGIS / GeoLibre (desktop GIS)

Desktop GIS tools are unbeatable for spatial analysis — hundreds of algorithms, format support, and editing capabilities. But they produce static maps. Noodles.gl is not trying to be a GIS workbench. It's the tool you reach for *after* analysis, when you need to present results with motion and narrative.

| | QGIS / GeoLibre | Noodles.gl |
|---|---|---|
| Spatial analysis algorithms | Hundreds | CodeOp + DuckDB |
| Format support | 30+ | GeoJSON, CSV, Parquet, SQL |
| Geometry editing | Full | Coming soon (GeoEditor) |
| Animation / timeline | None | Core feature |
| Video export | Basic (limited) | Full MP4, any resolution |
| Data-driven styling | Static rules | Reactive, animated |
| Browser-based | GeoLibre yes, QGIS no | Yes |

### vs. Flourish / Datawrapper

Template-based visualization tools are easy to use but constrained. You get pre-built chart types with limited customization. Noodles.gl has no templates — instead, you compose visual pipelines from primitive operators, which means the ceiling is much higher.

| | Flourish | Noodles.gl |
|---|---|---|
| Time to first visualization | Minutes | Minutes |
| Customization ceiling | Low (templates) | Unlimited (composable graph) |
| Map animations | Preset transitions | Any parameter, any curve |
| Custom data transforms | No | CodeOp, DuckDB, expressions |
| Self-hosted | No | Yes (static files) |
| Export video | Limited | Full MP4 |

## When to use Noodles.gl

- Your visualization needs **motion** — camera moves, data revealing over time, parameter transitions
- You want a **reactive pipeline** — change upstream data and everything downstream updates
- You need **publication quality** — high-res export, precise control over every visual parameter
- The story is **geospatial** — maps, coordinates, routes, regions, globes

## When to use something else

- **Quick data exploration** with no animation needs → Kepler.gl
- **Traditional GIS analysis** (buffer, intersect, spatial joins on hundreds of layers) → QGIS
- **General motion graphics** with live action compositing → After Effects
- **Simple embedded charts** with no customization → Datawrapper
- **Fully custom non-map visualizations** → D3.js / Observable
