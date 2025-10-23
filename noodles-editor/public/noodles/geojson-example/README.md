# GeoJSON BART Stations

_Adapted from [Deck.gl examples](https://deck.gl/docs/api-reference/layers/path-layer)_

## Overview
This example visualizes the BART transit system using a single GeoJSON layer that contains multiple geometry types: station points with text labels showing station names, rail route lines colored by their route ID (blue, orange, etc.), and polygon features. The GeoJSON layer automatically handles each geometry type differently while maintaining consistent styling through accessor functions.

## Key Techniques
- **Data source**: `FileOp` loads GeoJSON from URL
- **GeoJSON layer**: `GeoJsonLayerOp` with `pointType: "circle+text"` for labeled points
- **Fill color**: `ColorOp` with static color `#A0A0B4C8` (RGB: 160, 160, 180, Alpha: 200) sets uniform fill
- **Line color**: `AccessorOp` with expression `d.properties.color || '#000'` uses feature properties
- **Text labels**: `AccessorOp` with expression `d.properties.name` displays station names
- **Styling**: `getPointRadius: 4`, `getLineWidth: 20`, `extruded: true`, `getElevation: 30`
- **Basemap**: `MaplibreBasemapOp` with positron style

## Data Structure
The GeoJSON file contains features with:
- Geometry types: Point (stations), MultiLineString (rail routes), and Polygon
- Properties:
  - `name`: Station name or route name (e.g., "DUBL-DALY (ROUTE 11/12)")
  - `color`: Hex color for rail routes (e.g., "#00aeef")

## Node Graph Flow
```
Data → GeoJSON Layer → Deck → Out
     ↘ Fill Color Accessor ↗
     ↘ Line Color Accessor ↗
     ↘ Text Accessor ↗
```

## Use Cases
This pattern is useful for:
- Transit system visualization
- Infrastructure mapping
- Any GeoJSON data with mixed geometry types
- Features requiring labels
- Property-driven styling
- Municipal or regional datasets with predefined colors
