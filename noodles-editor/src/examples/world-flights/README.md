# World Flights

_Adapted from [Kepler.gl examples](https://kepler.gl/)_

## Overview
This example displays actual recorded flight trajectories across a global map, colored by each aircraft's country of origin. Static lines show each complete route, animated trails replay the flights over the timeline, and a dot marks each aircraft's current position.

## Nodes
- **`flights-file`** (GeoJSON) loads the kepler.gl world flights file for the static routes
- **`flights`** (Code) reads the same file and splits each feature's coordinates into a `path` list and a `timestamps` list, keeping `properties`
- **`color-index`** and **`route-color-index`** (Attribute Create) write `color_ramp_index` as `(category(origin_country, 8.0) + 0.5) / 10.0`
- **`color`** and **`route-color`** (Color Ramp) map that index through the `categorical-category10` ramp into `color_ramp`, so each origin country gets its own color
- **`routes`** (Path Layer) draws each full trajectory from `geom`
- **`trails`** (Trips Layer) replays flights from `path` and `timestamps` with `trailLength: 336` and `widthScale: 200` meters
- **`time`** (Number) holds the current time in Unix seconds; it is keyframed on the timeline and drives `trails`' `currentTime` and `heads-now`'s `time`
- **`heads-now`** (Time Series) interpolates `lng, lat, alt` along each path at that time
- **`position`** (Attribute Create) writes `[lng, lat, alt]`, and **`heads`** (Scatterplot Layer) draws a dot there
- **`deck`** (Deck) holds the Carto Dark Matter basemap and a global camera

## Data Structure
The GeoJSON file contains flight trajectory features with:
- `geometry`: LineString with coordinates [longitude, latitude, altitude, timestamp] for each point
- `properties`:
  - `icao24`: Aircraft identifier
  - `origin_country`: Country of aircraft origin
  - `callsign`: Flight callsign
  - `airline`: Airline name
  - `country`: Additional country information

## Pipeline
```
flights-file → route-color-index → route-color → routes → deck
flights → color-index → color → trails → deck
                              → heads-now → position → heads → deck
time → trails (currentTime), heads-now (time)
```

All three layers read the `color_ramp` column, so a flight's route, trail and dot share one color.

## Use Cases
This pattern is useful for visualizing:
- Global transportation networks
- International trade flows
- Migration patterns
- Communication networks
- Any large-scale origin-destination data
- Network connectivity visualization
