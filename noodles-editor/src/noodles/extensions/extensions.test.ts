// Renders the custom shader extensions on a real WebGL device to catch shader
// compilation and uniform regressions when upgrading deck.gl / luma.gl
import { Deck, type Layer, type LayerExtension, OrthographicView } from '@deck.gl/core'
import { SolidPolygonLayer } from '@deck.gl/layers'
import { brightnessContrast, hueSaturation, vibrance } from '@luma.gl/effects'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { colorFill } from './color-fill'
import { FilterColorExtension } from './filter-color-extension'
import { Mask3DExtension } from './mask-3d-extension'

const SIZE = 100
const RED = [255, 0, 0] as [number, number, number]

let deck: Deck<OrthographicView> | null = null
let canvas: HTMLCanvasElement | null = null

// Deck's render loop needs real requestAnimationFrame and timers
beforeAll(() => {
  vi.useRealTimers()
})

function cleanup() {
  deck?.finalize()
  canvas?.remove()
  deck = null
  canvas = null
}

afterEach(cleanup)

// Render a red square covering the viewport and return a pixel reader.
// OrthographicView at zoom 0 maps 1 world unit to 1 pixel, centered on [0, 0].
async function render(extensions: LayerExtension[], extensionProps: Record<string, unknown> = {}) {
  cleanup()
  canvas = document.createElement('canvas')
  canvas.style.width = `${SIZE}px`
  canvas.style.height = `${SIZE}px`
  document.body.appendChild(canvas)

  const errors: Error[] = []
  const layer = new SolidPolygonLayer({
    id: 'square',
    data: [
      [
        [-SIZE, -SIZE],
        [SIZE, -SIZE],
        [SIZE, SIZE],
        [-SIZE, SIZE],
      ],
    ],
    getPolygon: d => d,
    getFillColor: RED,
    extensions,
    ...extensionProps,
  }) as Layer

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Deck did not render')), 10000)
    deck = new Deck({
      canvas,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      views: new OrthographicView(),
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      layers: [layer],
      onError: error => {
        errors.push(error)
      },
      onAfterRender: () => {
        if (layer.isLoaded || errors.length) {
          clearTimeout(timeout)
          resolve()
        }
      },
    })
  })

  expect(errors).toEqual([])

  const readCanvas = document.createElement('canvas')
  readCanvas.width = SIZE
  readCanvas.height = SIZE
  const ctx = readCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !canvas) throw new Error('Missing canvas')
  ctx.drawImage(canvas, 0, 0, SIZE, SIZE)
  return (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
}

describe('shader extensions', () => {
  it('renders the unmodified layer', async () => {
    const pixel = await render([])
    expect(pixel(50, 50)).toEqual([255, 0, 0, 255])
  })

  it('FilterColorExtension(colorFill) replaces the layer color', async () => {
    const pixel = await render([new FilterColorExtension(colorFill)], {
      colorFill: { fill: [0, 0, 1, 1] },
    })
    expect(pixel(50, 50)).toEqual([0, 0, 255, 255])
  })

  it('FilterColorExtension(brightnessContrast) brightens the layer', async () => {
    const pixel = await render([new FilterColorExtension(brightnessContrast)], {
      brightnessContrast: { brightness: 1, contrast: 0 },
    })
    const [r, g, b] = pixel(50, 50)
    expect(r).toBe(255)
    expect(g).toBeGreaterThan(200)
    expect(b).toBeGreaterThan(200)
  })

  it('FilterColorExtension(hueSaturation) desaturates the layer', async () => {
    const pixel = await render([new FilterColorExtension(hueSaturation)], {
      hueSaturation: { hue: 0, saturation: -1 },
    })
    const [r, g, b] = pixel(50, 50)
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2)
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2)
  })

  it('FilterColorExtension(vibrance) compiles and renders', async () => {
    const pixel = await render([new FilterColorExtension(vibrance)], {
      vibrance: { amount: 0.5 },
    })
    expect(pixel(50, 50)[3]).toBe(255)
  })

  describe('Mask3DExtension', () => {
    const mask = (innerRadius: number) =>
      render([new Mask3DExtension()], { targetPosition: [0, 0, 0], innerRadius, fadeRange: 1 })

    it('discards everything with a small radius', async () => {
      const pixel = await mask(10)
      expect(pixel(50, 50)[3]).toBe(0)
    })

    it('keeps the center and discards the edges with a medium radius', async () => {
      const pixel = await mask(40)
      expect(pixel(50, 50)).toEqual([255, 0, 0, 255])
      expect(pixel(0, 50)[3]).toBe(0)
      expect(pixel(99, 50)[3]).toBe(0)
    })

    it('keeps everything with a large radius', async () => {
      const pixel = await mask(10000)
      expect(pixel(0, 50)).toEqual([255, 0, 0, 255])
    })
  })
})
