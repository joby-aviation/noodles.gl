# San Francisco Elevation Contours

_Adapted from [Kepler.gl examples](https://github.com/keplergl/kepler.gl-data/tree/master/sfcontour)_

## Overview
This example displays San Francisco's topography through elevation contour lines - lines connecting points of equal elevation. Closely spaced lines indicate steep hills while widely spaced lines show flatter areas. Each line represents a specific elevation, creating a traditional topographic map that reveals the city's famous hills and valleys.

## Key Techniques
- **Data source**: `FileOp` loads contour line data (GeoJSON LineStrings)
- **Line layer**: `GeoJsonLayerOp` renders contour lines with `lineWidthScale: 8` and `opacity: 0.38`
- **Elevation accessor**: `AccessorOp` with expression `d.properties.elevation`
- **Color mapping**: `ColorRampOp` turns the elevation value into the line and fill color
- **Basemap**: `MaplibreBasemapOp` with dark matter style, centered on San Francisco

## Data Structure
The GeoJSON file contains contour line features with:
- `geometry`: LineString coordinates
- `properties`:
  - `elevation`: Elevation value for the contour line
  - `objectid`: Unique identifier
  - `isoline_ty`: Isoline type (e.g., "800 - Normal")
  - `shape_len`: Length of the contour line

## Use Cases
This pattern is useful for:
- Topographic mapping
- Terrain analysis
- Flood risk assessment
- Urban planning (slope, drainage)
- Hiking/trail planning
- Geographic education
- Any elevation or isoline data
