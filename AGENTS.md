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

## Quick Reference Links

- **[Architecture](dev-docs/architecture.md)** - System architecture, state management, and error handling
- **[Development Guide](dev-docs/developing.md)** - Setup, commands, workflows, and best practices
- **[Testing Guide](dev-docs/testing-guide.md)** - Testing strategy, critical components, and runbook guidelines
- **[PR Guidelines](dev-docs/pr-guidelines.md)** - Creating focused PRs with tests and documentation
- **[Analytics](dev-docs/analytics.md)** - Privacy-preserving analytics guidelines
- **[Tech Stack](dev-docs/tech-stack.md)** - Complete technology listing

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

**Core:** React 18, TypeScript, Vite, Yarn

**Animation:** Theatre.js (timeline editor, all parameters can be keyframed)

**Visualization:** Deck.gl (WebGL data visualization), MapLibre GL (mapping), luma.gl (rendering), D3.js (data)

**Geospatial:** @turf/turf (analysis), H3-js (indexing), DuckDB-WASM (SQL), Apache Arrow (columnar data)

**UI:** @xyflow/react (node editor), Radix UI, PrimeReact

**State:** Zustand (global state), RxJS (reactive data flow), Theatre.js (animation state)

**Dev Tools:** Biome (linting/formatting), TypeScript, Vitest, Playwright

See [tech-stack.md](dev-docs/tech-stack.md) for complete details.

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
│   ├── developing.md
│   ├── testing-guide.md
│   ├── pr-guidelines.md
│   ├── analytics.md
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

**Path Prefixes in File References:**

- `@/` - Relative to project data directory
- Absolute paths work as-is
- URLs can reference remote resources

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
- `utils` - Collection of utility functions (arc geometry, color conversion, geospatial operations, interpolation, etc.)
- All Operator classes for instantiation

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

The `utils` object is available globally in CodeOp, AccessorOp, and ExpressionOp. It provides commonly-used functions:

**Key utilities include:**

- **Arc Geometry**: `getArc()` - Generate 3D arc paths between two points
- **Color Conversion**: `hexToColor()`, `colorToHex()`, `rgbaToColor()` - Convert between color formats
- **Geospatial**: `getDirections()` - Get routing directions between points
- **Interpolation**: `interpolate()` - Create mapping functions between ranges
- **Array Operations**: `cross()` - Generate all unique pairs from an array
- **Search**: `binarySearchClosest()` - Find closest value in sorted array
- **Distance Constants**: `FEET_TO_METERS`, `MILES_TO_METERS`, etc.
- **Map Styles**: `CARTO_DARK`, `MAP_STYLES` - Predefined basemap URLs
- **Random**: `mulberry32(seed)` - Deterministic pseudo-random number generator

**Example usage:**
```javascript
// Create a 3D arc between two cities
const arc = utils.getArc({
  source: { lat: 40.7128, lng: -74.0060, alt: 0 },
  target: { lat: 51.5074, lng: -0.1278, alt: 0 },
  arcHeight: 500000,  // 500km peak height
  segmentCount: 100
})

// Convert hex color to Deck.gl format
const deckColor = utils.hexToColor('#ff5733')

// Create interpolation function
const altToIntensity = utils.interpolate([0, 10000], [0, 255])
```

**For complete API documentation with all parameters and examples**, see:

- [Utils API Reference](docs/developers/utils-api-reference.md) - Comprehensive function documentation
- Source code: [noodles-editor/src/utils/](noodles-editor/src/utils/) - Implementation with inline comments

## Available Operator Classes (`opTypes`)

All operator classes are available as globals in CodeOp for programmatic instantiation:

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

## State Management

The application uses Zustand for global state. See [architecture.md](dev-docs/architecture.md#state-management-with-zustand) for complete details.

**Quick reference:**
```typescript
import { getOp, setOp, deleteOp, hasOp } from './store'

// Get operator by path (absolute or relative)
const op = getOp('/data-loader')
const relative = getOp('./sibling', contextOpId)

// Batch updates for performance
getOpStore().batch(() => {
  setOp('/op1', op1)
  setOp('/op2', op2)
})
```

## Performance Tips

- Keep operators pure and stateless
- Avoid heavy computations in AccessorOps (runs per data item)
- Batch related changes together using `batch()`
- Use DuckDB for large dataset queries
- Profile bottlenecks with execution tracing

See [developing.md](dev-docs/developing.md#best-practices) for complete best practices (2 spaces, no semicolons, single quotes).

## Common Patterns

### Accessing Operator Outputs

```javascript
// In CodeField or AccessorOp
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

Any field can be keyframed via Theatre.js. Changes in timeline propagate through reactive system with smooth interpolation between keyframes.

## Common Tasks for LLMs

### Adding a New Operator
1. Create operator class in `operators.ts` or separate file
2. Define inputs with `createInputs()` method
3. Define outputs with `createOutputs()` method
4. Implement `execute()` method with pure function logic
5. Register operator in operator registry
6. Add to category in `components/categories.ts` using display name without "Op" suffix (e.g., `'File'` not `'FileOp'`)
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

## Testing and Pull Requests

**Testing:** Add tests for new operators, bug fixes, and changes to critical components. See [testing-guide.md](dev-docs/testing-guide.md) for strategy and best practices.

**Pull Requests:** Keep PRs focused, include tests and documentation, provide test runbooks for UI changes. See [pr-guidelines.md](dev-docs/pr-guidelines.md) for complete guidelines.

**Analytics:** Add `analytics.track()` for user actions and feature usage. Never track sensitive data. See [analytics.md](dev-docs/analytics.md) for guidelines.

## Important Notes for LLMs

1. **Operators are pure functions** - They should not have side effects or maintain state
2. **Paths use Unix-style syntax** - Use `/` prefix for absolute, `./` for relative
3. **Fields are observables** - Use `field.setValue()` to update, `field.value` to read
4. **Memoization is automatic** - Don't worry about caching, the framework handles it
5. **Type safety is critical** - Always use Zod schemas for validation
6. **Timeline integration** - Any parameter can be animated via Theatre.js
7. **Project files are JSON** - Easy to parse and modify programmatically
8. **Testing is expected** - Add tests for new features and changes to critical components
9. **Document edge cases** - Users may not expect implementation-specific behavior
10. **Keep PRs focused** - Split large changes into reviewable chunks when possible

---

**Last Updated**: 2025-12-01
**Version**: Based on project version 6 schema
