# SQL Compiler Architecture

This document describes the architecture and design decisions behind the Noodles.gl SQL compilation system.

## Overview

The SQL compiler transforms operator graphs into optimized SQL queries that execute in DuckDB-WASM. Instead of pulling data through JavaScript for each operator, compilable subgraphs execute as a single SQL query with zero-copy Arrow Table results.

## Core Philosophy

**The graph IS the query plan.** Each operator is a CTE (Common Table Expression) template. Operator field values are prepared statement parameters. The compiler walks the graph once, emits a single parameterized SQL string, and executes it via DuckDB.

## Key Components

### 1. Template System (`templates.ts`)

Operators declare their SQL representation via templates:

- **Static templates**: Fixed SQL with parameter holes
- **Dynamic templates**: Runtime SQL generation for operators with structural variability (e.g., FilterOp's condition changes SQL operators)

Template holes:
- `{{upstream}}` / `{{upstream2}}` — CTE aliases of connected inputs
- `{{$fieldName}}` — Prepared statement parameters (runtime values)
- `{{ident:hole}}` — Escaped SQL identifiers (column names)

### 2. Compiler (`compiler.ts`)

**Compilation process:**

1. Topologically sort compilable nodes (sources first)
2. Assign CTE aliases from operator IDs
3. For each operator:
   - Resolve template holes
   - Allocate parameter slots for field values
   - Embed operator comments for error attribution
4. Emit: `WITH cte1 AS (...), cte2 AS (...) SELECT * FROM cteN`
5. Return: `CompiledQuery` with SQL, param slots, and operator aliases

**Fingerprinting:** Computes a topology hash (operator IDs + types + connections) for cache invalidation. Field value changes don't invalidate the cache — only topology changes (add/remove operators, change connections).

### 3. Executor (`executor.ts`)

**Execution process:**

1. Collect current parameter values from operator fields
2. Execute prepared statement with parameter values
3. Return Arrow Table (zero-copy from DuckDB)
4. On error, attribute to specific operator via embedded comments

**Timeline scrubbing:** Parameter-only changes re-execute the same prepared statement without recompilation. This enables 60fps animation with changing field values.

### 4. Subgraph Detector (`subgraph-detector.ts`)

**Detection process:**

1. Walk graph backward from sink operators (renderers, consumers)
2. Identify compilable chains (continuous sequences of SQL-compilable operators)
3. Stop at boundary operators (CodeOp, ColorRamp, AccessorOp, visualization layers)
4. Compile each chain independently

**Boundary operators** break SQL chains because they require JavaScript:
- `CodeOp` — Arbitrary JS execution
- `ColorRampOp` — Complex interpolation logic
- `AccessorOp` — Per-row JS functions
- All Deck.gl layer operators — Consume data, produce layer props

### 5. Mustache Parser (`mustache-parser.ts`)

DuckDbOp allows users to write raw SQL with mustache `{{}}` references to other operators.

**Supported syntax:**

- **Explicit prefixes** (recommended):
  - `{{cte:/op}}` or `{{data:/op}}` — Upstream CTE reference
  - `{{param:/op.par.value}}` — Parameter value
  - `{{ident:column_name}}` — SQL identifier

- **Legacy heuristics** (backward compatible):
  - `.par.` or `.inputs.` → parameter
  - `.out.` → CTE reference
  - Bare operator path → CTE reference

The parser converts mustache refs to `$N` parameters or CTE aliases and integrates the user's SQL as a CTE in the compiled chain.

### 6. Error Attribution (`error-attribution.ts`)

**Problem:** DuckDB errors report line numbers in generated SQL, not operator IDs.

**Solution:**

1. Embed operator metadata as SQL comments during compilation:
   ```sql
   /* operator: /filter-1 */
   /* type: FilterOp */
   SELECT * FROM upstream WHERE age > $1
   ```

2. On SQL error:
   - Extract line number from error message
   - Walk backward in SQL to find nearest operator comment
   - Create `OperatorError` with operator ID and type
   - Enrich error with compiled SQL and parameter values

This enables precise debugging: "Error in operator '/filter-1' (FilterOp): Column 'invalid' not found"

### 7. Fingerprinting (`fingerprint.ts`)

**Cache invalidation strategy:**

- **Fingerprint includes:** Operator IDs, types, edge connections
- **Fingerprint excludes:** Field values, operator positions

**Behavior:**

- Field value change → Same fingerprint → Reuse compiled SQL, re-execute with new params
- Topology change → Different fingerprint → Recompile

This is critical for timeline animation: scrubbing a timeline changes field values (via interpolation) but doesn't change topology. Without fingerprinting, every frame would recompile.

### 8. Capabilities (`capabilities.ts`)

**Operator capability flags:**

```typescript
interface SQLCapabilities {
  sqlCompilable: boolean        // Can compile to SQL?
  acceptsArrowTables: boolean   // Can consume Arrow Tables?
  producesArrowTables: boolean  // Produces Arrow Tables?
}
```

**Purpose:** Enables gradual migration. New operators opt-in to Arrow Table support; legacy operators continue receiving POJO arrays via `.toArray()`.

**Example:**

```typescript
// Modern SQL-compilable operator
registerCapabilities('FilterOp', {
  sqlCompilable: true,
  acceptsArrowTables: true,
  producesArrowTables: true,
})

// Boundary operator (not compilable)
registerCapabilities('CodeOp', {
  sqlCompilable: false,
})
```

### 9. Graph Integration (`graph-integration.ts`)

**SQLGraphIntegration** bridges SQL compilation into the pull-based graph executor.

**Integration flow:**

1. Before pulling roots, detect compilable subgraphs
2. Compile each subgraph to SQL (cached by topology fingerprint)
3. Execute compiled queries (cached prepared statements)
4. Inject results into operator cached outputs
5. Mark SQL-satisfied operators as clean
6. Continue with normal pull-based execution for non-compilable operators

**Dirty tracking:** Only re-execute if:
- Topology changed (new fingerprint)
- Any operator in the compiled chain is dirty (field value changed)

## Design Decisions

### Why Not Main-Thread DuckDB?

**Considered:** Move DuckDB to main thread to enable UDFs (User-Defined Functions) for ColorRamp, AccessorOp, etc.

**Rejected because:**
- DuckDB queries on 100K+ rows take 50-500ms
- Blocking main thread >16ms causes visible jank
- `requestIdleCallback` doesn't help (queries aren't interruptible)
- SharedArrayBuffer + sync worker is architecturally complex

