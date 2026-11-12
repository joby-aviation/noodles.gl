# Simple Mesh Layer BART Stations

## Overview
This example places 3D mesh objects at each BART station location, with each mesh colored by station ridership and randomly rotated for visual variety. Higher ridership stations appear more orange/red while lower ridership stations are darker. This demonstrates using 3D geometry as data markers instead of flat circles.

## Nodes
- **`data-source`** (File) loads the BART station JSON from the deck.gl data repo
- **`position`** (Attribute Create) writes `position` as `[item(coordinates, 0.0), item(coordinates, 1.0)]`
- **`color`** (Attribute Create) writes `color` as `[sqrt(exits), 140, 0]`, so busier stations have more red
- **`orientation`** (Attribute Create) writes `orientation` as `[0, random() * 180, 0]` for a random rotation
- **`mesh-layer`** (Simple Mesh Layer) draws the deck.gl `humanoid_quad.obj` mesh with `position: "position"`, `color: "(color) / 255.0"`, `orientation: "orientation"` and `sizeScale: 30`
- **`deck`** (Deck) holds the Carto Positron basemap and the camera over San Francisco (pitch 30)

## Data Structure
The JSON file contains BART station records with:
- `name`: Station name and code
- `code`: Two-letter station code
- `address`: Street address
- `entries`: Number of station entries (ridership)
- `exits`: Number of station exits (ridership)
- `coordinates`: Array of [longitude, latitude]

## Pipeline
```
data-source → position → color → orientation → mesh-layer → deck
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
- Point `mesh-layer`'s `mesh` param at your own OBJ model
- Add animation by modifying orientation over time
- Use different mesh shapes based on data categories
- Add interactivity to show station details on hover
- Scale mesh size based on data values with the `scale` channel
