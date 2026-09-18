import { fitBounds } from '@math.gl/web-mercator'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Vec2Field } from '../noodles/fields'
import { BoundingBoxOp, CombineXYOp, NumberOp } from '../noodles/operators'
import { clearOps, getOpStore, setOp } from '../noodles/store'
import { transformGraph } from '../noodles/transform-graph'
import { canConnect, canConnectCached } from '../noodles/utils/can-connect'
import { applyOperatorInputs, captureOperatorInputs } from '../noodles/utils/property-history'
import { DEFAULT_RENDER_SETTINGS } from '../noodles/utils/render-settings-constants'
import {
  isRuntimeOnlyInputEdge,
  serializeEdges,
  serializeNodes,
} from '../noodles/utils/serialization'
import {
  calculateRenderSurfaceSize,
  observeRenderSurface,
  syncBoundingBoxViewportSize,
} from './render-surface-size'

afterEach(() => {
  clearOps()
})

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

describe('BoundingBoxOp viewport integration', () => {
  const data = [
    { lng: -97.3159, lat: 32.9917 },
    { lng: -96.8629, lat: 32.8517 },
  ]

  it('is deterministic from its declared inputs', () => {
    const operator = new BoundingBoxOp('/bbox')
    const props = {
      data,
      padding: 180,
      viewportSize: { x: 1000, y: 500 },
    }
    const first = operator.execute(props)

    const second = operator.execute(props)
    const expected = fitBounds({
      bounds: [
        [-97.3159, 32.8517],
        [-96.8629, 32.9917],
      ],
      width: 1000,
      height: 500,
      padding: 180,
    })

    expect(second).toEqual(first)
    expect(second.viewState).toEqual({
      longitude: expected.longitude,
      latitude: expected.latitude,
      zoom: expected.zoom,
    })
  })

  it('uses the render-settings default when direct callers omit viewportSize', () => {
    const operator = new BoundingBoxOp('/bbox')
    const expectedSize = calculateRenderSurfaceSize(
      DEFAULT_RENDER_SETTINGS.resolution,
      DEFAULT_RENDER_SETTINGS.lod
    )
    const result = operator.execute({ data, padding: 0 } as never)
    const expected = fitBounds({
      bounds: [
        [-97.3159, 32.8517],
        [-96.8629, 32.9917],
      ],
      width: expectedSize.width,
      height: expectedSize.height,
      padding: 0,
    })

    expect(operator.inputs.viewportSize.value).toEqual({
      x: expectedSize.width,
      y: expectedSize.height,
    })
    expect(result.viewState.zoom).toBe(expected.zoom)
  })

  it('rejects invalid viewport dimensions with a clear error', () => {
    const operator = new BoundingBoxOp('/bbox')

    expect(() =>
      operator.execute({ data, padding: 0, viewportSize: { x: Number.NaN, y: 500 } })
    ).toThrow('BoundingBox viewportSize must contain positive, finite x and y values')
    expect(() => operator.execute({ data, padding: 0, viewportSize: { x: 1000, y: 0 } })).toThrow(
      'BoundingBox viewportSize must contain positive, finite x and y values'
    )
    expect(() => operator.execute({ data, padding: 0, viewportSize: null } as never)).toThrow(
      'BoundingBox viewportSize must contain positive, finite x and y values'
    )
  })

  it('syncs fixed resolution and LOD through the runtime input', async () => {
    const operator = new BoundingBoxOp('/bbox')
    const unrelated = new NumberOp('/number')
    operator.inputs.data.setValue(data)
    operator.inputs.padding.setValue(100)
    await operator.pull()
    expect(operator.dirty).toBe(false)

    const renderSize = calculateRenderSurfaceSize({ width: 1000, height: 500 }, 2)
    syncBoundingBoxViewportSize([unrelated, operator], renderSize)

    expect(operator.inputs.viewportSize.value).toEqual({ x: 2000, y: 1000 })
    expect(operator.dirty).toBe(true)
    const resized = await operator.pull()
    const expected = fitBounds({
      bounds: [
        [-97.3159, 32.8517],
        [-96.8629, 32.9917],
      ],
      width: 2000,
      height: 1000,
      padding: 100,
    })
    expect(resized.viewState.zoom).toBe(expected.zoom)
  })

  it('syncs responsive ResizeObserver measurements through the runtime input', () => {
    let resize: ResizeObserverCallback | undefined
    const createObserver = (callback: ResizeObserverCallback) => {
      resize = callback
      return { observe: vi.fn(), disconnect: vi.fn() }
    }

    let width = 800
    let height = 600
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientWidth: { configurable: true, get: () => width },
      clientHeight: { configurable: true, get: () => height },
    })
    const operator = new BoundingBoxOp('/bbox')
    const stop = observeRenderSurface(
      element,
      size => syncBoundingBoxViewportSize([operator], size),
      createObserver
    )
    expect(operator.inputs.viewportSize.value).toEqual({ x: 800, y: 600 })

    width = 1280
    height = 720
    resize?.([], {} as ResizeObserver)
    expect(operator.inputs.viewportSize.value).toEqual({ x: 1280, y: 720 })
    stop()
  })

  it('does not dirty a settled operator when the size is unchanged', async () => {
    const operator = new BoundingBoxOp('/bbox')
    await operator.pull()
    expect(operator.dirty).toBe(false)

    syncBoundingBoxViewportSize([operator], { width: 3840, height: 2160 })
    expect(operator.dirty).toBe(false)
  })

  it('ignores invalid runtime measurements', () => {
    const operator = new BoundingBoxOp('/bbox')

    syncBoundingBoxViewportSize([operator], { width: Number.NaN, height: 500 })
    syncBoundingBoxViewportSize([operator], { width: 1000, height: Number.POSITIVE_INFINITY })

    expect(operator.inputs.viewportSize.value).toEqual({ x: 3840, y: 2160 })
  })

  it('does not persist the runtime viewport size in projects or undo snapshots', () => {
    const operator = new BoundingBoxOp('/bbox')
    operator.inputs.viewportSize.setValue({ x: 1234, y: 567 })
    setOp(operator.id, operator as never)

    const nodes = [{ id: operator.id, type: 'BoundingBoxOp', data: {}, position: { x: 0, y: 0 } }]
    const runtimeEdge = {
      id: '/vec.out.xy->/bbox.par.viewportSize',
      source: '/vec',
      sourceHandle: 'out.xy',
      target: operator.id,
      targetHandle: 'par.viewportSize',
    }
    const serialized = serializeNodes(getOpStore(), nodes, [])
    const clipboard = serializeNodes(getOpStore(), nodes, [], { forClipboard: true })
    const history = JSON.parse(captureOperatorInputs() ?? '{}')
    applyOperatorInputs(JSON.stringify({ [operator.id]: { viewportSize: { x: 10, y: 10 } } }))

    expect(serialized[0].data.inputs).not.toHaveProperty('viewportSize')
    expect(clipboard[0].data.inputs).not.toHaveProperty('viewportSize')
    expect(clipboard[0].data.visibleInputs).not.toContain('viewportSize')
    expect(history[operator.id]).not.toHaveProperty('viewportSize')
    expect(operator.inputs.viewportSize.value).toEqual({ x: 1234, y: 567 })
    expect(
      serializeEdges(getOpStore(), [...nodes, { ...nodes[0], id: '/vec' }], [runtimeEdge])
    ).toEqual([])
    expect(isRuntimeOnlyInputEdge(getOpStore(), runtimeEdge)).toBe(true)
  })

  it('keeps the runtime input out of editable visibility and graph connections', () => {
    const operator = new BoundingBoxOp('/bbox')
    const source = new CombineXYOp('/vec')
    const editableTarget = new Vec2Field()

    operator.showField('viewportSize')

    expect(operator.isFieldVisible('viewportSize')).toBe(false)
    expect(operator.visibleFields.value?.has('viewportSize')).not.toBe(true)
    expect(canConnect(source.outputs.xy as never, operator.inputs.viewportSize as never)).toBe(
      false
    )
    expect(
      canConnectCached(source.outputs.xy as never, operator.inputs.viewportSize as never)
    ).toBe(false)
    operator.inputs.viewportSize.addConnection('crafted-edge', source.outputs.xy)
    expect(operator.inputs.viewportSize.subscriptions.size).toBe(0)
    expect(canConnectCached(source.outputs.xy as never, editableTarget as never)).toBe(true)
  })

  it('rejects crafted project edges targeting the runtime input', () => {
    const edgeId = '/vec.out.xy->/bbox.par.viewportSize'
    const { operators } = transformGraph({
      nodes: [
        {
          id: '/vec',
          type: 'CombineXYOp',
          position: { x: 0, y: 0 },
          data: { inputs: { x: 1, y: 1 } },
        },
        {
          id: '/bbox',
          type: 'BoundingBoxOp',
          position: { x: 200, y: 0 },
          data: { inputs: {} },
        },
      ] as never,
      edges: [
        {
          id: edgeId,
          source: '/vec',
          sourceHandle: 'out.xy',
          target: '/bbox',
          targetHandle: 'par.viewportSize',
        },
      ] as never,
    })
    const boundingBox = operators.find(
      operator => operator.id === '/bbox'
    ) as unknown as BoundingBoxOp

    expect(boundingBox.inputs.viewportSize.value).toEqual({ x: 3840, y: 2160 })
    expect(boundingBox.inputs.viewportSize.subscriptions.size).toBe(0)
    expect(boundingBox.connectionErrors.value.get(edgeId)).toBe(
      'Runtime-only inputs cannot be connected'
    )
  })

  it('ignores serialized runtime values and visibility when loading a project', () => {
    const { operators } = transformGraph({
      nodes: [
        {
          id: '/bbox',
          type: 'BoundingBoxOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: { viewportSize: { x: 1, y: 1 } },
            visibleInputs: ['padding', 'viewportSize'],
          },
        },
      ] as never,
      edges: [],
    })
    const [operator] = operators
    const expected = calculateRenderSurfaceSize(
      DEFAULT_RENDER_SETTINGS.resolution,
      DEFAULT_RENDER_SETTINGS.lod
    )

    const boundingBox = operator as unknown as BoundingBoxOp
    expect(boundingBox.inputs.viewportSize.value).toEqual({
      x: expected.width,
      y: expected.height,
    })
    expect(boundingBox.visibleFields.value).toEqual(new Set(['padding']))
  })
})
