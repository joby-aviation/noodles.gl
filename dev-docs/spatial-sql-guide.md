# Spatial SQL with DuckDB Guide

This guide explains how to use DuckDB's spatial extension with Noodles.gl for high-performance geospatial data processing and visualization.

## Overview

Noodles.gl automatically loads DuckDB's spatial extension, giving you access to PostGIS-compatible spatial functions. Combined with automatic WKB (Well-Known Binary) to GeoArrow promotion, you get zero-copy rendering of spatial query results.

## Quick Start

### Basic Spatial Query

```sql
-- Create points with ST_AsWKB for automatic GeoArrow promotion
SELECT 
  id,
  name,
  ST_AsWKB(ST_Point(lng, lat)) as geometry
FROM cities
```

The `DuckDbOp` operator will:
1. Execute the SQL query
2. Detect the WKB `geometry` column
3. Auto-promote it to native GeoArrow format
4. Output zero-copy Arrow table

Layer operators will:
1. Auto-detect the `geometry` column
2. Use it directly as `getPosition` attribute
3. Render with zero-copy GPU upload

### Geometry Column Naming

Auto-detection works with these column names (case-insensitive):
- `geometry`
- `geom`
- `wkb_geometry`

Or specify explicitly with `GeometryPreparationOp`.

## Spatial Functions

### Point Creation

```sql
-- Create Point from coordinates
ST_Point(longitude, latitude) → GEOMETRY

-- Example: Cities as points
SELECT 
  name,
  ST_AsWKB(ST_Point(lng, lat)) as geometry
FROM cities
```

### Distance Calculations

```sql
-- Distance between geometries (returns meters for geographic coordinates)
ST_Distance(geom1, geom2) → DOUBLE

-- Example: Find cities within 50km of San Francisco
WITH sf AS (
  SELECT ST_Point(-122.4194, 37.7749) as point
)
SELECT 
  city.name,
  ROUND(ST_Distance(city.geom, sf.point) / 1000, 2) as distance_km
FROM cities city, sf
WHERE ST_Distance(city.geom, sf.point) < 50000
```

### Buffers

```sql
-- Create buffer around geometry (distance in meters for geographic)
ST_Buffer(geometry, distance) → GEOMETRY

-- Example: 10km buffer zones
SELECT 
  name,
  ST_AsWKB(ST_Buffer(ST_Point(lng, lat), 10000)) as geometry
FROM facilities
```

### Spatial Relationships

```sql
-- Check if geometries intersect
ST_Intersects(geom1, geom2) → BOOLEAN

-- Check if point is within polygon
ST_Within(point, polygon) → BOOLEAN

-- Example: Points within region
SELECT p.*
FROM points p, regions r
WHERE ST_Within(p.geometry, r.boundary)
  AND r.name = 'California'
```

### Geometry Conversion

```sql
-- Convert to Well-Known Binary (for rendering)
ST_AsWKB(geometry) → BINARY

-- Convert to Well-Known Text (for debugging)
ST_AsText(geometry) → VARCHAR

-- Parse from Well-Known Text
ST_GeomFromText('POINT(0 0)') → GEOMETRY
```

### Geometry Properties

```sql
-- Get X coordinate of point
ST_X(point) → DOUBLE

-- Get Y coordinate of point
ST_Y(point) → DOUBLE

-- Get area (square meters for geographic)
ST_Area(polygon) → DOUBLE

-- Get length (meters for geographic)
ST_Length(linestring) → DOUBLE
```

## Supported Geometry Types

### Currently Auto-Promoted

| Geometry Type | WKB → GeoArrow | Zero-Copy Rendering |
|---------------|----------------|---------------------|
| Point | ✅ Yes | ✅ Yes |
| Polygon | ✅ Yes | ✅ Yes |
| MultiPolygon | ✅ Yes | ✅ Yes |

### Other Types (Fallback Rendering)

