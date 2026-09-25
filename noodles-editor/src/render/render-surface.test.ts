import { fitBounds } from '@math.gl/web-mercator'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publishEnvironment, readEnvironment, resetEnvironment } from '../noodles/environment'
import { BoundingBoxOp } from '../noodles/operators'
import {
  calculateRenderSurfaceSize,
  observeRenderSurface,
  observeRenderSurfacePointer,
  toRenderSurfacePoint,
} from './render-surface'

beforeEach(() => {
  resetEnvironment()
})

function createSurface(rect: { left: number; top: number; width: number; height: number }) {
  const element = document.createElement('div')
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, get: () => 1000 },
    offsetHeight: { configurable: true, get: () => 500 },
  })
  element.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top }) as DOMRect
  return element
}

describe('render surface size', () => {
  it.each([
    { resolution: { width: 1920, height: 1080 }, lod: 1, expected: { width: 1920, height: 1080 } },
    { resolution: { width: 1920, height: 1080 }, lod: 2, expected: { width: 3840, height: 2160 } },
    { resolution: { width: 1280, height: 720 }, lod: 1.5, expected: { width: 1920, height: 1080 } },
  ])('calculates the render target for resolution $resolution at LOD $lod', ({
    resolution,
    lod,
    expected,
  }) => {
    expect(calculateRenderSurfaceSize(resolution, lod)).toEqual(expected)
  })

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

describe('render surface pointer', () => {
  it('converts client coordinates to surface pixels', () => {
    const element = createSurface({ left: 100, top: 50, width: 1000, height: 500 })
    expect(toRenderSurfacePoint(element, 350, 150)).toEqual({ x: 250, y: 100 })
  })

  it('removes the TransformScale factor in fixed mode', () => {
    // A 1000x500 surface scaled down to half size on screen
    const element = createSurface({ left: 100, top: 50, width: 500, height: 250 })
    expect(toRenderSurfacePoint(element, 350, 150)).toEqual({ x: 500, y: 200 })
  })

  it('reports window mouse moves until stopped', () => {
    const element = createSurface({ left: 0, top: 0, width: 1000, height: 500 })
    const target = new EventTarget() as Window
    const listener = vi.fn()
    const stop = observeRenderSurfacePointer(() => element, listener, target)

    target.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 20 }))
    expect(listener).toHaveBeenLastCalledWith({ x: 10, y: 20 })

    stop()
    target.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 40 }))
    expect(listener).toHaveBeenCalledOnce()
  })

  it('ignores moves before the surface mounts', () => {
    const target = new EventTarget() as Window
    const listener = vi.fn()
    const stop = observeRenderSurfacePointer(() => null, listener, target)
    target.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 20 }))
    expect(listener).not.toHaveBeenCalled()
    stop()
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
    publishEnvironment('renderSurface', { width: 1000, height: 500 })
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
    publishEnvironment('renderSurface', { width: 1000, height: 500 })
    const operator = new BoundingBoxOp('/bbox')
    operator.inputs.data.setValue(data)
    operator.inputs.padding.setValue(100)
    await operator.pull()
    expect(operator.dirty).toBe(false)

    publishEnvironment('renderSurface', calculateRenderSurfaceSize({ width: 1000, height: 500 }, 2))
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

    publishEnvironment('renderSurface', { ...readEnvironment('renderSurface') })
    expect(operator.dirty).toBe(false)
    operator.dispose()
  })

  it('unsubscribes from render-size changes when disposed', async () => {
    const operator = new BoundingBoxOp('/bbox')
    await operator.pull()
    operator.dispose()

    publishEnvironment('renderSurface', { width: 1000, height: 500 })
    expect(operator.dirty).toBe(false)
  })

  it('does not expose the render size as an input', () => {
    const operator = new BoundingBoxOp('/bbox')
    expect(Object.keys(operator.inputs)).toEqual(['data', 'padding'])
    expect(BoundingBoxOp.environment).toEqual(['renderSurface'])
    operator.dispose()
  })
})
