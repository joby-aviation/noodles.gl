# US County Unemployment

_Adapted from [Kepler.gl examples](https://kepler.gl/)_

## Overview
This example creates a choropleth map of all US counties where each county's color represents its unemployment rate. Counties with higher unemployment appear in one color (typically darker or more intense) while lower unemployment counties appear in another, creating a visual map of economic health across the entire United States.

## Nodes
- **`data-source`** (GeoJSON) loads the county boundaries from `@/data.geojson`
- **`unemployment`** (Attribute Create) writes `unemployment` as `coalesce(unemployment_rate, 0)`
- **`extent`** (Extent) finds the highest rate; its `max` drives `map-range`'s `inMax`
- **`map-range`** (Map Range) scales `unemployment` from `inMin: 0.1` up to that maximum into 0 to 1, written as `map_range`
- **`unemployment-color`** (Color Ramp) maps `map_range` through the `viridis` ramp into `unemployment_color`
- **`geojson-layer`** (Polygon Layer) fills counties with `color: "unemployment_color"`
- **`deck`** (Deck) holds the Carto Voyager basemap and the camera

## Pipeline
```
data-source → unemployment → map-range → unemployment-color → geojson-layer → deck
            → extent (max) ↗ (inMax)
```

## Data Structure
The GeoJSON file contains county features with:
- `geometry`: MultiPolygon county boundaries
- `properties`:
  - `NAME`: County name
  - `GEOID`: Geographic identifier (state + county FIPS code)
  - `STATEFP`, `COUNTYFP`: State and county FIPS codes
  - `unemployment_rate`: Unemployment rate (percentage)
  - `labor_force`: Total labor force count
  - `employed`: Number of employed persons
  - `unemployment_level`: Number of unemployed persons
  - `ALAND`, `AWATER`: Land and water area (square meters)
  - `LSAD`, `COUNTYNS`, `AFFGEOID`: Additional identifiers

## Use Cases
This pattern is useful for:
- Economic analysis
- Policy research
- Regional development planning
- Socioeconomic studies
- Grant allocation
- Business location decisions
- Any statistical mapping by administrative region
