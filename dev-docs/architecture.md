# Project Architecture

Noodles.gl is a node editor for geospatial visualizations and animations. A project is a
document: nodes, the edges between them, and a timeline. Noodles compiles the document and runs
it in DuckDB, so a node is a step in a query plan, not a function called on JavaScript arrays.
The compiler is `@noodles.gl/planner` (`packages/planner`), shared with d-d-d.

## The pipeline

```
EditorDoc ──lowerDocument──► Graph (planner IR) + ScalarProgram
                                  │                    │
                       compileProgram (memoized)       evaluate(T, F) every frame
                                  │                    │
                       ProgramRuntime in the engine worker (DuckDB-Wasm, spatial)
                                  │  layer data as binary attribute buffers
                                  ▼
                       Engine (main thread): deck layers, host operators, basemap
                                  │
                       Visualization → timeline-editor.tsx → deck.gl + MapLibre
```

- **Lowering** (`packages/planner/src/lower.ts`) turns each document node into IR nodes through
  its operator's `lower()`: SQL relations, filters, joins, aggregates, attribute expressions,
  layers. Pure and fast; it runs on every edit.
- **Compiling** (`compileProgram`) plans the IR: which relations are memoized as temp tables,
  which inline into their readers, what SQL each layer runs, and how each parameter is
  **routed**: `prop` (a deck prop), `uniform`, `cpu` (a CPU pass over columns), `requery`
  (rerun a query with new binds) or `rematerialize` (rebuild a table). A slider that only moves
  a uniform never touches DuckDB.
- **The runtime** (`src/runtime/program-runtime.ts`) keeps the compiled program live. A
  structural edit calls `setGraph`, which recompiles only what changed; a value edit or a
  playhead move calls `setValues`, which does what each route says.
- **The engine worker** (`src/runtime/worker/engine.worker.ts`) owns DuckDB-Wasm's synchronous
  build, the runtime, JS scalar UDFs and JS tables. The main thread talks to it through
  `RuntimeProxy`; layer buffers come back by transfer.
- **The engine** (`src/runtime/engine.ts`) sits on the main thread: it lowers the document,
  decides between `setGraph` and `setValues`, builds deck layer instances from the buffers
  (`deck-layers.ts`), runs host operators, and merges everything into the visualization.

## Operators

Every operator is an `OpDef` registered with the planner. There are three kinds:

| Kind | Where | Runs |
| --- | --- | --- |
| Planner operators | `packages/planner/src/operators.ts`, `gis.ts` | lowered to IR, compiled to SQL / CPU / GPU |
| Deck operators | `src/runtime/deck-ops.ts`, `value-ops.ts` | on the main thread, into deck descriptions (views, widgets, extensions, tile sources, map style, curves) |
| Host operators | `src/runtime/host/` | a Noodles operator class's `execute()` on JS values |

Host operators are what cannot compile: CodeOp when its code reads `op()`, the timeline or
`this`; Geocoder and Directions (they call APIs with the user's key); Chart (draws into the
page); BoundingBox (needs the canvas size); Merge and LayerProps (JS objects, not rows); Mouse;
TileLayer and custom MapLibre layers. Their classes are the only ones left in
`src/noodles/operators.ts`, with the extension operators and the classes whose fields a
parameter widget uses. `HostRunner` runs them in dependency order and memoizes them by input.

Per-row values never come from accessor functions: they are columns, made by attribute nodes
and expressions, and layers bind columns to channels.

A path is one row. When a path, trips or polygon layer's position reads a list of positions
(`DOUBLE[3][]`) or a geometry, `compileProgram` marks the layer's path columns
(`LayerAnalysis.lists`), its query selects them whole, and `runtime/path-rows.ts` flattens the
Arrow lists or the geometry bytes into the vertex buffer and `startIndices`, repeating each
row's other values along its vertices. A scatter or text layer on a geometry draws a mark per
point. Time Series samples path rows in place (`rows: 'paths'`). world-flights draws 12,938
flight rows this way rather than 1.5M vertex rows.

## The document (`EditorDoc`)

Defined in `packages/planner/src/doc.ts`:

- `nodes`: `{ id, op, name, parent, x, y, params, flags, promoted }`. `parent` is the subnet a
  node is inside; `flags` are bypass and display.
- `edges`: `{ id, source, sourcePort, target, targetPort, index }`. A `targetPort` of
  `par:<name>` drives a parameter from a number or value output; `index` orders edges into a
  multi-input port such as a deck's `layers`.
- `params`: literal values, `{ expr }` (a parameter expression with `T`, `F` and `ch('path')`),
  or `{ ref }` (another node's parameter).
- `timeline`: tracks keyed `nodeId.param`, with keyframes.

Projects in the older operator-graph format (`noodles.json` schema 1–19) are migrated through
`src/noodles/__migrations__/` and converted on load by `src/runtime/migrate/to-editor-doc.ts`.
`op-catalog.ts` says what each Noodles operator type becomes; anything the
conversion cannot express is a `MigrationError` that names the node and why.

## Editor (`src/editor/`)

- `doc-store.ts`: the document, selection, current network, playhead and debug flag. Undo is by
  document snapshot; edits with the same tag inside 500 ms coalesce into one step.
- `doc-engine.ts`: binds the store to the engine and publishes what it drew (`useEngineState`).
- `doc-network.tsx`, `doc-node.tsx`: the network editor (React Flow), in d-d-d's layout:
  compact nodes, Houdini keys (Tab, B, D, Shift+C, Enter, U, F), subnets.
- `doc-properties.tsx`, `param-row.tsx`: the parameter pane, by folder. `field-adapter.ts`
  builds a Noodles field per parameter so the widgets in
  `src/noodles/components/field-components.tsx` edit document parameters.
  `pane-editors.tsx` adds editors drawn above some nodes' parameters (map style, ramp, table,
  features).
- `doc-builder.ts`, `tool-docs.ts`: what the map tools, the GIS wizard and Import Data add.
- `project-files.tsx`, `load-doc.ts`: open, save, Save As, rename.
- Debug mode ("Show editor debug info" in the top menu) shows the SQL, relations, routes and
  engine badges. Users see only values, rows drawn and errors.

## Timeline and export

The timeline panel keeps its own store (`src/timeline/timeline-store.ts`); `doc-timeline.ts`
keeps it and `doc.timeline` in step. The playhead feeds the engine's `setTime`, which
re-evaluates the scalar program and routes the changed values.

Export (`src/render/renderer.ts`) calls `settleEngine(t)` before each frame: it sets the time,
waits for the runtime, the worker and host operators to finish, and resolves once the view has
committed that frame.

## The in-app assistant

The chat (`src/ai-chat/`) edits the document through `doc-tools.ts`: `list_nodes`,
`get_node_info`, `get_node_output` (rows from the runtime), `apply_modifications` (one undo step
per call). See [agent-harness.md](agent-harness.md).

## State outside the document

- `src/editor/ui-store.ts`: panels, dialogs, map placement, spreadsheet pin.
- `src/noodles/filesystem-store.tsx`: the project's directory handle, storage type and errors.
- `src/noodles/keys-store.tsx`: API keys and the assistant's provider preference.

## Debugging

```javascript
localStorage.debug = 'noodles:*'   // all namespaces; see src/utils/debug.ts
window.plannerEngine               // the engine: vis(), errors(), lowering(), runtime.program()
```
