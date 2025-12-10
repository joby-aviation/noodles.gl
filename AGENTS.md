# AGENTS.md - LLM Context for Noodles.gl

> **Note**: This document is optimized for LLM consumption and provides comprehensive technical context for AI assistants working with the Noodles.gl codebase. For human-readable documentation, see [/docs](docs/) and [/dev-docs](dev-docs/).

This document provides essential context for Large Language Models (LLMs) working with the Noodles.gl codebase.

## Project Overview

**Noodles.gl** is a React-based node-based editor for creating geospatial visualizations and animations. It combines visual programming with reactive data flow to build interactive presentations, high-quality renders, and data-driven animations.

### Core Purpose
- Create animated timeline presentations and data visualizations
- Specialize in geospatial data, aviation routes, and interactive storytelling
- Enable rapid prototyping and development of complex visualizations
- Export to video, images, or interactive web presentations

### Key Users
- Visualization experts creating presentation-ready graphics
- Developers doing rapid visualization prototyping
- Data scientists exploring and analyzing data
- Research teams publishing geospatial analysis

## Architecture

### Fundamental Concepts

**Operators**: Processing nodes that transform data
- Pure functions: deterministic (same inputs = same outputs)
- Reactive: automatically re-execute when upstream data changes
- Typed: use Zod schemas for input/output validation
- Memoized: results cached to avoid unnecessary recomputation

**Fields**: Typed inputs/outputs with validation and UI hints
- Strongly typed RxJS observables
- Support both value and reference connections
- Can be keyframed in timeline for animations
- Custom React components for specialized UI controls

**Reactive Flow**: Automatic updates using RxJS
- Unidirectional data flow from outputs to inputs
- Lazy evaluation: nodes only execute when upstream values change
- Topological sorting determines execution order
- Parallel execution for independent branches

### Technology Stack

**Core Framework**
- React 18 with TypeScript
- Vite for build tool and dev server
- Yarn for package management

**Animation & Timeline**
- Theatre.js for animation timeline editor and runtime
- Any parameter can be keyframed to create smooth animations

**Visualization & Mapping**
- Deck.gl - WebGL data visualization
- MapLibre GL - Open-source mapping
- luma.gl - WebGL rendering engine
- D3.js for data manipulation

**Geospatial & Data Processing**
- @turf/turf - Geospatial analysis
- H3-js - Hexagonal hierarchical geospatial indexing
- DuckDB-WASM - In-browser analytical database
- Apache Arrow - Columnar data format

**UI & Node Editor**
- @xyflow/react - Node-based editor components
- Radix UI - Accessible component primitives
- PrimeReact - Rich UI component library

**State Management**

- Zustand for global state management
- Operator and sheet object storage
- Batching support for atomic updates
- Non-reactive access patterns via `getOpStore()`

**Reactive Programming**
- RxJS for reactive data flow

**Development Tools**
- Biome - Fast linter and formatter (replaces ESLint/Prettier)
- TypeScript for type checking
- Vitest for unit testing
- Playwright for end-to-end testing

## Project Structure

```
noodles-gl-public/
├── noodles-editor/           # Main application
│   ├── src/
│   │   ├── noodles/          # Core node system
│   │   │   ├── operators.ts  # Operator registry
│   │   │   ├── fields.ts     # Field system
│   │   │   ├── components/   # React components
│   │   │   │   ├── op-components.tsx      # Operator node renderers
│   │   │   │   ├── field-components.tsx   # Field input renderers
│   │   │   │   ├── menu.tsx               # Operator menu
│   │   │   │   └── categories.ts          # Operator categorization
│   │   │   ├── utils/        # Utilities
│   │   │   │   ├── path-utils.ts          # Path resolution
│   │   │   │   ├── memoize.ts             # Caching
│   │   │   │   ├── serialization.ts       # Save/load
│   │   │   │   └── ...
│   │   │   └── hooks/        # React hooks
│   │   ├── ai-chat/          # Claude AI integration
│   │   ├── utils/            # General utilities
│   │   ├── timeline-editor.tsx  # Timeline interface
│   │   ├── noodles.tsx       # Main viz component
│   │   └── index.tsx         # App entry point
│   ├── public/
│   │   └── noodles/          # Example projects
│   ├── scripts/              # Build scripts
│   ├── package.json
│   ├── vite.config.js
│   └── tsconfig.json
├── website/                  # Documentation website
├── docs/                     # Documentation source
│   ├── developers/           # Developer guides
│   └── users/                # User guides
├── dev-docs/                 # Internal dev docs
│   ├── architecture.md
│   ├── tech-stack.md
│   └── specs/                # Design specs
├── README.md
└── CONTRIBUTING.md
```

## Key Files and Their Purposes

### Core Application Files

