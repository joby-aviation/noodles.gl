# World Flights

_Adapted from [Kepler.gl examples](https://kepler.gl/)_

## Overview
This example displays actual recorded flight trajectories across a global map, colored by each aircraft's country of origin. Static lines show each complete route, animated trails replay the flights over the timeline, and a dot marks each aircraft's current position.

## Key Techniques
- **Data source**: `FileOp` loads GeoJSON with LineString flight paths
- **Data transform**: `CodeOp` (`/transform-flights`) splits each feature's coordinates into `path` and `timestamps` arrays
- **Path layer**: `GeoJsonLayerOp` renders the full flight trajectories
- **Animated layer**: `TripsLayerOp` replays flights with a trail (`trailLength: 336`)
- **Current time**: `NumberOp` (`/time`) is keyframed in the timeline and drives the trips layer and `TimeSeriesOp`
- **Current positions**: `TimeSeriesOp` finds each aircraft's position at the current time for a `ScatterplotLayerOp`
- **Country accessor**: `AccessorOp` with expression `d.properties.origin_country` extracts country string
- **Color mapping**: `CategoricalColorRampOp` with `category10` assigns distinct colors to each country
- **Basemap**: `MaplibreBasemapOp` with dark matter style, showing a global view

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
     ↘ transform-flights → Trips Layer ↗
                       ↘ TimeSeries → Scatterplot Layer ↗
time → Trips Layer, TimeSeries (currentTime)
origin-country Accessor → CategoricalColorRamp → Layer Colors
```

The `origin-country` accessor extracts the country string from each flight. This string flows into a `CategoricalColorRampOp`, which assigns a unique color from the `category10` scheme to each distinct country. The color output flows to the `GeoJsonLayerOp` (static paths), `TripsLayerOp` (animated trails), and `ScatterplotLayerOp` (current positions), so all three layers use the same colors.

## Use Cases
This pattern is useful for visualizing:
- Global transportation networks
- International trade flows
- Migration patterns
- Communication networks
- Any large-scale origin-destination data
- Network connectivity visualization
