# AGENTS.md - LLM Context for Noodles.gl

> **Note**: This document is optimized for LLM consumption and provides comprehensive technical context for AI assistants working with the Noodles.gl codebase. For human-readable documentation, see [/docs](docs/) and [/dev-docs](dev-docs/).

This document provides essential context for Large Language Models (LLMs) working with the Noodles.gl codebase.

## Project Overview

**Noodles.gl** is a React-based node-based editor for creating geospatial visualizations and animations. A project is a document of nodes and edges that Noodles compiles and runs in DuckDB, so dragging a slider or playing the timeline re-runs only what that change needs. It builds interactive presentations, high-quality renders, and data-driven animations.

### Core Purpose
- Create animated timeline presentations and data visualizations
- Specialize in geospatial data, aviation routes, and interactive storytelling
- Enable rapid prototyping and development of complex visualizations
- Export to video, images, or interactive web presentations

## Quick Reference Links

- **[Architecture](dev-docs/architecture.md)** - System architecture, state management, and error handling
- **[Development Guide](dev-docs/developing.md)** - Setup, commands, workflows, and best practices
- **[Testing Guide](dev-docs/testing-guide.md)** - Testing strategy, critical components, and runbook guidelines
- **[PR Guidelines](dev-docs/pr-guidelines.md)** - Focused PRs, PR description format, screenshots for UI changes
- **[Analytics](dev-docs/analytics.md)** - Privacy-preserving analytics guidelines
- **[Agent Harness](dev-docs/agent-harness.md)** - The in-app AI chat: providers, tool routing, context budgets
- **[Tech Stack](dev-docs/tech-stack.md)** - Complete technology listing
- **[Adding Operators](dev-docs/adding-operators.md)** - Planner, deck and host operators; conversions from older projects; tests
- **[Claude Code Workflow](dev-docs/claude-code-workflow.md)** - Editing project files directly, WebMCP connection, graph design guidelines

## Architecture

Full detail: [dev-docs/architecture.md](dev-docs/architecture.md).

```
EditorDoc ─lowerDocument─► planner IR + scalar program ─compileProgram─► ProgramRuntime
                                                         (engine worker: DuckDB-Wasm)
                                                                     │ binary layer buffers
                                       Engine (main thread): deck layers, host operators
```

- **Operators** are `OpDef`s registered with `@noodles.gl/planner` (`packages/planner`). Each
  declares ports, parameters and a `lower()` that emits IR: SQL relations, filters, joins,
  attribute expressions, layers.
- **The planner** decides which relations are memoized and how each parameter is routed: a
  deck prop, a uniform, a CPU pass, a requery or a rematerialize. A value edit never
  recompiles; a structural edit recompiles only what changed.
- **Per-row values are columns**, made by `attribute` nodes and channel expressions. There are
  no accessor functions.
- **A path is one row.** A path, trips or polygon layer whose position reads a list of
  positions or a geometry draws a row per path; the worker flattens the column into deck's
  vertex buffers. Never unnest paths into vertex rows just to draw them.
- **Host operators** are the few Noodles classes that cannot compile (CodeOp reading `op()` or
  the timeline, Geocoder, Directions, Chart, TileLayer,
  custom MapLibre layers). They run their `execute()` on the main thread.

## Key Files

- **`packages/planner/src/operators.ts`, `gis.ts`** - planner operators. Add new operators here.
- **`packages/planner/src/doc.ts`, `lower.ts`** - the document format and its lowering.
- **`noodles-editor/src/runtime/engine.ts`** - lowers the document, routes changes, builds layers.
- **`noodles-editor/src/runtime/worker/`** - the engine worker: DuckDB, the runtime, JS tables and UDFs.
- **`noodles-editor/src/runtime/deck-ops.ts`, `value-ops.ts`** - deck operators (views, widgets, extensions, tiles, map style) and curve operators.
- **`noodles-editor/src/runtime/host/`** - the host runner and host operator registration.
- **`noodles-editor/src/runtime/migrate/`** - converting older operator-graph projects to documents.
- **`noodles-editor/src/editor/`** - the editor: store, network, parameter pane, tools, project files.
- **`noodles-editor/src/noodles/operators.ts`, `fields.ts`** - the remaining Noodles classes (host operators) and the field types the parameter widgets edit.
- **`noodles-editor/src/noodles/components/field-components.tsx`** - parameter widgets.
- **`noodles-editor/src/timeline-editor.tsx`** - the map, the deck and the timeline around the editor.

