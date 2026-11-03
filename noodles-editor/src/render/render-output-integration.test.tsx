import { cleanup, render, waitFor } from '@testing-library/react'
import type { Map as MapLibre } from 'maplibre-gl'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TimelineEditor from '../timeline-editor'
import { captureScreenshot } from './renderer'

const harness = vi.hoisted(() => ({
  hostSize: { width: 500, height: 280 },
  settings: {
    display: 'fixed' as 'fixed' | 'responsive',
    resolution: { width: 320, height: 180 },
    lod: 1,
    scaleMode: 'fit' as const,
    waitForData: false,
    codec: 'avc' as const,
    bitrateMbps: 10,
    bitrateMode: 'constant' as const,
    scaleControl: 0.3,
    framerate: 30,
    captureDelay: 0,
    rendersDirectory: 'renders',
  },
  visualization: {
    deckProps: {
      layers: [],
      viewState: { longitude: 0, latitude: 0, zoom: 0 },
    },
    mapProps: undefined as Record<string, unknown> | undefined,
  },
}))

vi.mock('../layout', async () => {
  const { createElement } = await import('react')
  return {
    Layout: ({ children }: { children?: ReactNode }) =>
      createElement(
        'div',
        {
          'data-testid': 'render-host',
          style: {
            position: 'relative',
            width: `${harness.hostSize.width}px`,
            height: `${harness.hostSize.height}px`,
          },
        },
        children
      ),
  }
})

// The document editor's visualization: this scene's props and render settings, with no
// document, so the engine never starts
vi.mock('../editor/doc-noodles', () => ({
  useDocNoodles: () => ({
    projectName: 'render-output-integration',
    deckProps: harness.visualization.deckProps,
    mapProps: harness.visualization.mapProps,
    renderSettings: harness.settings,
    selectedNodeIds: [],
    onSaveProject: async () => {},
    onNewProject: async () => {},
    onImport: async () => {},
    undoRedoRef: { current: null },
    copyControlsRef: { current: null },
    reactFlowRef: { current: null },
  }),
}))

vi.mock('../noodles/components/top-menu-bar', () => ({ TopMenuBar: () => null }))
vi.mock('../noodles/components/spreadsheet-pane/spreadsheet-pane', () => ({
  SpreadsheetPane: () => null,
}))
vi.mock('../noodles/components/tools/map-tool-layer', () => ({ MapToolLayer: () => null }))
vi.mock('../timeline/components/TimelinePanel', () => ({ TimelinePanel: () => null }))

const EMPTY_MAP_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background' as const,
      paint: { 'background-color': '#000000' },
    },
  ],
}

type Size = { width: number; height: number }

async function expectCanvasAndCapturedPng(
  container: HTMLElement,
  selector: string,
  expected: Size
) {
  let canvas: HTMLCanvasElement | null = null
  await waitFor(
    () => {
      canvas = container.querySelector<HTMLCanvasElement>(selector)
      expect(canvas).not.toBeNull()
      expect({ width: canvas!.width, height: canvas!.height }).toEqual(expected)
    },
    { timeout: 10_000 }
  )
  expect(canvas!.getContext('webgl2') ?? canvas!.getContext('webgl')).not.toBeNull()

  let writtenBlob: Blob | undefined
  const pickerSpy = vi.spyOn(window, 'showSaveFilePicker').mockResolvedValue({
    getFile: async () => new File([], 'render.png', { type: 'image/png' }),
    createWritable: async () => ({
      write: async (blob: Blob) => {
        writtenBlob = blob
      },
      close: async () => {},
    }),
  } as unknown as FileSystemFileHandle)

  await captureScreenshot('render', () => canvas!)

  const image = await createImageBitmap(writtenBlob!)
  expect({ width: image.width, height: image.height }).toEqual(expected)
  image.close()
  pickerSpy.mockRestore()
}

