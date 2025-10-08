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

## Utilities
- **SwitchOp**: Switch between multiple values
- **MathOp**: Perform a mathematical operation
- **Debugging**: Use `ViewerOp` and `ConsoleOp` to inspect intermediate results

## Organization

- **ContainerOp**: Use containers to group related operators
