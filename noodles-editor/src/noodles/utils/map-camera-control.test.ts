import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CodeOp,
  ContainerOp,
  DeckRendererOp,
  GraphInputOp,
  GraphOutputOp,
  MaplibreBasemapOp,
  MapViewStateOp,
  NumberOp,
  OutOp,
  RerouteOp,
} from '../operators'
import { getOpStore, setOp } from '../store'
import {
  createCameraGestureHistory,
  extractCameraViewState,
  findViewCameraOpId,
  type GraphEdge,
  getCameraControlState,
  updateCameraInputs,
  useCameraControlState,
  wrapLongitude,
} from './map-camera-control'

function edge(source: string, sourceHandle: string, target: string, targetHandle: string) {
  return { source, sourceHandle, target, targetHandle }
}

// /camera -> /basemap -> /deck -> /out, the layout most projects use
function wireView(): GraphEdge[] {
  setOp('/out', new OutOp('/out'))
  setOp('/deck', new DeckRendererOp('/deck'))
  setOp('/basemap', new MaplibreBasemapOp('/basemap'))
  return [
    edge('/deck', 'out.vis', '/out', 'par.vis'),
    edge('/basemap', 'out.maplibre', '/deck', 'par.basemap'),
    edge('/camera', 'out.viewState', '/basemap', 'par.viewState'),
  ]
}

// /scene/camera -> /scene/output -> /scene.out.out -> /basemap, with the boundary edge
// a new container gets
function wireContainerCamera(inner: GraphEdge[] = []): GraphEdge[] {
  setOp('/scene', new ContainerOp('/scene'))
  setOp('/scene/output', new GraphOutputOp('/scene/output'))
  return [
    edge('/scene', 'out.out', '/basemap', 'par.viewState'),
    edge('/scene/output', 'out.propagatedValue', '/scene', 'out.out'),
    ...(inner.length > 0
      ? inner
      : [edge('/scene/camera', 'out.viewState', '/scene/output', 'par.value')]),
  ]
}

function context(
  edges: GraphEdge[],
  overrides: { isRendering?: boolean; isPlaying?: boolean } = {}
) {
  return { edges, isRendering: false, isPlaying: false, ...overrides }
}