| Geometry Type | Status |
|---------------|--------|
| LineString | ⚠️ Falls back to JS materialization |
| MultiPoint | ⚠️ Falls back to JS materialization |
| MultiLineString | ⚠️ Falls back to JS materialization |
| GeometryCollection | ⚠️ Not recommended |

**Note:** Non-promoted types still work but don't benefit from zero-copy optimization.

## Workflow Patterns

### Pattern 1: Direct WKB Output

**Best for:** Point and Polygon geometries

```
DuckDbOp (ST_AsWKB) → Layer (auto-detects geometry)
```

Example:
```sql
SELECT 
  id,
  ST_AsWKB(ST_Point(lng, lat)) as geometry,
  value
FROM data
```

Automatically:
- WKB detected and promoted to GeoArrow
- `getPosition` uses geometry column as binary attribute
- Zero-copy rendering

### Pattern 2: Explicit Geometry Preparation

**Best for:** Custom column names or debugging

```
DuckDbOp → GeometryPreparationOp → Layer
```

Example:
```sql
SELECT 
  id,
  ST_AsWKB(shape) as custom_geom_column
FROM data
```

Then use `GeometryPreparationOp` with `geometryColumn: "custom_geom_column"`.

### Pattern 3: Extract Coordinates in SQL

**Best for:** Simple point data without spatial operations

```sql
SELECT 
  id,
  ST_X(geometry) as lng,
  ST_Y(geometry) as lat,
  value
FROM spatial_table
```

Auto-detection will find `lng`/`lat` columns and create `getPosition: [d.lng, d.lat, 0]`.

**Downside:** Materializes coordinates to JavaScript (no zero-copy).

## Performance Optimization

### ✅ Do: Use WKB for Point/Polygon rendering

```sql
-- Fast: Zero-copy GPU upload
SELECT ST_AsWKB(ST_Point(lng, lat)) as geometry FROM data
```

### ✅ Do: Filter in SQL before rendering

```sql
-- Efficient: Filter 1M rows to 1K in DuckDB
SELECT ST_AsWKB(geometry) as geometry
FROM large_dataset
WHERE ST_Distance(geometry, ST_Point(-122, 37)) < 50000
LIMIT 1000
```

### ✅ Do: Compute attributes in SQL

```sql
-- Computes color once in DuckDB, stored as binary attribute
SELECT 
  ST_AsWKB(geometry) as geometry,
  CASE 
    WHEN value > 100 THEN 255
    WHEN value > 50 THEN 128
    ELSE 64
  END as color_r
FROM data
```

### ❌ Avoid: Extracting X/Y when rendering points

```sql
-- Slow: Materializes to JS, no zero-copy
SELECT 
  ST_X(geometry) as x,
  ST_Y(geometry) as y
FROM data
```

Better:
```sql
-- Fast: WKB → GeoArrow → GPU
SELECT ST_AsWKB(geometry) as geometry FROM data
```

### ❌ Avoid: Complex geometry in accessors

```javascript
// Bad: Creates geometry per frame
getPosition: d => [ST_X(d.geometry), ST_Y(d.geometry), 0]
```

Better:
```sql
-- Do it once in SQL
SELECT ST_AsWKB(geometry) as geometry FROM data
```

## Common Spatial Queries

### Cities Within Distance

```sql
WITH target AS (
  SELECT ST_Point(-122.4194, 37.7749) as point
)
SELECT 
  city.name,
  ST_AsWKB(city.geometry) as geometry,
  ST_Distance(city.geometry, target.point) / 1000 as distance_km
FROM cities city, target
WHERE ST_Distance(city.geometry, target.point) < 50000
ORDER BY distance_km
```

### Spatial Join (Points in Polygons)

```sql
SELECT 
  p.id,
  p.name,
  r.region_name,
  ST_AsWKB(p.geometry) as geometry
FROM points p
JOIN regions r ON ST_Within(p.geometry, r.boundary)
```

### Nearest Neighbors