## Project Files

A project is an `EditorDoc`:

```json
{
  "version": 1,
  "name": "earthquakes",
  "nodes": [
    { "id": "n1", "op": "file", "name": "quakes", "x": 0, "y": 0,
      "params": { "url": "@/data.csv", "format": "csv" } },
    { "id": "n2", "op": "attribute", "name": "position", "x": 300, "y": 0,
      "params": { "name": "position", "expression": "[Longitude, Latitude]" } },
    { "id": "n3", "op": "scatter", "name": "points", "x": 600, "y": 0,
      "params": { "position": "position", "radiusScale": { "expr": "4 + 2 * sin(T)" } } },
    { "id": "n4", "op": "deck", "name": "deck", "x": 900, "y": 0, "params": {} }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "sourcePort": "out", "target": "n2", "targetPort": "in" },
    { "id": "e2", "source": "n2", "sourcePort": "out", "target": "n3", "targetPort": "in" },
    { "id": "e3", "source": "n3", "sourcePort": "out", "target": "n4", "targetPort": "layers", "index": 0 }
  ],
  "timeline": { "tracks": [] }
}
```

- Node ids are opaque. `name` is unique within a network; a node's path is its name under its
  subnets' names (`/points`, `/subnet/filter`), and tools accept ids, names or paths.
- `parent` puts a node inside a `subnet`; `subnet-input` / `subnet-output` nodes are its ports.
- Edges join ports. `par:<name>` as a `targetPort` drives a parameter from a number or value
  output; `index` orders a multi-input port such as the deck's `layers`.
- `params` are literals, `{ "expr": "..." }` (parameter expressions: `T` seconds, `F` frame,
  `ch('node/param')`, math) or `{ "ref": "node/param" }`. Leave out parameters at their default.
- `@/name.csv` is a file in the project's data directory.
- The `deck` node holds the basemap style, the camera and the render settings.
- The examples in `noodles-editor/src/examples/` are documents. Older operator-graph files
  (`noodles.json` schema 1–21) are migrated and converted when they load; the examples' old
  graphs are conversion fixtures in `src/runtime/migrate/__fixtures__/`.
- `npm run validate:projects -- path/to/noodles.json` (repo root) checks a document against
  the operator registry (`noodles-validate/registry.json`, regenerated with
  `npm run generate:registry` in `noodles-editor/`).

## Expressions and Code

- **Row expressions** (attribute nodes, layer channels, `filter` in expression mode) use
  column names, arithmetic and functions: `[lng, lat]`, `sqrt(pop) * 2`, `hex_color(color)`.
  They compile to SQL, a CPU loop or WGSL from one AST.
- **`sql`** nodes take any SELECT: `{{input0}}` is the table on `in0`, `ch('threshold/value')`
  a parameter.
- **`code`** returns rows from JavaScript in the engine worker: `d` is the input's rows, and
  `d3`, `turf` and `utils` are in scope. Its rows become a DuckDB table.
- **`js-function`** defines a function expressions can call per row (much slower than SQL).
- The `utils` functions are documented in [docs/developers/utils-api-reference.md](docs/developers/utils-api-reference.md).

## Development Workflow

### Quick Start Commands

npm workspaces (root `package.json`): run `npm install` at the root, then run app commands (`npm start`, `npm test`, `npm run lint`, `npm run fix-lint`) from `noodles-editor/`. `npm run build:all` at the root builds app and website. Node version is pinned in `.nvmrc`.

### Development URLs

- **Local**: `http://localhost:5173/examples/nyc-taxis`
- **Specific Project**: Replace `nyc-taxis` with project name from `noodles-editor/src/examples/`
- **Safe Mode**: Add `?safeMode=true` to disable code execution

### Testing

- Unit tests co-located with source files (`*.test.ts`)
- Vitest for unit testing
- Playwright for browser integration tests
- Run specific tests: `npm test src/editor/doc-ops.node.test.ts`
- `*.node.test.ts` run in Node with DuckDB-Wasm (`--project node`); the rest run in Chromium
- Planner: `npm test -w @noodles.gl/planner`

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

See [dev-docs/adding-operators.md](dev-docs/adding-operators.md). A planner operator is one
`OpDef` in `packages/planner/src/operators.ts`; its `category` puts it in the Add Node menu, and
there is no second registry. Read structural parameters with `ctx.str`/`ctx.num` and bind values
with `ctx.bind`, so a slider is routed, not recompiled. Never Biome-format `packages/planner`.
Every operator needs tests; anything that replaces an older Noodles operator needs a conversion
in `src/runtime/migrate/` with a test.

