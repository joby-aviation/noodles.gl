# NYC Taxis

_Adapted from [Kepler.gl examples](https://kepler.gl/demo/nyctrips)_

## Overview
This example visualizes NYC taxi trips as a three-layer visualization: purple circles for pickup locations, blue circles for dropoff locations, and arcs connecting each pickup to its corresponding dropoff. This creates a flow map that reveals transportation patterns, with the arcs showing the direction and path of each trip.

## Nodes
- **`data-source`** (File) loads `@/data.csv`
- **`pickup-position`** (Attribute Create) writes `pickup_position` as `[pickup_longitude, pickup_latitude]`
- **`dropoff-position`** (Attribute Create) writes `dropoff_position` as `[dropoff_longitude, dropoff_latitude]`
- **`pickup`** and **`dropoff`** (Color) hold the purple and blue
- **`arc-layer`** (Arc Layer) draws from `pickup_position` to `dropoff_position` in those colors
- **`pickup-layer`** and **`dropoff-layer`** (Scatterplot Layer) draw the endpoints
- All three layers use `blend: "additive"`, which brightens overlapping points and arcs
- **`deck`** (Deck) holds the Carto Dark Matter basemap and the camera. Two timeline keyframes on `deck.bearing` turn the camera a full circle over 20 seconds at a constant speed, so playback loops without a jump. Press play in the timeline to watch it

## Pipeline
```
data-source → pickup-position → dropoff-position → arc-layer     → deck
                                                 → pickup-layer  → deck
                                                 → dropoff-layer → deck
```

## Data Structure
The CSV file contains taxi trip records with fields:
- `VendorID`: Taxi company identifier
- `tpep_pickup_datetime`, `tpep_dropoff_datetime`: Trip start and end times
- `passenger_count`: Number of passengers
- `trip_distance`: Distance in miles
- `pickup_longitude`, `pickup_latitude`: Starting location
- `dropoff_longitude`, `dropoff_latitude`: Ending location
- `fare_amount`, `tip_amount`, `total_amount`: Payment details

## Use Cases
This pattern is useful for visualizing:
- Origin-destination flows
- Transportation networks
- Migration patterns
- Delivery routes
- Any dataset with start and end locations
