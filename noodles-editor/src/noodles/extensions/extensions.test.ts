// Renders the custom shader extensions on a real WebGL device to catch shader
// compilation and uniform regressions when upgrading deck.gl / luma.gl
import {
  COORDINATE_SYSTEM,
  CompositeLayer,
  Deck,
  type DeckProps,
  type Layer,
  type LayerExtension,
  MapView,
  type MapViewState,
  OrthographicView,
  type WebMercatorViewport,
} from '@deck.gl/core'
import { SolidPolygonLayer } from '@deck.gl/layers'
import { brightnessContrast, hueSaturation, vibrance } from '@luma.gl/effects'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

type Views = OrthographicView | MapView

let deck: Deck<Views> | null = null
let canvas: HTMLCanvasElement | null = null
let onRender: (() => void) | null = null

// Deck's render loop needs real requestAnimationFrame and timers
beforeAll(() => {
  vi.useRealTimers()
})

function cleanup() {
  deck?.finalize()
  canvas?.remove()
  deck = null
  canvas = null
  onRender = null
}

afterEach(cleanup)

// Resolve on the first render after `update`, once `layer` has loaded
function nextRender(layer: Layer, errors: Error[], update: () => void) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Deck did not render')), 10000)
    onRender = () => {
      if (layer.isLoaded || errors.length) {
        clearTimeout(timeout)
        onRender = null
        resolve()
      }
    }
    update()
  })
}

function readPixels() {
  const readCanvas = document.createElement('canvas')
  readCanvas.width = SIZE
  readCanvas.height = SIZE
  const ctx = readCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !canvas) throw new Error('Missing canvas')
  ctx.drawImage(canvas, 0, 0, SIZE, SIZE)
  return (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
}

// Render `layer` on a fresh SIZE x SIZE canvas
async function renderDeck(layer: Layer, deckProps: Partial<DeckProps<Views>>) {
  cleanup()
  canvas = document.createElement('canvas')
  // Size the drawing buffer up front, otherwise it stays at the 300x150 default
  canvas.width = SIZE
  canvas.height = SIZE
  canvas.style.width = `${SIZE}px`
  canvas.style.height = `${SIZE}px`
  document.body.appendChild(canvas)

  const errors: Error[] = []
  await nextRender(layer, errors, () => {
    deck = new Deck({
      canvas,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      layers: [layer],
      onError: error => {
        errors.push(error)
      },
      onAfterRender: () => onRender?.(),
      ...deckProps,
    })
  })
  expect(errors).toEqual([])
  return errors
}

// Render a red square covering the viewport and return a pixel reader.
// OrthographicView at zoom 0 maps 1 world unit to 1 pixel, centered on [0, 0].
async function render(
  extensions: LayerExtension[],
  extensionProps: Record<string, unknown> = {},
  { composite = false } = {}
) {
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

  await renderDeck(layer, {
    views: new OrthographicView(),
    initialViewState: { target: [0, 0, 0], zoom: 0 },
  })
  return readPixels()
}

describe('shader extensions', () => {
  it('renders the unmodified layer', async () => {
    const pixel = await render([])
    expect(pixel(50, 50)).toEqual([255, 0, 0, 255])
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

    describe('in a geospatial view', () => {
      // At zoom 16 on the equator, 1 meter is about 0.84 pixels
      const VIEW_STATE: MapViewState = { longitude: 0, latitude: 0, zoom: 16 }
      const MOVED_VIEW_STATE: MapViewState = { longitude: 0.0002, latitude: -0.0001, zoom: 16 }
      const TARGET = [-0.0001, 0.00005, 0]
      const RADIUS = 30

      // Like a Tile3DLayer tile: meters around the tile's own origin, shifted by a modelMatrix
      const tile = {
        coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin: [0.0003, 0.0002, 0] as [number, number, number],
        modelMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -25, 15, 0, 1]),
        data: [
          [
            [-1000, -1000],
            [1000, -1000],
            [1000, 1000],
            [-1000, 1000],
          ],
        ],
      }
      // Plain lng/lat, where the common-space origin follows the view center at this zoom
      const lngLat = {
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        data: [
          [
            [-0.01, -0.01],
            [0.01, -0.01],
            [0.01, 0.01],
            [-0.01, 0.01],
          ],
        ],
      }

      // Check pixels at the target and at meter offsets from it, east and south
      function expectSphere() {
        const pixel = readPixels()
        const viewport = deck?.getViewports()[0] as WebMercatorViewport
        const at = (east: number, south: number) => {
          const lngLat = viewport.addMetersToLngLat(TARGET, [east, -south, 0])
          const [x, y] = viewport.project(lngLat)
          return pixel(Math.round(x), Math.round(y))
        }
        expect(at(0, 0)).toEqual([255, 0, 0, 255])
        expect(at(RADIUS - 10, 0)).toEqual([255, 0, 0, 255])
        expect(at(0, RADIUS - 10)).toEqual([255, 0, 0, 255])
        expect(at(RADIUS + 15, 0)[3]).toBe(0)
        expect(at(0, RADIUS + 15)[3]).toBe(0)
      }

      it.each([
        ['a tile sublayer', tile],
        ['a lng/lat sublayer', lngLat],
      ])(
        'keeps a sphere around a lng/lat target in %s as the view moves',
        async (_, layerProps) => {
          const layer = new WrapperLayer({
            id: 'square',
            getPolygon: (d: unknown) => d,
            getFillColor: RED,
            extensions: [new Mask3DExtension()],
            targetPosition: TARGET,
            innerRadius: RADIUS,
            fadeRange: 0,
            ...layerProps,
          }) as Layer
          const errors = await renderDeck(layer, { views: new MapView(), viewState: VIEW_STATE })
          expectSphere()

          await nextRender(layer, errors, () => deck?.setProps({ viewState: MOVED_VIEW_STATE }))
          expect(errors).toEqual([])
          expectSphere()
        }
      )
    })
  })
})
