# Overture Maps NYC Parks

_Query global map data from Overture Maps using DuckDB_

## Overview
This example demonstrates how to query and visualize parks in New York City using Overture Maps data. Overture Maps provides a global, open-source dataset with consistent schemas for places, buildings, transportation, and more. The data is stored as Parquet files on S3, which can be queried directly using DuckDB's spatial capabilities.

## Nodes
- **`duckdb-query`** (DuckDB SQL) queries Overture's S3 Parquet files for places with `taxonomy.primary = 'park'` and builds one GeoJSON FeatureCollection in SQL
- **`extract-geojson`** (Code) returns the `geojson` value from the query's first row, or an empty FeatureCollection
- **`extract-geojson-rows`** (GeoJSON) turns that FeatureCollection into rows with a `geom` column
- **`geojson-layer`** (Polygon Layer) fills parks in green (`fillColor: [34, 197, 94]`) with darker borders (`lineColor: [22, 163, 74]`, `lineWidthScale: 2`) at `opacity: 0.6`
- **`geojson-layer-lines`** (Path Layer) and **`geojson-layer-points`** (Scatterplot Layer) draw any line and point features in the same colors
- **`deck`** (Deck) holds the Carto Positron basemap and the camera over New York City

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
        'category': taxonomy.primary
      })
    })
  )
}) as geojson
FROM read_parquet([
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00000-a0a9949b-7e8e-59fe-803b-6cc55b17f790-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00001-95b3bb67-399f-571e-9503-61421d57661c-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00002-6f03d044-7fc3-539e-842b-7b15c796e629-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00003-755a53ba-2d37-54c8-b30e-8c14897bc3f3-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00004-14b83d8c-d850-51f9-85b2-8f8a0b4634af-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00005-c3667754-428e-500c-bf3b-a0b5921b7cc0-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00006-55d446f6-129a-556e-b79e-e1cfd5735068-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00007-a2c7689b-daa2-5233-9780-d37ccfc3ea74-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00008-8b09f6c1-f726-581a-9b39-f891088cc2ad-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00009-fe90ff49-733f-5fa3-9755-c6cd4438305c-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00010-c680fdf1-f03b-5be1-93f1-56c835a00765-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00011-472205f3-e3ff-5474-98a4-b9b3361f7306-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00012-8cf9bdfe-d946-56f8-84c0-19493d0fbb9c-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00013-6c366648-1364-543e-894b-d6e65d03c056-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00014-dcceff87-235e-5a0e-a4b4-5f25ccb873e7-c000.zstd.parquet',
  's3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/part-00015-eb1c1331-f519-5db6-8fef-74a77e5776ff-c000.zstd.parquet'
],
  filename=true,
  hive_partitioning=1
)
WHERE
  bbox.xmin >= {{./bounds.out.bounds.0.0}}
  AND bbox.xmax <= {{./bounds.out.bounds.1.0}}
  AND bbox.ymin >= {{./bounds.out.bounds.0.1}}
  AND bbox.ymax <= {{./bounds.out.bounds.1.1}}
  AND taxonomy.primary = 'park'
LIMIT 1000;
```

**Key Features:**
- `JSON()` constructs GeoJSON directly in SQL
- `LIST()` aggregates features into an array
- `ST_AsGeoJSON()` converts WKB geometry to GeoJSON
- `COALESCE()` provides fallback for missing names
- Spatial bbox filtering keeps queries small

## Pipeline
```
duckdb-query → extract-geojson → extract-geojson-rows → geojson-layer        → deck
                                                      → geojson-layer-lines  → deck
                                                      → geojson-layer-points → deck
```

## Customization

### Query Different Features
Change the `taxonomy.primary` filter in `duckdb-query`:
- `'restaurant'`: Restaurants
- `'cafe'`: Cafes
- `'school'`: Schools
- `'hospital'`: Hospitals

### Query Buildings or Roads
Replace the S3 paths array with different themes. You'll need to list each parquet file explicitly since DuckDB WASM doesn't support glob patterns (`*.parquet`).

Use AWS CLI to list files:
```bash
aws s3 ls s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/ --no-sign-request
```

**Note:** DuckDB WASM requires explicit file paths in an array; glob patterns like `*.parquet` or `*/*` are not supported.

Overture removes old releases after a few months. If the query fails with "No files found", list the current releases with `aws s3 ls s3://overturemaps-us-west-2/release/ --no-sign-request` and replace the paths with the files from the newest one. File names change with every release.

### Style Changes
Change the params on `geojson-layer`:
- **Fill color**: Change `fillColor` (`[34, 197, 94]`, or `#22c55e`)
- **Opacity**: Adjust `opacity` (`0.6`) for transparency (0 to 1)
- **Line width**: Change `lineWidthScale` (`2`) for thicker or thinner borders

## Performance Tips
- Keep bbox small (< 0.2° × 0.2°) for faster queries
- Use `LIMIT` to cap results (100 to 5000 depending on density)
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
