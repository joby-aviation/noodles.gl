# NYC Census

_Adapted from [Kepler.gl examples](https://github.com/keplergl/kepler.gl-data/tree/master/nyc_census)_

## Overview
This example creates a choropleth map of NYC census tracts where each tract polygon is colored based on demographic data. Each tract is colored and extruded by its population, revealing demographic patterns across New York City's five boroughs.

## Key Techniques
- **Data source**: `FileOp` loads census tract boundaries with demographic data
- **Polygon layer**: `GeoJsonLayerOp` renders tract boundaries with `extruded: true` and `elevationScale: 11`
- **Population accessor**: `AccessorOp` with expression `d.properties.Population`
- **Color mapping**: `MapRangeOp` scales population from 0-10000 to 0-1, then `ColorRampOp` with the `turbo` scheme sets the fill color
- **Elevation**: a second `MapRangeOp` scales population from 0-10000 to 0-200 for `getElevation`
- **Basemap**: `MaplibreBasemapOp` with voyager style, centered on New York City

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
