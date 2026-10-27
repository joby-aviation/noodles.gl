import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cameraControlOf, drivingCamera } from './camera-control'
import {
  cameraOf,
  navigates,
  playheadShowsCamera,
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

  it('moves the camera only in a locked camera view that can be edited', () => {
    expect(navigates({ lookThrough: true, lock: true }, true)).toBe('camera')
    // A locked camera view that can't move holds still rather than leaving for the viewport
    expect(navigates({ lookThrough: true, lock: true }, false)).toBe('none')
    expect(navigates({ lookThrough: true, lock: false }, true)).toBe('viewport')
    expect(navigates({ lookThrough: false, lock: true }, true)).toBe('viewport')
  })

  it('goes back to the camera when the playhead moves, unless the viewport is locked', () => {
    expect(playheadShowsCamera({ lookThrough: false, lock: false })).toBe(true)
    expect(playheadShowsCamera({ lookThrough: false, lock: true })).toBe(false)
    expect(playheadShowsCamera({ lookThrough: true, lock: false })).toBe(false)
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

describe('a Switch Value of cameras', () => {
  // Two View States into a switch, the switch into the deck
  const shots = (switchParams: DocNode['params'], timeline?: EditorDoc['timeline']) => ({
    ...doc(
      [
        node('map', 'deck'),
        node('sf', 'view-state'),
        node('ny', 'view-state'),
        node('shots', 'switch-value', switchParams),
      ],
      [
        {
          id: 'a',
          source: 'sf',
          sourcePort: 'viewState',
          target: 'shots',
          targetPort: 'par:values',
          index: 0,
        },
        {
          id: 'b',
          source: 'ny',
          sourcePort: 'viewState',
          target: 'shots',
          targetPort: 'par:values',
          index: 1,
        },
        { id: 'c', source: 'shots', sourcePort: 'value', target: 'map', targetPort: 'viewState' },
      ]
    ),
    timeline,
  })

  it('makes the View State its Index picks the active camera', () => {
    expect(drivingCamera(shots({ index: 0 }))).toBe('sf')
    expect(drivingCamera(shots({ index: 1 }))).toBe('ny')
  })

  it('follows a keyframed Index at the playhead', () => {
    const timeline = {
      tracks: [
        {
          target: 'shots.index',
          keyframes: [
            { id: 'k0', time: 0, value: 0, interpolation: 'hold' },
            { id: 'k1', time: 2, value: 1, interpolation: 'hold' },
          ],
        },
      ],
    } as unknown as EditorDoc['timeline']
    expect(drivingCamera(shots({}, timeline), 1)).toBe('sf')
    expect(drivingCamera(shots({}, timeline), 3)).toBe('ny')
  })

  it('has no one camera to move while blending between two', () => {
    const between = shots({ index: 0.5, blend: true })
    expect(drivingCamera(between)).toBeNull()
    expect(cameraControlOf(between, idle).reason).toBe(
      "shots isn't on one View State here, so the map can't move a camera."
    )
    expect(drivingCamera(shots({ index: 0.5 }))).toBe('sf')
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

  it('the lock pins the view it is in, and stays when switching views', () => {
    viewportCamera().open('quakes')
    viewportCamera().setLookThrough(false, here)
    viewportCamera().setLock(true)
    expect(viewportCamera()).toMatchObject({ lookThrough: false, lock: true })
    viewportCamera().setLookThrough(true)
    expect(viewportCamera()).toMatchObject({ lookThrough: true, lock: true })
  })

  it('keeps each project’s viewport while the page is open, and stores none for a reload', () => {
    viewportCamera().open('quakes')
    viewportCamera().setLookThrough(false, here)
    viewportCamera().open('taxis')
    expect(viewportCamera()).toMatchObject({ lookThrough: true, viewport: undefined })
    viewportCamera().open('quakes')
    expect(viewportCamera()).toMatchObject({ lookThrough: false, viewport: here })
    // Nothing outlives the page: a reload starts at the project's camera
    expect(localStorage.getItem('noodles-viewport')).toBeNull()
  })
})

describe('switching projects quickly', () => {
  beforeEach(() => {
    localStorage.removeItem('noodles-viewport')
    useViewportCamera.setState({
      project: undefined,
      lookThrough: true,
      lock: false,
      viewport: undefined,
    })
  })

  it('keeps the last view of a project left before its save was due', () => {
    vi.useFakeTimers()
    viewportCamera().open('examples:quakes')
    viewportCamera().setLookThrough(false, here)
    viewportCamera().open('examples:taxis')
    viewportCamera().setViewport({ ...here, zoom: 3 })
    viewportCamera().open('examples:quakes')
    expect(viewportCamera().viewport).toEqual(here)
    vi.useRealTimers()
  })
})
