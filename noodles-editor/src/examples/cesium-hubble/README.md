# Cesium + Hubble Video Spheres

## Overview
This example combines a Cesium 3D point cloud of lower Manhattan with video-textured spheres placed at locations across Manhattan. The camera animates through the scene over a 19-second timeline, visiting each performance location.

## Nodes
- **`point-cloud`** (Tile 3D Layer) renders the photorealistic NYC point cloud with `provider: "Cesium"` and `flatLighting: true`
- **`video-spheres`** (`CodeOp`, a host operator) builds a UV sphere mesh in code (no external geometry file) and returns one `SimpleMeshLayer` per sphere, each textured with a `<video>` element for live playback
- **`renderer`** (Deck) holds the Carto Positron basemap and the camera; its `longitude`, `latitude`, `zoom`, `pitch` and `bearing` are keyframed on the timeline (8 keyframes each) for a flythrough

## Pipeline
```
point-cloud   → renderer (layers)
video-spheres → renderer (layers)
```

## Data
Eleven street performance videos and one still image, listed in `video-spheres` with a position and radius for each sphere. The videos load from remote URLs.
