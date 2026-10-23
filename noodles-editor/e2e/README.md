# End-to-end tests

Playwright tests that drive the editor in Chromium. Vitest ignores this folder; the unit
and browser tests live next to the code in `src/`.

- `examples-visual.spec.ts`: opens every example in `src/examples/`, waits for the scene to
  settle and compares the rendered map (no editor UI) against a baseline in `__snapshots__/`.
- `export.spec.ts`: CUJ A1. Opens an example, picks Image and Video from the top bar's
  Export menu, and checks that a PNG and an MP4 arrive. The video test
  skips when the browser has no encoder for any export codec.
  Both run again without `showSaveFilePicker`, through the download fallback Firefox and Safari use.

## Running

From `noodles-editor/`:

```bash
npm run test:e2e
```

```bash
npx playwright test examples-visual -g california-earthquakes
```

Playwright starts the Vite dev server, or reuses one already on port 5173. Set
`PLAYWRIGHT_BASE_URL` to test a running deployment instead.

## How a test knows the scene is ready

The editor exposes `window.__noodlesTest` (see `src/timeline-editor.tsx`):

- `pendingWork()` lists what is still loading: dirty or running operators, a basemap
  that has not reached MapLibre's `idle` event since its last render, deck layers. `waitForScene()` in `helpers.ts` waits for it to stay empty, and
  names what it was still waiting on if it times out.
- `getTimelineStore()` sets the out point so the video export stays short.

Tests lower the Out node's LOD to 0.5 in the project file as it loads. The examples
render a 4K canvas by default, which software WebGL draws too slowly, and changing the LOD
in Render Settings after the map has drawn sometimes leaves the basemap drawn into one
corner of the resized canvas.

LOD sets the size of the map's viewport, not only its pixel density, so at a quarter of
the authored LOD the same zoom would show a quarter of the authored width. `openExample`
lowers every literal zoom in the project, keyframes included, by log2 of the LOD change,
which keeps each example's bounds. Zoom that comes over an edge is left alone. Marks sized
in pixels, such as labels, still draw larger relative to the map than at the authored LOD.
`orbit` keeps its own LOD (`AUTHORED_LOD` in `examples-visual.spec.ts`): OrbitView's zoom
input stops at 0, below what orbit would need.

## Baselines

Every test renders with SwiftShader (software WebGL), the only WebGL on CI runners. It
draws the same on macOS and Linux to within 0.2% of pixels, under the 1% tolerance in
`playwright.config.ts`, so one set of baselines serves both. The exception is deck text
layers, which draw with a system font: `geojson-example` and `us-state-population` allow 5%
for their labels.

Update the baselines with:

```bash
npx playwright test examples-visual --update-snapshots
```

Look at every changed image before committing it, and say in the PR why each one changed.
If CI still disagrees, the `playwright-report` artifact of the failed run has the images
CI rendered (`test-results/*/*-actual.png`).

Some examples only have to mount a canvas (`MOUNT_ONLY` in `examples-visual.spec.ts`):
`chargers` and `cesium-hubble` load data that changes between runs, and `nyc-taxis`,
`sf-elevation-contours`, `uk-commute` and `world-flights` draw more geometry than software
WebGL can settle in time.

The download in the export tests comes from a stand-in for `showSaveFilePicker`, which
opens a native dialog Playwright cannot drive. It hands the bytes the app writes back as a
browser download (`installSavePickerAsDownload` in `helpers.ts`).
