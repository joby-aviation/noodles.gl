# NYC Census

_Adapted from [Kepler.gl examples](https://github.com/keplergl/kepler.gl-data/tree/master/nyc_census)_

## Overview
This example creates a choropleth map of NYC census tracts where each tract polygon is colored based on demographic data. Census tracts are colored according to population or other statistical variables, creating a heat map that reveals demographic patterns across New York City's five boroughs.

## Key Techniques
- **Data source**: `FileOp` loads census tract boundaries with demographic data
- **Polygon layer**: `GeoJsonLayerOp` renders tract boundaries
- **Color mapping**: Data-driven fill colors based on census variables
- **Basemap**: `MaplibreBasemapOp` centered on New York City

## Data Structure
The GeoJSON file contains census tract features with:
- `geometry`: Polygon boundaries for each tract
- `properties`:
  - `ntaname`: Neighborhood tabulation area name
  - `ntacode`: Neighborhood code
  - `ct2010`: Census tract 2010 ID
  - `boro_name`: Borough name (Manhattan, Brooklyn, etc.)
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
