# Orbit View 3D Scene

## Overview
This example sets up a minimal 3D scene with an orbit camera (no geographic map) for viewing 3D models or objects. Instead of a map basemap, it uses a solid blue background and an orbit view that lets you rotate around the scene. This is the starting point for any non-geographic 3D visualization like product viewers, molecular structures, or CAD models.

## Nodes
- **`dummy-data`** (Generate) makes one row (`count: 1`) so the layer has something to draw
- **`scene`** (Scenegraph Layer) draws the deck.gl airplane glTF model at `position: "[0.0, 0.0, 0.0]"` with `modelColor: [255, 255, 255]` and `sizeMinPixels: 10`
- **`camera`** (OrbitView) sets `clear: true`, `clearColor: "#2997ffff"` and `fovy: 50`, wired into the deck's `views`
- **`deck`** (Deck) has `basemap: "none"`, so no map tiles are drawn

## Pipeline
```
dummy-data → scene → deck
camera → deck (views)
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
- Point `scene`'s `scenegraph` param at your own glTF/GLB model URL
- Use multiple Scenegraph Layer nodes for complex scenes
- Add lighting with material properties
- Animate models using timeline features
- Add other 3D layers like Point Cloud Layer or Simple Mesh Layer
