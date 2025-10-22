# World Flights

_Adapted from [Kepler.gl examples](https://kepler.gl/)_

## Overview
This example displays actual recorded flight trajectories as colored line paths across a global map. Each line represents an aircraft's journey, colored by the aircraft's country of origin. The trajectories show the complete path with altitude and timestamp data for each point along the route, creating a snapshot of global air traffic.

## Key Techniques
- **Data source**: `FileOp` loads GeoJSON with LineString flight paths
- **Path layer**: `GeoJsonLayerOp` renders flight trajectories
- **Color accessor**: `AccessorOp` with expression `utils.stringToColor(d.properties.origin_country)` colors paths by country
- **Basemap**: `MaplibreBasemapOp` showing global view

## Data Structure
The GeoJSON file contains flight trajectory features with:
- `geometry`: LineString with coordinates [longitude, latitude, altitude, timestamp] for each point
- `properties`:
  - `icao24`: Aircraft identifier
  - `origin_country`: Country of aircraft origin
  - `callsign`: Flight callsign
  - `airline`: Airline name
  - `country`: Additional country information

## Use Cases
This pattern is useful for visualizing:
- Global transportation networks
- International trade flows
- Migration patterns
- Communication networks
- Any large-scale origin-destination data
- Network connectivity visualization
