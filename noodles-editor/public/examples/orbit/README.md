# Orbit View 3D Scene

## Overview
This example sets up a minimal 3D scene with an orbit camera (no geographic map) for viewing 3D models or objects. Instead of a map basemap, it uses a solid blue background and an orbit view that lets you rotate around the scene. This is the starting point for any non-geographic 3D visualization like product viewers, molecular structures, or CAD models.

## Key Techniques
- **Orbit view**: `OrbitViewOp` with `clear: true`, `clearColor: "#2997ffff"`, and `fovy: 50`
- **Deck renderer**: `DeckRendererOp` with `basemap: null` for no map tiles
- **Scenegraph layer**: `ScenegraphLayerOp` with `sizeMinPixels: 10` and `getColor: "#ffffffff"`
- **Data**: `ExpressionOp` with `[null]` provides minimal data

## Node Graph Flow
```
Expression → Scenegraph Layer → Deck → Out
OrbitView → Deck
```

## Use Cases
This pattern is useful for:
- 3D model visualization
- CAD/BIM model viewing
- Point cloud rendering
- Molecular or scientific 3D data
- Product visualization
- Game asset preview
- Any non-geographic 3D content
- VR/AR previews

## Next Steps
To extend this example:
- Add actual 3D model data via `FileOp` (GLB, OBJ formats)
- Use multiple `ScenegraphLayerOp` instances for complex scenes
- Add lighting with material properties
- Animate models using timeline features
- Add other 3D layers like `PointCloudLayerOp` or `MeshLayerOp`
