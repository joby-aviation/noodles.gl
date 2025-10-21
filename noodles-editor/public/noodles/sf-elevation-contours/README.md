# San Francisco Elevation Contours

## Overview
This example visualizes the topography of San Francisco using elevation contour lines, showing the city's famous hills and valleys.

## What It Demonstrates
- **Contour line visualization**: Elevation isolines
- **Topographic mapping**: Terrain representation using lines
- **3D terrain data in 2D**: Conveying elevation through contours
- **Geographic analysis**: Understanding terrain and slope

## Key Techniques
- **Data source**: Contour line data (likely GeoJSON LineStrings)
- **Line layer**: `PathLayerOp` or `GeoJsonLayerOp` for contour lines
- **Color by elevation**: Different colors or line weights by height
- **Dense line rendering**: Many overlapping contour lines

## Data Structure
Contour data includes:
- Line geometry (array of coordinates)
- Elevation value for each contour
- Possibly contour interval (e.g., every 50 feet)

## Use Cases
This pattern is useful for:
- Topographic mapping
- Terrain analysis
- Flood risk assessment
- Urban planning (slope, drainage)
- Hiking/trail planning
- Geographic education
- Any elevation or isoline data