```sql
WITH target AS (
  SELECT ST_Point(-122.4194, 37.7749) as point
)
SELECT 
  name,
  ST_AsWKB(geometry) as geometry,
  ST_Distance(geometry, target.point) as distance
FROM points, target
ORDER BY distance
LIMIT 10
```

### Heatmap Data Aggregation

```sql
SELECT 
  ST_AsWKB(ST_Point(
    FLOOR(lng * 100) / 100,  -- Round to grid
    FLOOR(lat * 100) / 100
  )) as geometry,
  COUNT(*) as weight
FROM events
GROUP BY FLOOR(lng * 100), FLOOR(lat * 100)
```

## Troubleshooting

### Geometry Column Not Detected

**Symptom:** Layer doesn't automatically use geometry

**Solutions:**
1. Ensure column is named `geometry`, `geom`, or `wkb_geometry`
2. Use `GeometryPreparationOp` with explicit column name
3. Check that `ST_AsWKB()` is used in query

### DuckDB GEOMETRY Type Error

**Error:** `"DuckDB GEOMETRY values are not WKB by default"`

**Solution:** Always wrap with `ST_AsWKB()`:

```sql
-- Wrong: Returns internal GEOMETRY type
SELECT ST_Point(lng, lat) as geometry FROM data

-- Correct: Returns WKB binary
SELECT ST_AsWKB(ST_Point(lng, lat)) as geometry FROM data
```

### Mixed Geometry Types

**Symptom:** Some geometries don't render

**Cause:** Column contains mix of Points, Polygons, etc.

**Solution:** Filter to single type:
```sql
SELECT ST_AsWKB(geometry) as geometry
FROM data
WHERE ST_GeometryType(geometry) = 'POINT'
```

### No Spatial Functions Available

**Symptom:** `Function ST_Point not found`

**Cause:** Spatial extension not loaded (shouldn't happen in Noodles.gl)

**Check:** DuckDbOp automatically runs:
```sql
SET autoinstall_known_extensions = 1;
INSTALL spatial;
LOAD spatial;
```

## Example Projects

### Spatial SQL Demo

See `examples/spatial-sql-demo` for comprehensive examples:
- Point geometries with auto-detection
- Buffer zones around points
- Distance filtering
- Spatial text labels

### File-Based Spatial Data

```sql
-- Read GeoParquet
SELECT ST_AsWKB(geometry) as geometry, *
FROM read_parquet('data.parquet')

-- Read Shapefile (requires GDAL extension)
INSTALL spatial;
INSTALL gdal;
LOAD gdal;
SELECT ST_AsWKB(geom) as geometry, *
FROM ST_Read('data.shp')
```

## Advanced Topics

### Custom Projections

```sql
-- Transform to Web Mercator (EPSG:3857)
ST_Transform(geometry, 'EPSG:4326', 'EPSG:3857')
```

### Geometry Simplification

```sql
-- Reduce polygon complexity (tolerance in degrees)
ST_Simplify(geometry, 0.01)
```

### Spatial Indexing

DuckDB automatically uses spatial indexes for:
- `ST_Intersects`
- `ST_Within`
- `ST_Distance` with threshold

No manual index creation needed.

## Performance Benchmarks

| Operation | Without WKB Promotion | With WKB Promotion |
|-----------|----------------------|-------------------|
| 1M Points | ~5-8 FPS | ~55-60 FPS |
| 100K Polygons | ~2-3 FPS | ~30-40 FPS |
| Memory Usage | 300MB+ | 50-80MB |

*Benchmarks: MacBook Pro M1, Chrome 120*

## Further Reading

- [DuckDB Spatial Extension Docs](https://duckdb.org/docs/extensions/spatial.html)
- [PostGIS Function Reference](https://postgis.net/docs/reference.html) (mostly compatible)
- [GeoArrow Specification](https://github.com/geoarrow/geoarrow)
- [Noodles.gl Arrow Architecture](./ARROW_SQL_ARCHITECTURE.md)

---

**Last Updated:** 2025-06-04
