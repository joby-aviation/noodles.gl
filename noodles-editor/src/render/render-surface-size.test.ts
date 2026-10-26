import { fitBounds } from '@math.gl/web-mercator'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BoundingBoxOp, MouseOp } from '../noodles/operators'
import { DEFAULT_RENDER_SETTINGS } from '../noodles/utils/render-settings-constants'
import {
  calculateRenderSurfaceSize,
  getRenderSurfaceSize,
  observeRenderSurface,
  resetRenderSurfaceSize,
  setRenderSurfaceSize,
  subscribeToRenderSurfaceSize,
  toRenderSurfacePoint,
} from './render-surface-size'

beforeEach(() => {
  resetRenderSurfaceSize()
})

describe('render surface size', () => {
  it('defaults to the fixed render resolution including LOD', () => {
    expect(getRenderSurfaceSize()).toEqual(
      calculateRenderSurfaceSize(DEFAULT_RENDER_SETTINGS.resolution, DEFAULT_RENDER_SETTINGS.lod)
    )
  })

  it('notifies subscribers of changes only, deduplicating identical and invalid sizes', () => {
    const listener = vi.fn()
    const subscription = subscribeToRenderSurfaceSize(listener)
    expect(listener).not.toHaveBeenCalled()

    setRenderSurfaceSize(getRenderSurfaceSize())
    setRenderSurfaceSize({ width: Number.NaN, height: 500 })
    setRenderSurfaceSize({ width: 1000, height: 0 })
    expect(listener).not.toHaveBeenCalled()

    setRenderSurfaceSize({ width: 1920, height: 1080 })
    expect(listener).toHaveBeenCalledOnce()
    expect(getRenderSurfaceSize()).toEqual({ width: 1920, height: 1080 })
    subscription.unsubscribe()
  })

  it.each([
    { resolution: { width: 1920, height: 1080 }, lod: 1, expected: { width: 1920, height: 1080 } },
    { resolution: { width: 1920, height: 1080 }, lod: 2, expected: { width: 3840, height: 2160 } },
    { resolution: { width: 1280, height: 720 }, lod: 1.5, expected: { width: 1920, height: 1080 } },
  ])(
    'calculates the render target for resolution $resolution at LOD $lod',
    ({ resolution, lod, expected }) => {
      expect(calculateRenderSurfaceSize(resolution, lod)).toEqual(expected)
    }
  )

  it('publishes the initial responsive size and later element resizes', () => {
    let resize: ResizeObserverCallback | undefined
    const disconnect = vi.fn()
    const createObserver = (callback: ResizeObserverCallback) => {
      resize = callback
      return { observe: vi.fn(), disconnect }
    }

    let width = 800
    let height = 600
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientWidth: { configurable: true, get: () => width },
      clientHeight: { configurable: true, get: () => height },
    })
    const listener = vi.fn()
    const stop = observeRenderSurface(element, listener, createObserver)
    expect(listener).toHaveBeenLastCalledWith({ width: 800, height: 600 })

    resize?.([], {} as ResizeObserver)
    expect(listener).toHaveBeenCalledOnce()

    width = 1200
    height = 700
    resize?.([], {} as ResizeObserver)
    expect(listener).toHaveBeenLastCalledWith({ width: 1200, height: 700 })

    width = 0
    resize?.([], {} as ResizeObserver)
    expect(listener).toHaveBeenCalledTimes(2)

    width = Number.NaN
    height = Number.POSITIVE_INFINITY
    resize?.([], {} as ResizeObserver)
    expect(listener).toHaveBeenCalledTimes(2)

    stop()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

// A 1000x500 surface laid out at `rect` on screen
function createSurface(rect: { left: number; top: number; width: number; height: number }) {
  const element = document.createElement('div')
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, get: () => 1000 },
    offsetHeight: { configurable: true, get: () => 500 },
  })
  element.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top }) as DOMRect
  return element
}

