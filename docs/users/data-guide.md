# Working with Data

Every table in a project runs in DuckDB. Data nodes load tables, and every node after them works on rows and columns. The [Operator Reference](../reference/operators.md) lists each node's ports and parameters.

## Data Sources

### Files

A **File** node (`file`) reads a file from a URL, or `@/name.csv` from the project's data directory:

| Format | Rows |
|--------|------|
| `csv` | One per line. Header row, column names and a null marker are options |
| `json` | One per item of an array of records |
| `parquet` | One per row |

The table's columns are the file's, and expressions after it name them exactly as written. A JSON column that holds a list of 2 to 4 numbers, such as `"coordinates": [-122.4, 37.7]`, is a vector: a layer's Position can be `coordinates` as it is.

### GeoJSON and other vector files

A **GeoJSON** node (`geojson`) reads GeoJSON, and any vector file DuckDB spatial reads (Shapefile, GeoPackage, KML...). Its outputs:

- `features`: one row per feature, with its geometry in a `geom` column and its properties as columns. A Path or Polygon layer with Position `geom` draws one path or polygon per row.
- `polygons`, `lines`, `points`: one row per vertex, with `lng` and `lat` columns.
- `all`: every vertex row, with a `kind` column.

A shapefile is several files with one name. Import or drop the `.shp` together with its `.shx` (required) and `.dbf` (the attributes), and its `.prj` and `.cpg` if it has them.

### Overture Maps and OpenStreetMap

- **Overture Maps** (places, buildings, roads, worldwide): query its Parquet files on S3 from a `sql` node. See the <EditorLink example="overture-nyc-parks">Overture NYC Parks example</EditorLink> and [docs.overturemaps.org](https://docs.overturemaps.org/).
- **OpenStreetMap**: an **Overpass** node (`overpass`) runs an [Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL) query, with `{{bbox}}` replaced by its Bounds, and returns the features it finds. Wire it into a GeoJSON node to draw them. See the <EditorLink example="overpass-nyc-parks">Overpass NYC Parks example</EditorLink>.

## Processing

### Row nodes

Most processing is one node per step, with [expressions](./expressions.md) over columns:

- **Filter**, **Range Filter**, **Region Filter**: keep rows
- **Attribute Create**: add a column, such as `position` = `[lng, lat]`
- **Map Range**, **Color Ramp**: scale a value, or turn it into a color
- **Sort**, **Limit**, **Join**, **Union**, **Aggregate**: reshape tables

Geometry steps (Buffer, Centroid, Dissolve, Spatial Join and more) are nodes too; see [Geometry](./operators-guide.md#geometry) in the Operators Guide.

### SQL

A **DuckDB SQL** node (`sql`) takes any SELECT. `{{input0}}` to `{{input2}}` are the tables wired into `in0` to `in2`, and `ch('node/param')` reads a parameter, so a slider can drive the query:

```sql
SELECT origin, count(*) AS flights, avg(passengers) AS passengers
FROM {{input0}}
WHERE passengers > ch('min-passengers/value')
GROUP BY origin
```

With nothing wired in, a `sql` node can read files itself, such as `read_parquet('https://...')`.

### Code

A **Code** node (`code`) makes rows with JavaScript. `d` is the input's rows as objects, or a GeoJSON FeatureCollection when the input has a `geom` column. With its **JSON file** URL set and nothing wired in, `d` is that file, parsed whole. `d3`, `turf` and `utils` are in scope. Return an array of rows or a FeatureCollection; either becomes a table.

```javascript
// Code: points to features with turf
return turf.featureCollection(
  d.filter(row => row.passengers > 100)
    .map(row => turf.point([row.lng, row.lat], { name: row.name, passengers: row.passengers }))
)
```

The code runs in the engine's worker, only when its input changes, and can `await` (a `fetch`, for example). For a value per row, use an expression or a [JS Function](./expressions.md#js-function) instead. The [utils API reference](../developers/utils-api-reference.md) lists what `utils` has.

## Common Tasks

### Positions from columns

Add an **Attribute Create** node with Name `position` and Expression `[longitude, latitude]`, then set the layer's Position to `position`. Or write the expression in the layer's Position directly.

### Color by value

Add a **Color Ramp** node with Input `passengers`, a Ramp, and Min and Max. It writes an RGB column (`Cd` by default) that a layer's Color names. To set Min and Max from the data, wire an **Extent** node's `min` and `max` outputs into them.

Or write it in the layer's Color channel: `ramp(fit(passengers, colmin(passengers), colmax(passengers), 0, 1))` spreads the layer's own Color ramp over the data.

### Filter by time

For a column of times in seconds, add a **Filter** in Compare mode with Column `timestamp` and Operator `≤`, and wire a **Time** node into its Value port. As the timeline plays, the filter keeps the rows up to the current time. For paths that move over time, use a Trips Layer or a Time Series node (see [Animation and Rendering](./animation-and-rendering.md#animating-data)).

## Performance

- Aggregate or bin before drawing: Aggregate, Grid Bin, or a Hexagon or Heatmap layer
- Filter early
- Prefer expressions and `sql` over Code and JS Function nodes, which run JavaScript
- Drive a query from a parameter, not from inside a Code node: a parameter change re-runs only what reads it

## Debugging

- Select a node and press `D` (display) to see its rows in the spreadsheet and as points on the map
- Hover the `i` in a node's header for its row count, columns and errors
- **Wrong place on the map**: positions are `[longitude, latitude]`, in that order
- **Text instead of numbers**: `to_number(column)` reads text as a number
- **Missing values**: `coalesce(column, 0)` gives a fallback
- **Unknown column**: names are case-sensitive and must match the table exactly
