import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/examples')

export const EXAMPLES = readdirSync(examplesDir)
  .filter(name => existsSync(join(examplesDir, name, 'noodles.json')))
  .sort()

// Examples render at 1920x1080 with LOD 2, a 4K canvas that software WebGL draws too
// slowly to test. Lower the LOD from the Out node's render settings, as a user would.
const TEST_LOD = 0.5

type ImageSize = { width: number; height: number }

export async function openExample(page: Page, exampleName: string) {
  await page.goto(`/examples/${exampleName}`)
  await openRenderSettings(page)
  await setTestLod(page)
}

async function openRenderSettings(page: Page) {
  // The Out node can sit outside the graph viewport, where a real click cannot reach it
  const outNode = page.locator('.react-flow__node[data-id="/out"]')
  await outNode.waitFor({ timeout: 60_000 })
  await outNode.dispatchEvent('click')
}

async function setTestLod(page: Page) {
  await page.locator('#render-lod').fill(String(TEST_LOD))
}

// The size an export should have at the test LOD, from the Out node's resolution
async function expectedSize(page: Page): Promise<ImageSize> {
  const width = Number(await page.locator('#render-resolution-width').inputValue())
  const height = Number(await page.locator('#render-resolution-height').inputValue())
  return { width: Math.round(width * TEST_LOD), height: Math.round(height * TEST_LOD) }
}

// Width and height from the PNG's IHDR chunk
function pngSize(png: Buffer): ImageSize {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

// The Export menu's Image (PNG) saves through showSaveFilePicker, a native dialog
// Playwright cannot drive. This stand-in hands the bytes the app writes back as a
// browser download. Call before the page loads.
export function installSavePicker(page: Page) {
  return page.addInitScript(() => {
    window.showSaveFilePicker = (async ({ suggestedName = 'image.png' } = {}) => {
      const parts: Blob[] = []
      return {
        kind: 'file',
        name: suggestedName,
        // The app reads the type to pick the image format
        getFile: async () => new File([], suggestedName, { type: 'image/png' }),
        createWritable: async () => ({
          write: async (data: Blob) => void parts.push(data),
          close: async () => {
            const link = document.createElement('a')
            link.href = URL.createObjectURL(new Blob(parts, { type: 'image/png' }))
            link.download = suggestedName
            link.click()
          },
        }),
      }
    }) as unknown as typeof window.showSaveFilePicker
  })
}

// The visualization exactly as Export > Image (PNG) saves it: the map or deck canvas at
// the render resolution, without any editor UI around or over it
export async function exportImage(page: Page): Promise<Buffer> {
  const download = page.waitForEvent('download')
  // The top bar's Export menu. Its name also holds the icon glyphs.
  await page.getByRole('button', { name: /^\W*Export\W*$/ }).click()
  await page.getByRole('menuitem', { name: /image \(png\)/i }).click()
  return readFile(await (await download).path())
}

// Exports until the image stops changing: basemap tiles, data files and deck layers load
// at their own pace, and nothing outside the app says when all of them are done. Waits
// for the network to go quiet first, so a blank canvas before the data arrives does not
// count as settled.
export async function exportSettledImage(
  page: Page,
  { timeout = 150_000, interval = 2_000 } = {}
): Promise<Buffer> {
  const deadline = Date.now() + timeout
  await page.waitForLoadState('networkidle', { timeout })
  let previous: Buffer | null = null
  let reason = 'no export finished'
  while (Date.now() < deadline) {
    const next = await exportImage(page)
    const size = pngSize(next)
    const expected = await expectedSize(page)
    if (size.width !== expected.width || size.height !== expected.height) {
      // A project that finishes loading after the LOD was set puts its own LOD back
      reason = `the export was ${size.width}x${size.height}, not ${expected.width}x${expected.height}`
      await openRenderSettings(page)
      await setTestLod(page)
      previous = null
    } else if (previous?.equals(next)) {
      return next
    } else {
      reason = 'the image was still changing'
      previous = next
    }
    await page.waitForTimeout(interval)
  }
  throw new Error(`The export did not settle within ${timeout / 1000}s: ${reason}`)
}
