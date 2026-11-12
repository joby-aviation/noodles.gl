# Extending the Framework

[Creating Operators](./creating-operators.md) covers adding an operator to Noodles.gl. This page covers the rest: registering operators and color ramps from an application, converting older projects, and debugging.

## Registering from an application

An application that embeds the planner can add to its catalog at startup, without editing `packages/planner`:

```typescript
import { registerOperator, registerRamp } from '@noodles.gl/planner'

// An operator, by the same OpDef shape as the built-ins. Registering an existing type
// replaces it. One without `lower` is skipped by lowering, as host operators are.
registerOperator(myOperatorDef)

// A color ramp for ramp(), colorscale nodes and every ramp menu: 0 to 1 RGB stops,
// evenly spaced
registerRamp('sunset', [[0.1, 0.0, 0.3], [0.9, 0.3, 0.2], [1.0, 0.9, 0.5]], 'Sunset')
```

The editor does this itself: `registerDeckOperators()` (in `src/runtime/deck-ops.ts`) adds the deck operators, and `registerNoodlesRamps()` (in `src/runtime/ramps.ts`) adds the editor's d3 color schemes.

## Converting older projects

Projects saved before documents are operator graphs (`noodles.json` schema 1 to 23). When one loads, its schema migrations in `src/noodles/__migrations__/` run first, then `toEditorDoc` in `src/runtime/migrate/to-editor-doc.ts` converts it to an `EditorDoc`.

- `op-catalog.ts` says what each older operator type becomes: planner operators, row operators, a `code` node, a deck operator, a subnet, a host operator, or refused (the ForLoop operators).
- `to-editor-doc.ts` holds the conversions, and `gis-conversions.ts` the GIS ones. A conversion writes every older default explicitly, since `noodles.json` stored only what was set and planner defaults differ.
- Anything a conversion cannot express throws a `MigrationError` naming the node and why. It never falls back to a JavaScript accessor or a silent default.
- Test a conversion with a case in `src/runtime/migrate/*-conversions.node.test.ts` that converts a node, lowers it, and checks the rows.

To migrate such files on disk, run `npm run migrate-projects -- <file or folder>` from `noodles-editor/`. `--check` lists what would change without writing. To check a document against the operator registry, run `npm run validate:projects -- path/to/noodles.json` from the repo root.

## Debugging

- **Debug mode.** Turn on **Show editor debug info** in the top menu to see each node's SQL, memoization, routes and engine badges. Users never see these otherwise.
- **The engine.** `window.plannerEngine` is the running engine: `errors()` lists errors by node, `lowering()` returns the lowered graph and scalar program, and `vis()` what was drawn.
- **Logging.** The [`debug`](https://www.npmjs.com/package/debug) package logs nothing until enabled. Set `localStorage.debug = 'noodles:*'` in the console and reload; `src/utils/debug.ts` lists the namespaces. To add a log line:

```typescript
import { debugMigration } from '../utils/debug'

debugMigration('converted %s to %d nodes', name, doc.nodes.length)
```

- **Tests.** A failing project is usually quickest to reproduce as a `*.node.test.ts` that lowers a small document with DuckDB in Node; see [Creating Operators](./creating-operators.md#tests-and-generated-files).
