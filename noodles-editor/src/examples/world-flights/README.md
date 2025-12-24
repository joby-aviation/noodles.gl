# World Flights

_Adapted from [Kepler.gl examples](https://kepler.gl/)_

## Overview
This example displays actual recorded flight trajectories as colored line paths across a global map. Each line represents an aircraft's journey, colored by the aircraft's country of origin. The trajectories show the complete path with altitude and timestamp data for each point along the route, creating a snapshot of global air traffic.

## Key Techniques
- **Data source**: `FileOp` loads GeoJSON with LineString flight paths
- **Path layer**: `GeoJsonLayerOp` renders flight trajectories
- **Animated layer**: `TripsLayerOp` shows animated flight paths with trail effects
- **Country accessor**: `AccessorOp` with expression `d.properties.origin_country` extracts country string
- **Color mapping**: `CategoricalColorRampOp` assigns distinct colors to each country category
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

## Node Graph Flow
```
Data → GeoJSON Layer → Deck → Out
     ↘ Trips Layer ↗
     ↘ origin-country Accessor → CategoricalColorRamp → Layer Colors
```

The `origin-country` accessor extracts the country string from each flight feature. This string flows into a `CategoricalColorRampOp`, which automatically assigns a unique color from a predefined color scheme to each distinct country. The color output then flows to both the `GeoJsonLayerOp` (for static paths) and `TripsLayerOp` (for animated trails), ensuring consistent coloring across both visualization layers.

## Use Cases
This pattern is useful for visualizing:
- Global transportation networks
- International trade flows
- Migration patterns
- Communication networks
- Any large-scale origin-destination data
- Network connectivity visualization
