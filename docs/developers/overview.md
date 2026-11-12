# Framework Developer Overview

> Want to make maps with Noodles.gl rather than change its code? Go to [Start here](../intro.md) to open the editor or an example.

This section is for changing Noodles.gl itself: adding an operator, a parameter widget, or a helper that code nodes can call. Noodles.gl draws on a long line of [node-based tools](./node-based-tools.md), Houdini and TouchDesigner most of all.

## How a project runs

A project is a document of nodes and edges (an `EditorDoc`). Noodles compiles it into a query plan and runs the plan in DuckDB, in a web worker:

```
EditorDoc ─lowerDocument─► planner IR + scalar program ─compileProgram─► ProgramRuntime
                                                         (engine worker: DuckDB-Wasm)
                                                                     │ binary layer buffers
                                       Engine (main thread): deck layers, host operators
```

- **Operators** are `OpDef`s registered with `@noodles.gl/planner` (`packages/planner`). Each one declares its ports and parameters, and a `lower()` that turns a node into IR: SQL relations, filters, joins, attribute expressions, layers.
- **The planner** decides which relations are kept as tables and how each parameter change is handled. Dragging a slider never recompiles; a structural edit recompiles only what changed.
- **Per-row values are columns**, made by attribute nodes and expressions. There are no per-row accessor functions.
- **Host operators** are the few that cannot compile (Geocoder, Directions, Chart, TileLayer and similar). They run on the main thread.

[Data Flow](./data-flow.md) follows a document through these steps.

## Setup

The repo uses npm workspaces, with the Node version pinned in `.nvmrc`:

```bash
npm ci                 # at the repo root
cd noodles-editor
npm start              # http://localhost:5173/examples/nyc-taxis
npm test               # Vitest; *.node.test.ts run in Node with DuckDB
npm run lint
npm test -w @noodles.gl/planner   # planner tests, from the repo root
```

The [development guide](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/developing.md) covers environment variables, code style and the other commands.

## Where the code lives

| Path | What it holds |
|------|---------------|
| `packages/planner/src/operators.ts`, `gis.ts` | Planner operators. New operators usually go here. |
| `packages/planner/src/doc.ts`, `lower.ts` | The document format and its lowering |
| `noodles-editor/src/runtime/engine.ts` | Lowers the document, routes changes, builds deck layers |
| `noodles-editor/src/runtime/worker/` | The engine worker: DuckDB, the runtime, JavaScript tables and functions |
| `noodles-editor/src/runtime/deck-ops.ts`, `value-ops.ts` | Deck operators (views, widgets, extensions, tiles, map style) and curves |
| `noodles-editor/src/runtime/host/` | Runs host operators |
| `noodles-editor/src/runtime/migrate/` | Converts older operator-graph projects to documents |
| `noodles-editor/src/noodles/operators.ts`, `fields.ts` | Host operator classes, and the fields behind parameter widgets |
| `noodles-editor/src/editor/` | The editor: document store, network, parameter pane |

## Next steps

- **[Creating Operators](./creating-operators.md)**: add a planner, deck or host operator
- **[Data Flow](./data-flow.md)**: the document, compiling, and what an edit costs
- **[Paths and Subnets](./paths-containers.md)**: node names, parameter references and subnets
- **[Field System](./field-system.md)**: the widgets that edit parameters
- **[Extending the Framework](./framework-extension.md)**: converting older projects, registering operators from an application, debugging
- **[Utils API Reference](./utils-api-reference.md)**: helpers in scope in code nodes
- **[Contributing](./contributing.md)**: pull requests and tests

The [architecture guide](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/architecture.md) in the repo has the full detail.
