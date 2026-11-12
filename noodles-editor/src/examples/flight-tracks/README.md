# Flight Tracks

_Adapted from [Root Geospatial Flight Tracks dataset](https://source.coop/root-geospatial/flight-tracks)_

## Overview

This example visualizes flight tracks over the California Central Coast, from Monterey Bay to the southern San Joaquin Valley, on June 15, 2024. It queries pre-processed flight trajectory data from the Root Geospatial Flight Tracks dataset on Source Cooperative and displays flight paths as colored lines with start (green) and end (red) points. The data covers 4 adjacent zoom-8 quadkey tiles (latitude 35.5 to 36.6, longitude -123.75 to -118.1).

## Nodes

- **`flights`** (DuckDB SQL) reads the 4 Parquet tiles, builds each track as a line geometry `geom`, and adds `start_point` and `end_point` columns
- **`tracks`** (Path Layer) draws `geom` in cyan (`lineColor: [0, 191, 255]`, `widthScale: 2` pixels, `opacity: 0.6`)
- **`starts`** (Scatterplot Layer) draws `start_point` in green (`fillColor: [0, 255, 0]`, `radiusScale: 500` meters)
- **`ends`** (Scatterplot Layer) draws `end_point` in red (`fillColor: [255, 0, 0]`, `radiusScale: 500` meters)
- **`deck`** (Deck) holds the Carto Dark Matter basemap and the camera over the Central Coast

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

1. Explicitly listing 4 quadkey tile paths in `read_parquet([...])` (duckdb-wasm has no wildcard support)
2. Converting the geometry array to a line with `ST_MakeLine(list_transform(geometry, g -> ST_Point(g.x, g.y)))`
3. Using `DISTINCT ON (icao, end_t)` to deduplicate flights that span multiple tiles
4. Filtering out NULL geometries to ensure clean visualization data
5. Taking each flight's endpoints with `ST_StartPoint(geom)` and `ST_EndPoint(geom)`, limited to 500 flights

## Pipeline

```
flights → tracks → deck
        → starts → deck
        → ends   → deck
```

## Use Cases

This pattern is useful for:

- Aviation traffic analysis
- Flight path visualization
- ADS-B data exploration
- Geospatial data processing from S3
- Working with partitioned datasets
- Real-world trajectory visualization
