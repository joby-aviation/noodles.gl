import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cameraControlOf, drivingCamera } from './camera-control'
import {
  cameraOf,
  navigates,
  showsCamera,
  useViewportCamera,
  viewportCamera,
} from './viewport-camera'

const node = (id: string, op: string, params: DocNode['params'] = {}) =>
  ({ id, op, x: 0, y: 0, params }) satisfies DocNode

const doc = (nodes: DocNode[], edges: EditorDoc['edges'] = []): EditorDoc => ({
  version: 1,
  name: 'camera',
  nodes,
  edges,
})

const here = { longitude: -122.4, latitude: 37.8, zoom: 9, pitch: 30, bearing: 10 }
const idle = { isRendering: false, isPlaying: false }

describe('what the map shows and moves', () => {
  it('shows the camera in camera view, while exporting, and before the viewport has moved', () => {
    expect(showsCamera({ lookThrough: true, lock: false, viewport: here }, false)).toBe(true)
    expect(showsCamera({ lookThrough: false, lock: false, viewport: here }, true)).toBe(true)
    expect(showsCamera({ lookThrough: false, lock: false }, false)).toBe(true)
    expect(showsCamera({ lookThrough: false, lock: false, viewport: here }, false)).toBe(false)
  })

  it('moves the camera only when looking through it, locked, and it can be edited', () => {
    expect(navigates({ lookThrough: true, lock: true }, true)).toBe('camera')
    expect(navigates({ lookThrough: true, lock: true }, false)).toBe('viewport')
    expect(navigates({ lookThrough: true, lock: false }, true)).toBe('viewport')
    expect(navigates({ lookThrough: false, lock: true }, true)).toBe('viewport')
  })

  it('reads a camera from a view state, defaulting pitch and bearing', () => {
    expect(cameraOf({ longitude: 1, latitude: 2, zoom: 3 })).toEqual({
      longitude: 1,
      latitude: 2,
      zoom: 3,
      pitch: 0,
      bearing: 0,
    })
    expect(cameraOf({ longitude: 1, latitude: 2 })).toBeUndefined()
    expect(cameraOf(undefined)).toBeUndefined()
  })
})

describe('the active camera', () => {
  it('is the deck, or the View State wired into it, whatever is selected', () => {
    expect(drivingCamera(doc([node('map', 'deck')]))).toBe('map')
    const wired = doc(
      [node('map', 'deck'), node('shot', 'view-state')],
      [{ id: 'v', source: 'shot', sourcePort: 'viewState', target: 'map', targetPort: 'viewState' }]
    )
    expect(drivingCamera(wired)).toBe('shot')
    expect(cameraControlOf(wired, idle)).toEqual({ nodeId: 'shot', enabled: true, reason: null })
  })

  it('says what drives a camera the map cannot move', () => {
    const fitted = doc(
      [node('map', 'deck'), node('fit', 'fit-bounds')],
      [{ id: 'v', source: 'fit', sourcePort: 'viewState', target: 'map', targetPort: 'viewState' }]
    )
    expect(cameraControlOf(fitted, idle).reason).toBe(
      "fit drives the camera, so the map can't move it."
    )
    const expr = doc([node('map', 'deck', { zoom: { expr: '4 + T' } })])
    expect(cameraControlOf(expr, idle)).toMatchObject({
      enabled: false,
      reason: expect.stringContaining('zoom'),
    })
    expect(cameraControlOf(doc([node('map', 'deck')]), { ...idle, isPlaying: true }).enabled).toBe(
      false
    )
  })
})

describe('the viewport store', () => {
  beforeEach(() => {
    localStorage.removeItem('noodles-viewport')
    useViewportCamera.setState({
      project: undefined,
      lookThrough: true,
      lock: false,
      viewport: undefined,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('starts a project in camera view, and leaves it at the camera when the viewport never moved', () => {
    viewportCamera().open('quakes')
    expect(viewportCamera()).toMatchObject({ lookThrough: true, lock: false, viewport: undefined })
    viewportCamera().setLookThrough(false, here)
    expect(viewportCamera()).toMatchObject({ lookThrough: false, viewport: here })
  })

  it('locking looks through the camera, and leaving camera view keeps the lock', () => {
    viewportCamera().open('quakes')
    viewportCamera().setLookThrough(false, here)
    viewportCamera().setLock(true)
    expect(viewportCamera()).toMatchObject({ lookThrough: true, lock: true })
    viewportCamera().setLookThrough(false)
    expect(viewportCamera()).toMatchObject({ lookThrough: false, lock: true })
  })

  it('keeps each project’s viewport in this browser', () => {
    vi.useFakeTimers()
    viewportCamera().open('quakes')
    viewportCamera().setLookThrough(false, here)
    vi.advanceTimersByTime(400)
    viewportCamera().open('taxis')
    expect(viewportCamera()).toMatchObject({ lookThrough: true, viewport: undefined })
    viewportCamera().open('quakes')
    expect(viewportCamera()).toMatchObject({ lookThrough: false, viewport: here })
  })
})
