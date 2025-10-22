# New Project Template

## Overview
This is a blank template with only the essential nodes: a deck.gl renderer and an output node. It's the minimal starting point for any Noodles visualization, ready for you to add data sources, layers, and styling. Think of it as an empty canvas.

## Key Techniques
- **Deck renderer**: `DeckRendererOp` handles rendering deck.gl layers
- **Output**: `OutOp` connects the visualization to the Noodles display

## Node Graph Flow
```
Deck → Out
```

## Use Cases
Use this template as a starting point for:
- Custom visualization projects
- Experimenting with Noodles operators
- Learning the Noodles node-based workflow
- Building visualizations from scratch

## Next Steps
To build on this template, you can add:
- **Data sources**: `FileOp`, `DuckDbOp`, or other data operators
- **Layers**: `ScatterplotLayerOp`, `GeoJsonLayerOp`, `ArcLayerOp`, etc.
- **Accessors**: `AccessorOp` nodes to transform and extract data
- **Basemaps**: `MaplibreBasemapOp` for geographic context
- **View configuration**: `MapViewStateOp` or `OrbitViewOp` for custom camera settings
