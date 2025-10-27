# Querying Overture Maps Data

Learn how to query and visualize global map data from [Overture Maps](https://overturemaps.org/) using DuckDB's spatial capabilities.

## What is Overture Maps?

Overture Maps is an open-source global map dataset that includes:
- **Places**: Points of interest (parks, restaurants, shops, etc.)
- **Buildings**: Building footprints worldwide
- **Transportation**: Roads, railways, and transit networks
- **Base**: Land use, land cover, and water features
- **Addresses**: Address points

The data is stored as Parquet files on S3, queryable directly via DuckDB's spatial and httpfs extensions.

## Example: NYC Parks with Interactive Bounding Box

This example demonstrates how to query all parks in New York City using a mouse-driven bounding box.

### Setup

You'll need these operators:
1. **BoundsOp** - Creates a bounding box from two points (interactive via Geocoder widgets)
2. **DuckDbOp** - Queries Overture Maps Parquet files
3. **GeoJsonLayerOp** - Renders the parks on the map
4. **ViewerOp** - Displays the map

### Step 1: Create the Bounding Box

Add a `BoundsOp` node and configure it with two `Point2D` inputs. You can:
- Manually enter coordinates for NYC bounds:
  - **point1**: `[-74.05, 40.68]` (southwest corner - Brooklyn)
  - **point2**: `[-73.90, 40.82]` (northeast corner - Upper Manhattan)
- Or use `GeocoderOp` nodes to interactively select points on a map

The `BoundsOp` will output a bounding box array: `[[west, south], [east, north]]`

### Step 2: Query Overture Maps with DuckDB

Add a `DuckDbOp` node with this SQL query that returns GeoJSON directly:

```sql
SELECT JSON({
  'type': 'FeatureCollection',
  'features': LIST(
    JSON({
      'type': 'Feature',
      'geometry': JSON(ST_AsGeoJSON(geometry)),
      'properties': JSON({
        'id': id,
        'name': COALESCE(names.primary, 'Unnamed Park'),
        'category': categories.primary
      })
    })
  )
}) as geojson
FROM read_parquet(
  's3://overturemaps-us-west-2/release/2024-09-18.0/theme=places/type=*/*',
  filename=true,
  hive_partitioning=1
)
WHERE
  -- Filter by bounding box (reference BoundsOp outputs)
  bbox.minX >= {{./bounds-op.out.bounds.0.0}}
  AND bbox.maxX <= {{./bounds-op.out.bounds.1.0}}
  AND bbox.minY >= {{./bounds-op.out.bounds.0.1}}
  AND bbox.maxY <= {{./bounds-op.out.bounds.1.1}}
  -- Filter for parks only
  AND categories.primary = 'park'
LIMIT 1000;
```

Then add a `CodeOp` to extract the GeoJSON object from the result:

```javascript
// DuckDB returns [{ geojson: {...} }], extract the GeoJSON object
return d[0].geojson;
```

#### Understanding the Query

- **`JSON()`**: Constructs JSON objects directly in DuckDB
- **`LIST()`**: Aggregates all features into an array
- **`ST_AsGeoJSON(geometry)`**: Converts Overture's WKB geometry to GeoJSON string
- **`COALESCE(names.primary, 'Unnamed Park')`**: Provides fallback for missing names
- **`{{./bounds-op.out.bounds.0.0}}`**: Mustache template referencing the BoundsOp output
  - `./bounds-op` - relative path to the BoundsOp node
  - `.out.bounds` - the output field named "bounds"
  - `.0.0` - first coordinate pair, first value (west longitude)
- **`categories.primary = 'park'`**: Filters for park features only

### Step 3: Visualize on Map

Add a `GeoJsonLayerOp` and configure:
- **data**: Connect to the CodeOp output (the GeoJSON FeatureCollection)
- **filled**: `true`
- **getFillColor**: `#22c55e` (green for parks)
- **opacity**: `0.6`
- **stroked**: `true`
- **getLineColor**: `#16a34a` (darker green border)
- **getLineWidth**: `2`

Add a `ViewerOp` and connect the GeoJsonLayerOp's layer output to it.

### Complete Node Graph

```
[BoundsOp] → [DuckDbOp] → [CodeOp] → [GeoJsonLayerOp] → [ViewerOp]
  point1:      query:        code:      data: connected     layers: connected
  [-74.05,     (JSON SQL)    return     getFillColor: #22c55e
   40.68]                    d[0]       opacity: 0.6
  point2:                    .geojson
  [-73.90,
   40.82]
```

## More Examples

### All Buildings in a Block

Query building footprints with height data:

```sql
SELECT JSON({
  'type': 'FeatureCollection',
  'features': LIST(
    JSON({
      'type': 'Feature',
      'geometry': JSON(ST_AsGeoJSON(geometry)),
      'properties': JSON({
        'id': id,
        'height': height,
        'level': level
      })
    })
  )
}) as geojson
FROM read_parquet(
  's3://overturemaps-us-west-2/release/2024-09-18.0/theme=buildings/type=*/*',
  filename=true,
  hive_partitioning=1
)
WHERE
  bbox.minX >= {{./bounds.out.bounds.0.0}}
  AND bbox.maxX <= {{./bounds.out.bounds.1.0}}
  AND bbox.minY >= {{./bounds.out.bounds.0.1}}
  AND bbox.maxY <= {{./bounds.out.bounds.1.1}}
LIMIT 5000;
```

Extract with `CodeOp`: `return d[0].geojson`

Visualize with `GeoJsonLayerOp` using:

- **extruded**: `true`
- **getElevation**: `d => d.properties.height || 10` (accessor for building height)
- **getFillColor**: `#94a3b8`

### Road Network

Query roads for routing or network analysis:

```sql
SELECT JSON({
  'type': 'FeatureCollection',
  'features': LIST(
    JSON({
      'type': 'Feature',
      'geometry': JSON(ST_AsGeoJSON(geometry)),
      'properties': JSON({
        'id': id,
        'name': names.primary,
        'class': class,
        'subtype': subtype
      })
    })
  )
}) as geojson
FROM read_parquet(
  's3://overturemaps-us-west-2/release/2024-09-18.0/theme=transportation/type=segment/*',
  filename=true,
  hive_partitioning=1
)
WHERE
  bbox.minX >= {{./bounds.out.bounds.0.0}}
  AND bbox.maxX <= {{./bounds.out.bounds.1.0}}
  AND bbox.minY >= {{./bounds.out.bounds.0.1}}
  AND bbox.maxY <= {{./bounds.out.bounds.1.1}}
  AND class = 'motorway'
LIMIT 2000;
```

Extract with `CodeOp`: `return d[0].geojson`

### Places by Category

Query specific types of places (restaurants, cafes, etc.):

```sql
SELECT JSON({
  'type': 'FeatureCollection',
  'features': LIST(
    JSON({
      'type': 'Feature',
      'geometry': JSON(ST_AsGeoJSON(geometry)),
      'properties': JSON({
        'id': id,
        'name': names.primary,
        'category': categories.primary,
        'confidence': confidence
      })
    })
  )
}) as geojson
FROM read_parquet(
  's3://overturemaps-us-west-2/release/2024-09-18.0/theme=places/type=*/*',
  filename=true,
  hive_partitioning=1
)
WHERE
  bbox.minX >= -122.45
  AND bbox.maxX <= -122.38
  AND bbox.minY >= 37.75
  AND bbox.maxY <= 37.81
  AND (
    categories.primary = 'restaurant'
    OR categories.primary = 'cafe'
  )
LIMIT 500;
```

Extract with `CodeOp`: `return d[0].geojson`

## Tips and Best Practices

### Performance

1. **Always use bbox filtering**: Overture datasets are huge. Without spatial filters, queries will time out.
2. **Use LIMIT**: Start with small limits (100-1000) while developing, increase as needed.
3. **Select only needed columns**: Don't use `SELECT *` - it's slower and uses more memory.
4. **Check data size**: Use `ViewerOp` or `ConsoleOp` to inspect result counts before rendering.

### Bounding Box Strategy

- **Small areas first**: Start with neighborhood-scale queries (0.05° x 0.05°)
- **Progressive loading**: For large areas, consider tiling or level-of-detail strategies
- **Coordinate precision**: Overture uses WGS84 (EPSG:4326) coordinates [longitude, latitude]

### Data Quality

- **`confidence` field**: Higher values indicate more reliable data
- **Missing names**: Check for null names and provide fallbacks
- **Category variations**: Categories may have subcategories (e.g., `restaurant.pizza`)

### Latest Release

Check [Overture Maps releases](https://github.com/OvertureMaps/data/releases) for the latest version. Update the S3 path in queries:
```
's3://overturemaps-us-west-2/release/2024-09-18.0/theme=places/...'
                                    ^^^^^^^^^^^^
                                    Update this date
```

## Troubleshooting

### Query returns empty results
- Verify bbox coordinates are in correct order: `[west, south, east, north]`
- Check that bbox coordinates are `[longitude, latitude]` (not lat/lng)
- Ensure bbox overlaps with data (some themes have sparse coverage)

### "httpfs extension not found"
- The DuckDB instance should auto-load httpfs
- If error persists, try adding `INSTALL httpfs;` before `LOAD httpfs;`

### Large queries are slow
- Reduce bbox area
- Lower the LIMIT
- Filter by more specific categories
- Consider pre-downloading Parquet files for local querying

### GeoJSON parsing errors
- Ensure `ST_AsGeoJSON()` is called on geometry column
- Verify the CodeOp correctly parses the JSON string
- Check for null geometries in results

## Resources

- [Overture Maps Documentation](https://docs.overturemaps.org/)
- [Overture Schema Reference](https://docs.overturemaps.org/schema/reference/)
- [DuckDB Spatial Extension](https://duckdb.org/docs/extensions/spatial.html)
- [Example Queries (Overture GitHub)](https://github.com/OvertureMaps/data/tree/main/examples)
