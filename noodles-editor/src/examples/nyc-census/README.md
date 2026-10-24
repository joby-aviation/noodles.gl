# NYC Census

_Adapted from [Kepler.gl examples](https://github.com/keplergl/kepler.gl-data/tree/master/nyc_census)_

## Overview
This example creates a choropleth map of NYC census tracts where each tract polygon is colored based on demographic data. Each tract is colored and extruded by its population, revealing demographic patterns across New York City's five boroughs.

## Nodes
- **`data-source`** (GeoJSON) loads the census tracts from `@/data.json`
- **`map-range`** (Map Range) scales `Population` from 0 to 10000 into 0 to 1, written as `map_range`
- **`population-color`** (Color Ramp) maps `map_range` through the `turbo` ramp into `population_color`
- **`population-to-elevation`** (Map Range) scales `Population` from 0 to 10000 into 0 to 200, written as `population_to_elevation`
- **`geojson-layer`** (Polygon Layer) fills and extrudes tracts with `color: "population_color"`, `elevation: "population_to_elevation"` and `elevationScale: 11`
- **`deck`** (Deck) holds the Carto Voyager basemap and the camera

## Pipeline
```
data-source → map-range → population-color → population-to-elevation → geojson-layer → deck
```

## Data Structure
The GeoJSON file contains census tract features with:
- `geometry`: Polygon boundaries for each tract
- `properties`:
  - `ntaname`: Neighborhood tabulation area name
  - `ntacode`: Neighborhood code
  - `ct2010`, `boro_ct2010`: Census tract 2010 IDs
  - `boro_name`, `boro_code`: Borough name (Manhattan, Brooklyn, etc.) and code
  - `Population`: Population count
  - `shape_area`, `shape_leng`: Geometric properties
  - `puma`, `cdeligibil`, `ctlabel`: Additional census identifiers

## Use Cases
This pattern is useful for:
- Demographic analysis
- Urban planning
- Public health studies
- Economic research
- Resource allocation planning
- Any choropleth/statistical mapping