- **`noodles-editor/src/noodles/operators.ts`** - Registry of all available operators. Add new operators here.
- **`noodles-editor/src/noodles/fields.ts`** - Field system implementation. All field types defined here.
- **`noodles-editor/src/noodles/components/op-components.tsx`** - React components for rendering operator nodes. Most use default renderer, some have custom components.
- **`noodles-editor/src/noodles/components/field-components.tsx`** - React components for rendering field inputs.
- **`noodles-editor/src/noodles/noodles.tsx`** - Main visualization component that loads projects and manages state, orchestrates nodes with React Flow.
- **`noodles-editor/src/timeline-editor.tsx`** - Timeline editor interface for Theatre.js integration.

### Utilities

- **`noodles-editor/src/noodles/utils/path-utils.ts`** - Unix-style path resolution for operator references
- **`noodles-editor/src/noodles/utils/serialization.ts`** - Project save/load functionality
- **`noodles-editor/src/noodles/utils/memoize.ts`** - Caching for operator results
- **`noodles-editor/src/noodles/storage.ts`** - File system access and project management

## Data Flow and Connections

### Edge Structure in Project Files (noodles.json)

```typescript
// Edge format connecting operators
{
  "id": "/add-1.out.result->/viewer.par.data",  // Unique edge ID
  "source": "/add-1",                            // Source node ID
  "target": "/viewer",                           // Target node ID
  "sourceHandle": "out.result",                  // Output field name
  "targetHandle": "par.data"                     // Input field name
}
```

### Operator Path System

Operators use Unix-style fully qualified paths:

```typescript
// Absolute paths (from root)
op('/data-loader')              // Root level operator
op('/analysis/filter')          // Nested in container

// Relative paths (from current operator)
op('./sibling')                 // Same container
op('../parent-sibling')         // Parent container
op('local-name')                // Same container (shorthand)
```

### Reactive References

**In CodeField expressions:**
```javascript
// Reference other operators programmatically
const upstream = op('/data-loader').out.data
const filtered = op('./filter').par.data
```

**In DuckDbOp SQL (mustache syntax):**
```sql
SELECT * FROM 'data.csv'
WHERE age > {{/threshold.par.value}}
  AND status = {{./config.par.status}}
```

### Connection Rules

- **Type Safety**: Zod schemas ensure type compatibility
- **Single Input**: Each input accepts one connection
- **Multiple Outputs**: Outputs can connect to many inputs
- **Cycle Detection**: Prevents circular dependencies

## Operator Categories

### Data Sources
- **FileOp**: Load JSON, CSV, GeoJSON files
- **DuckDbOp**: SQL queries with reactive references
- **GeocoderOp**: Convert addresses to coordinates
- **H3IndexOp**: Generate H3 cell indices

### Data Processing
- **FilterOp**: Filter data based on conditions
- **MapOp**: Transform data arrays
- **GroupByOp**: Group and aggregate data
- **JoinOp**: Combine multiple datasets
- **SliceOp**: Slice arrays

### Math & Logic
- **NumberOp**: Numeric constants
- **ExpressionOp**: Single-line JavaScript expressions
- **CodeOp**: Multi-line custom JavaScript code
- **AccessorOp**: Data accessor functions for Deck.gl

### GeoJSON Operations
- **GeoJsonOp**: Create GeoJSON from data
- **BoundingBoxOp**: Calculate bounding boxes
- **GeoJsonCircleOp**: Generate circles on the map

### Deck.gl Layers (Visualization)
- **ScatterplotLayerOp**: Point visualizations
- **PathLayerOp**: Line and route visualizations
- **ArcLayerOp**: Arc connections between points
- **H3HexagonLayerOp**: Hexagonal grid visualizations
- **HeatmapLayerOp**: Density visualizations
- **GeoJsonLayerOp**: Render GeoJSON features
- **ColumnLayerOp**: 3D columns
- **IconLayerOp**: Icon markers
- **TextLayerOp**: Text labels
- **PolygonLayerOp**: Polygon rendering
- **TripsLayerOp**: Animated paths

### View & Rendering
- **DeckViewOp**: Configure Deck.gl views (MapView, OrbitView, FirstPersonView, GlobeView)
- **MapboxOp**: Configure map style and properties
- **DeckRendererOp**: Main rendering node

## Code Operators and Available Globals

### CodeOp
Multi-line JavaScript with full library access:

```javascript
// Example: Calculate distances
const distances = data.map(d => {
  const from = [d.start_lng, d.start_lat]
  const to = [d.end_lng, d.end_lat]
  return turf.distance(from, to, { units: 'kilometers' })
})
return distances
```

**Available globals:**
- `d3` - D3.js library for data manipulation and visualization
- `turf` - Turf.js geospatial analysis functions
- `deck` - Deck.gl utilities and components
- `Plot` - Observable Plot for creating charts
- `vega` - Vega visualization grammar
- `Temporal` - TC39 Temporal API for dates and times
- `utils` - Collection of utility functions (see below)
- All Operator classes for instantiation (see opTypes list below)

