# US County Unemployment

## Overview
This example visualizes unemployment rates across US counties, creating a choropleth map to show economic patterns across the country.

## What It Demonstrates
- **Choropleth mapping**: Color-coded regions by unemployment rate
- **National-scale statistics**: All US counties
- **Economic data visualization**: Unemployment trends
- **Multi-scale analysis**: State and county-level patterns

## Key Techniques
- **Data source**: County boundary data with unemployment statistics
- **Polygon layer**: `GeoJsonLayerOp` or `PolygonLayerOp` for county shapes
- **Color ramp**: Sequential color scale from low to high unemployment
- **Data classification**: Binning unemployment rates into categories
- **US basemap**: Continental United States view

## Data Structure
County unemployment data includes:
- County boundary geometry (polygons)
- Unemployment rate (percentage)
- County name and FIPS code
- Possibly time series data for trends
- Labor force statistics

## Use Cases
This pattern is useful for:
- Economic analysis
- Policy research
- Regional development planning
- Socioeconomic studies
- Grant allocation
- Business location decisions
- Any statistical mapping by administrative region
