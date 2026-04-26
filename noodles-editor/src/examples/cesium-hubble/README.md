# Cesium + Hubble Video Spheres

## Overview
This example combines a Cesium 3D point cloud of lower Manhattan with video-textured spheres placed at street musician locations across NYC. The camera animates through the scene over a 19-second timeline, visiting each performance location.

## Key Techniques
- **3D point cloud**: `Tile3DLayerOp` with the Cesium ion provider renders a photorealistic point cloud of NYC
- **Inline mesh generation**: A `CodeOp` generates a UV sphere as a loaders.gl-format mesh (no external geometry file needed)
- **Video textures**: Each `SimpleMeshLayer` uses a `<video>` element as its texture, creating live video playback on 3D spheres
- **Animated camera**: The `MaplibreBasemapOp` view state (longitude, latitude, zoom, pitch, bearing) is keyframed in the timeline for a cinematic flythrough

## Data
Twelve street performance videos filmed in NYC neighborhoods including Lower Manhattan, Greenwich Village, Midtown, and Central Park.
