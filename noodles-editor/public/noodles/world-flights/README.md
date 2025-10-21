# World Flights

## Overview
This example visualizes global flight routes between major airports worldwide using arc layers to show connections between cities.

## What It Demonstrates
- **Global-scale visualization**: Worldwide airport connections
- **Arc layer usage**: Great circle routes between airports
- **Source-target relationships**: Origin-destination pairs for flights
- **High-density data**: Efficiently rendering thousands of flight routes

## Key Techniques
- **Data source**: Flight route data with origin and destination airports
- **Position accessors**: Extract source and target coordinates for each route
- **Arc layer**: `ArcLayerOp` draws curved lines (great circles) between airports
- **Global basemap**: Shows entire world for context
- **Opacity control**: Manages visual complexity with many overlapping routes

## Data Structure
Expected to contain flight route data with:
- Origin airport coordinates (longitude, latitude)
- Destination airport coordinates (longitude, latitude)
- Optional: flight frequency, airline, route info

## Use Cases
This pattern is useful for visualizing:
- Global transportation networks
- International trade flows
- Migration patterns
- Communication networks
- Any large-scale origin-destination data
- Network connectivity visualization
