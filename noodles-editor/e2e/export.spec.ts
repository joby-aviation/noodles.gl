// CUJ A1: a new visitor opens an example and exports a still or a video. Picks Image or
// Video from the top bar's Export menu and checks that a file arrives. Codec, framerate
// and resolution come from the Out node's Render Settings, which the test sets first.

import { readFileSync } from 'node:fs'
import { type Download, expect, type Page, test } from '@playwright/test'
import { installSavePickerAsDownload, openExample, waitForScene } from './helpers'

const EXAMPLE = 'california-earthquakes'

// Same strings as codecMap in src/render/renderer.ts, in the order the select lists them
const CODECS = [
  ['avc', 'avc1.42003e'],
  ['hevc', 'hev1.1.6.L123.00'],
  ['vp9', 'vp09.00.10.08'],
  ['av1', 'av01.0.08M.08'],
] as const

async function openForExport(page: Page) {
  await installSavePickerAsDownload(page)
  // An export error is reported with alert(); fail on it instead of letting it auto-dismiss
  page.on('dialog', dialog => {
    throw new Error(`Unexpected dialog: ${dialog.message()}`)
  })
  // openExample leaves the Out node's Render Settings open
  await openExample(page, EXAMPLE)
  await waitForScene(page)
  await expect(exportButton(page)).toBeEnabled()
}

// The top bar's Export button, not Render Settings' "Export Photo" and "Export Video". The
// icon glyphs end up in its accessible name, hence \W* around the word.
function exportButton(page: Page) {
  return page.getByRole('button', { name: /^\W*Export\W*$/ })
}

async function exportFromMenu(page: Page, item: 'Image (PNG)' | 'Video (MP4)') {
  await exportButton(page).click()
  await page.getByRole('menuitem', { name: item }).click()
}

async function downloadBytes(download: Download) {
  return readFileSync(await download.path())
}

test.describe('export', () => {
  test('exports a PNG still', async ({ page }) => {
    await openForExport(page)

    const downloadPromise = page.waitForEvent('download')
    await exportFromMenu(page, 'Image (PNG)')
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.png$/)
    const bytes = await downloadBytes(download)
    expect(bytes.length).toBeGreaterThan(1000)
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  test('exports a short MP4', async ({ page }) => {
    await openForExport(page)

    // Headless Linux Chromium often has no H.264 encoder; use whatever this browser has
    const codec = await page.evaluate(async codecs => {
      for (const [name, codec] of codecs) {
        for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
          const { supported } = await VideoEncoder.isConfigSupported({
            codec,
            width: 1280,
            height: 720,
            bitrate: 2_000_000,
            hardwareAcceleration,
          })
          if (supported) return name
        }
      }
      return null
    }, CODECS)
    test.skip(codec === null, 'this browser has no video encoder for any export codec')

    await page.locator('#render-resolution-preset').selectOption('1280x720')
    await page.locator('#render-codec').selectOption(codec as string)
    await page.locator('#render-framerate').fill('10')
    // Five frames keep the encode short; a user would drag the out marker
    await page.evaluate(() => window.__noodlesTest?.getTimelineStore().setOutPoint(0.5))

    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 })
    await exportFromMenu(page, 'Video (MP4)')
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/\.mp4$/)
    const bytes = await downloadBytes(download)
    expect(bytes.length).toBeGreaterThan(1000)
    // Every MP4 starts with an ftyp box
    expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp')
  })
})
