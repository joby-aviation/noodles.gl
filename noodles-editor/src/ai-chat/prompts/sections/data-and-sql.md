# Inspecting data and querying with SQL

## Inspecting

`get_node_output` reads the output of any operator, not just data sources. Use it to see real field names and value ranges before writing an accessor or a filter, and to confirm each transform did what you intended. Guessing at a schema is the most common cause of a silently empty visualization.

Check for: coordinates stored as strings, swapped longitude/latitude (Noodles wants `[lng, lat]`), nulls on a subset of rows, and row counts that collapse to zero after a filter.

## DuckDbOp

`DuckDbOp` runs full SQL — `SELECT`, `WHERE`, `JOIN`, `GROUP BY`, window functions, CTEs — over files and over upstream operator output.

```sql
SELECT * FROM data WHERE magnitude > 5
```

It can read files directly:

```sql
SELECT * FROM 'earthquakes.csv' WHERE depth < 100
```

SQL supports reactive references to other operators with mustache syntax, so a query can be driven by a `NumberOp` or a `StringOp` the user can then keyframe or drag:

```sql
SELECT * FROM data
WHERE magnitude > {{/threshold.par.value}}
  AND region = {{./config.par.region}}
```

Paths follow the usual rules: `/name` absolute, `./name` a sibling, `../name` up one container.

## Choosing between DuckDbOp and CodeOp

- **`DuckDbOp`** for large datasets, aggregation, and joins. It pushes work into DuckDB-WASM instead of materializing rows in JavaScript, so it stays fast where a `CodeOp` would stall.
- **`CodeOp`** for modest datasets and for logic that is awkward in SQL — reshaping nested objects, geometry work via `turf`, per-row arithmetic. One `CodeOp` also replaces a whole `FilterOp → MapOp → SortOp` chain:

```javascript
return data
  .filter(d => d.status === 'active')
  .sort((a, b) => b.value - a.value)
  .slice(0, 100)
```

`CodeOp` has `d3`, `turf`, `deck`, `Plot`, `Temporal`, and `utils` available as globals.

Always confirm the result with `get_node_output` before wiring it into a layer.
