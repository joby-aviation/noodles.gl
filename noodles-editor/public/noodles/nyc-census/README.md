# NYC Census

## Overview
This example visualizes NYC census tract data, likely showing demographic or statistical information across census boundaries.

## What It Demonstrates
- **Polygon visualization**: Census tracts as filled polygons
- **Choropleth mapping**: Color-coding regions by statistical values
- **Boundary data**: Working with administrative/statistical boundaries
- **Demographic analysis**: Visualizing population or socioeconomic data

## Key Techniques
- **Data source**: Census tract boundaries (likely GeoJSON or CSV with geometry)
- **Polygon layer**: `GeoJsonLayerOp` or `PolygonLayerOp` for tract boundaries
- **Color mapping**: Data-driven colors based on census variables
- **NYC-focused viewport**: Centered on New York City

## Data Structure
Typical census data includes:
- Tract geometry (polygon boundaries)
- Population statistics
- Demographic data (age, income, education, etc.)
- Housing information
- Economic indicators

## Use Cases
This pattern is useful for:
- Demographic analysis
- Urban planning
- Public health studies
- Economic research
- Resource allocation planning
- Any choropleth/statistical mapping
