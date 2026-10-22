// Visual regression for the examples in src/examples/. Each test opens an example,
// exports the visualization as a PNG once it stops changing and compares that against a
// baseline. Only the visualization is compared: the export holds the rendered canvas and
// nothing of the editor, so a change to the editor UI cannot fail these tests.
//
// Updating baselines: see dev-docs/testing-guide.md

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test } from '@playwright/test'
import { EXAMPLES, exportSettledImage, installSavePicker, openExample } from './helpers'

// Examples whose output a test cannot hold still or wait for
const SKIPPED: Record<string, string> = {
  chargers: 'live Open Charge Map API data changes between runs',
  'cesium-hubble': 'streams a point-cloud video from S3',
  'flight-tracks': 'queries a remote ADS-B dataset over the network',
  // These block the page for minutes in software WebGL, the only WebGL CI runners have
  'nyc-taxis': 'too heavy for software WebGL',
  'sf-elevation-contours': 'too heavy for software WebGL',
  'uk-commute': 'too heavy for software WebGL',
  'world-flights': 'too heavy for software WebGL',
}

for (const exampleName of EXAMPLES) {
  test(exampleName, async ({ page }, testInfo) => {
    test.skip(exampleName in SKIPPED, SKIPPED[exampleName])

    await installSavePicker(page)
    await openExample(page, exampleName)
    const image = await exportSettledImage(page)

    // A missing baseline is written, not failed, so CI can render the baselines for its
    // own platform. The annotation names it; the CI job warns about it.
    const baseline = testInfo.snapshotPath(`${exampleName}.png`)
    if (!existsSync(baseline)) {
      await mkdir(dirname(baseline), { recursive: true })
      await writeFile(baseline, image)
      testInfo.annotations.push({ type: 'new baseline', description: baseline })
      return
    }
    expect(image).toMatchSnapshot(`${exampleName}.png`)
  })
}
