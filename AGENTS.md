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
- `d3` - D3.js library
- `turf` - Turf.js geospatial functions
- `deck` - Deck.gl utilities
- `Plot` - Observable Plot
- `utils` - Utility functions (color conversion, geospatial helpers, KML conversion, etc.)
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

## Development Workflow

### Quick Start Commands

```bash
# Install dependencies
yarn install:all

# Start development server
yarn start:app            # or cd noodles-editor && yarn start

# Run tests
cd noodles-editor && yarn test

# Lint and format
cd noodles-editor && yarn lint
cd noodles-editor && yarn fix-lint

# Build for production
yarn build:all
```

### Development URLs

- **Local**: `http://localhost:5173/?project=example`
- **Specific Project**: Replace `example` with project name from `noodles-editor/public/noodles/`
- **Safe Mode**: Add `&safeMode=true` to disable code execution

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
- **Examples**: [noodles-editor/public/noodles/](noodles-editor/public/noodles/) contains example projects
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

**Last Updated**: 2025-11-12
**Version**: Based on project version 6 schema
