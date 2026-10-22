# @noodles.gl/planner

A cost-based query planner for data graphs that span DuckDB, the CPU and a compute shader.

You describe a graph of filters, aggregates, scales, colour scales and arbitrary expressions, and
the planner decides **which engine runs each node**, then emits the SQL, the WGSL and the JS to
do it. Not a renderer, not a database driver: given a graph and some statistics, it hands back a
plan as data.

```bash
npm install @noodles.gl/planner
```

Zero runtime dependencies. `apache-arrow` is used for types only, so the built output has no
imports at all. You can plan a graph in a browser, in Node, or in a build step.

## The idea

The central piece is **one expression IR with three backends**. `sqrt(pop) * 2` compiles to
a DuckDB `SELECT` expression, a WGSL statement, or a JS loop body from the same AST, so "which
engine runs this node" is a cost decision rather than a rewrite. Without that, moving a filter
from SQL to a GPU discard mask means maintaining two implementations in two languages, and
choosing between them is a refactor instead of an integer.

```
expr.ts            parser + AST + the capability table (per-function sql/wgsl spellings)
backends/sql.ts    -> DuckDB, with $1-style binds for prepared statements
backends/wgsl.ts   -> WGSL, width- and bool-aware
backends/js.ts     -> JS, for the CPU stage
functions.ts       user-defined functions, resolved by inlining
```

## Three phases

Deliberately separated, so a plan exists as data before anything is generated:

```
analyze.ts     topological order, feasible engines per node, widths, op counts. No decisions
optimizer.ts   price every legal plan, pick the cheapest
planner.ts     emit SQL + WGSL + the CPU loop for the chosen assignment
```

Stages run in one order and only one order, because SQL cannot read a GPU buffer and GPU output
cannot return to the CPU without a readback:

```
SQL   filters that really remove rows, aggregates, scalar expressions
CPU   generated JS over Arrow columns, results uploaded
GPU   one fused compute kernel writing attribute buffers in place
```

That constraint is what makes the search **exact**: an assignment is just two boundary indices
in topological order, so there are O(n²) candidates and all of them get priced. `explain.candidates`
lists every one, including the illegal ones and why.

The objective is not build time alone:

```
cost = build
     + horizon × frameRate × renderFrame(rows)        drawing is recurring
     + horizon × Σ rate_p × rebind(stage owning p)    parameters have change rates
```

The second term is why a filter that removes rows beats a GPU discard mask: masked rows are
re-rasterized every frame. The third is the "parameterized query" idea as an objective: a dragged
slider pulls its consumers onto the GPU, where rebinding is a 16-byte uniform write instead of a
requery.

## Usage

```ts
import { plan, statsSql, parseStatsRow, targetCaps } from '@noodles.gl/planner';

// One query per source gives the optimizer its statistics.
const { table } = await db.query(statsSql('"trips"', columns));
const stats = parseStatsRow(table.get(0), columns);

const physical = plan(graph, schema, {
  policy: 'cost',
  stats,
  caps: targetCaps('webgpu-native', device),   // or undefined, headless
  params: { speedCutoff: 60 },
  relation: '"trips"',
});

physical.sql;                 // the DuckDB query, with $1-style binds
physical.sqlParams;           // bind order
physical.kernels[0].code;     // the fused WGSL
physical.cpuStage;            // nodes the generated JS loop evaluates
physical.attributes;          // what exists afterwards, and where it came from
physical.explain.candidates;  // every legal plan and its cost
physical.explain.edges;       // the desugared topology, for drawing the plan
```

`caps` is a capability description, not a product name. It covers compute availability, whether the
renderer accepts app-owned buffers, a GPU memory budget, and the per-stage storage-binding limit.
Memory and binding limits are **hard constraints inside the search**, so exceeding them changes
the plan rather than producing a validation error at first draw.

## Attributes are named

Houdini-style: `P` is position, `Cd` is colour, `pscale` is radius. A graph node is a wrangle that
creates or overwrites one. Those names are a default, not a constant:

```ts
plan(graph, schema, {
  conventions: { position: 'aPosition', color: 'aColor', mask: '$keep', internalPrefix: '$' },
});
```

`analyze` resolves every render channel once and publishes `channels`, so nothing downstream
applies a naming fallback. A channel named with the internal prefix is rejected up front, because
internal attributes get no buffer.

## Programmable

`scale`, `colorscale` and `project` are sugar over the IR. `wrangle` is the general case, a
VEX-style multi-statement body:

```
fn ease(x) = x * x * (3.0 - 2.0 * x);
@P      = [lng / 360.0, mercatorY(lat), elevation * {{exag}}];
var t   = clamp(fit(ln(pop), {{lo}}, {{hi}}, 0.0, 1.0), 0.0, 1.0);
@Cd     = ramp(ease(t));
@pscale = t * {{k}};
```

Each statement becomes one attribute node, is placed independently, and the existing fusion merges
them back into one dispatch. The planner needs no knowledge of wrangles at all. `var` locals get
an SSA register rather than a buffer, so they cost no memory, no upload and no binding slot.

User functions are **inlined**, so the backends, `enginesFor`, `widthOf`, `opCount` and fusion all
see an ordinary tree. The price is argument duplication, which `opCount` charges honestly: a
function names work rather than saving it.

For what the IR genuinely cannot express, a `raw` node carries literal SQL or WGSL:

```json
{ "id": "custom", "type": "raw", "input": "src", "engine": "gpu",
  "code": "tint = vec3<f32>(elevation / 900.0, 0.0, 1.0);",
  "writes": [{ "name": "tint", "width": 3 }],
  "reads": ["elevation"], "opCost": 4 }
```

Its code sees plain names: a declared read, write or param is in scope as itself. In exchange it
declares what the planner can no longer infer, and those declarations are **trusted**: an
undeclared read is an unbound buffer, not an error. Prefer a `wrangle` whenever the expression
fits. It does not block fusion, though. A raw GPU node is spliced into the same kernel as its
neighbours, because fusion follows the stage assignment rather than legibility.

## Sources

Data arrives through a provider, so the planner never needs to know where rows come from:

```ts
import { relationSource, parquetUrlSource, sqlSource, type SqlEngine } from '@noodles.gl/planner';
```

`SqlEngine` is the four-method seam a driver implements (`exec`, `run`, `describe`,
`resetPrepared`). `@noodles.gl/gpu-runtime/duckdb` is one implementation over duckdb-wasm.

## Known limits

One aggregate and one colour ramp per graph. No relational joins, no strings. The optimizer is
exact only within the family "stage boundaries in topological order". For a linear chain that is
every legal plan; for a branching DAG it is not. Cardinality estimation assumes uniformity and
independence, so it is least trustworthy exactly where data is skewed; `explain` reports estimated
against actual rather than hiding it. Change rates are declared in the graph, not measured from
real interaction.

## See also

The [repository README](../../README.md) for the WebGPU runtime, the deck.gl adapters and the
inspector demo, and [FINDINGS.md](../../FINDINGS.md) for the measured results, including the
bugs that were invisible until the backends were actually executed.
