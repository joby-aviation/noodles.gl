import { afterEach, describe, expect, it } from 'vitest'
import {
  DeckRendererOp,
  type IOperator,
  MaplibreBasemapOp,
  MapViewStateOp,
  type Operator,
  ProjectOp,
  SplitMapViewStateOp,
  UnprojectOp,
} from './operators'
import { clearOps } from './store'

describe('roll camera fields', () => {
  afterEach(() => clearOps())

  it('defaults old camera projects to zero roll', async () => {
    const camera = new MapViewStateOp('/camera')
    expect((await camera.pull()).viewState.roll).toBe(0)
    const split = new SplitMapViewStateOp('/split')
    expect(split.execute({ viewState: { longitude: 8, latitude: 47, zoom: 12 } }).roll).toBe(0)
  })

  it('propagates animated roll through camera, basemap, split, and renderer connections', async () => {
    const camera = new MapViewStateOp('/camera')
    const basemap = new MaplibreBasemapOp('/map')
    const split = new SplitMapViewStateOp('/split')
    const renderer = new DeckRendererOp('/deck')
    basemap.inputs.viewState.addConnection('camera-map', camera.outputs.viewState)
    split.inputs.viewState.addConnection('camera-split', camera.outputs.viewState)
    renderer.inputs.basemap.addConnection('map-deck', basemap.outputs.maplibre)
    for (const [source, target] of [
      [camera, basemap],
      [camera, split],
      [basemap, renderer],
    ]) {
      // The base Operator type is invariant across concrete field schemas.
      source.addDownstreamDependent(target as unknown as Operator<IOperator>)
      target.addUpstreamDependency(source as unknown as Operator<IOperator>)
    }
    for (const roll of [32, -24, 0]) {
      camera.inputs.roll.setValue(roll)
      await camera.pull()
      await basemap.pull()
      expect((await split.pull()).roll).toBe(roll)
      expect(await renderer.pull()).toMatchObject({
        vis: { mapProps: { roll }, deckProps: { viewState: { roll } } },
      })
    }
  })

  it('lets explicit renderer roll override basemap roll, including resetting to zero', () => {
    const renderer = new DeckRendererOp('/deck')
    expect(
      renderer.execute({ ...renderer.data, basemap: { roll: 30 }, viewState: { roll: 0 } })
    ).toMatchObject({ vis: { mapProps: { roll: 0 }, deckProps: { viewState: { roll: 0 } } } })
  })

  it('projects and unprojects using the banked camera', () => {
    const project = new ProjectOp('/project')
    const unproject = new UnprojectOp('/unproject')
    const viewState = { longitude: 8.5, latitude: 47.3, zoom: 12, pitch: 50, bearing: 20, roll: 35 }
    const options = { viewState, width: 1280, height: 720 }
    const position = { lng: 8.52, lat: 47.31 }
    const { screenPosition } = project.execute({ ...options, position })
    const { point } = unproject.execute({ ...options, screenPosition })
    expect(point.lng).toBeCloseTo(position.lng, 6)
    expect(point.lat).toBeCloseTo(position.lat, 6)
    expect(screenPosition).not.toEqual(
      project.execute({ ...options, viewState: { ...viewState, roll: 0 }, position }).screenPosition
    )
  })
})
