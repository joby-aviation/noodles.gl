# Creating Operators

An operator is what a person places on the canvas: "Filter", "Arc Layer". Each one is an `OpDef` registered with the planner (`@noodles.gl/planner`, in `packages/planner`): its ports, its parameters, and how it compiles. This page is a summary of [dev-docs/adding-operators.md](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/adding-operators.md), which has the full test layout.

## Pick the kind

- **Planner operator**, the default, for anything over rows: a source, a filter or join, a GIS step, an attribute, a layer. It compiles to SQL, a CPU pass or a GPU kernel. Add it to `OPERATORS` in `packages/planner/src/operators.ts`, or to `gis.ts` for a GIS step.
- **Deck operator** for a deck.gl object built from parameters rather than rows: a view, a widget, a layer extension, a tile source, a map style. These live in `noodles-editor/src/runtime/deck-ops.ts`; the number curves (Bezier Curve, Ramp) are in `value-ops.ts`.
- **Host operator** only when the work cannot run in the engine: it calls an API with the user's key, reads the page, or returns JavaScript objects rather than rows.

## A planner operator

```typescript
{
  type: 'above', label: 'Above', category: 'rows',
  description: 'Keep rows where a column is above a value.',
  inputs: [table()], outputs: [out()],
  params: [
    { name: 'column', label: 'Column', kind: 'column', default: '', of: 'in' },
    { name: 'value', label: 'Value', kind: 'float', default: 0, step: 0.1, changeRate: 4, port: true },
  ],
  lower(ctx) {
    const col = ctx.str('column');
    if (!col) ctx.error('Above needs a column');
    return {
      nodes: [{ id: ctx.id, type: 'filter', input: ctx.input('in'), predicate: `${col} > ${ctx.bind('value')}` }],
      outputs: { out: ctx.id },
    };
  },
},
```

- `type` is the `op` in a project file. `label` and `description` are what the Add Node menu and the parameter pane show.
- `category` places it in the Add Node menu. There is no second registry.
- `inputs` and `outputs` are ports. `table()` and `out()` are helpers in `operators.ts` for a table port named `in` and a table output named `out`.
- `lower(ctx)` returns IR nodes (`sql`, `filter`, `join`, `aggregate`, `attribute`, `wrangle`, `js`, layers; see `types.ts`) and which IR node each output port is. `ctx.input('in')` is the IR node wired into a port, and `ctx.error` reports a problem on the node.

### Key principles

- **Bind values, read structure.** `ctx.str`, `ctx.num` and `ctx.bool` read a parameter structurally, so changing it recompiles. `ctx.bind` returns a placeholder (`{{key}}`) for SQL or an expression, so a change is routed instead: dragging `value` above requeries or updates a uniform and never recompiles. `float`, `int` and `text` parameters are bindable by default, other kinds are structural, and `bind` overrides either way (`bind: 'prop'` makes a parameter a deck prop).
- **Per-row values are columns.** Channels and attributes are expressions over columns, never JavaScript callbacks per row.
- **`changeRate`** (expected changes per second while dragged) helps the optimizer pick a route.
- **`port: true`** gives a parameter a `par:<name>` handle that a number output can drive.
- **`when`** shows a parameter only for some values of another; **`folder`** groups parameters into tabs.
- **Scalars.** An operator that computes a number from its parameters alone has `scalar(p, clock)` instead of `lower`, and joins the scalar program evaluated every frame (Number, Time, Math).

Never Biome-format `packages/planner`: it keeps its own style.

### Parameter kinds

| Kind | For |
|------|-----|
| `float`, `int` | Numbers, with `min`, `max` and `step` |
| `toggle` | A boolean |
| `menu` | One of `options` |
| `string`, `text`, `url` | Text |
| `column` | A column of the input named by `of` |
| `expr` | A row expression |
| `code` | SQL, JavaScript or another `language` |
| `color` | `[r, g, b]` from 0 to 255 |
| `field` | A widget the editor supplies (see [Field System](./field-system.md)) |

## A deck operator

Add a `DeckOp` to `DECK_OPS` in `noodles-editor/src/runtime/deck-ops.ts`. Its `def` is an `OpDef` whose outputs are `value` ports, and its `build(params, id, env)` returns the description deck takes, such as `{ type: 'CompassWidget', id, placement }`. `noodles` names the older Noodles operator it replaces. `registerDeckOperators()` registers them all with the planner.

A `build` that reads an API key with `getKeysStore().getKey()` lists the keys in `usesKeys`, so it runs again when the user changes one.

## A host operator

A Noodles operator class in `noodles-editor/src/noodles/operators.ts`, listed in `opTypes` and planned as `host(reason)` in `src/runtime/migrate/op-catalog.ts`:

```typescript
export class GeocoderOp extends Operator<GeocoderOp> {
  static displayName = 'Geocoder'
  static description = 'Get the location of a query string'
  static usesKeys = ['mapbox'] as const
  createInputs() {
    return { query: new StringField() }
  }
  createOutputs() {
    return { location: new Point2DField(), results: new DataField() }
  }
  async execute({ query }: ExtractProps<typeof this.inputs>) {
    const apiKey = getKeysStore().getKey('mapbox')
    const [result] = await geocodeWithMapbox(query, apiKey)
    // ...
  }
}
```

`HostRunner` runs `execute()` on the main thread, and rows it returns reach planner nodes through DuckDB. Keep host operators small: each one is work the engine cannot plan.

## Code without a new operator

Often a new operator isn't needed:

- An **Attribute Create** node or a layer channel takes a row expression, such as `distance([lng1, lat1], [lng2, lat2])`. See [Expressions](../users/expressions.md).
- A **`sql`** node takes any SELECT. `{{input0}}` to `{{input2}}` are the tables wired into `in0` to `in2`, and `ch('threshold/value')` binds a parameter, so dragging it reruns the query without recompiling.
- A **`code`** node runs JavaScript in the engine worker and returns rows, with `d3`, `turf` and [`utils`](./utils-api-reference.md) in scope.
- A **`js-function`** node defines a function expressions can call per row. DuckDB runs it about 20 times slower than SQL.

## Tests and generated files

- Planner behavior: `packages/planner/src/*.test.ts` (`npm test -w @noodles.gl/planner`), usually by lowering a small `EditorDoc` and checking the IR.
- Real SQL: a `*.node.test.ts` in `noodles-editor/src/runtime/__tests__/` using `openNodeDuck()` from `duckdb-node.ts`. Assert on rows, and on what a change cost (compiles, requeries).
- `src/runtime/migrate/examples.node.test.ts` runs every example; keep it passing.
- A new or changed operator changes the registry snapshot and its reference page. From `noodles-editor/`, run `npm run generate:registry`, then `npm run generate:op-docs` (it writes `docs/reference/operators/<type>.md`). Write anything the generated tables can't say under the page's `## Remarks`; the generator keeps it.

An operator that replaces one from older projects also needs a conversion: see [Extending the Framework](./framework-extension.md#converting-older-projects).
