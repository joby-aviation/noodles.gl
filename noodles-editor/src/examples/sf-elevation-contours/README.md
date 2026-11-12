# San Francisco Elevation Contours

_Adapted from [Kepler.gl examples](https://github.com/keplergl/kepler.gl-data/tree/master/sfcontour)_

## Overview
This example displays San Francisco's topography through elevation contour lines: lines connecting points of equal elevation. Closely spaced lines indicate steep hills while widely spaced lines show flatter areas. Each line represents a specific elevation, creating a traditional topographic map that reveals the city's famous hills and valleys.

## Nodes
- **`data-source`** (GeoJSON) loads the contour lines from the kepler.gl data repo
- **`elevation-range`** (Map Range) scales `elevation` from 0 to 900 into 0 to 1, written as `elevation_range`
- **`elevation-color`** (Color Ramp) maps `elevation_range` through the `viridis` ramp into `elevation_color`
- **`geojson-layer-lines`** (Path Layer) draws the contours in `elevation_color` with `widthScale: 8` meters, `widthMinPixels: 0.2` and `opacity: 0.38`
- **`deck`** (Deck) holds the Carto Dark Matter basemap and the camera

## Pipeline
```
data-source → elevation-range → elevation-color → geojson-layer-lines → deck
```

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
