# Essential Operators

Operators are the core processing units in the Noodles.gl system. They take inputs, process data, and produce outputs that can be connected to other operators.

## Primitives

- **NumberOp**, **StringOp**, **BooleanOp**

## Data Sources
- **FileOp**: Load JSON and CSV data from files or URLs
- **JSONOp**: Parse a JSON string

## Code

- **CodeOp**: Write custom JavaScript for data processing
- **DuckDbOp**: Query a DuckDB database using sql
- **ExpressionOp**: Run a JavaScript expression on the data

## Visualization

> For developers familiar with deck.gl and Maplibre, see the [deck.gl and Maplibre Guide](./deckgl-maplibre-guide.md) for details on how Noodles.gl builds on these libraries.

### Layers
- **Deck.gl Layers**: Create any [deck.gl layer](https://deck.gl/docs/api-reference/layers), such as `ScatterPlotLayerOp`
- **AccessorOp**: Create an accessor function for use in deck.gl layers

### Views
- **MaplibreBasemapOp**: Customize the Maplibre basemap
- **MapViewStateOp**: Create a react-map-gl [ViewState](https://visgl.github.io/react-map-gl/docs/api-reference/maplibre/types#viewstate) for controlling the camera
- **Deck.gl Views**: Create any [deck.gl view](https://deck.gl/docs/developer-guide/views#types-of-views), such as `FirstPersonViewOp`

### Output
- **DeckRendererOp**: Visualization deck.gl layers and Maplibre maps
- **OutOp**: Output a visualization

## Routing

- **DirectionsOp**: Get a route between two points, as a path with timestamps for animating along it

Each mode uses a different routing service, and some inputs and outputs only work with one of them. Inputs that don't apply to the selected mode are hidden.

| Mode | Service | API key | Extra inputs | Extra outputs |
|------|---------|---------|--------------|---------------|
| Driving (Mapbox / OSRM) | Mapbox Directions; without a Mapbox key, the free [OSRM](https://project-osrm.org/) demo server | Mapbox (optional) | — | — |
| Driving with traffic (Google) | Google Routes API | Google Maps | Departure time, traffic model, avoid tolls | `hasTolls`, `tollAmount`, `tollCurrency` |
| Transit (Google) | Google Directions | Google Maps | — | — |

All modes output `distance` (meters), `duration` (seconds), `durationFormatted`, `path` and `timestamps`. The toll outputs are blank in other modes.

Notes on Driving with traffic:
- **Departure time** is local time at the origin. Scheduled departures must be in the future.
- **Traffic model** sets the assumption Google uses for traffic. *Best guess* is the typical time and matches Google Maps. *Pessimistic* is a heavy-traffic estimate and *Optimistic* a light-traffic one.
- **Tolls**: `tollAmount` is Google's estimated cash price. If `hasTolls` is true but `tollAmount` is blank, Google expects tolls but doesn't know the price.

See [API Keys](./api-keys.md) for which Google APIs to enable.

## Utilities
- **SwitchOp**: Switch between multiple values
- **MathOp**: Perform a mathematical operation
- **Debugging**: Use `ViewerOp` and `ConsoleOp` to inspect intermediate results

## GeoJSON

- **LineInterpolationOp**: Resample LineString and MultiLineString geometry with Catmull–Rom, cardinal, basis, natural, or monotone curves. Its turn-radius mode preserves straight legs and replaces corners with circular arcs measured in meters; short legs automatically limit the effective radius to prevent adjacent turns from overlapping.

## Organization

- **ContainerOp**: Use containers to group related operators
- **CommentOp**: A resizable note that explains the nodes beside it. Double-click to edit it. See [Comments](./workflows-intro.md#comments)
