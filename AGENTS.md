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

## Quick Reference Links

- **[Architecture](dev-docs/architecture.md)** - System architecture, state management, and error handling
- **[Development Guide](dev-docs/developing.md)** - Setup, commands, workflows, and best practices
- **[Testing Guide](dev-docs/testing-guide.md)** - Testing strategy, critical components, and runbook guidelines
- **[PR Guidelines](dev-docs/pr-guidelines.md)** - Creating focused PRs with tests and documentation
- **[Analytics](dev-docs/analytics.md)** - Privacy-preserving analytics guidelines
- **[Agent Harness](dev-docs/agent-harness.md)** - The in-app AI chat: providers, tool routing, context budgets
- **[Tech Stack](dev-docs/tech-stack.md)** - Complete technology listing
- **[Adding Operators](dev-docs/adding-operators.md)** - Operator class template, registration checklist, custom field types
- **[Claude Code Workflow](dev-docs/claude-code-workflow.md)** - Editing noodles.json directly, WebMCP connection, graph design guidelines

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

**Pull-Based Execution**: Demand-driven operator execution
- Operators only execute when outputs are requested and inputs have changed
- Dirty flag system tracks which operators need re-execution
- Topological sorting determines execution order
- Parallel execution for independent branches
- GraphExecutor manages the execution loop with RAF-based timing

## Key Files and Their Purposes

### Core Application Files

- **`noodles-editor/src/noodles/operators.ts`** - Registry of all available operators. Add new operators here.
- **`noodles-editor/src/noodles/fields.ts`** - Field system implementation. All field types defined here.
- **`noodles-editor/src/noodles/graph-executor.ts`** - Pull-based execution engine with topological sorting, dirty tracking, and RAF loop.
- **`noodles-editor/src/noodles/components/op-components.tsx`** - React components for rendering operator nodes. Most use default renderer, some have custom components.
- **`noodles-editor/src/noodles/components/field-components.tsx`** - React components for rendering field inputs.
- **`noodles-editor/src/noodles/noodles.tsx`** - Main visualization component that loads projects and manages state, orchestrates nodes with React Flow.
- **`noodles-editor/src/timeline-editor.tsx`** - Timeline editor interface with native timeline components.

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

npm workspaces (root `package.json`): run `npm install` at the root, then run app commands (`npm start`, `npm test`, `npm run lint`, `npm run fix-lint`) from `noodles-editor/`. `npm run build:all` at the root builds app and website. Node version is pinned in `.nvmrc`.

### Development URLs

- **Local**: `http://localhost:5173/examples/nyc-taxis`
- **Specific Project**: Replace `nyc-taxis` with project name from `noodles-editor/public/examples/`
- **Safe Mode**: Add `?safeMode=true` to disable code execution

### Testing

- Unit tests co-located with source files (`*.test.ts`)
- Vitest for unit testing
- Playwright for browser integration tests
- Run specific tests: `npm test src/noodles/operators.test.ts`

### Debug Logging

The codebase uses the `debug` package for development logging. Debug output is disabled by default and has zero overhead when disabled.

**Enable in browser console:**
```javascript
localStorage.debug = 'noodles:*'        // All noodles logging
localStorage.debug = 'noodles:history*' // Just history/undo-redo
localStorage.debug = ''                 // Disable
// Refresh the page after changing
```

**Available namespaces:** see [`noodles-editor/src/utils/debug.ts`](noodles-editor/src/utils/debug.ts) for the full list with descriptions.

**Adding new debug logging:**
```typescript
import { debugHistory } from '../../utils/debug'
debugHistory('Message with %s formatting', value)
```

## Creating New Operators

See [dev-docs/adding-operators.md](dev-docs/adding-operators.md) for the class template, registration checklist, and custom field types.

**Critical:** a new operator must be registered in the `opTypes` object in `operators.ts` AND added to a category in `components/categories.ts` (display name without the "Op" suffix), or it never appears in the Add Node menu. Operators are pure, typed with Zod-backed fields, memoized by the framework, and require unit tests.

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

Any field can be keyframed via the native timeline system. Changes in timeline propagate through the reactive system with smooth bezier interpolation between keyframes.

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
6. **Timeline integration** - Any parameter can be animated via the native timeline
7. **Project files are JSON** - Easy to parse and modify programmatically
8. **Testing is expected** - Add tests for new features and changes to critical components
9. **Document edge cases** - Users may not expect implementation-specific behavior
10. **Keep PRs focused** - Split large changes into reviewable chunks when possible
11. **Host state goes through `static environment`** - Timeline, render surface, clock, and pointer are read from `execute(props, env)` after declaring them; never subscribe to stores or the DOM from an operator (see [architecture.md](dev-docs/architecture.md#environment-state))

## The In-App AI Assistant

The chat panel (`noodles-editor/src/ai-chat/`) has its own agent loop, tool surface, and one security boundary. Guidance lives in `noodles-editor/src/ai-chat/AGENTS.md` (loaded automatically when working there) and [dev-docs/agent-harness.md](dev-docs/agent-harness.md).

## Using Claude Code with Noodles.gl

See [dev-docs/claude-code-workflow.md](dev-docs/claude-code-workflow.md) for editing `noodles.json` directly, validating changes, graph design guidelines, and connecting to a running browser via WebMCP or the MCP proxy.

---

**Last Updated**: 2026-09-21
**Version**: Based on project version 6 schema
