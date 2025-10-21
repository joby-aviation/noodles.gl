# NYC Taxis

## Overview
This example visualizes NYC taxi trip data showing pickup and dropoff locations, as well as the routes between them using arc layers.

## What It Demonstrates
- **Multi-layer visualization**: Three separate layers (pickup points, dropoff points, and arcs connecting them)
- **Position accessors**: Using `AccessorOp` to extract longitude/latitude from different columns
- **Color coding**: Distinct colors for pickup (purple) and dropoff (blue) locations
- **Arc layer**: Showing directional flow from pickup to dropoff
- **CSV data loading**: Reading taxi trip data from a CSV file

## Key Techniques
- **Data source**: `FileOp` loads taxi trip data in CSV format
- **Position extraction**: Two accessor operators extract pickup and dropoff coordinates
- **Color operators**: `ColorOp` nodes define consistent colors for pickup and dropoff visualizations
- **Layer types**:
  - `ScatterplotLayerOp` for pickup and dropoff points
  - `ArcLayerOp` for routes connecting pickup to dropoff
- **Basemap**: Dark matter style provides good contrast for the bright colored data

## Data Structure
The CSV file contains taxi trip records with fields:
- `pickup_longitude`, `pickup_latitude`: Starting location
- `dropoff_longitude`, `dropoff_latitude`: Ending location
- Additional trip metadata (time, fare, etc.)

## Use Cases
This pattern is useful for visualizing:
- Origin-destination flows
- Transportation networks
- Migration patterns
- Delivery routes
- Any dataset with start and end locations
