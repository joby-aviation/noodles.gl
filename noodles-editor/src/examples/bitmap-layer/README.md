# BitmapLayer — San Francisco Districts

Reimplements deck.gl's canonical BitmapLayer example as a four-node Noodles graph. The bitmap uses deck.gl's San Francisco districts image and geographic bounds, rendered over a Carto Voyager basemap.

The image is deliberately bundled with the project and referenced as `@/sf-districts.png`. This exercises the project-asset path fixed by PR #619; replacing it with the upstream HTTPS URL would not cover that behavior.

Source: [deck.gl BitmapLayer documentation](https://deck.gl/docs/api-reference/layers/bitmap-layer)

## Manual verification

1. Open the **BitmapLayer — San Francisco Districts** example.
2. Confirm the colored district raster covers San Francisco and aligns with the underlying streets and coastline.
3. Select **BitmapLayer** and confirm its image is `@/sf-districts.png`.
4. Change opacity and confirm the local bitmap updates without an asset-loading error.
5. Save the example as a project, reload it, and confirm the bitmap still renders.
