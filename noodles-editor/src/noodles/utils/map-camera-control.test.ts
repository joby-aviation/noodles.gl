import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MapViewStateOp, NumberOp } from '../operators'
import { getOpStore, setOp } from '../store'
import {
  createCameraGestureHistory,
  extractCameraViewState,
  getCameraControlState,
  updateCameraInputs,
  wrapLongitude,
} from './map-camera-control'

describe('selected map camera control', () => {
  beforeEach(() => getOpStore().clearOps())

  it('enables one selected, editable MapViewStateOp', () => {
    const camera = new MapViewStateOp('/camera')
    setOp('/camera', camera)

    expect(getCameraControlState(['/camera'], false)).toMatchObject({
      op: camera,
      enabled: true,
      reason: null,
    })
  })

  it('ignores a selected non-camera operator', () => {
    setOp('/number', new NumberOp('/number'))
    expect(getCameraControlState(['/number'], false)).toEqual({
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

    expect(getCameraControlState(['/camera', '/second'], false).reason).toMatch(/exactly one/)

    camera.locked.next(true)
    expect(getCameraControlState(['/camera'], false).reason).toMatch(/Unlock/)
    camera.locked.next(false)

    expect(getCameraControlState(['/camera'], true).reason).toMatch(/exporting/)

    camera.inputs.longitude.addConnection('edge', new NumberOp('/source').outputs.val)
    expect(getCameraControlState(['/camera'], false).reason).toMatch(/longitude/)
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
})
