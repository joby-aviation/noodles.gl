# Overture Maps NYC Parks

_Query global map data from Overture Maps using DuckDB_

## Overview
This example demonstrates how to query and visualize parks in New York City using Overture Maps data. Overture Maps provides a global, open-source dataset with consistent schemas for places, buildings, transportation, and more. The data is stored as Parquet files on S3, which can be queried directly using DuckDB's spatial capabilities.

## Key Techniques
- **Bounding box**: `BoundsOp` defines the geographic area (SW Brooklyn to NE Manhattan)
- **DuckDB query**: `DuckDbOp` queries Overture's S3 Parquet files with spatial filtering
- **Direct GeoJSON**: SQL constructs GeoJSON using `JSON()` and `LIST()` functions
- **Data extraction**: `CodeOp` extracts the GeoJSON object from query results
- **GeoJSON layer**: `GeoJsonLayerOp` renders parks with green fill and darker borders
- **Basemap**: `MaplibreBasemapOp` with positron style

## Data Source
[Overture Maps](https://overturemaps.org/) provides:
- **Global Coverage**: Pre-processed OSM data plus additional sources
- **Consistent Schema**: Structured, queryable datasets
- **S3 Access**: Direct querying via DuckDB without downloading
- **Monthly Updates**: Regular releases with the latest data

## SQL Query Breakdown
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
FROM read_parquet([
  's3://overturemaps-us-west-2/release/2025-10-22.0/theme=places/type=place/part-00000-2286d3de-b89f-44be-91c6-3e57d0b74722-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2025-10-22.0/theme=places/type=place/part-00001-2286d3de-b89f-44be-91c6-3e57d0b74722-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2025-10-22.0/theme=places/type=place/part-00002-2286d3de-b89f-44be-91c6-3e57d0b74722-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2025-10-22.0/theme=places/type=place/part-00003-2286d3de-b89f-44be-91c6-3e57d0b74722-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2025-10-22.0/theme=places/type=place/part-00004-2286d3de-b89f-44be-91c6-3e57d0b74722-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2025-10-22.0/theme=places/type=place/part-00005-2286d3de-b89f-44be-91c6-3e57d0b74722-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2025-10-22.0/theme=places/type=place/part-00006-2286d3de-b89f-44be-91c6-3e57d0b74722-c000.zstd.parquet'
],
  filename=true,
  hive_partitioning=1
)
WHERE
  bbox.xmin >= {{./bounds.out.bounds.0.0}}
  AND bbox.xmax <= {{./bounds.out.bounds.1.0}}
  AND bbox.ymin >= {{./bounds.out.bounds.0.1}}
  AND bbox.ymax <= {{./bounds.out.bounds.1.1}}
  AND categories.primary = 'park'
LIMIT 1000;
```

**Key Features:**
- `JSON()` constructs GeoJSON directly in SQL
- `LIST()` aggregates features into an array
- `ST_AsGeoJSON()` converts WKB geometry to GeoJSON
- `COALESCE()` provides fallback for missing names
- Mustache templates (`{{...}}`) reference BoundsOp outputs
- Spatial bbox filtering ensures efficient queries

## Node Graph Flow
```
[BoundsOp] → [DuckDbOp] → [CodeOp] → [GeoJsonLayerOp] → [DeckRendererOp] → [OutOp]
  Define         Query        Extract      Render Parks        Compose          Display
  NYC Area       Overture     GeoJSON      (Green Fill)        Layers
                 S3 Data
                    ↓
            [MaplibreBasemapOp]
                (Basemap)
```

## Customization

### Query Different Features
Change the `categories.primary` filter:
- `'restaurant'` - Restaurants
- `'cafe'` - Cafes
- `'school'` - Schools
- `'hospital'` - Hospitals

### Query Buildings or Roads
Replace the S3 paths array with different themes. You'll need to list each parquet file explicitly since DuckDB WASM doesn't support glob patterns (`*.parquet`).

Use AWS CLI to list files:
```bash
aws s3 ls s3://overturemaps-us-west-2/release/2025-10-22.0/theme=buildings/type=building/ --no-sign-request
```

**Note:** DuckDB WASM requires explicit file paths in an array - glob patterns like `*.parquet` or `*/*` are not supported.

### Adjust Bounding Box
Modify `BoundsOp` inputs to query different areas:
- **San Francisco**: `[-122.5, 37.7]` to `[-122.35, 37.82]`
- **London**: `[-0.2, 51.45]` to `[0.05, 51.6]`
- **Tokyo**: `[139.6, 35.6]` to `[139.85, 35.75]`

### Style Changes
Modify `GeoJsonLayerOp` inputs:
- **Fill color**: Change `#22c55e` to any hex color
- **Opacity**: Adjust `0.6` for transparency (0-1)
- **Line width**: Change `2` for thicker/thinner borders

## Performance Tips
- Keep bbox small (< 0.2° × 0.2°) for faster queries
- Use `LIMIT` to cap results (100-5000 depending on density)
- Filter by specific categories to reduce data
- Check [Overture releases](https://github.com/OvertureMaps/data/releases) for latest version

## Use Cases
This pattern is useful for:
- Urban planning and analysis
- Location-based visualizations
- Regional demographic studies
- Infrastructure mapping
- Real estate analysis
- Tourism and recreation planning

## Related Examples
- **Overpass NYC Parks**: Real-time OSM data via Overpass API
- **NYC Census**: Demographic data visualization
- **SF Street Trees**: City-scale point data visualization