## State Management

- **`src/editor/doc-store.ts`** - the document, selection, current network, playhead, debug
  flag. `docStore().edit(fn, tag)` changes the document; edits with the same tag inside 500 ms
  are one undo step. `useEditor(selector)` subscribes a component.
- **`src/editor/doc-engine.ts`** - `useEngineState()`: what the engine drew, its errors, layers.
- **`src/editor/ui-store.ts`** - panels, dialogs, map placement.

```typescript
import { docStore } from './editor/doc-store'
import { setParam } from './editor/doc-ops'

docStore().edit(d => setParam(d, nodeId, 'radiusScale', 8), `drag:${nodeId}`)
```

## Performance Tips

- Bind values (`ctx.bind`) instead of reading them structurally in `lower()`.
- Prefer expressions and `sql` over `code` and `js-function`.
- Debug mode ("Show editor debug info") shows each node's SQL, memoization and routes.

## Testing and Pull Requests

**Testing:** Add tests for new operators, bug fixes, and changes to critical components. See [testing-guide.md](dev-docs/testing-guide.md) for strategy and best practices.

**Pull Requests:** Keep PRs focused, include tests and documentation, provide test runbooks for UI changes. See [pr-guidelines.md](dev-docs/pr-guidelines.md) for complete guidelines.

**PR Descriptions:**
- Use the headings from `.github/pull_request_template.md` as they are: an issue reference, an optional `#### Background`, a `#### Change List` and `#### Screenshots`. Do not add `Summary`, `Test plan` or `Validation` sections.
- Keep it short. Most good descriptions are under 900 characters, not counting a collapsed test runbook.
- Change List: one bullet per operator, component, API or artifact, ten words or less, identifiers in backticks, no trailing periods. End with `Unit tests` / `Browser tests` / `Documentation` / `Migration` as applicable, and one line on what was actually run to verify.
- **UI changes need a before/after screenshot or GIF.** Capture them (see [screenshot-guide.md](dev-docs/screenshot-guide.md)) outside the repo or in a gitignored directory, and attach with `gh pr create --attach './before.png#Alt text'` (also on `gh pr edit` / `gh pr comment`). Don't commit them.
- Do not add footers, emoji, links to tool sessions, `Co-Authored-By` lines, or tables of files. Do not make up an issue number; remove the line if there is none.

**Analytics:** Add `analytics.track()` for user actions and feature usage. Never track sensitive data. See [analytics.md](dev-docs/analytics.md) for guidelines.

## Important Notes for LLMs

1. **The document is the source of truth** - edit it through `doc-ops.ts` or `apply_modifications`, never engine state
2. **Per-row values are columns** - attribute nodes and expressions, not accessor functions
3. **Routes decide cost** - a value change should never recompile; keep parameters bindable
4. **Host operators are the exception** - add one only when the work cannot run in the engine
5. **Users never see planner internals** - SQL, routes and engine badges only in debug mode
6. **Timeline integration** - any number parameter can be keyframed (`nodeId.param` tracks)
7. **Older projects convert on load** - a conversion that cannot express something is a `MigrationError`, never a silent fallback
8. **Testing is expected** - Add tests for new features and changes to critical components
9. **Document edge cases** - Users may not expect implementation-specific behavior
10. **Keep PRs focused** - Split large changes into reviewable chunks when possible

## The In-App AI Assistant

The chat panel (`noodles-editor/src/ai-chat/`) has its own agent loop, tool surface, and one security boundary. Guidance lives in `noodles-editor/src/ai-chat/AGENTS.md` (loaded automatically when working there) and [dev-docs/agent-harness.md](dev-docs/agent-harness.md).

## Using Claude Code with Noodles.gl

See [dev-docs/claude-code-workflow.md](dev-docs/claude-code-workflow.md) for editing project files directly, validating changes, graph design guidelines, and connecting to a running browser via WebMCP.

The `noodles` MCP server (`.mcp.json`, [noodles-mcp](noodles-mcp/README.md)) looks up operator schemas, docs and example projects without a browser, and validates project files. The [`noodles-live`](.claude/skills/noodles-live/SKILL.md) skill covers changing a project open in the editor.

---

**Last Updated**: 2026-10-24
**Version**: `EditorDoc` version 1; older projects up to operator-graph schema 21