**Chosen approach:** Accept boundary operators that break chains. Most real graphs have few JS-heavy operators in data paths. Breaking into 2-3 SQL segments is better than 20 individual JS operator executions.

### Why Explicit Mustache Prefixes?

**Problem:** `{{/op}}` is ambiguous — is it a CTE reference or a parameter?

**Solution:** Support explicit prefixes: `{{cte:/op}}`, `{{param:/op.par.value}}`, `{{ident:column}}`

**Backward compatibility:** Legacy heuristics (.par. → param, .out. → data) still work, but explicit prefixes are clearer and prevent misclassification.

### Why Embed Operator Comments?

**Alternative considered:** Store a line-to-operator mapping separately.

**Problem:** Line numbers shift during SQL generation (whitespace, formatting).

**Chosen approach:** Embed `/* operator: /id */` comments directly in SQL. Comments are stable (never stripped by DuckDB), don't affect execution, and simplify error attribution logic.

### Why Arrow Tables?

**Benefits:**
- Zero-copy handoff from DuckDB to JS
- Memory-efficient for large datasets
- Columnar format matches DeckGL's attribute system
- Future-proof for WebGPU integration

**Compatibility:** Operators opt-in via capabilities. Legacy operators get `.toArray()` fallback.

## Performance Characteristics

### Compilation Time
- **Target:** <5ms for 20-operator chains
- **Current:** ~2-3ms for typical chains
- **Bottleneck:** Template resolution, not graph walking

### Execution Time
- **Improvement:** 2-10× faster than JS path for 10K+ rows
- **Reason:** Single SQL query eliminates intermediate materialization
- **Sweet spot:** 3-10 operator chains

### Timeline Scrubbing
- **Target:** <16ms per frame (60fps)
- **Current:** ~5-10ms for parameter-only changes
- **Key:** Prepared statement reuse + no recompilation

### Memory
- **Arrow Tables:** ~50% smaller than POJO arrays for large datasets
- **Prepared statements:** Persistent connections (closed on topology change)

## Testing Strategy

### Unit Tests
- Template resolution (`compiler.test.ts`)
- Parameter collection (`executor.test.ts`)
- Fingerprint computation (`fingerprint.test.ts`)
- Error attribution (`error-attribution.test.ts`)
- Mustache parsing (`mustache-parser.test.ts`)
- Capabilities (`capabilities.test.ts`)

### Integration Tests
- Subgraph detection (`subgraph-detector.test.ts`)
- Full compile→execute path (`integration.test.ts`)
- Graph integration (`graph-integration.test.ts`)

### E2E Tests
- SQL correctness vs JS execution (`e2e.test.ts`, `parity.test.ts`)
- Timeline scrubbing (`e2e.test.ts`)
- Boundary transitions (`udf-boundaries.test.ts`)
- Example projects (`regression.test.ts`)

### Performance Tests
- Benchmarks (`benchmarks.test.ts`)
- JS vs SQL comparison (`js-performance.test.ts`)

## Future Enhancements

### 1. Schema Propagation
Track column schemas through CTE chain for better error messages:
```typescript
interface CTESchema {
  columns: Array<{ name: string, type: string }>
  isWildcard: boolean  // SELECT * used
}
```

### 2. Partial Compilation
For ExpressionOp, attempt SQL translation first; fall back to JS if it uses JS globals (d3, turf):
```typescript
const sqlExpr = tryTranslateToSQL(expression)
if (sqlExpr) {
  // Compile as SQL
} else {
  // Break chain, execute as JS
}
```

### 3. Parallel Execution
DuckDB supports concurrent queries. Execute independent subgraphs in parallel:
```typescript
const results = await Promise.all(
  subgraphs.map(sg => execute(sg.compiled, sg.params))
)
```

### 4. Query Plan Analysis
Expose DuckDB's EXPLAIN for debugging slow queries:
```typescript
const plan = await conn.query(`EXPLAIN ${compiledQuery.sql}`)
console.log('Query plan:', plan)
```

### 5. Incremental Computation
For large datasets, cache intermediate CTEs across executions:
```typescript
// Create materialized view for expensive upstream
await conn.query(`CREATE TEMP TABLE cached_data AS ${cteSQL}`)
// Reference in downstream queries
SELECT * FROM cached_data WHERE ...
```

## Related Documentation

- [Testing Guide](../../dev-docs/testing-guide.md)
- [Architecture Overview](../../dev-docs/architecture.md)
- [Development Guide](../../dev-docs/developing.md)
- [AGENTS.md](../../../AGENTS.md) — LLM context for this codebase
