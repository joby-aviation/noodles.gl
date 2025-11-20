# UK Commute Patterns

_Adapted from [Kepler.gl examples](https://kepler.gl/demo/ukcommute)_

## Overview
This example visualizes UK commute patterns using a three-layer approach: orange circles mark where people live (residence), purple circles show where they work (workplace), and orange arcs connect each home to its corresponding workplace. The visualization uses actual commute flow data to show real transportation patterns across regions.

## Key Techniques
- **Data source**: `FileOp` loads CSV with residence and workplace coordinates
- **Residence position**: `AccessorOp` with expression `[d.residence_lng, d.residence_lat]`
- **Workplace position**: `AccessorOp` with expression `[d.workplace_lng, d.workplace_lat]`
- **Residence layer**: `ScatterplotLayerOp` with orange fill (`#ffa500ff`)
- **Workplace layer**: `ScatterplotLayerOp` with purple fill (`#800080ff`)
- **Arc layer**: `ArcLayerOp` with orange color (`#ff991f`) and `getWidth: 2`
- **Basemap**: `MaplibreBasemapOp` with dark matter style, 49° pitch

## Data Structure
The CSV file contains:
- `residence_lng`, `residence_lat`: Home location coordinates
- `workplace_lng`, `workplace_lat`: Work location coordinates
- `all_flows`: Number of commuters on this route

## Use Cases
This pattern is useful for:
- Transportation planning
- Economic analysis
- Urban development
- Public transit planning
- Regional connectivity studies
- Labor market analysis
