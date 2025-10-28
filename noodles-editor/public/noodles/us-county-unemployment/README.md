# US County Unemployment

_Adapted from [Kepler.gl examples](https://kepler.gl/)_

## Overview
This example creates a choropleth map of all US counties where each county's color represents its unemployment rate. Counties with higher unemployment appear in one color (typically darker or more intense) while lower unemployment counties appear in another, creating a visual map of economic health across the entire United States.

## Key Techniques
- **Data source**: `FileOp` loads county boundaries with unemployment statistics
- **Polygon layer**: `GeoJsonLayerOp` renders county shapes
- **Color mapping**: `ColorRampOp` creates sequential scale from low to high unemployment
- **Basemap**: `MaplibreBasemapOp` showing continental United States

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
