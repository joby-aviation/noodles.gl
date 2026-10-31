# SF Bike Parking Aggregation

## Overview
This example transforms individual bike parking locations into 3D aggregated visualizations using either square grid cells or hexagonal cells. Each point location is grouped into cells, with the cell's height and color indicating the total number of parking spaces in that area. You can toggle between grid and hexagon views to see how different aggregation shapes reveal density patterns differently.

## Nodes
- **`data-source`** (File) loads the bike parking JSON from the deck.gl data repo
- **`position`** (Attribute Create) writes `position` as `[item(COORDINATES, 0.0), item(COORDINATES, 1.0)]`
- **`hexagon-layer`** (Hexagon Layer) bins rows into hexagons with `radius: 200` and `elevationScale: 4`
- **`grid-layer`** (Grid Layer) bins rows into square cells with `cellSize: 200` and `elevationScale: 4`
- Both layers read `position` and use the `SPACES` column for `colorWeight` and `elevationWeight`, summed per bin (`SUM`)
- **`switch`** (Switch) picks one layer: `index: 0` is the hexagons, `1` the grid
- **`deck`** (Deck) holds the Carto Positron basemap and the camera (zoom 13, pitch 30)

## Data Structure
The JSON file contains bike parking facility records with fields:
- `ADDRESS`: Street address of the facility
- `RACKS`: Number of bike racks
- `SPACES`: Number of parking spaces
- `COORDINATES`: Array of [longitude, latitude]

## Pipeline
```
data-source → position → hexagon-layer → switch → deck
                       ↘ grid-layer    ↗
```

## Use Cases
This pattern is useful for visualizing:
- Facility density (parking, charging stations, amenities)
- Event hotspots
- Sales or activity heatmaps
- Urban planning and resource allocation
- Any point data that benefits from aggregation and density analysis
