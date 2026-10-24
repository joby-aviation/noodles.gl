import { fitBounds } from '@math.gl/web-mercator'
import { type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RENDER_SETTINGS } from '../noodles/utils/render-settings-constants'
import { registerHostOperators } from '../runtime/host/host-ops'
import { HostRunner } from '../runtime/host/host-runner'
import {
  calculateRenderSurfaceSize,
  getRenderSurfaceSize,
  observeRenderSurface,
  resetRenderSurfaceSize,
  setRenderSurfaceSize,
  subscribeToRenderSurfaceSize,
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

describe('Fit Bounds render size reactivity', () => {
  // The one row DuckDB gives the fit: the data's extent
  const row = { west: -97.3159, east: -96.8629, south: 32.8517, north: 32.9917 }
  const bounds: [[number, number], [number, number]] = [
    [-97.3159, 32.8517],
    [-96.8629, 32.9917],
  ]
  const doc: EditorDoc = {
    version: 1,
    name: 'b',
    nodes: [
      { id: 'rows', op: 'sql', x: 0, y: 0, params: {} },
      { id: 'b', op: 'fit-bounds', x: 0, y: 0, params: { padding: 100 } },
    ],
    edges: [{ id: 'e', source: 'rows', sourcePort: 'out', target: 'b', targetPort: 'par:data' }],
  }
  const aggregate = vi.fn(async () => row)
  const inputs = { planner: () => undefined, slots: new Map(), time: 0, aggregate }

  // The host runner memoizes an operator by what it read; a fit reads the render surface too
  it('fits to the published render size, and refits when it changes, only then', async () => {
    registerHostOperators()
    const runner = new HostRunner()
    setRenderSurfaceSize({ width: 1000, height: 500 })
    expect((await runner.run(doc, inputs)).ran).toEqual(['b'])
    const first = fitBounds({ bounds, width: 1000, height: 500, padding: 100 })
    expect(runner.output('b', 'viewState')).toEqual({
      longitude: first.longitude,
      latitude: first.latitude,
      zoom: first.zoom,
    })
    expect((await runner.run(doc, inputs)).reused).toEqual(['b'])

    setRenderSurfaceSize(calculateRenderSurfaceSize({ width: 1000, height: 500 }, 2))
    expect((await runner.run(doc, inputs)).ran).toEqual(['b'])
    const expected = fitBounds({ bounds, width: 2000, height: 1000, padding: 100 })
    expect(runner.output('b', 'zoom')).toBe(expected.zoom)
  })

  it('does not take the render size as a parameter', () => {
    registerHostOperators()
    const params = OPERATOR_INDEX.get('fit-bounds')?.params.map(p => p.name)
    expect(params).toEqual(['data', 'position', 'padding'])
  })
})