describe('selected map camera control', () => {
  beforeEach(() => getOpStore().clearOps())

  it('enables one selected, editable MapViewStateOp', () => {
    const camera = new MapViewStateOp('/camera')
    setOp('/camera', camera)

    expect(getCameraControlState(['/camera'], context(wireView()))).toMatchObject({
      op: camera,
      enabled: true,
      reason: null,
    })
  })

  it('ignores a selected non-camera operator', () => {
    setOp('/number', new NumberOp('/number'))
    expect(getCameraControlState(['/number'], context([]))).toEqual({
      op: null,
      enabled: false,
      reason: null,
    })
  })

  it('explains multiple selection, locked nodes, exports, and connected fields', () => {
    const camera = new MapViewStateOp('/camera')
    const second = new MapViewStateOp('/second')
    setOp('/camera', camera)
    setOp('/second', second)
    const edges = wireView()

    expect(getCameraControlState(['/camera', '/second'], context(edges)).reason).toMatch(
      /exactly one/
    )

    camera.locked.next(true)
    expect(getCameraControlState(['/camera'], context(edges)).reason).toMatch(/Unlock/)
    camera.locked.next(false)

    expect(
      getCameraControlState(['/camera'], context(edges, { isRendering: true })).reason
    ).toMatch(/exporting/)

    expect(getCameraControlState(['/camera'], context(edges, { isPlaying: true }))).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/Pause the timeline/),
    })

    const connected = [...edges, edge('/source', 'out.val', '/camera', 'par.longitude')]
    expect(getCameraControlState(['/camera'], context(connected)).reason).toMatch(
      /Disconnect camera inputs.*longitude/
    )
  })

  it('treats expression-driven camera inputs as driven', () => {
    const camera = new MapViewStateOp('/camera')
    setOp('/camera', camera)
    const edges = wireView()

    camera.inputs.zoom.setExpression('4')
    expect(getCameraControlState(['/camera'], context(edges))).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/expressions.*zoom/),
    })
    expect(updateCameraInputs(camera, { longitude: 1, latitude: 2, zoom: 10 })).toBe(false)
    expect(camera.inputs.zoom.expression).toBe('4')

    camera.inputs.zoom.clearExpression()
    expect(getCameraControlState(['/camera'], context(edges)).enabled).toBe(true)
  })

  it('disables a MapViewStateOp that does not drive the visible map', () => {
    setOp('/camera', new MapViewStateOp('/camera'))
    setOp('/second', new MapViewStateOp('/second'))
    const edges = wireView()

    const state = getCameraControlState(['/second'], context(edges))
    expect(state.enabled).toBe(false)
    expect(state.reason).toMatch(/does not drive the visible map/)
  })

  it('enables a camera inside a container that drives the map', () => {
    const camera = new MapViewStateOp('/scene/camera')
    setOp('/scene/camera', camera)
    const edges = [...wireView().filter(e => e.target !== '/basemap'), ...wireContainerCamera()]

    expect(getCameraControlState(['/scene/camera'], context(edges))).toMatchObject({
      op: camera,
      enabled: true,
      reason: null,
    })
  })

  describe('useCameraControlState', () => {
    afterEach(cleanup)

    it('updates when the selected camera is locked or an input gets an expression', () => {
      const camera = new MapViewStateOp('/camera')
      setOp('/camera', camera)
      const edges = wireView()
      const { result } = renderHook(() => useCameraControlState(['/camera'], context(edges)))
      expect(result.current.enabled).toBe(true)

      act(() => camera.locked.next(true))
      expect(result.current.reason).toMatch(/Unlock/)
      act(() => camera.locked.next(false))
      expect(result.current.enabled).toBe(true)

      act(() => camera.inputs.pitch.setExpression('10'))
      expect(result.current.reason).toMatch(/expressions.*pitch/)
      act(() => camera.inputs.pitch.clearExpression())
      expect(result.current.enabled).toBe(true)
    })
  })

  describe('findViewCameraOpId', () => {
    beforeEach(() => {
      setOp('/camera', new MapViewStateOp('/camera'))
      setOp('/other', new MapViewStateOp('/other'))
    })

    it('follows the basemap viewState to the camera', () => {
      expect(findViewCameraOpId(wireView())).toBe('/camera')
    })

    it('finds a camera connected to the renderer viewState', () => {
      const edges = wireView().filter(e => e.target !== '/basemap')
      edges.push(edge('/camera', 'out.viewState', '/deck', 'par.viewState'))
      expect(findViewCameraOpId(edges)).toBe('/camera')
    })

    it('prefers the renderer viewState over the basemap camera', () => {
      const edges = [...wireView(), edge('/other', 'out.viewState', '/deck', 'par.viewState')]
      expect(findViewCameraOpId(edges)).toBe('/other')
    })

    it('follows Reroute pass-throughs', () => {
      setOp('/reroute', new RerouteOp('/reroute'))
      const edges = wireView().filter(e => e.target !== '/basemap')
      edges.push(
        edge('/camera', 'out.viewState', '/reroute', 'par.value'),
        edge('/reroute', 'out.value', '/basemap', 'par.viewState')
      )
      expect(findViewCameraOpId(edges)).toBe('/camera')
    })

    it('returns null when the camera is transformed before the renderer', () => {
      setOp('/transform', new CodeOp('/transform'))
      const edges = wireView().filter(e => e.target !== '/basemap')
      edges.push(
        edge('/camera', 'out.viewState', '/transform', 'par.data'),
        edge('/transform', 'out.data', '/basemap', 'par.viewState')
      )
      expect(findViewCameraOpId(edges)).toBeNull()
    })

    it('follows a camera out of a container through its GraphOutputOp', () => {
      setOp('/scene/camera', new MapViewStateOp('/scene/camera'))
      const edges = [...wireView().filter(e => e.target !== '/basemap'), ...wireContainerCamera()]
      expect(findViewCameraOpId(edges)).toBe('/scene/camera')
    })

    it('follows a camera into a container through its GraphInputOp', () => {
      setOp('/scene/input', new GraphInputOp('/scene/input'))
      const edges = [
        ...wireView().filter(e => e.target !== '/basemap'),
        ...wireContainerCamera([
          edge('/scene/input', 'out.value', '/scene/output', 'par.value'),
          edge('/scene', 'par.in', '/scene/input', 'par.parentValue'),
        ]),
        edge('/camera', 'out.viewState', '/scene', 'par.in'),
      ]
      expect(findViewCameraOpId(edges)).toBe('/camera')
    })

    it('returns null when a container transforms the camera', () => {
      setOp('/scene/camera', new MapViewStateOp('/scene/camera'))
      setOp('/scene/transform', new CodeOp('/scene/transform'))
      const edges = [
        ...wireView().filter(e => e.target !== '/basemap'),
        ...wireContainerCamera([
          edge('/scene/camera', 'out.viewState', '/scene/transform', 'par.data'),
          edge('/scene/transform', 'out.data', '/scene/output', 'par.value'),
        ]),
      ]
      expect(findViewCameraOpId(edges)).toBeNull()
    })

    it('returns null for a container without a GraphOutputOp', () => {
      setOp('/scene/camera', new MapViewStateOp('/scene/camera'))
      const edges = [...wireView().filter(e => e.target !== '/basemap'), ...wireContainerCamera()]
      getOpStore().deleteOp('/scene/output')
      expect(findViewCameraOpId(edges)).toBeNull()
    })

    it('returns null when nothing reaches the output', () => {
      expect(findViewCameraOpId([])).toBeNull()
      expect(findViewCameraOpId(wireView().filter(e => e.target !== '/out'))).toBeNull()
    })

    it('returns null when renderer or basemap values override the camera', () => {
      const edges = wireView()
      const deck = getOpStore().getOp('/deck') as DeckRendererOp
      deck.inputs.viewState.setValue({ zoom: 4 })
      expect(findViewCameraOpId(edges)).toBeNull()
      deck.inputs.viewState.setValue({})

      const basemap = getOpStore().getOp('/basemap') as MaplibreBasemapOp
      basemap.inputs.viewState.fields.zoom.setExpression('4')
      expect(findViewCameraOpId(edges)).toBeNull()
      basemap.inputs.viewState.fields.zoom.clearExpression()

      expect(
        findViewCameraOpId([...edges, edge('/n', 'out.val', '/basemap', 'par.viewState.zoom')])
      ).toBeNull()
      expect(findViewCameraOpId(edges)).toBe('/camera')
    })
  })

  it('extracts camera state from direct and keyed Deck view states', () => {
    const state = { longitude: 1, latitude: 2, zoom: 3, pitch: 4, bearing: 5 }
    expect(extractCameraViewState(state)).toEqual(state)
    expect(extractCameraViewState({ map: state })).toEqual(state)
    expect(extractCameraViewState({ nope: true })).toBeNull()
  })

  it('writes all camera fields and refuses connected fields', () => {
    const camera = new MapViewStateOp('/camera')
    const state = { longitude: 1, latitude: 2, zoom: 3, pitch: 4, bearing: 5 }

    expect(updateCameraInputs(camera, state)).toBe(true)
    expect(camera.data).toMatchObject(state)

    camera.inputs.zoom.addConnection('edge', new NumberOp('/source').outputs.val)
    expect(updateCameraInputs(camera, { ...state, zoom: 10 })).toBe(false)
    expect(camera.inputs.zoom.value).toBe(0)
  })

  it('wraps longitudes from panning across the antimeridian', () => {
    expect(wrapLongitude(180)).toBe(180)
    expect(wrapLongitude(-180)).toBe(-180)
    expect(wrapLongitude(190)).toBe(-170)
    expect(wrapLongitude(-190)).toBe(170)
    expect(wrapLongitude(540)).toBe(-180)

    const camera = new MapViewStateOp('/camera')
    expect(updateCameraInputs(camera, { longitude: 200, latitude: 2, zoom: 3 })).toBe(true)
    expect(camera.inputs.longitude.value).toBe(-160)
  })

  it('only writes camera fields whose values changed', () => {
    const camera = new MapViewStateOp('/camera')
    const state = { longitude: 1, latitude: 2, zoom: 3, pitch: 4, bearing: 5 }
    updateCameraInputs(camera, state)

    const zoomSpy = vi.spyOn(camera.inputs.zoom, 'setValue')
    const longitudeSpy = vi.spyOn(camera.inputs.longitude, 'setValue')
    updateCameraInputs(camera, { ...state, longitude: 10 })

    expect(longitudeSpy).toHaveBeenCalledWith(10)
    expect(zoomSpy).not.toHaveBeenCalled()
  })

  it('commits one history entry for a gesture with many updates', () => {
    let captureCount = 0
    const commits: string[] = []
    const history = createCameraGestureHistory(
      () => `before-${++captureCount}`,
      before => commits.push(before)
    )

    history.begin()
    history.begin()
    history.begin()
    history.finish()
    history.finish()

    expect(captureCount).toBe(1)
    expect(commits).toEqual(['before-1'])
  })

  it('starts a fresh snapshot after a deck gesture is cut off', () => {
    let captureCount = 0
    const commits: string[] = []
    const history = createCameraGestureHistory(
      () => `before-${++captureCount}`,
      before => commits.push(before)
    )

    history.setInteracting(true)
    history.setInteracting(true)
    // Camera control turned off mid-drag, so deck never reports the gesture ending
    history.finish()
    expect(commits).toEqual(['before-1'])

    history.setInteracting(true)
    history.setInteracting(false)
    expect(commits).toEqual(['before-1', 'before-2'])
  })
})
