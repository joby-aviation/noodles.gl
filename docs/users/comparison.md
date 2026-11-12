# How Noodles.gl compares

Noodles.gl overlaps with geospatial tools, motion design software and data visualization libraries. Here's how it relates to tools you may already know.

## The short version

Noodles.gl is built for animated, data-driven map stories: camera moves, data revealed over time, parameter changes exported as video. Other tools cover parts of this. Noodles.gl puts a node graph over your data, a keyframe timeline and GPU map layers in one browser editor.

## Detailed comparison

### vs. Kepler.gl / Foursquare Studio

Kepler is good for fast geospatial exploration: drop a CSV, see points on a map, adjust filters. Its animation centers on the time filter, which plays data through time and can export that as a video. It has no general keyframe timeline, so no camera moves, easing curves or animating an arbitrary parameter. When the story needs directed motion rather than a time sweep, Noodles.gl picks up.

| | Kepler.gl / FSQ Studio | Noodles.gl |
|---|---|---|
| Drop a CSV and explore | Instant | Instant (Import Data or drop the file) |
| Animate the camera | No | Keyframes with curves |
| Animate data over time | Time filter playback | Timeline, any number parameter |
| Composable pipeline | No | Node graph |
| Export video | Time filter only, preset resolutions | MP4 at the resolution you set |
| Custom code | DuckDB SQL; expressions on Studio Enterprise | JavaScript and DuckDB SQL, no tier |

### vs. After Effects

After Effects is the standard for motion graphics, but on its own it has no geospatial data, map projections or live data. The usual setup for maps is **After Effects with the GeoLayers plugin**, which is widely used and capable. It is a paid plugin on top of a subscription, and the data arrives as exported assets: change the query and you redo the work.

Noodles.gl applies After Effects-style keyframing (bezier curves, scrubbing, easing) to a live data pipeline. Change the query and every frame of the animation updates.

| | After Effects + GeoLayers | Noodles.gl |
|---|---|---|
| Keyframe timeline | Full, professional | Keyframes with bezier curves |
| Data-driven | Static import per revision | Live pipeline |
| Map projections | Through the plugin | Mercator and globe |
| Geo layer types | Limited set | About two dozen deck.gl layers: arcs, hexagons, heatmaps, trips... |
| When the data changes | Redo by hand | Updates on its own |
| Runs in a browser | No | Yes, no install |

### vs. D3.js / Observable

D3 gives you complete control, but every visualization is code written from scratch, with no timeline, GPU layers or visual editor. Code nodes in Noodles.gl have D3 in scope, so you can use it without maintaining your own rendering.

| | D3.js | Noodles.gl |
|---|---|---|
| Custom visualization | Anything you can code | Built-in layers, plus Code nodes and SQL |
| Visual editor | No | Node graph and timeline |
| GPU rendering | No (SVG/Canvas) | WebGL through deck.gl |
| Large datasets | Limited by SVG and Canvas | DuckDB queries and GPU layers |
| Animation | Code your own | Built-in timeline |
| Shareable projects | Deploy as an app | A JSON project file |

### vs. QGIS / GeoLibre (desktop GIS)

Desktop GIS tools are best for spatial analysis: hundreds of algorithms, wide format support and editing. Their output is mostly static maps. Noodles.gl is not a GIS workbench. It is for presenting results with motion after the analysis is done, so getting your data in should be easy: drop a GeoJSON, Shapefile or GeoParquet file on the canvas and Import Data builds the pipeline.

| | QGIS / GeoLibre | Noodles.gl |
|---|---|---|
| Spatial analysis | Hundreds of algorithms | Common GIS steps as nodes, plus Code nodes and DuckDB SQL |
| Formats | 30+ | CSV, JSON, Parquet, GeoJSON, Shapefile, GeoParquet, PMTiles, and what DuckDB spatial reads |
| Geometry editing | Full | Basic (Draw tool) |
| Animation | Trips layer playback (GeoLibre) | Timeline, any number parameter |
| Video export | Basic | MP4 at the resolution you set |
| Data-driven styling | Static rules | Expressions over columns, animated |
| Browser-based | GeoLibre yes, QGIS no | Yes |

### vs. Flourish / Datawrapper

Template tools are easy to use but limited to their chart types and options. Noodles.gl has no templates: you compose a pipeline from operators, which takes longer to learn and goes further.

| | Flourish | Noodles.gl |
|---|---|---|
| Time to first visualization | Minutes | Minutes from an example or with the AI assistant; longer from a blank graph |
| Customization | Limited to templates | Any graph you can build |
| Map animations | Preset transitions | Any number parameter, any curve |
| Custom data transforms | No | Code nodes, DuckDB SQL, expressions |
| Self-hosted | No | Yes (static files) |
| Export video | Limited | MP4 |

## When to use Noodles.gl

- Your visualization needs **motion**: camera moves, data revealed over time, parameter transitions
- You want a **live pipeline**: change the data upstream and everything downstream updates
- You need **publication quality**: high-resolution export and control over every visual parameter
- The story is **geospatial**: maps, coordinates, routes, regions, globes

## When to use something else

- **Quick data exploration** with no animation: Kepler.gl
- **Deep GIS analysis** (long processing chains, topology validation, hundreds of layers): QGIS
- **General motion graphics** with live-action compositing: After Effects
- **Simple embedded charts**: Datawrapper
- **Custom visualizations that aren't maps**: D3.js or Observable
