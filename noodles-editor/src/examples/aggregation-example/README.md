# SF Bike Parking Aggregation

## Overview
This example transforms individual bike parking locations into 3D aggregated visualizations using either square grid cells or hexagonal cells. Each point location is grouped into cells, with the cell's height and color indicating the total number of parking spaces in that area. You can toggle between grid and hexagon views to see how different aggregation shapes reveal density patterns differently.

## Key Techniques
- **Data source**: `FileOp` loads bike parking data from JSON
- **Position accessor**: `AccessorOp` with expression `d.COORDINATES` extracts location
- **Weight accessor**: `AccessorOp` with expression `d.SPACES` extracts parking space count
- **Grid layer**: `GridLayerOp` with 200m cells and `elevationScale: 4`
- **Hexagon layer**: `HexagonLayerOp` with 200m radius and `elevationScale: 4`
- **Layer switching**: `SwitchOp` toggles between grid and hexagon views
- **Basemap**: `MaplibreBasemapOp` with positron style

## Data Structure
The JSON file contains bike parking facility records with fields:
- `ADDRESS`: Street address of the facility
- `RACKS`: Number of bike racks
- `SPACES`: Number of parking spaces
- `COORDINATES`: Array of [longitude, latitude]

## Node Graph Flow
```
Data → Position Accessor → Grid Layer → Switch → Deck
                         ↘ Hexagon Layer ↗
     → Spaces Accessor → Both Layers (getColorWeight, getElevationWeight)
```

## Use Cases
This pattern is useful for visualizing:
- Facility density (parking, charging stations, amenities)
- Event hotspots
- Sales or activity heatmaps
- Urban planning and resource allocation
- Any point data that benefits from aggregation and density analysis
