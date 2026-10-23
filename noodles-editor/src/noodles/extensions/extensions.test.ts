// Renders the custom shader extensions on a real WebGL device to catch shader
// compilation and uniform regressions when upgrading deck.gl / luma.gl
import {
  CompositeLayer,
  Deck,
  type Layer,
  type LayerExtension,
  OrthographicView,
} from '@deck.gl/core'
import { SolidPolygonLayer } from '@deck.gl/layers'
import { brightnessContrast, hueSaturation, vibrance } from '@luma.gl/effects'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { colorFill } from './color-fill'
import { FilterColorExtension } from './filter-color-extension'
import { Mask3DExtension } from './mask-3d-extension'

const SIZE = 100
const RED = [255, 0, 0] as [number, number, number]

// Mimics Tile3DLayer, which only forwards extension props listed in defaultProps
class WrapperLayer extends CompositeLayer<Record<string, unknown>> {
  static layerName = 'WrapperLayer'
  renderLayers() {
    return new SolidPolygonLayer(
      this.getSubLayerProps({
        id: 'polygons',
        data: this.props.data,
        getPolygon: this.props.getPolygon,
        getFillColor: this.props.getFillColor,
      })
    )
  }
}

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
async function render(
  extensions: LayerExtension[],
  extensionProps: Record<string, unknown> = {},
  { composite = false } = {}
) {
  cleanup()
  canvas = document.createElement('canvas')
  // Size the drawing buffer up front, otherwise it stays at the 300x150 default
  canvas.width = SIZE
  canvas.height = SIZE
  canvas.style.width = `${SIZE}px`
  canvas.style.height = `${SIZE}px`
  document.body.appendChild(canvas)

  const errors: Error[] = []
  const LayerClass = composite ? WrapperLayer : SolidPolygonLayer
  const layer = new LayerClass({
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
    // Pixel (x, y) maps to world (x - 50, y - 50); OrthographicView flips y by default
    const mask = (props: Record<string, unknown>, options?: { composite?: boolean }) =>
      render([new Mask3DExtension()], { fadeRange: 0, ...props }, options)

    it('keeps a sphere centered on the target', async () => {
      const pixel = await mask({ targetPosition: [0, 0, 0], innerRadius: 20 })
      expect(pixel(50, 50)).toEqual([255, 0, 0, 255])
      expect(pixel(62, 50)).toEqual([255, 0, 0, 255])
      expect(pixel(50, 62)).toEqual([255, 0, 0, 255])
      expect(pixel(78, 50)[3]).toBe(0)
      expect(pixel(22, 50)[3]).toBe(0)
      expect(pixel(50, 78)[3]).toBe(0)
      expect(pixel(50, 22)[3]).toBe(0)
    })

    it('follows an offset target', async () => {
      const pixel = await mask({ targetPosition: [30, 20, 0], innerRadius: 10 })
      expect(pixel(80, 70)).toEqual([255, 0, 0, 255])
      expect(pixel(50, 50)[3]).toBe(0)
      expect(pixel(80, 30)[3]).toBe(0)
    })

    it('fades to white beyond the inner radius', async () => {
      const pixel = await mask({ targetPosition: [0, 0, 0], innerRadius: 10, fadeRange: 20 })
      expect(pixel(50, 50)).toEqual([255, 0, 0, 255])
      const [r, g, b, a] = pixel(70, 50)
      expect([r, a]).toEqual([255, 255])
      expect(g).toBeGreaterThan(50)
      expect(b).toBeGreaterThan(50)
      expect(pixel(90, 50)[3]).toBe(0)
    })

    it('applies to sublayers of composite layers', async () => {
      const pixel = await mask({ targetPosition: [0, 0, 0], innerRadius: 20 }, { composite: true })
      expect(pixel(50, 50)).toEqual([255, 0, 0, 255])
      expect(pixel(90, 50)[3]).toBe(0)
    })
  })
})
