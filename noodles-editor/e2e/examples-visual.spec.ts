// Visual regression for every example in src/examples/. Each test opens the example,
// waits for the scene to settle and compares the rendered map against a baseline.
//
// Update baselines: see e2e/README.md

import { expect, test } from '@playwright/test'
import { EXAMPLES, openExample, screenshotMap, waitForScene } from './helpers'

// These only have to mount a canvas. Some load data that changes between runs, so a
// baseline would fail on content rather than on a regression. Others draw enough geometry
// that software WebGL (CI has no GPU) cannot settle them in time; on a GPU they settle in
// a few seconds.
const MOUNT_ONLY: Record<string, string> = {
  chargers: 'live Open Charge Map API data',
  'cesium-hubble': 'streams a point-cloud video from S3',
  'nyc-taxis': 'too heavy for software WebGL',
  'sf-elevation-contours': 'too heavy for software WebGL',
  'uk-commute': 'too heavy for software WebGL',
  'world-flights': 'too heavy for software WebGL',
}

// Deck text layers draw labels with a system font, which differs between macOS and Linux
// (about 2% of pixels for geojson-example's station names)
const MAX_DIFF_PIXEL_RATIO: Record<string, number> = {
  'geojson-example': 0.03,
}

test.describe('examples', () => {
  for (const exampleName of EXAMPLES) {
    test(exampleName, async ({ page }) => {
      await openExample(page, exampleName)

      if (MOUNT_ONLY[exampleName]) {
        test.info().annotations.push({ type: 'mount only', description: MOUNT_ONLY[exampleName] })
        return
      }

      await waitForScene(page)
      const screenshot = await screenshotMap(page)
      const maxDiffPixelRatio = MAX_DIFF_PIXEL_RATIO[exampleName]
      expect(screenshot).toMatchSnapshot(
        `${exampleName}.png`,
        maxDiffPixelRatio === undefined ? {} : { maxDiffPixelRatio }
      )
    })
  }
})
