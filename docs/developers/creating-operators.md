# Creating Operators

An operator is what a person places on the canvas: "Filter", "Arc Layer". Each is an `OpDef` registered with the planner (`@noodles.gl/planner`, in `packages/planner`): its ports, its parameters, and how it compiles. The full guide, with conversions from older projects and the test layout, is [dev-docs/adding-operators.md](https://github.com/joby-aviation/noodles.gl/blob/main/dev-docs/adding-operators.md); this page summarizes it.

## Operator Fundamentals

### Three Kinds

- **Planner operators** work on rows: a source, a filter or join, a GIS step, an attribute, a layer. They compile to SQL, a CPU pass or a GPU kernel. This is the default. They live in `packages/planner/src/operators.ts`, and GIS steps in `gis.ts`.
- **Deck operators** build a deck.gl object from parameters, not rows: a view, a widget, a layer extension, a tile source, a map style. They live in `noodles-editor/src/runtime/deck-ops.ts`, with the number curves (Bezier Curve, Ramp) in `value-ops.ts`.
- **Host operators** are for work that cannot run in the engine: calling an API with the user's key, reading the page, or returning JavaScript objects rather than rows. They are Noodles operator classes in `noodles-editor/src/noodles/operators.ts`, run on the main thread. Add one only when nothing else will do.

### Basic Structure

A planner operator is one entry in `OPERATORS`:

```typescript
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

- `type` is the `op` in a project file; `label` and `description` are what the Add Node menu and the parameter pane show.
- `lower(ctx)` returns IR nodes (`sql`, `filter`, `join`, `aggregate`, `attribute`, `js`, layers...) and which IR node each output port is.
- `category` puts the operator in the Add Node menu. There is no second registry.

### Key Principles

- **Bind values, read structure**: `ctx.str`, `ctx.num` and `ctx.bool` read a parameter structurally, so changing it recompiles. `ctx.bind` makes a placeholder, so a change is routed instead: a slider on `value` above requeries or rebinds a uniform and never recompiles.
- **Per-row values are columns**: channels and attributes are expressions over columns, never per-row JavaScript callbacks.
- **Routing hints**: `changeRate` (changes per second while dragged) and `bind: 'prop'` tell the optimizer how to route a parameter.
- **Ports for parameters**: `port: true` gives a parameter a `par:<name>` handle that a number output can drive.
- **Pane layout**: `when` shows a parameter only for some values of another; `folder` groups parameters.
- **Scalars**: a number computed from parameters alone gets `scalar(p, clock)` instead of `lower`, and joins the scalar program evaluated every frame (Number, Time, Math).

Never Biome-format `packages/planner`: it keeps its own style.

## Operator Categories

The Add Node menu lists operators by category, in this order:

| Category | Examples |
|----------|----------|
| `data` | `file`, `geojson`, `sql`, `code`, `table`, `generate`, `overpass` |
| `table` | `join`, `union`, `sort`, `limit`, `aggregate`, `unnest`, `time-series`, `grid` |
| `geometry` | `buffer`, `centroid`, `clip`, `spatial-join`, `cells`, `choropleth-join` |
| `rows` | `filter`, `range`, `region`, `attribute`, `wrangle`, `map-range`, `extent`, `js-function` |
| `color` | `color-ramp`, `color` |
| `layer` | `scatter`, `arc`, `path`, `trips`, `polygon`, `text`, `heatmap`, `hexagon`, `bitmap`, `tile-3d` |
| `number` | `number`, `time`, `mouse`, `math`, `expression`, `bezier-curve`, `ramp` |
| `output` | `deck`, views, widgets, extensions, `map-style`, `fit-bounds`, `merge`, `layer-props` |
| `structure` | `switch`, `subnet` |
| `host` | Directions, Geocoder, Chart, TileLayer, Custom MapLibre Layer |

## Code Operators

### Code

A `code` node runs JavaScript in the engine worker and returns rows. `d` is the input's rows as objects (a GeoJSON FeatureCollection when the input has a `geom` geometry column), and `d3`, `turf` and `utils` are in scope. It returns an array of rows or a FeatureCollection, which becomes a DuckDB table every later node plans over:

```javascript
// Distance between two points per row, in kilometers
return d.map(row => ({
  ...row,
  km: turf.distance([row.start_lng, row.start_lat], [row.end_lng, row.end_lat]),
}))
```

The `distance([lng1, lat1], [lng2, lat2])` expression in an Attribute Create node does the same without JavaScript, and is much faster.

### JS Function

A `js-function` node defines a function any expression can call by name, run by DuckDB per row. Its Body returns a number, or an array of up to 4. `d3`, `turf` and `utils` are in scope here too. DuckDB runs JavaScript about 20 times slower than SQL, so use it only for logic the expression language cannot express.

### Converted CodeOps

A CodeOp from an older project becomes a `code` node, unless its code reads `op()`, the timeline or `this`, or returns layers or DOM objects. Then it stays a host operator, run outside the plan.

## Operator Paths and References

### Names and Paths

Node ids are opaque. A node's `name` is unique within its network, and its path is its name under its subnets' names:

- **Root nodes**: `/name` (e.g., `/points`, `/threshold`)
- **Nested nodes**: `/subnet/name` (e.g., `/analysis/filter1`)

Tools and references accept ids, names or paths.

### Parameter References

A parameter can hold a literal, `{ "expr": "..." }` or `{ "ref": "node/param" }`. Expressions read other parameters with `ch('node/param')`, and paths may be relative: `ch('../controls/size')` reaches out of a subnet. See [Expressions](../users/expressions.md).

## DuckDB Integration

A `sql` node takes any SELECT. `{{input0}}` to `{{input2}}` are the tables wired into `in0` to `in2`, and `ch()` binds a parameter, so dragging it reruns the query without recompiling the plan:

```sql
SELECT * FROM {{input0}}
WHERE population > ch('threshold/value')
ORDER BY population DESC
```

## Best Practices

### Performance

- Bind values with `ctx.bind` instead of reading them structurally in `lower()`
- Prefer expressions and `sql` over `code` and `js-function`
- Debug mode ("Show editor debug info") shows each node's SQL, memoization and routes

### Data Flow

- Design clear port contracts: tables on `in` and `out`, layers into the deck's `layers`
- Give a node that writes a column a parameter for its name
- Report a bad parameter with `ctx.error`, which shows on the node

### Code Organization

- Keep operators small; one that lowers to several IR nodes is fine
- Every operator needs tests: planner behavior in `packages/planner/src/*.test.ts`, real SQL in a `*.node.test.ts` with DuckDB in Node

## Subnets and Hierarchy

### Subnet Organization

Nodes can be grouped into subnets (`subnet`). A node's `parent` is the subnet it is inside, and `subnet-input` and `subnet-output` nodes inside are the subnet's ports:

```
/                         (root)
├── data-loader           (root-level node)
├── threshold             (root-level node)
└── analysis/             (subnet)
    ├── filter1           (/analysis/filter1)
    └── visualization/    (nested subnet)
        └── map-layer     (/analysis/visualization/map-layer)
```

### Path Benefits

- **No name conflicts**: The same name can appear in different subnets
- **Logical organization**: Group related nodes together
- **Promoted parameters**: A subnet can expose parameters that drive the nodes inside it

## Loops

The older ForLoop operators have no equivalent: per-item work is a row operation over a table (an attribute, a `sql` node, a `code` node), and a project that uses one cannot be converted.

## Custom Operators

An application can add its own operator with `registerOperator(def)` from `@noodles.gl/planner`. One without `lower` is skipped by lowering. An operator that replaces one from the older operator-graph format also needs a conversion in `noodles-editor/src/runtime/migrate/` with a test; anything the conversion cannot express is a `MigrationError` naming the node and why.
