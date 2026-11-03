# UK Commute Patterns

_Adapted from [Kepler.gl examples](https://kepler.gl/demo/ukcommute)_

## Overview
This example visualizes UK commute patterns using a three-layer approach: orange circles mark where people live (residence), purple circles show where they work (workplace), and arcs that fade from orange to purple connect each home to its corresponding workplace. The visualization uses actual commute flow data to show real transportation patterns across regions.

## Key Techniques
- **Data source**: `FileOp` loads CSV with residence and workplace coordinates
- **Residence position**: `AccessorOp` with expression `[d.residence_lng, d.residence_lat]`
- **Workplace position**: `AccessorOp` with expression `[d.workplace_lng, d.workplace_lat]`
- **Colors**: `ColorOp` nodes for source (orange, `#f69a00`) and target (purple, `#950c69`)
- **Residence layer**: `ScatterplotLayerOp` filled with the source color
- **Workplace layer**: `ScatterplotLayerOp` filled with the target color
- **Arc layer**: `ArcLayerOp` from source to target color with `getWidth: 80` and `getHeight: 0.7`
- **Blending**: `BlendingOp` with `additive` mode brightens overlapping points and arcs
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