describe('production render output dimensions', () => {
  beforeEach(() => {
    vi.useRealTimers()
    harness.hostSize = { width: 500, height: 280 }
    harness.settings.display = 'fixed'
    harness.settings.resolution = { width: 320, height: 180 }
    harness.settings.lod = 1
    harness.visualization.mapProps = undefined
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useFakeTimers({ now: new Date('2025-02-01T00:00:00Z') })
  })

  it.each([
    {
      name: 'pure Deck at fixed LOD 1',
      selector: '#deckgl-overlay',
      basemap: false,
      display: 'fixed' as const,
      lod: 1,
      expected: { width: 320, height: 180 },
    },
    {
      name: 'pure Deck at fixed LOD 2',
      selector: '#deckgl-overlay',
      basemap: false,
      display: 'fixed' as const,
      lod: 2,
      expected: { width: 640, height: 360 },
    },
    {
      name: 'pure Deck in responsive mode',
      selector: '#deckgl-overlay',
      basemap: false,
      display: 'responsive' as const,
      lod: 2,
      expected: { width: 500, height: 280 },
    },
    {
      name: 'MapLibre at fixed LOD 1',
      selector: '.maplibregl-canvas',
      basemap: true,
      display: 'fixed' as const,
      lod: 1,
      expected: { width: 320, height: 180 },
    },
    {
      name: 'MapLibre at fixed LOD 2',
      selector: '.maplibregl-canvas',
      basemap: true,
      display: 'fixed' as const,
      lod: 2,
      expected: { width: 640, height: 360 },
    },
    {
      name: 'MapLibre in responsive mode',
      selector: '.maplibregl-canvas',
      basemap: true,
      display: 'responsive' as const,
      lod: 2,
      expected: { width: 500, height: 280 },
    },
  ])('keeps $name canvas and captured PNG dimensions correct', async testCase => {
    // MapLibre intentionally uses DPR (and its WebGL size cap), so the browser
    // characterization runs in the DPR-1 context configured in vitest.config.ts.
    expect(window.devicePixelRatio).toBe(1)
    harness.settings.display = testCase.display
    harness.settings.lod = testCase.lod

    if (testCase.basemap) {
      harness.visualization.mapProps = {
        mapStyle: EMPTY_MAP_STYLE,
        longitude: 0,
        latitude: 0,
        zoom: 0,
      }
    }

    const view = render(<TimelineEditor />)
    await expectCanvasAndCapturedPng(view.container, testCase.selector, testCase.expected)
  })
})

describe('basemap size after render size changes', () => {
  beforeEach(() => {
    vi.useRealTimers()
    harness.hostSize = { width: 500, height: 280 }
    harness.settings.display = 'fixed'
    harness.settings.resolution = { width: 320, height: 180 }
    harness.settings.lod = 2
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    harness.settings.lod = 1
    harness.visualization.mapProps = undefined
    vi.useFakeTimers({ now: new Date('2025-02-01T00:00:00Z') })
  })

  it('resizes the map in the same commit as an LOD change, and not on other renders', async () => {
    let map: MapLibre | null = null
    harness.visualization.mapProps = {
      mapStyle: EMPTY_MAP_STYLE,
      longitude: 0,
      latitude: 0,
      zoom: 0,
      onRender: ({ target }: { target: MapLibre }) => {
        map = target
      },
    }

    const view = render(<TimelineEditor />)
    await waitFor(() => expect(map?.loaded()).toBe(true), { timeout: 10_000 })
    const canvas = map!.getCanvas()
    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 640, height: 360 })
    const resize = vi.spyOn(map!, 'resize')

    // Nothing about the render size changed
    view.rerender(<TimelineEditor />)
    expect(resize).not.toHaveBeenCalled()

    harness.settings.lod = 0.5
    view.rerender(<TimelineEditor />)
    // Checked before MapLibre's own ResizeObserver or the next frame can run
    expect(resize).toHaveBeenCalledTimes(1)
    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 160, height: 90 })
  })

  it("keeps MapLibre's default label fade outside preview exports", async () => {
    let map: MapLibre | null = null
    harness.visualization.mapProps = {
      mapStyle: EMPTY_MAP_STYLE,
      longitude: 0,
      latitude: 0,
      zoom: 0,
      onRender: ({ target }: { target: MapLibre }) => {
        map = target
      },
    }

    render(<TimelineEditor />)
    await waitFor(() => expect(map?.loaded()).toBe(true), { timeout: 10_000 })
    // An explicit fadeDuration: undefined replaced the default, so labels never settled
    // @ts-expect-error _fadeDuration is private
    expect(map!._fadeDuration).toBe(300)
  })
})
