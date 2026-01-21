# Project Architecture

Noodles.gl is a sophisticated node-based editor designed for creating geospatial visualizations and animations using Deck.gl. It emphasizes a balance between flexibility and rapid iteration, leveraging reactive data flow principles. It is a software that encourages toolbuilding and in-app extension to fit your needs.

The core concepts are based on Operators and Fields. At a high level, Operators comprise multiple Fields and an `execute` function. Fields are strongly typed and will react to incoming data changes. Fields and Operators can have custom React components that render in the node editor. In the future we might allow these to be created within the tool itself.

Noodles is powered by a reactive dataflow engine using rxjs and a keyframe-based timeline system powered by Theatre.js. It has a type system using Zod to make it easier to parse and accept arguments in multiple formats while allowing the operators to be flexible and composable.

Changes from the node editor propagate automatically through the dataflow graph, and any parameters can be keyframed on the timeline to create smooth animations. This makes it easy to create complex, data-driven animations with minimal effort.

## Directory Structure

```
noodles-editor/
├── src/                    # Source code
├── public/                 # Static assets and 3D models
├── dist/                   # Build output
├── vite.config.js          # Vite build configuration
├── tsconfig.json           # TypeScript configuration
├── biome.json              # Biome linter/formatter config
└── package.json            # Dependencies and scripts
```

## Source Code Organization (`src/`)

### Core Application Files

- `index.tsx` - Application entry point
- `App.tsx` - Root component (minimal wrapper)
- `TimelineEditor.tsx` - Timeline editor interface for orchestrating React with the rendering pipeline and Theatre.js
- `noodles.tsx` - Main visualization component that loads projects and manages state, and orchestrates nodes with React Flow
- `Operators.ts` - Registry of all available operators. Define new operators here.
- `Fields.ts` - Registry of all available fields. Define new fields here.
- `op-components.tsx` - React components for rendering operator nodes in the editor. Most operators use a default renderer but some have custom components defined here.
- `field-components.tsx` - React components for rendering field inputs in the node editor. Most fields use a default renderer but some have custom components defined here.

### Feature Modules (`src/features/`)

- `effects.ts` - Visual effects and animations

### Visualizations (`src/visualizations/noodles`)

- `nodes/` - Node editor components and logic

### Utilities (`src/utils/`)

- `color.ts` - Color manipulation utilities
- `distance.ts` - Geospatial distance calculations
- `arc-geometry.ts` - Arc geometry calculations
- `interpolate.ts` - Animation interpolation functions
- `map-styles.ts` - Map styling configurations
- `sheet-context.ts` - Theatre.js sheet context management
- `use-sheet-value.ts` - React hooks for Theatre.js values

### Rendering (`src/render/`)

- `renderer.ts` - Main rendering engine for saving to video or images
- `draw-loop.ts` - Animation frame management
- `transform-scale.tsx` - Coordinate transformation utilities

## Architecture Patterns

### Visualization System

- Visualizations return a `Visualization` object with:
  - `deckProps` - Deck.gl layer configuration
  - `mapProps` - MapLibre map settings
  - `widgets` - UI panel components

### Theatre.js Integration

- Projects are loaded dynamically based on URL parameters
- Each visualization has an associated Theatre.js sheet
- Animation state is managed through Theatre.js objects

### Component Organization

- Feature-based folder structure
- Shared utilities in dedicated utils folder
- Type definitions co-located with components
- CSS modules for component-specific styles

### Data Flow

- URL parameters determine visualization project
- Projects can have associated state files and data
- Real-time updates through Theatre.js timeline
- Node-based operators for modular data transformations
- Type system using zod for validation, parsing, and transformation

## Pull-Based Execution Model

The application uses a **pull-based execution model** where operators only execute when their outputs are requested and their inputs have changed. This is similar to how Blender Geometry Nodes and Houdini work.

### Key Concepts

**Dirty Flag System**: Each operator maintains a dirty flag that indicates whether it needs re-execution:
- When an input field value changes, the operator is marked dirty
- Dirty flags propagate downstream automatically
- Clean operators return cached results instantly

**Pull Execution**: When an operator's output is needed:
1. Check if operator is clean (cached result available)
2. If dirty, pull upstream dependencies first
3. Execute the operator with current input values
4. Cache the result and mark as clean
5. Return the result

### GraphExecutor

The `GraphExecutor` class (`graph-executor.ts`) manages operator execution:

```typescript
import { GraphExecutor } from './graph-executor'

const executor = new GraphExecutor({
  targetFPS: 60,        // Target frame rate
  parallel: true,       // Execute independent nodes in parallel
  batchDelay: 16,       // Batch dirty marks (ms)
  enableProfiling: true // Enable performance monitoring
})

// Add operators to the graph
executor.addNode(operator)

// Add edges (connections between operators)
executor.addEdge(sourceId, targetId)

// Start the execution loop
executor.start()
```

### Topological Sorting

The executor maintains a topologically sorted execution order:
- Cycle detection prevents infinite loops
- Parallel execution levels allow independent operators to run concurrently
- Changes only re-execute affected downstream operators

### Operator Dirty Tracking

Operators track their execution status:

```typescript
// Mark an operator as needing re-execution
operator.markDirty()

// Pull results from an operator (executes if dirty)
const result = await operator.pull()

// Check if operator has cached results
if (operator.pullExecutionStatus === PullExecutionStatus.CLEAN) {
  // Use cached result
}
```

### Performance Benefits

- **Selective execution**: Only execute operators needed for current frame
- **Cache efficiency**: Clean operators return instantly without computation
- **Parallel execution**: Independent operators execute concurrently
- **Reduced overhead**: No subscription management overhead

## State Management with Zustand

The application uses Zustand for global state management, storing operators and Theatre.js sheet objects.

### Store Architecture

The store contains:

- `operators`: Map of operator IDs to operator instances
- `sheetObjects`: Map of operator IDs to Theatre.js sheet objects
- `hoveredOutputHandle`: Currently hovered output handle for UI feedback
- Batching support for atomic updates

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
