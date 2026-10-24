# Working with Data

Learn how to load, process, and transform data in Noodles.gl for your visualizations. Every table in a project runs in DuckDB, and every node after a data node works on rows and columns.

## Data Sources

### Local and Remote Files

Use a **File** node (`file`) to read a file from a URL, or `@/name.csv` from the project's data directory. Supported formats:

| Format | Rows | Use Case |
|--------|------|----------|
| `csv` | One per line | Tabular data. Header row, column names and a null marker are options |
| `json` | One per array item | JSON arrays of records |
| `parquet` | One per row | Large columnar files |

The table's columns are what the file has, and expressions after it name them exactly.

### Common Data Formats

### JSON Data
```json
[
  { "origin": "SFO", "destination": "LAX", "coordinates": [-122.4194, 37.7749] }
]
```

A column holding a list of 2 to 4 numbers, like `coordinates`, is a vector: a layer's Position can be `coordinates` as it is.

### CSV Data
```
origin,destination,passengers,lng,lat
SFO,LAX,150,-122.4194,37.7749
```

### GeoJSON

Use a **GeoJSON** node (`geojson`) for GeoJSON, and for any vector file DuckDB spatial reads (Shapefile, GeoPackage, KML...). It has several outputs:

- `features`: one row per feature, its geometry in a `geom` column and its properties as columns. A Path or Polygon layer with Position `geom` draws one path or polygon per row.
- `polygons`, `lines`, `points`: one row per vertex, with `lng` and `lat` columns.
- `all`: every vertex row, with a `kind` column.

### Geospatial Data

**Overture Maps**: Global datasets (places, buildings, roads) via a `sql` node. Best for large-scale analytics. Query Parquet files on S3 with SQL. See [docs.overturemaps.org](https://docs.overturemaps.org/).

**Overpass API**: Current OpenStreetMap data via an **Overpass** node (`overpass`). Best for city-scale queries. Uses Overpass QL syntax, with `{{bbox}}` replaced by the bounds. See [Overpass QL docs](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL).

## Data Processing

### Row Nodes

Most processing is a node per step, with [expressions](./expressions.md) over columns:

- **Filter**, **Range Filter**, **Region Filter**: keep rows
- **Attribute Create**: add a column, such as `position = [lng, lat]`
- **Map Range**, **Color Ramp**: scale a value, or turn it into a color
- **Sort**, **Limit**, **Join**, **Union**, **Aggregate**: reshape tables

### SQL

A **DuckDB SQL** node (`sql`) takes any SELECT. `{{input0}}` to `{{input2}}` are the tables wired into `in0` to `in2`, and `ch('node/param')` reads a parameter, so a slider can drive the query:

```sql
SELECT origin, count(*) AS flights, avg(passengers) AS passengers
FROM {{input0}}
WHERE passengers > ch('min-passengers/value')
GROUP BY origin
```

A `sql` node with nothing wired in can read files itself, such as `read_parquet('https://...')`.

### Code

A **Code** node (`code`) makes rows with JavaScript. `d` is the input's rows as objects (or, when the input has a `geom` geometry column, a GeoJSON FeatureCollection), and `d3`, `turf` and `utils` are in scope. Return an array of rows or a GeoJSON FeatureCollection; either becomes a table that the nodes after it work on.

```javascript
// Code: points to features with turf
return turf.featureCollection(
  d.filter(row => row.passengers > 100)
    .map(row => turf.point([row.lng, row.lat], { name: row.name, passengers: row.passengers }))
)
```

```javascript
// Code: a buffer around every feature of a GeoJSON input
return turf.featureCollection(d.features.map(f => turf.buffer(f, 5, { units: 'kilometers' })))
```

With a **JSON file** URL set and nothing wired in, `d` is that file, parsed whole. The code runs in the engine's worker, not the page, and runs again only when its input changes. It can `await`, for example a `fetch`. For a value computed per row, use an expression or a JS Function instead.

See the [utils API reference](../developers/utils-api-reference.md) for what `utils` contains.

## Common Data Tasks

### Coordinate Conversion

Add an **Attribute Create** node with Name `position` and Expression `[longitude, latitude]`, then set the layer's Position to `position`. Or write the expression in the layer's Position directly.

### Color Mapping

Add a **Color Ramp** node with Input `passengers`, a Ramp, and Min and Max. It writes an RGB column (`Cd` by default) that a layer's Color names. To set Min and Max from the data, wire an **Extent** node's `min` and `max` outputs into them.

Or write it in the layer's Color channel: `ramp(clamp(passengers / 300.0, 0.0, 1.0))` uses the layer's own Color ramp.

### Time-based Filtering

For a column of times in seconds, add a **Filter** in Compare mode with Column `timestamp` and Operator `<=`, and wire a **Time** node into its Value port. As the timeline plays, the filter keeps the rows up to the current time. For paths that move over time, use a Trips Layer or a Time Series node instead (see [Animation and Rendering](./animation-and-rendering.md)).

## Performance Tips

### Large Datasets
- Aggregate or bin before drawing (Aggregate, Grid Bin, or a Hexagon or Heatmap layer)
- Filter early in your pipeline
- Prefer expressions and `sql` over `code` and JS Functions, which run JavaScript per row or per table
- Keep a slider on a parameter rather than inside a code node: a parameter change re-runs only what reads it

## Debugging Data Issues

### Data Preview
- Select a node and press `D` (display) to see its rows in the spreadsheet and preview them as points on the map
- Hover the `i` in a node's header for its row count, columns and errors
- Verify coordinate order (`[lng, lat]`)

### Common Issues
- **Wrong coordinate order**: Use `[longitude, latitude]`
- **Text instead of numbers**: JSON files often hold numbers as text; `to_number(column)` reads them as numbers
- **Missing data**: `coalesce(column, 0)` gives a value for missing rows
- **Wrong column name**: Names are case-sensitive and must match the table exactly
