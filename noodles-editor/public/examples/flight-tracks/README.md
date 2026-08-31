# Flight Tracks Near SFO

_Adapted from [Root Geospatial Flight Tracks dataset](https://source.coop/root-geospatial/flight-tracks)_

## Overview

This example visualizes flight tracks near San Francisco International Airport (SFO) on June 15, 2024. It queries pre-processed flight trajectory data from the Root Geospatial Flight Tracks dataset on Source Cooperative's S3 bucket and displays flight paths as colored lines with start (green) and end (red) points. The data covers 4 quadkey tiles around the San Francisco Bay Area.

## Key Techniques

- **DuckDB query**: `DuckDbOp` loads pre-processed flight segments from S3 Parquet files using spatial extensions
- **S3 data access**: Queries 4 specific quadkey-partitioned files without splat arguments (duckdb-wasm limitation)
- **Pre-aggregated geometries**: Uses existing LINESTRING geometries from the source data
- **Deduplication**: Uses `DISTINCT ON` to remove duplicate flight segments appearing in multiple tiles
- **Path layer**: `PathLayerOp` renders flight trajectories in cyan
- **Position accessors**: Extract start/end positions from LINESTRING geometry text
- **Scatterplot layers**: Green markers for flight starts, red markers for flight ends
- **Basemap**: `MaplibreBasemapOp` with dark matter style

## Data Structure

The flight-tracks dataset contains pre-processed flight segments with:

- `icao`: Aircraft unique identifier (ICAO 24-bit address)
- `r` (aliased as `registration`): Aircraft registration number
- `aircraft_type`: Type of aircraft
- `start_t`, `end_t`: Flight segment start and end times (Unix timestamp)
- `start_height_agl_ft`, `end_height_agl_ft`: Altitude above ground level in feet
- `geometry`: Array of coordinate structs with x (longitude) and y (latitude)
- Partitioned by `quadkey_z8` (zoom level 8 quadkey), `year`, `month`, and `day`

## DuckDB Query Highlights

The query demonstrates several techniques:

1. Loading DuckDB spatial and httpfs extensions for S3 access
2. Explicitly listing 4 quadkey tile paths (required for duckdb-wasm, no wildcard support)
3. Converting the geometry array to LINESTRING WKT text using `ST_AsText(ST_MakeLine(...))`
4. Using `DISTINCT ON (icao, end_t)` to deduplicate flights that span multiple tiles
5. Filtering out NULL geometries to ensure clean visualization data

## Node Graph Flow

```
DuckDB (S3 query) → Path Layer → Deck
                  → Start Position Accessor → Scatterplot (green) → Deck
                  → End Position Accessor → Scatterplot (red) → Deck
Basemap → Deck → Out
```

## Use Cases

This pattern is useful for:

- Aviation traffic analysis
- Flight path visualization
- ADS-B data exploration
- Geospatial data processing from S3
- Working with partitioned datasets
- Real-world trajectory visualization
