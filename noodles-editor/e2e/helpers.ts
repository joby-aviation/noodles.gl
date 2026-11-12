import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { DEFAULT_RENDER_SETTINGS } from '../src/noodles/utils/render-settings-constants'

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/examples')

export const EXAMPLES = readdirSync(examplesDir)
  .filter(name => existsSync(join(examplesDir, name, 'noodles.json')))
  .sort()

type TestHooks = {
  getTimelineStore: () => {
    setOutPoint: (time: number) => void
  }
  pendingWork: () => Promise<string[]>
}

declare global {
  interface Window {
    __noodlesTest?: TestHooks
  }
}

// Wait until the engine has drawn the document, deck layers are loaded and basemap tiles
// are in, and stay that way for a few polls: a single ready frame can come before the next
// load starts
export async function waitForScene(page: Page, timeout = 60_000) {
  const deadline = Date.now() + timeout
  let pending: string[] = []
  for (let streak = 0; streak < 4; ) {
    if (Date.now() > deadline) {
      throw new Error(`Scene did not settle within ${timeout}ms, waiting on: ${pending.join(', ')}`)
    }
    await page.waitForTimeout(250)
    pending = await page.evaluate(
      async () => (await window.__noodlesTest?.pendingWork()) ?? ['editor']
    )
    streak = pending.length === 0 ? streak + 1 : 0
  }
  await waitForSmoothFrames(page, timeout)
}

// Software WebGL compiles each shader program on first use, and the deck and MapLibre
// contexts share one GPU process. After the scene settles that backlog can hold the page
// under one frame a second for tens of seconds, and a screenshot or an export's frame read
// started then times out. Wait until frames arrive at a normal rate.
async function waitForSmoothFrames(page: Page, timeout: number) {
  const smooth = await page.evaluate(
    timeoutMs =>
      new Promise<boolean>(resolve => {
        // A timer too, since a stalled page may not run the next animation frame at all
        const timer = setTimeout(() => resolve(false), timeoutMs)
        let streak = 0
        let last = performance.now()
        const tick = (now: number) => {
          streak = now - last < 100 ? streak + 1 : 0
          last = now
          if (streak < 10) return requestAnimationFrame(tick)
          clearTimeout(timer)
          resolve(true)
        }
        requestAnimationFrame(tick)
      }),
    timeout
  )
  if (!smooth) throw new Error(`Frames did not return to a normal rate within ${timeout}ms`)
}

// Examples render at 1920x1080 with LOD 2, a 4K canvas that software WebGL draws too
// slowly to test. Lower the deck node's LOD in the project as it loads: changing it in the
// deck's Export settings after the map has drawn sometimes leaves the basemap drawn into one
// corner of the resized canvas.
export const TEST_LOD = 0.5

// The parts of a project file (an EditorDoc, see packages/planner/src/doc.ts) lowerLod reads
type Project = {
  nodes?: { id: string; op: string; params?: Record<string, unknown> }[]
  edges?: { target: string; targetPort: string }[]
  timeline?: { tracks?: { target: string; keyframes?: { value: unknown }[] }[] }
}

// LOD scales the map's viewport, not only its pixel density: at a quarter of the authored
// LOD the same zoom shows a quarter of the authored width. Map and orbit zoom are both log2
// scales, so lowering each literal zoom by log2 of the LOD change keeps the framing. Zoom
// that arrives over an edge (BoundingBox already fits the render surface) or from an
// expression or reference is left alone.
function lowerLod(project: Project, lod: number): Project {
  const deck = project.nodes?.find(node => node.op === 'deck')
  if (!deck) return project
  deck.params ??= {}
  const authoredLod = Number(deck.params.lod ?? DEFAULT_RENDER_SETTINGS.lod)
  deck.params.lod = lod
  const shift = Math.log2(authoredLod / lod)

  // An edge into a parameter targets `par:<name>`; a value port such as viewState its name
  const wired = new Set(project.edges?.map(edge => `${edge.target} ${edge.targetPort}`))
  const isWired = (nodeId: string, param: string) =>
    wired.has(`${nodeId} par:${param}`) || wired.has(`${nodeId} ${param}`)
  for (const node of project.nodes ?? []) {
    const params = node.params ?? {}
    // A zoom parameter (the deck's camera, a View State node) or a zoom inside a compound
    // parameter (a view's viewState)
    for (const [key, value] of Object.entries(params)) {
      if (isWired(node.id, key)) continue
      if (key === 'zoom' && typeof value === 'number') params.zoom = value - shift
      const nested = value as { zoom?: unknown } | null
      if (typeof nested?.zoom === 'number') params[key] = { ...nested, zoom: nested.zoom - shift }
    }
  }

  // Keyframed zoom: a track drives `nodeId.param`, or `nodeId.param.zoom` inside a compound
  for (const track of project.timeline?.tracks ?? []) {
    if (track.target.split('.').at(-1) !== 'zoom') continue
    for (const keyframe of track.keyframes ?? []) {
      if (typeof keyframe.value === 'number') keyframe.value -= shift
    }
  }
  return project
}

// lod: null leaves the example's own LOD, for tests that only check the canvas mounts
export async function openExample(
  page: Page,
  exampleName: string,
  { lod = TEST_LOD }: { lod?: number | null } = {}
) {
  if (lod !== null) {
    await page.route(/\/noodles[^/]*\.json(\?|$)/, async route => {
      const response = await route.fetch()
      let project: Project
      try {
        project = await response.json()
      } catch {
        // Vite also serves the file as a JS module for the examples list; leave that alone
        return route.fulfill({ response })
      }
      await route.fulfill({ response, json: lowerLod(project, lod) })
    })
  }
  await page.goto(`/examples/${exampleName}`)
  // The map canvas sits in a fixed overlay pinned over #map, not inside it
  await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 60_000 })
}

// Render settings are the deck node's Export parameters. Select the deck in the Layers
// panel's Scene section, as a user would, and wait for the Properties pane to show them.
export async function openRenderSettings(page: Page, deckName = 'deck') {
  await page.getByRole('button', { name: `${deckName} Deck`, exact: true }).click()
  await page.getByRole('button', { name: /Export$/, expanded: true }).waitFor()
  await page.getByLabel('Frame rate', { exact: true }).waitFor()
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
  // The camera toolbar (Viewport | camera, the lock) floats in the pane's top-left corner, over
  // the map when the map fills the pane's height
  const style = 'div:has(> fieldset[aria-label="Map shows"]) { visibility: hidden !important }'
  const shoot = () => page.screenshot({ clip, style, animations: 'disabled', timeout: 60_000 })

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
