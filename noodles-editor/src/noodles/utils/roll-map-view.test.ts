import { MapView, project, WebMercatorViewport } from '@deck.gl/core'
import { Map as MapLibre, setWorkerUrl } from 'maplibre-gl'
import { afterEach, describe, expect, it } from 'vitest'
import { mapRenderingDefaults } from '../../render/rendering-defaults'
import { createRollViewport, RollMapView } from './roll-map-view'

describe('camera roll', () => {
  let map: MapLibre | undefined
  let container: HTMLDivElement | undefined
  afterEach(() => {
    map?.remove()
    container?.remove()
  })

  it('preserves the original viewport when roll is absent or zero', () => {
    const options = { longitude: 8.5, latitude: 47.3, zoom: 12, pitch: 55 }
    expect(createRollViewport(options)).toBeInstanceOf(WebMercatorViewport)
    expect(
      createRollViewport({ ...options, roll: 0 }).equals(new WebMercatorViewport(options))
    ).toBe(true)
  })

  it.each([-45, 30, 90])('matches MapLibre projection at %s degrees of roll', roll => {
    container = document.createElement('div')
    container.style.cssText = 'width: 960px; height: 540px; position: absolute;'
    document.body.append(container)
    setWorkerUrl(mapRenderingDefaults.workerUrl!)
    map = new MapLibre({
      ...mapRenderingDefaults,
      container,
      style: { version: 8, sources: {}, layers: [] },
      center: [8.5, 47.3],
      zoom: 12,
      pitch: 55,
      bearing: 25,
      roll,
      attributionControl: false,
    })
    const viewport = new RollMapView({ id: 'maplibre', roll }).makeViewport({
      width: 960,
      height: 540,
      viewState: { longitude: 8.5, latitude: 47.3, zoom: 12, pitch: 55, bearing: 25 },
    })!
    for (const point of [
      [8.51, 47.31],
      [8.48, 47.29],
      [8.5, 47.3],
    ]) {
      const expected = map.project(point as [number, number])
      const actual = viewport.project(point)
      expect(actual[0]).toBeCloseTo(expected.x, 2)
      expect(actual[1]).toBeCloseTo(expected.y, 2)
      const unprojected = viewport.unproject(actual)
      expect(unprojected[0]).toBeCloseTo(point[0], 6)
      expect(unprojected[1]).toBeCloseTo(point[1], 6)
    }
  })

  it('honors roll in standalone view state and overrides it for the MapLibre camera', () => {
    const viewState = { longitude: 8, latitude: 47, zoom: 10, roll: -25 }
    const options = { width: 800, height: 600, viewState }
    const rolled = new RollMapView().makeViewport(options)!
    // The GPU uniform path needs the geographic origin even though Viewport
    // does not declare longitude/latitude on its base class.
    expect(() =>
      project.getUniforms({ viewport: rolled, coordinateSystem: 'lnglat' })
    ).not.toThrow()
    expect(rolled.equals(new MapView().makeViewport(options)!)).toBe(false)
    expect(
      new RollMapView({ roll: 0 })
        .makeViewport(options)!
        .equals(new MapView().makeViewport(options)!)
    ).toBe(true)
  })
})
