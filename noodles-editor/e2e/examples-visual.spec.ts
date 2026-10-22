// Visual regression for every example in src/examples/. Each test opens the example,
// waits for the scene to settle and compares the map pane against a baseline.
//
// Update baselines: see e2e/README.md

import { expect, test } from '@playwright/test'
import { EXAMPLES, openExample, waitForScene } from './helpers'

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

test.describe('examples', () => {
  for (const exampleName of EXAMPLES) {
    test(exampleName, async ({ page }) => {
      await openExample(page, exampleName)

      if (MOUNT_ONLY[exampleName]) {
        test.info().annotations.push({ type: 'mount only', description: MOUNT_ONLY[exampleName] })
        return
      }

      await waitForScene(page)
      await expect(page.locator('#map')).toHaveScreenshot(`${exampleName}.png`)
    })
  }
})