### AccessorOp
Per-item accessor functions for Deck.gl layers:

```javascript
// Example: Get position
[d.longitude, d.latitude]

// Example: Conditional color
d.value > 100 ? [255, 0, 0] : [0, 255, 0]
```

**Context:**
- `d` - Current data item
- `data` - Full dataset array

### ExpressionOp
Single-line calculations:

```javascript
Math.PI * Math.pow(d.radius, 2)
```

## Available Utility Functions (`utils` object)

The `utils` object is available globally in CodeOp, AccessorOp, and ExpressionOp. It provides a collection of utility functions for common operations:

### Arc Geometry Utilities
**From `utils.arc-geometry`:**

- **`getArc(options)`** - Generate 3D arc paths between two points
  - `source` - Starting point `{ lat, lng, alt }`
  - `target` - Ending point `{ lat, lng, alt }`
  - `arcHeight` - Height of the arc in meters
  - `smoothHeight` - Smooth altitude transitions (default: `true`)
  - `smoothPosition` - Smooth position transitions (default: `false`)
  - `segmentCount` - Number of segments in the arc (default: `250`)
  - `wrapLongitude` - Handle anti-meridian crossing (default: `true`)
  - `tilt` - Tilt angle in degrees, -90 to 90 (default: `0`)
  - Returns array of `[lng, lat, alt]` coordinates

- **`mix(from, to, t)`** - Linear interpolation between two numbers
- **`mixspace(start, end, mixAmount[])`** - Linear interpolation across multiple ratios
- **`clamp(x, lower, upper)`** - Constrain a value within a range
- **`range(stop)`** - Generate array of integers from 0 to stop-1
- **`smoothstep(edge0, edge1, x)`** - Smooth interpolation with Hermite polynomial
- **`segmentRatios(segmentCount, smooth)`** - Generate interpolation ratios for arcs
- **`paraboloid(distance, sourceZ, targetZ, ratio, scaleHeight)`** - Calculate parabolic arc height
- **`tiltPoint(point, start, end, tilt)`** - Apply tilt transformation to a point

```javascript
// Example: Create a 3D arc between two cities
const arc = utils.getArc({
  source: { lat: 40.7128, lng: -74.0060, alt: 0 },    // NYC
  target: { lat: 51.5074, lng: -0.1278, alt: 0 },     // London
  arcHeight: 500000,  // 500km peak height
  tilt: 15,           // 15-degree tilt
  segmentCount: 100
})
```

### Search and Data Utilities

- **`binarySearchClosest(arr, val, i?)`** - Find the closest value in a sorted array
  - Returns the index of the closest element
  - Optional `i` parameter to start search from a specific index

```javascript
// Example: Find closest timestamp
const times = [0, 100, 200, 300, 400]
const idx = utils.binarySearchClosest(times, 250)  // Returns 2
```

### Color Utilities
**From `utils.color`:**

- **`colorToRgba([r, g, b, a])`** - Convert Deck.gl color array to RGBA object (0-1 range)
- **`rgbaToColor({ r, g, b, a })`** - Convert RGBA object (0-1) to Deck.gl color array (0-255)
- **`rgbaToClearColor({ r, g, b, a })`** - Convert to WebGL clear color format
- **`hexToColor(hex, alpha?)`** - Parse hex color string to Deck.gl color array
- **`colorToHex(color, alpha?)`** - Convert Deck.gl color to hex string
- **`hexToRgba(hex)`** - Parse hex to RGBA object
- **`rgbaToHex(rgba)`** - Convert RGBA object to hex string

```javascript
// Example: Convert colors
const deckColor = utils.hexToColor('#ff5733')
const hex = utils.colorToHex([255, 87, 51, 255])
```

### Array Utilities

- **`cross(arr)`** - Generate all unique pairs from an array
  - Returns array of tuples `[item1, item2]`

```javascript
// Example: Create all route pairs
const cities = ['NYC', 'LA', 'CHI']
const routes = utils.cross(cities)
// Returns: [['NYC', 'LA'], ['NYC', 'CHI'], ['LA', 'CHI']]
```

### Geospatial Utilities

- **`getDirections({ origin, destination, mode? })`** - Async function to get routing directions
  - `origin` - `{ lat, lng }` starting point
  - `destination` - `{ lat, lng }` ending point
  - `mode` - Either `utils.DRIVING` or `utils.TRANSIT` (default: `DRIVING`)
  - Returns `{ distance, duration, durationFormatted, path, timestamps }`
  - Requires Mapbox or Google Maps API keys configured

```javascript
// Example: Get driving directions
const route = await utils.getDirections({
  origin: { lat: 40.7128, lng: -74.0060 },
  destination: { lat: 34.0522, lng: -118.2437 },
  mode: utils.DRIVING
})
console.log(route.durationFormatted)  // "45 hours, 30 mins"
```

### Distance Constants
**From `utils.distance`:**

