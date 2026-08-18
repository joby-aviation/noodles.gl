# Carto Voyager LOD evidence

This comparison holds the base resolution at 1920 × 1080 and the camera center at New York City (`-73.9857, 40.7484`). Bounds are calculated with Deck.gl's `WebMercatorViewport`. Active road-layer counts use Carto Voyager style layers whose zoom range includes the camera zoom and whose layer ID or source layer identifies roads, transportation, bridges, or tunnels.

| Case | Effective canvas | Camera zoom | Geographic bounds | Active road layers | Screenshot |
| --- | ---: | ---: | --- | ---: | --- |
| 1× LOD | 1920 × 1080 | 12 | `[-74.150495, 40.678137, -73.820905, 40.818589]` | 27 | [1× / zoom 12](./assets/render-lod-evidence/voyager-1x-z12.jpg) |
| 2× LOD | 3840 × 2160 | 12 | `[-74.315290, 40.607800, -73.656110, 40.888703]` | 27 | [2× / zoom 12](./assets/render-lod-evidence/voyager-2x-z12.jpg) |
| 2× LOD, compensated | 3840 × 2160 | 13 | `[-74.150495, 40.678137, -73.820905, 40.818589]` | 36 | [2× / zoom 13](./assets/render-lod-evidence/voyager-2x-z13.jpg) |

The 2× / zoom 12 canvas covers roughly twice the longitude and latitude span of 1× / zoom 12. Adding `log2(2) = 1` to zoom restores the original bounds, but zoom 13 activates additional Voyager road layers. That is why LOD and camera compensation cannot serve as a semantic “less map detail” control.

The checked-in values and images were captured from `https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json` on 2026-08-18. Re-run the evidence capture before relying on exact style-layer counts after Carto updates Voyager.
