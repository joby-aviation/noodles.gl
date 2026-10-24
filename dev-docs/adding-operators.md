# Adding Operators

An operator is an `OpDef`: its ports, its parameters, and how it compiles. Pick the kind first
(see [architecture.md](architecture.md#operators)):

- **Planner operator** for anything over rows: a source, a filter or join, a GIS step, an
  attribute, a layer. It compiles to SQL, a CPU pass or a GPU kernel. This is the default.
- **Deck operator** for a deck.gl object built from parameters, not rows: a view, a widget, an
  extension, a tile source.
- **Host operator** only when the work cannot run in the engine: it calls an API with the
  user's key, reads the page, or returns JavaScript objects rather than rows.

## A planner operator

Add it to `OPERATORS` in `packages/planner/src/operators.ts` (GIS steps go in `gis.ts`):

```ts
{
  type: 'filter', label: 'Filter', category: 'rows',
  description: 'Keep rows matching a condition.',
  inputs: [table()], outputs: [out()],
  params: [
    { name: 'column', label: 'Column', kind: 'column', default: '', of: 'in' },
    { name: 'value', label: 'Value', kind: 'float', default: 0, step: 0.1, changeRate: 4, port: true },
  ],
  lower(ctx) {
    const col = ctx.str('column');
    if (!col) ctx.error('Filter needs a column');
    return {
      nodes: [{ id: ctx.id, type: 'filter', input: ctx.input('in'), predicate: `${col} > ${ctx.bind('value')}` }],
      outputs: { out: ctx.id },
    };
  },
},
```

- `lower(ctx)` returns IR nodes (`sql`, `filter`, `join`, `aggregate`, `attribute`, `js`,
  layers…; see `types.ts`) and which IR node each output port is.
- Read structural parameters with `ctx.str` / `ctx.num` / `ctx.bool`: changing one recompiles.
  Bind values with `ctx.bind` (`{{key}}` in SQL or an expression), so a change is routed
  instead: a slider on `value` above requeries or rebinds a uniform, never recompiles.
- `changeRate` (changes per second while dragged) and `bind: 'prop'` tell the optimizer how
  to route a parameter.
- `port: true` gives the parameter a `par:<name>` handle that a number output can drive.
- `when` shows a parameter only for some values of another; `folder` groups parameters into
  pane tabs.
- `category` places it in the Add Node menu (`src/editor/menus.tsx` lists `OPERATORS` by
  category). There is no second registry.
- A number computed from parameters alone is a **scalar** operator: give it `scalar(p, clock)`
  instead of `lower`, and it joins the scalar program evaluated every frame.

Never Biome-format `packages/planner`: it keeps its own style.

## A deck operator

Add a `DeckOp` to `DECK_OPS` in `noodles-editor/src/runtime/deck-ops.ts`: an `OpDef` (outputs
of type `value`) and a `build(params, id)` that returns the deck description. `registerDeckOperators()`
registers them with the planner. A parameter whose widget is a Noodles field (an extension
list, a map style's overrides) uses `kind: 'field'` with `{ op, input }`, and the FieldAdapter
builds that field from the class.

## A host operator

A Noodles operator class in `noodles-editor/src/noodles/operators.ts` with `createInputs`,
`createOutputs` and `execute`, listed in `opTypes`, and planned `host(reason)` in
`src/runtime/migrate/op-catalog.ts`. `HostRunner` runs `execute()` with the inputs the document
and the scalar program give it, and hands rows back to planner nodes through DuckDB. Keep it
small: every host operator is work the engine cannot plan.

## Converting an older Noodles operator

If the operator replaces one from the operator-graph format, update its entry in
`op-catalog.ts` and add the conversion in `to-editor-doc.ts` (GIS steps:
`gis-conversions.ts`). A conversion writes every Noodles default explicitly, since `noodles.json`
stored only what was set and planner defaults differ. Anything it cannot express throws a
`MigrationError` naming the node and why; it never falls back to a JS accessor.

## Tests

- Planner behavior: `packages/planner/src/*.test.ts` (`npm test -w @noodles.gl/planner`).
- Real SQL: a `*.node.test.ts` in `src/runtime/__tests__/` or beside the code, using `openNodeDuck()` from
  `src/runtime/__tests__/duckdb-node.ts`. Assert on rows, and on what a change cost: compiles,
  requeries, evaluations.
- A conversion: a case in `src/runtime/migrate/*-conversions.node.test.ts` that converts a
  Noodles node, lowers it, and checks the rows.
- `src/runtime/migrate/examples.node.test.ts` runs every example; keep it passing.

## Registry and reference pages

A new or changed operator changes the catalog's snapshot and its reference page. From
`noodles-editor/`, run `npm run generate:registry` (it writes `noodles-validate/registry.json`),
then `npm run generate:op-docs` (it writes `docs/reference/operators/<type>.md` and the index).
Tests fail while either is out of date. Write anything the tables can't say under the page's
`## Remarks`: which parameter wins when two disagree, defaults that differ from deck.gl, mistakes
that are easy to make. The generator keeps it.