- **`FEET_TO_METERS`** - Conversion factor: 0.3048
- **`METER_TO_MILES`** - Conversion factor: 0.000621371
- **`MILES_TO_METERS`** - Conversion factor: 1609.34

```javascript
// Example: Convert units
const heightInFeet = 1000
const heightInMeters = heightInFeet * utils.FEET_TO_METERS
```

### Interpolation

- **`interpolate(input, output, ease?)`** - Create a mapping function between two ranges
  - `input` - Input range `[min, max]`
  - `output` - Output range `[min, max]`
  - `ease` - Optional easing function
  - Returns a function that maps input values to output values

```javascript
// Example: Map altitude to color intensity
const altToIntensity = utils.interpolate([0, 10000], [0, 255])
const intensity = altToIntensity(5000)  // Returns 127.5
```

### Map Styles
**From `utils.map-styles`:**

- **`CARTO_DARK`** - URL for Carto dark basemap without labels
- **`MAP_STYLES`** - Object mapping basemap URLs to readable names
  - Includes: Streets, Light, Dark, Dark-NoLabels, Voyager, Voyager-NoLabels

```javascript
// Example: Use predefined basemap
const basemapUrl = utils.CARTO_DARK
```

### Random Number Generation

- **`mulberry32(seed)`** - Create a deterministic pseudo-random number generator
  - Takes a numeric seed
  - Returns a function that generates numbers between 0 and 1

```javascript
// Example: Generate deterministic random positions
const rng = utils.mulberry32(12345)
const positions = data.map(d => [
  d.lng + (rng() - 0.5) * 0.01,  // Add random jitter
  d.lat + (rng() - 0.5) * 0.01
])
```

## Available Operator Classes (`opTypes`)

All operator classes are available as globals in CodeOp for programmatic instantiation. This allows you to create operators dynamically or use their static methods. The complete list includes:

**Data Sources & Processing:**
`FileOp`, `DuckDbOp`, `NetworkOp`, `GeocoderOp`, `DirectionsOp`, `FilterOp`, `MapRangeOp`, `MergeOp`, `ConcatOp`, `SliceOp`, `SortOp`, `SelectOp`, `SwitchOp`, `TableEditorOp`

**Math & Logic:**
`NumberOp`, `BooleanOp`, `StringOp`, `DateOp`, `TimeOp`, `MathOp`, `ExpressionOp`, `CodeOp`, `AccessorOp`, `JSONOp`, `HSLOp`, `ColorOp`

**Geometry & Transforms:**
`PointOp`, `BoundsOp`, `RectangleOp`, `ArcOp`, `BezierCurveOp`, `BoundingBoxOp`, `ExtentOp`, `ProjectOp`, `UnprojectOp`, `GeoJsonOp`, `GeoJsonTransformOp`, `ScatterOp`

**Combinators:**
`CombineRGBAOp`, `CombineXYOp`, `CombineXYZOp`, `SplitRGBAOp`, `SplitXYOp`, `SplitXYZOp`, `SplitMapViewStateOp`

**Deck.gl Layers:**
`ScatterplotLayerOp`, `PathLayerOp`, `ArcLayerOp`, `LineLayerOp`, `IconLayerOp`, `TextLayerOp`, `PolygonLayerOp`, `SolidPolygonLayerOp`, `GeoJsonLayerOp`, `ColumnLayerOp`, `GridLayerOp`, `GridCellLayerOp`, `HexagonLayerOp`, `ContourLayerOp`, `ScreenGridLayerOp`, `HeatmapLayerOp`, `H3HexagonLayerOp`, `H3ClusterLayerOp`, `GreatCircleLayerOp`, `TripsLayerOp`, `BitmapLayerOp`, `TileLayerOp`, `MVTLayerOp`, `TerrainLayerOp`, `Tile3DLayerOp`, `PointCloudLayerOp`, `ScenegraphLayerOp`, `SimpleMeshLayerOp`, `GeohashLayerOp`, `S2LayerOp`, `QuadkeyLayerOp`, `A5LayerOp`, `RasterTileLayerOp`

**Deck.gl Extensions:**
`BrushingExtensionOp`, `DataFilterExtensionOp`, `ClipExtensionOp`, `MaskExtensionOp`, `Mask3DExtensionOp`, `PathStyleExtensionOp`, `FillStyleExtensionOp`, `CollisionFilterExtensionOp`, `TerrainExtensionOp`, `BrightnessContrastExtensionOp`, `HueSaturationExtensionOp`, `VibranceExtensionOp`

**Views & Rendering:**
`MapViewOp`, `GlobeViewOp`, `OrbitViewOp`, `FirstPersonViewOp`, `MapViewStateOp`, `DeckRendererOp`, `MaplibreBasemapOp`, `MapStyleOp`, `ViewerOp`

**Color & Styling:**
`ColorRampOp`, `CategoricalColorRampOp`, `LayerPropsOp`, `RandomizeAttributeOp`

