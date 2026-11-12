# Data Flow

A Noodles.gl project is not a set of functions that pass JavaScript arrays to each other. It is a document that Noodles compiles into a query plan and runs in DuckDB. This page follows a document from the file to the map. The [architecture guide](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/architecture.md) has the full detail.

## The document

A project is an `EditorDoc`, defined in `packages/planner/src/doc.ts`:

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

- **Nodes** have an opaque `id`, an `op` (the operator type), a `name` unique within their network, and `params`. A parameter left at its default is left out.
- **Edges** join an output port to an input port. A `targetPort` of `par:<name>` drives a parameter from a number or value output, and `index` orders the edges into a multi-input port such as the deck's `layers`.
- **Parameters** hold a literal, an expression (`{ "expr": "..." }`, with `T` for seconds, `F` for frames, `ch('node/param')` and math), or a reference (`{ "ref": "node/param" }`).
- **The timeline** holds keyframe tracks keyed `nodeId.param`.

The editor changes the document through `docStore().edit(fn, tag)` and the functions in `noodles-editor/src/editor/doc-ops.ts`. The document is the source of truth: the engine only reads it.

## From document to map

1. **Lowering.** `lowerDocument` (`packages/planner/src/lower.ts`) flattens subnets, applies bypass, and calls each node's `lower()`. The result is an IR graph (relations, filters, joins, attributes, layers) and a **scalar program**: every parameter's value as a function of time, from literals, expressions, references, keyframes and number operators. Lowering is pure and fast, and runs on every edit.
2. **Compiling.** `compileProgram` plans the IR. It decides which relations become temp tables and which inline into their readers, writes the SQL each layer runs, and gives each parameter a **route** (below).
3. **Running.** `ProgramRuntime` (`noodles-editor/src/runtime/program-runtime.ts`) keeps the compiled program live in the engine worker (`src/runtime/worker/engine.worker.ts`), which owns DuckDB-Wasm. `code` nodes run there and their rows become DuckDB tables; `js-function` nodes become functions DuckDB calls per row. Layer data comes back to the main thread as binary attribute buffers.
4. **Drawing.** The `Engine` (`src/runtime/engine.ts`) builds deck.gl layers from the buffers, builds views, widgets and extensions from deck operators, runs host operators, and hands the result to deck.gl and MapLibre.

A path, trips or polygon layer draws one row per path: the worker flattens a list-of-positions or geometry column into deck's vertex buffers. Don't unnest paths into vertex rows just to draw them.

## What an edit costs

On each change the engine lowers the document again and compares the new graph with the last one:

- **Different structure** (a node added, a wire moved, a structural parameter changed): `runtime.setGraph` recompiles. Memoization keeps the cost to what changed: an untouched relation is a table that already exists.
- **Same structure, new values** (a slider, the playhead): `runtime.setValues` sends each changed parameter down its routes.

| Route | Work done |
|-------|-----------|
| `prop` | Re-resolve the layer's deck props. Never waits for a query. |
| `uniform`, `cpu` | Rerun the layer's CPU stage |
| `requery` | Rerun the layer's query with new bound values, then its CPU stage |
| `rematerialize` | Rebuild the changed relation and what reads it |

Which route a parameter gets depends on how its operator reads it. A value bound with `ctx.bind` can be requeried or passed as a uniform; a value read with `ctx.str` or `ctx.num` is structural and recompiles. See [Creating Operators](./creating-operators.md#key-principles).

## Host operators

A few operators cannot compile: they call an API with the user's key (Geocoder, Directions), draw into the page (Chart), or work with JavaScript objects (TileLayer, a CodeOp from an older project that reads `op()`). They have no `lower()`. `HostRunner` (`src/runtime/host/host-runner.ts`) runs their `execute()` on the main thread in dependency order, memoized by input, and passes any rows they return to DuckDB for the planner nodes downstream.

## Seeing it

Turn on **Show editor debug info** in the top menu to see each node's SQL, memoization and routes. Users never see these otherwise. [Debugging](./framework-extension.md#debugging) covers the console tools.
