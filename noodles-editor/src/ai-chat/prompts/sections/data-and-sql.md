# Data and SQL

Every table runs in DuckDB. A data node reads one, and every node after it is planned into SQL, a CPU pass or the GPU, whichever is cheapest for the edit at hand.

## Reading data

- `file`: `{ "url": "…", "format": "csv" | "json" | "parquet" }`. A project file is `@/name.csv`.
- `geojson`: `{ "url": "…" }`. Its outputs are rows per vertex: `polygons` (with `id`, `ring`, `vertex`, `lng`, `lat`), `lines` (`id`, `vertex`), `points`, or `all` with a `kind` column. Feature properties are columns.
- `sql`: any SELECT. `{{input0}}` names the table wired into `in0`; `ch('node/param')` reads a parameter, so a slider can drive a WHERE clause.

```json
{ "type": "add_node", "op": "sql", "name": "big", "params": {
  "query": "SELECT * FROM {{input0}} WHERE pop > ch('threshold/value') ORDER BY pop DESC" } }
```

## Shaping tables

- `filter` (mode `compare`, `match` or `expression`) and `range` keep rows.
- `sort`, `limit`, `join` (left, inner, cross; keys by name), `union`, `aggregate` (`groupBy` and lines like `n = count()`, `total = sum(pop)`).
- `unnest` turns list columns into rows: `{ "lists": "path, timestamps", "split": "path: lng lat", "rename": "timestamps: t" }` gives one row per vertex, which `path` and `trips` layers draw.
- `grid` bins points into cells with a count.

## Checking

`get_node_output` on any node returns its columns and a sample. Use it before writing an expression or a query over a table: names are case-sensitive, and JSON files often type numbers as text (arithmetic reads them as numbers; comparisons do not).
