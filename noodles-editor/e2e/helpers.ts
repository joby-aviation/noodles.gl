import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/examples')

export const EXAMPLES = readdirSync(examplesDir)
  .filter(name => existsSync(join(examplesDir, name, 'noodles.json')))
  .sort()

type TestHooks = {
  getTimelineStore: () => {
    setOutPoint: (time: number) => void
  }
  pendingWork: () => string[]
}

declare global {
  interface Window {
    __noodlesTest?: TestHooks
  }
}

// Wait until operators are idle, deck layers are loaded and basemap tiles are in, and
// stay that way for a few polls: a single ready frame can come before the next load starts
export async function waitForScene(page: Page, timeout = 60_000) {
  try {
    await page.waitForFunction(
      () => {
        const w = window as Window & { __readyStreak?: number }
        const pending = w.__noodlesTest?.pendingWork() ?? ['editor']
        w.__readyStreak = pending.length === 0 ? (w.__readyStreak ?? 0) + 1 : 0
        return w.__readyStreak >= 4
      },
      undefined,
      { timeout, polling: 250 }
    )
  } catch (error) {
    const pending = await page.evaluate(() => window.__noodlesTest?.pendingWork() ?? ['editor'])
    throw new Error(`Scene did not settle within ${timeout}ms, waiting on: ${pending.join(', ')}`, {
      cause: error,
    })
  }
}

// Examples render at 1920x1080 with LOD 2, a 4K canvas that software WebGL draws too
// slowly to test. Lower the Out node's LOD in the project as it loads: changing it in
// Render Settings after the map has drawn sometimes leaves the basemap drawn into one
// corner of the resized canvas.
export const TEST_LOD = 0.5

// lod: null leaves the example's own LOD, for tests that only check the canvas mounts
export async function openExample(
  page: Page,
  exampleName: string,
  { lod = TEST_LOD }: { lod?: number | null } = {}
) {
  if (lod !== null) {
    await page.route(/\/noodles[^/]*\.json(\?|$)/, async route => {
      const response = await route.fetch()
      let project: { nodes?: { type: string; data: { inputs?: object } }[] }
      try {
        project = await response.json()
      } catch {
        // Vite also serves the file as a JS module for the examples list; leave that alone
        return route.fulfill({ response })
      }
      for (const node of project.nodes ?? []) {
        if (node.type === 'OutOp') node.data.inputs = { ...node.data.inputs, lod }
      }
      await route.fulfill({ response, json: project })
    })
  }
  await page.goto(`/examples/${exampleName}`)
  // The map canvas sits in a fixed overlay pinned over #map, not inside it
  await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 60_000 })
}

export async function openRenderSettings(page: Page) {
  // The Out node can sit outside the graph viewport, where a real click cannot reach it
  await page.locator('.react-flow__node[data-id="/out"]').dispatchEvent('click')
  await page.getByRole('button', { name: 'Export Photo' }).waitFor()
}

// The rendered map only: the output canvas is letterboxed inside the #map pane, and the
// pane's edges hold editor UI such as the sidebar toggle. One page screenshot rather than
// toHaveScreenshot, which first waits for two quick animation frames that a CI runner
// drawing software WebGL may not produce.
export async function screenshotMap(page: Page) {
  const output = await page
    .locator('.transform-scale', { has: page.locator('canvas') })
    .first()
    .boundingBox()
  const pane = await page.locator('#map').boundingBox()
  if (!output || !pane) throw new Error('The map output has no layout box')
  // Intersect with the pane, then round inward so no pixel outside the map is included
  const left = Math.ceil(Math.max(output.x, pane.x))
  const top = Math.ceil(Math.max(output.y, pane.y))
  const right = Math.floor(Math.min(output.x + output.width, pane.x + pane.width))
  const bottom = Math.floor(Math.min(output.y + output.height, pane.y + pane.height))
  const clip = { x: left, y: top, width: right - left, height: bottom - top }
  const shoot = () => page.screenshot({ clip, animations: 'disabled', timeout: 60_000 })

  // pendingWork() can report idle a beat before the last basemap tiles are drawn, so also
  // wait for two identical captures a second apart
  const deadline = Date.now() + 30_000
  let previous = await shoot()
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000)
    const current = await shoot()
    if (current.equals(previous)) return current
    previous = current
  }
  return previous
}

// The export buttons save through showSaveFilePicker, a native dialog Playwright cannot
// drive. This stand-in keeps everything the app writes and hands it back as a download,
// so a test sees the same bytes a user would find on disk.
export function installSavePickerAsDownload(page: Page) {
  return page.addInitScript(() => {
    type PickerOptions = {
      suggestedName?: string
      types?: { accept: Record<string, string[]> }[]
    }

    window.showSaveFilePicker = (async ({ suggestedName = 'file', types = [] }: PickerOptions) => {
      const [mimeType = '', extensions = []] = Object.entries(types[0]?.accept ?? {})[0] ?? []
      const name = /\.[a-z0-9]+$/i.test(suggestedName)
        ? suggestedName
        : `${suggestedName}${extensions[0] ?? ''}`

      let bytes = new Uint8Array(0)
      let cursor = 0
      const writeAt = (data: Uint8Array, position: number) => {
        if (position + data.length > bytes.length) {
          const grown = new Uint8Array(position + data.length)
          grown.set(bytes)
          bytes = grown
        }
        bytes.set(data, position)
        cursor = position + data.length
      }
      const toBytes = async (data: unknown) => {
        if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
        if (ArrayBuffer.isView(data)) {
          return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        }
        if (data instanceof ArrayBuffer) return new Uint8Array(data)
        return new TextEncoder().encode(String(data))
      }

      class FakeWritable extends WritableStream {
        constructor() {
          super({
            async write(chunk) {
              // Blobs have a type too, so only plain objects are write/seek/truncate commands
              if (chunk?.constructor === Object) {
                if (chunk.type === 'seek') cursor = chunk.position
                else if (chunk.type === 'truncate') bytes = bytes.slice(0, chunk.size)
                else writeAt(await toBytes(chunk.data), chunk.position ?? cursor)
              } else {
                writeAt(await toBytes(chunk), cursor)
              }
            },
            close() {
              const link = document.createElement('a')
              link.href = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
              link.download = name
              document.body.append(link)
              link.click()
              link.remove()
            },
          })
        }

        async write(data: unknown) {
          const writer = this.getWriter()
          await writer.write(data)
          writer.releaseLock()
        }
      }

      return {
        kind: 'file',
        name,
        getFile: async () => new File([], name, { type: mimeType }),
        createWritable: async () => new FakeWritable(),
      }
    }) as unknown as typeof window.showSaveFilePicker
  })
}

// Firefox and Safari have no showSaveFilePicker, and the export buttons fall back to an
// <a download> link. Removing it before the app loads takes Chromium down that path.
export function removeSavePicker(page: Page) {
  return page.addInitScript(() => {
    // The app checks 'showSaveFilePicker' in window, so setting it to undefined is not enough
    delete (window as Partial<Window>).showSaveFilePicker
  })
}