**Control Flow & Organization:**
`ContainerOp`, `ForLoopBeginOp`, `ForLoopEndOp`, `GraphInputOp`, `GraphOutputOp`, `OutOp`, `ConsoleOp`, `FpsWidgetOp`, `MouseOp`

```javascript
// Example: Instantiate operators programmatically
const numberOps = data.map((value, i) => {
  const op = new NumberOp(`/dynamic-${i}`)
  op.inputs.value.setValue(value)
  return op
})
```

## Development Workflow

### Quick Start Commands

```bash
# Install dependencies
yarn install:all

# Start development server
cd noodles-editor && yarn start

# Run tests
cd noodles-editor && yarn test

# Lint and format
cd noodles-editor && yarn lint
cd noodles-editor && yarn fix-lint

# Build for production
yarn build:all
```

**Node.js and Package Manager Requirements:**
- Node.js version pinned in `.nvmrc`
- Yarn version managed by Corepack, pinned in `package.json`
- If you encounter Node.js compatibility errors, ensure you're using the correct version from `.nvmrc`
- **Recommended**: Use [fnm](https://github.com/Schniz/fnm) for fast Node.js version management
  - fnm automatically uses the correct Node version from `.nvmrc`
  - Alternative: Use [nvm](https://github.com/nvm-sh/nvm) or any Node version manager
- **Yarn management**: Enable Corepack with `corepack enable yarn` to use the pinned Yarn version

### Development URLs

- **Local**: `http://localhost:5173/examples/nyc-taxis`
- **Specific Project**: Replace `nyc-taxis` with project name from `noodles-editor/public/examples/`
- **Safe Mode**: Add `?safeMode=true` to disable code execution

### Testing

- Unit tests co-located with source files (`*.test.ts`)
- Vitest for unit testing
- Playwright for browser integration tests
- Run specific tests: `yarn test src/noodles/operators.test.ts`

## Creating New Operators

### Basic Structure

```typescript
export class CustomOperator extends Operator<CustomOperator> {
  static displayName = 'Custom Processor'
  static description = 'Processes data with custom logic'

  createInputs() {
    return {
      data: new DataField(),
      threshold: new NumberField(50, { min: 0, max: 100 }),
    }
  }

  createOutputs() {
    return {
      result: new DataField(),
    }
  }

  execute({
    data,
    threshold,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return {
      result: data.filter(item => item.value > threshold)
    }
  }
}
```

### Key Principles

1. **Pure Functions**: Operators should be deterministic
2. **Typed Inputs/Outputs**: Use Field types with Zod schemas
3. **Reactive**: Changes propagate automatically
4. **Memoized**: Results cached based on input values
5. **Register**: Add to operator registry in `operators.ts`

## Common Field Types

- **DataField**: Generic data arrays
- **NumberField**: Numeric values with min/max/step
- **StringField**: Text values
- **BooleanField**: Boolean flags
- **ColorField**: Color values (hex or RGB)
- **CodeField**: Code expressions (JavaScript, SQL, JSON)
- **ArrayField**: Array of sub-fields
- **CompoundPropsField**: Object with multiple properties
- **PointField**: Geographic coordinates [lng, lat]
- **Vec2Field**: 2D vectors

## Performance Considerations

### Memoization
- Results automatically cached based on input hash
- Cache invalidated when inputs change
- LRU eviction prevents unbounded growth

### Optimization Tips
- Keep operators pure and stateless
- Avoid heavy computations in AccessorOps (runs per data item)
- Batch data operations when possible
- Use DuckDB for large dataset queries
- Profile bottlenecks with execution tracing

### Batching Updates

```typescript
// Batch multiple changes to avoid cascading updates
batch(() => {
  node1.fields.param1.setValue(value1)
  node2.fields.param2.setValue(value2)
})
```

## Project Files (noodles.json)

Projects are stored as JSON files with this structure:

```json
{
  "version": 6,
  "nodes": [
    {
      "id": "/data-loader",
      "type": "FileOp",
      "position": {"x": 100, "y": 100},
      "data": {
        "inputs": {
          "url": "@/data.csv",
          "format": "csv"
        }
      }
    }
  ],
  "edges": [
    {
      "id": "/data-loader.out.data->/filter.par.data",
      "source": "/data-loader",
      "target": "/filter",
      "sourceHandle": "out.data",
      "targetHandle": "par.data"
    }
  ],
  "viewport": {"x": 0, "y": 0, "zoom": 1}
}
```

### Path Prefixes in File References

- `@/` - Relative to project directory
- Absolute paths work as-is
- URLs can reference remote resources

## Migration System

When schema changes occur, add migrations in `noodles-editor/src/noodles/__migrations__/`:

```typescript
export const migration = {
  version: 7,
  migrate(project: ProjectV6): ProjectV7 {
    // Transform project structure
    return transformedProject
  }
}
```

## State Management with Zustand

The application uses Zustand for global state management, storing operators and Theatre.js sheet objects.

### Store Architecture

```typescript
// The store contains:
// - operators: Map<OpId, Operator<IOperator>>
// - sheetObjects: Map<OpId, ISheetObject>
// - hoveredOutputHandle: { nodeId: string; handleId: string } | null
// - Batching support for atomic updates
```

### Accessing the Store

**Direct Store Access (non-reactive):**

```typescript
import { getOpStore } from './store'

// Get the store instance
const store = getOpStore()

// Access operators
const op = store.getOp('/data-loader')
const allOps = store.getAllOps()
const entries = store.getOpEntries()
```

**Convenience Helpers (recommended):**

```typescript
import { getOp, getAllOps, getOpEntries, setOp, deleteOp, hasOp } from './store'

// Get a single operator by absolute or relative path
const op = getOp('/data-loader')  // Absolute path
const relative = getOp('./sibling', contextOpId)  // Relative path

// Check existence
if (hasOp('/data-loader')) { /* ... */ }

// Get all operators
const allOps = getAllOps()

// Iterate over operators
for (const [id, op] of getOpEntries()) {
  // ...
}

// Add/update operators
setOp('/new-op', operatorInstance)

// Remove operators
deleteOp('/old-op')
```

**Batching for Performance:**

```typescript
import { getOpStore } from './store'

// Batch multiple store operations to trigger single update
getOpStore().batch(() => {
  setOp('/op1', op1)
  setOp('/op2', op2)
  deleteOp('/op3')
  // Only one state update after batch completes
})
```

### Sheet Object Management

```typescript
import { getSheetObject, setSheetObject, deleteSheetObject, hasSheetObject } from './store'

// Manage Theatre.js sheet objects
const sheetObj = getSheetObject('/data-loader')
setSheetObject('/data-loader', sheetObject)
deleteSheetObject('/data-loader')
if (hasSheetObject('/data-loader')) { /* ... */ }
```

### Important Notes

- **Non-reactive by design**: Store access via `getOpStore()` does NOT trigger React re-renders
- **Use in tests**: Test files should use the convenience helpers (`getOp`, `getAllOps`, etc.)
- **Path resolution**: `getOp()` supports both absolute (`/foo/bar`) and relative (`./sibling`, `../parent`) paths
- **Batching**: Always use `store.batch()` when making multiple related changes
- **No `opMap` access**: The old `opMap` global is deprecated - use store helpers instead

## Common Patterns

### Accessing Operator Outputs

```javascript
// In CodeField or AccessorOp - uses the getOp helper internally
const data = op('/data-loader').out.data
const threshold = op('./threshold').par.value
```

### Creating Layers

```javascript
// Operators that create Deck.gl layers should return LayerProps
return {
  type: ScatterplotLayer,
  data: processedData,
  getPosition: d => [d.lng, d.lat],
  getRadius: 100,
  getFillColor: [255, 0, 0]
}
```

### Timeline Animation

Any field can be keyframed:
1. Fields are connected to Theatre.js via `useSheetValue` hook
2. Changes in timeline propagate through reactive system
3. Smooth interpolation between keyframes

## Error Handling

### Validation
- Zod schemas validate all field values
- Type mismatches caught at runtime
- Clear error messages displayed in UI

### Error Propagation
```typescript
try {
  const result = operator.execute(inputs)
  field.next(result)
} catch (error) {
  field.error(error)  // Propagate downstream
}
```

### Debugging
- Execution tracing tracks data flow
- Performance profiling measures execution times
- State inspection examines intermediate values

## Best Practices

### Graph Design
- Minimize connections to reduce complexity
- Group related operations in containers
- Use descriptive node and field names
- Document complex transformations

### Performance
- Avoid deep graph nesting
- Batch related changes together
- Profile and optimize hot paths
- Use DuckDB for heavy data operations

### Code Style
- Follow Biome configuration
- Write unit tests for operators
- Use TypeScript strictly
- Comment complex logic

### Maintenance
- Add migration scripts for schema changes
- Version control graph changes
- Keep documentation up-to-date
- Test operators in isolation

## Testing Strategy

### When to Add Tests

**Always add tests for:**
- New operators and core functionality
- Changes to critical components (listed below)
- Complex state management or hook modifications
- Bug fixes to prevent regressions
- Non-trivial utility functions

**Test Types:**

- **Unit Tests**: For operator logic, pure functions, and utilities
- **Integration Tests**: For graph transformations, hook interactions, and data flow
- **Component Tests**: For React components with React Testing Library
- **E2E Tests**: For full user workflows with Playwright

### Critical Components Requiring Extra Scrutiny

These components are core to the application and require thorough testing and careful review:

**Core Node System:**

- `noodles-editor/src/noodles/operators.ts` - Operator registry and execution
- `noodles-editor/src/noodles/fields.ts` - Field system and validation
- `noodles-editor/src/noodles/noodles.tsx` - Main application orchestration

**State Management:**

- `noodles-editor/src/noodles/hooks/use-project-modifications.ts` - Project state mutations
- `noodles-editor/src/noodles/storage.ts` - File system and persistence
- All custom hooks in `noodles-editor/src/noodles/hooks/`

**Data Flow:**

- `noodles-editor/src/noodles/utils/path-utils.ts` - Operator path resolution
- `noodles-editor/src/noodles/utils/serialization.ts` - Project save/load
- Graph transformation functions in `noodles.tsx`

### Testing Best Practices

**For Operators:**

```typescript
describe('CustomOperator', () => {
  it('should transform data correctly', () => {
    const op = new CustomOperator('/test-op')
    const result = op.execute({ data: testData, threshold: 50 })
    expect(result.output).toEqual(expectedOutput)
  })
})
```

**For React Hooks:**

```typescript
import { renderHook, act } from '@testing-library/react'

it('should update state correctly', () => {
  const { result } = renderHook(() => useCustomHook())
  act(() => {
    result.current.setValue(newValue)
  })
  expect(result.current.value).toBe(newValue)
})
```

**For Integration Tests:**

- Test operator connectivity and data flow through the graph
- Verify subscriptions are properly created and cleaned up
- Test that graph transformations match real application behavior
- Mock Theatre.js and other external dependencies appropriately

### Test Organization

- Co-locate unit tests with source files (`*.test.ts` alongside the file being tested)
- Integration and component tests can go in `__tests__` directories when they span multiple files
- Use descriptive test names that explain what is being tested
- Clean up resources in `afterEach` to prevent test pollution

## Additional Resources

- **Documentation**: [docs/](docs/) folder contains user and developer guides
- **Examples**: [noodles-editor/public/examples/](noodles-editor/public/examples/) contains example projects
- **Architecture**: [dev-docs/architecture.md](dev-docs/architecture.md) for detailed architecture
- **Tech Stack**: [dev-docs/tech-stack.md](dev-docs/tech-stack.md) for technology details
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines

## Common Tasks for LLMs

### Adding a New Operator
1. Create operator class in `operators.ts` or separate file
2. Define inputs with `createInputs()` method
3. Define outputs with `createOutputs()` method
4. Implement `execute()` method with pure function logic
5. Register operator in operator registry
6. Add to category in `components/categories.ts`
7. **Write unit tests** (required for all operators)
8. Document behavior and limitations if complex
9. Test in UI with example projects

### Modifying Existing Operator
1. Locate operator in `operators.ts`
2. Modify inputs, outputs, or execute logic
3. Consider migration if schema changes
4. **Update tests** to cover new behavior
5. Add tests for bug fixes to prevent regressions
6. Update documentation if behavior changes
7. Test in UI with example projects

### Modifying Critical Components

When changing files listed in "Critical Components Requiring Extra Scrutiny":

1. **Add tests first** if they don't exist
2. Make your changes
3. Ensure all existing tests pass
4. **Add new tests** for changed behavior
5. Consider integration tests for complex state changes
6. If the change is large, consider splitting into smaller PRs

### Debugging Data Flow
1. Check operator paths are correct (use absolute paths from root)
2. Verify edge connections in project JSON
3. Inspect field values with console logging
4. Check Zod schema validation errors
5. Use execution tracing for performance issues

### Creating Custom Field Type
1. Extend `Field` class in `fields.ts`
2. Implement `createSchema()` method with Zod schema
3. Set default value and options
4. Add custom UI component in `field-components.tsx` if needed
5. Register in field registry

## Analytics Tracking

### When to Add Analytics Events

Noodles.gl uses PostHog for privacy-preserving product analytics to understand feature usage. When implementing new features or user-facing functionality, consider adding analytics tracking to help understand how users interact with the app.

**Add analytics tracking for:**

- New user actions (button clicks, menu selections, keyboard shortcuts)
- Feature usage (rendering, AI chat, timeline operations)
- User workflows (project creation, save, export, import)
- Error states and failures (save failed, render cancelled)
- Performance milestones (render completion, load times)

**Never track:**

- Project names, file names, or file paths
- Node data, configuration values, or user content
- Code, queries, prompts, or AI responses
- API keys, tokens, or credentials
- Personal information or IP addresses

All sensitive properties are automatically filtered by the analytics utility, but avoid passing them in the first place.

### How to Add Tracking

```typescript
import { analytics } from '../utils/analytics'

// Simple event
analytics.track('feature_used')

// Event with properties
analytics.track('render_started', {
  codec: 'h264',          // ✅ Safe: configuration type
  resolution: '1920x1080' // ✅ Safe: dimensions
})

// What NOT to track
analytics.track('project_saved', {
  projectName: 'my-viz',  // ❌ Never: user content
  apiKey: 'sk-123'        // ❌ Never: credentials
})
```

### Event Naming Conventions

- **Format**: `object_action` (e.g., `node_added`, `project_saved`)
- **Tense**: Past tense (`created`, `opened`, `failed`)
- **Case**: snake_case (`ai_panel_opened`, `render_completed`)

### Common Tracking Examples

```typescript
// User interactions
analytics.track('keyboard_shortcut_used', { action: 'create_viewer' })
analytics.track('menu_opened', { menu: 'block_library' })

// Feature usage
analytics.track('node_added', { nodeType: 'ScatterplotLayerOp' })
analytics.track('render_started', { codec: 'h264' })
analytics.track('render_completed', { duration: 120, frameCount: 3600 })

// Error states
analytics.track('save_failed', { storageType: 'local', error: 'permission_denied' })
analytics.track('render_cancelled')
```

### Testing Analytics

Analytics events respect user consent and gracefully handle ad-blocker scenarios:

- Events only fire if user has opted in
- All PostHog calls are wrapped in try-catch blocks
- App continues working even if PostHog is blocked

For more details, see [dev-docs/analytics.md](dev-docs/analytics.md).

## Pull Request Guidelines

### Creating Focused PRs

When implementing features or fixes:

- **Keep PRs focused**: Each PR should address a single concern or feature
- **Split large changes**: Separate unrelated changes into different PRs (e.g., separate AI chat changes from core app state changes)
- **Smaller is better**: Smaller PRs are easier to review thoroughly and catch issues
- **Context matters**: Make it easy for reviewers by keeping related changes together

### What to Include in PRs

- **Tests**: Add tests for new features, bug fixes, and changes to critical components
- **Documentation**: Update relevant docs when behavior changes or new features are added
- **Operator Documentation**: For complex operators, document input/output behavior and limitations
- **Edge Cases**: Document known limitations or edge cases in code comments or docs
- **Test Runbook**: Provide clear instructions for manually testing the changes in the UI

### Testing and Runbooks

**When to Provide a Test Runbook:**

- Feature additions or modifications to operators
- Bug fixes that affect user-visible behavior
- Changes to visualization or interaction behavior
- New integrations or data processing capabilities

**Runbook Best Practices:**

1. **Keep it simple**: Assume the app is already running - don't include setup steps
2. **Use real nodes**: Create a minimal graph with actual operators that demonstrates the feature
3. **Provide noodles.json**: Include a complete project file that reviewers can load directly
4. **Clear expected results**: State exactly what should happen at each step
5. **Test both cases**: Cover both success and edge cases (e.g., enabled/disabled, valid/invalid)

**Example Test Runbook Structure:**

```markdown
## Manual Testing in UI

1. **Create test graph:**
   - Add [Operator1] with value X
   - Add [Operator2] with value Y
   - Connect outputs to inputs

2. **Test primary behavior:**
   - Set parameter to A → should see result B
   - Set parameter to C → should see result D

3. **Test edge case:**
   - Disable feature → should see fallback behavior

4. **Verify in timeline:**
   - Keyframe parameter from X to Y
   - Should see [describe animation/interpolation]
```

**Include Project File:**

Provide a complete `noodles.json` file that can be saved in `noodles-editor/public/noodles/` and opened with `?project=test-name`. This makes it trivial for reviewers to verify the changes.

### Documentation Best Practices

**When to Document:**

- Non-obvious behavior or implementation choices
- Known limitations or edge cases
- Complex algorithms or data transformations
- Operator-specific behavior (especially for SQL, code execution, etc.)

**Where to Document:**

- Code comments for implementation details
- Operator reference pages for user-facing behavior
- AGENTS.md for framework-level patterns and conventions
- README files for examples and walkthroughs

**Example - Documenting Edge Cases:**

```typescript
// DuckDbOp: Multi-statement SQL support
// - Multiple statements separated by semicolons are executed sequentially
// - Only the result from the final SELECT is returned
// - Limitation: Semicolons inside string literals will incorrectly split statements
// - Use SET statements for configuration, CTEs for complex queries
```

## Important Notes for LLMs

1. **Operators are pure functions** - They should not have side effects or maintain state
2. **Paths are always absolute from root** - Use `/` prefix for absolute, `./` for relative
3. **Fields are observables** - Use `field.setValue()` to update, `field.value` to read
4. **Memoization is automatic** - Don't worry about caching, the framework handles it
5. **Type safety is critical** - Always use Zod schemas for validation
6. **Timeline integration** - Any parameter can be animated via Theatre.js
7. **Project files are JSON** - Easy to parse and modify programmatically
8. **Testing is expected** - Add tests for new features and changes to critical components
9. **Document edge cases** - Users may not expect implementation-specific behavior
10. **Keep PRs focused** - Split large changes into reviewable chunks when possible

---

**Last Updated**: 2025-11-14
**Version**: Based on project version 6 schema
