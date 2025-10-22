# NYC Taxis

_Adapted from [Kepler.gl examples](https://kepler.gl/demo/nyctrips)_

## Overview
This example visualizes NYC taxi trips as a three-layer visualization: purple circles for pickup locations, blue circles for dropoff locations, and arcs connecting each pickup to its corresponding dropoff. This creates a flow map that reveals transportation patterns, with the arcs showing the direction and path of each trip.

## Key Techniques
- **Data source**: `FileOp` loads taxi trip data in CSV format
- **Position accessors**: `AccessorOp` nodes extract pickup and dropoff coordinates from separate columns
- **Colors**: `ColorOp` nodes define colors for pickup (purple) and dropoff (blue) points
- **Point layers**: Two `ScatterplotLayerOp` nodes for pickup and dropoff locations
- **Arc layer**: `ArcLayerOp` draws routes from pickup to dropoff
- **Basemap**: `MaplibreBasemapOp` with dark matter style

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
