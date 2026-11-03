# Cesium + Hubble Video Spheres

## Overview
This example combines a Cesium 3D point cloud of lower Manhattan with video-textured spheres placed at locations across Manhattan. The camera animates through the scene over a 19-second timeline, visiting each performance location.

## Key Techniques
- **3D point cloud**: `Tile3DLayerOp` with the Cesium ion provider renders a photorealistic point cloud of NYC
- **Inline mesh generation**: A `CodeOp` generates a UV sphere as a loaders.gl-format mesh (no external geometry file needed)
- **Video textures**: The `CodeOp` returns one `SimpleMeshLayer` per sphere, each using a `<video>` element as its texture for live playback on the sphere
- **Animated camera**: The `MaplibreBasemapOp` view state (longitude, latitude, zoom, pitch, bearing) is keyframed in the timeline for a cinematic flythrough

## Data
Eleven street performance videos and one still image, listed in the `CodeOp` with a position and radius for each sphere. The videos load from remote URLs.