describe('toRenderSurfacePoint', () => {
  it('offsets by the surface position in responsive mode', () => {
    const element = createSurface({ left: 100, top: 50, width: 1000, height: 500 })
    expect(toRenderSurfacePoint(element, 350, 150)).toEqual({ x: 250, y: 100 })
  })

  it('removes the TransformScale factor in fixed mode', () => {
    // Scaled down to half size on screen
    const element = createSurface({ left: 100, top: 50, width: 500, height: 250 })
    expect(toRenderSurfacePoint(element, 350, 150)).toEqual({ x: 500, y: 200 })
  })
})

describe('MouseOp', () => {
  const move = (clientX: number, clientY: number) =>
    window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))

  it('reports window mouse moves in render surface pixels', () => {
    const op = new MouseOp('/mouse')
    const surface = createSurface({ left: 100, top: 50, width: 500, height: 250 })
    op.setSurface(() => surface)

    move(350, 150)
    expect(op.outputs.position.value).toEqual({ x: 500, y: 200 })
    op.dispose()
  })

  it('follows the surface when it remounts after a display mode switch', () => {
    const op = new MouseOp('/mouse')
    let surface: HTMLElement | null = null
    op.setSurface(() => surface)

    move(10, 20)
    expect(op.outputs.position.value).toEqual({ x: 0, y: 0 })

    surface = createSurface({ left: 0, top: 0, width: 1000, height: 500 })
    move(10, 20)
    expect(op.outputs.position.value).toEqual({ x: 10, y: 20 })
    op.dispose()
  })

  it('stops listening when disposed', () => {
    const op = new MouseOp('/mouse')
    const surface = createSurface({ left: 0, top: 0, width: 1000, height: 500 })
    op.setSurface(() => surface)
    const removeEventListener = vi.spyOn(window, 'removeEventListener')

    op.dispose()
    expect(removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function), false)
    removeEventListener.mockRestore()
  })
})

describe('BoundingBoxOp render size reactivity', () => {
  const data = [
    { lng: -97.3159, lat: 32.9917 },
    { lng: -96.8629, lat: 32.8517 },
  ]
  const bounds: [[number, number], [number, number]] = [
    [-97.3159, 32.8517],
    [-96.8629, 32.9917],
  ]

  it('fits to the published render size rather than the browser viewport', () => {
    setRenderSurfaceSize({ width: 1000, height: 500 })
    const operator = new BoundingBoxOp('/bbox')
    const result = operator.execute({ data, padding: 180 })
    const expected = fitBounds({ bounds, width: 1000, height: 500, padding: 180 })

    expect(result.viewState).toEqual({
      longitude: expected.longitude,
      latitude: expected.latitude,
      zoom: expected.zoom,
    })
    operator.dispose()
  })

  it('invalidates a cached result when the render size changes', async () => {
    setRenderSurfaceSize({ width: 1000, height: 500 })
    const operator = new BoundingBoxOp('/bbox')
    operator.inputs.data.setValue(data)
    operator.inputs.padding.setValue(100)
    await operator.pull()
    expect(operator.dirty).toBe(false)

    setRenderSurfaceSize(calculateRenderSurfaceSize({ width: 1000, height: 500 }, 2))
    expect(operator.dirty).toBe(true)
    const resized = await operator.pull()
    const expected = fitBounds({ bounds, width: 2000, height: 1000, padding: 100 })

    expect(resized.viewState.zoom).toBe(expected.zoom)
    expect(operator.inputs.padding.value).toBe(100)
    operator.dispose()
  })

  it('does not dirty a settled operator when the size is unchanged', async () => {
    const operator = new BoundingBoxOp('/bbox')
    await operator.pull()
    expect(operator.dirty).toBe(false)

    setRenderSurfaceSize(getRenderSurfaceSize())
    expect(operator.dirty).toBe(false)
    operator.dispose()
  })

  it('unsubscribes from render-size changes when disposed', async () => {
    const operator = new BoundingBoxOp('/bbox')
    await operator.pull()
    operator.dispose()

    setRenderSurfaceSize({ width: 1000, height: 500 })
    expect(operator.dirty).toBe(false)
  })

  it('does not expose the render size as an input', () => {
    const operator = new BoundingBoxOp('/bbox')
    expect(Object.keys(operator.inputs)).toEqual(['data', 'padding'])
    operator.dispose()
  })
})
