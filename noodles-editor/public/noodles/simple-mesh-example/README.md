# Simple Mesh Layer BART Stations

## Overview
This example places 3D mesh objects (geometric shapes) at each BART station location, with each mesh colored by station ridership and randomly rotated for visual variety. Higher ridership stations appear more orange/red while lower ridership stations are darker. This demonstrates using 3D geometry as data markers instead of flat circles.

## Key Techniques
- **Data source**: `FileOp` loads BART station data from JSON
- **Mesh layer**: `SimpleMeshLayerOp` with `sizeScale: 30`
- **Position accessor**: `AccessorOp` with expression `d.coordinates` extracts locations
- **Color accessor**: `AccessorOp` with expression `utils.colorToHex([Math.sqrt(d.exits), 140, 0])` colors by ridership
- **Orientation accessor**: `AccessorOp` with expression `[0, Math.random() * 180, 0]` randomizes rotation
- **Basemap**: `MaplibreBasemapOp` with 30-degree pitch

## Data Structure
The JSON file contains BART station records with:
- `name`: Station name and code
- `code`: Two-letter station code
- `address`: Street address
- `entries`: Number of station entries (ridership)
- `exits`: Number of station exits (ridership)
- `coordinates`: Array of [longitude, latitude]

## Node Graph Flow
```
Data → Position Accessor → Mesh Layer → Deck → Out
     → Color Accessor ↗
     → Orientation Accessor ↗
Basemap → Deck
```

## Use Cases
This pattern is useful for:
- Custom 3D markers instead of standard pins
- 3D icon visualizations
- Data points requiring orientation (wind direction, flow)
- Artistic or branded visualizations with custom shapes
- 3D building representations
- Game-like visualizations
- Any scenario where 3D geometry adds meaning or visual interest

## Next Steps
To extend this example:
- Replace default mesh with custom 3D models
- Add animation by modifying orientation over time
- Use different mesh shapes based on data categories
- Add interactivity to show station details on hover
- Scale mesh size based on data values
