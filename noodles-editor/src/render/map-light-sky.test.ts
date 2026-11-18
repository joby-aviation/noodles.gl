import { describe, expect, it, vi } from 'vitest'
import { type BasemapLight, type BasemapSky, syncLightAndSky } from './map-light-sky'

const light: BasemapLight = { anchor: 'map', azimuthal: 90, polar: 45 }
const sky: BasemapSky = {
  enabled: true,
  skyColor: '#ff0000',
  horizonColor: '#ffffff',
  skyHorizonBlend: 0.8,
  atmosphereBlend: 0.3,
}

// Stands in for a MapLibre map: setLight and setSky throw while a style is loading
function fakeMap() {
  const listeners = new Map<string, Set<() => void>>()
  const map = {
    loaded: true,
    setLight: vi.fn(() => {
      if (!map.loaded) throw new Error('Style is not done loading.')
    }),
    setSky: vi.fn(() => {
      if (!map.loaded) throw new Error('Style is not done loading.')
    }),
    // What the style itself defines, which getSky and getLight read before anything changes it
    styleSky: undefined as unknown,
    styleLight: undefined as unknown,
    getSky: vi.fn(() => map.styleSky),
    getLight: vi.fn(() => map.styleLight),
    on: vi.fn((type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(fn)
    }),
    off: vi.fn((type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn)
    }),
    // A new mapStyle: the style reloads, then fires 'style.load'
    loadStyle() {
      map.loaded = true
      for (const fn of listeners.get('style.load') ?? []) fn()
    },
  }
  return map as typeof map & any
}

describe('syncLightAndSky', () => {
  it('applies light and sky right away', () => {
    const map = fakeMap()
    syncLightAndSky(map, light, sky)

    expect(map.setLight).toHaveBeenCalledWith({ anchor: 'map', position: [1.15, 90, 45] })
    expect(map.setSky).toHaveBeenCalledWith({
      'sky-color': '#ff0000',
      'horizon-color': '#ffffff',
      'sky-horizon-blend': 0.8,
      'atmosphere-blend': 0.3,
    })
  })

  it('applies them again after the style reloads', () => {
    const map = fakeMap()
    syncLightAndSky(map, light, sky)
    map.setLight.mockClear()
    map.setSky.mockClear()

    map.loadStyle()

    expect(map.setLight).toHaveBeenCalledWith({ anchor: 'map', position: [1.15, 90, 45] })
    expect(map.setSky).toHaveBeenCalledWith(expect.objectContaining({ 'sky-color': '#ff0000' }))
  })

  it('waits for the style to load instead of throwing', () => {
    const map = fakeMap()
    map.loaded = false

    expect(() => syncLightAndSky(map, light, sky)).not.toThrow()
    map.setSky.mockClear()

    map.loadStyle()
    expect(map.setSky).toHaveBeenCalledWith(expect.objectContaining({ 'sky-color': '#ff0000' }))
  })

  it('turns the sky off when it is disabled', () => {
    const map = fakeMap()
    syncLightAndSky(map, light, { ...sky, enabled: false })
    expect(map.setSky).toHaveBeenCalledWith(undefined)
  })

  // #884: the deck configures no sky, and a style may bring its own
  it("leaves the style's own sky alone when no sky is configured", () => {
    const map = fakeMap()
    syncLightAndSky(map, undefined, undefined)
    map.loadStyle()
    expect(map.setSky).not.toHaveBeenCalled()
    expect(map.setLight).not.toHaveBeenCalled()
  })

  it('takes away a sky it set when it stops', () => {
    const map = fakeMap()
    syncLightAndSky(map, light, sky)()
    expect(map.setSky).toHaveBeenLastCalledWith(undefined)

    const none = fakeMap()
    syncLightAndSky(none, undefined, undefined)()
    expect(none.setSky).not.toHaveBeenCalled()
  })

  // #900 review: turning Sky or Custom light off shows the style's own again
  it("puts the style's own sky and light back when it stops", () => {
    const map = fakeMap()
    map.styleSky = { 'sky-color': '#123456' }
    map.styleLight = { anchor: 'map', position: [1.5, 90, 80] }
    syncLightAndSky(map, light, sky)()
    expect(map.setSky).toHaveBeenLastCalledWith({ 'sky-color': '#123456' })
    expect(map.setLight).toHaveBeenLastCalledWith({ anchor: 'map', position: [1.5, 90, 80] })
  })

  it("reads the new style's own after a style load, and puts that back", () => {
    const map = fakeMap()
    const stop = syncLightAndSky(map, undefined, sky)
    map.styleSky = { 'sky-color': '#abcdef' }
    map.loadStyle()
    stop()
    expect(map.setSky).toHaveBeenLastCalledWith({ 'sky-color': '#abcdef' })
  })

  it('stops reapplying after cleanup', () => {
    const map = fakeMap()
    const stop = syncLightAndSky(map, light, sky)
    stop()
    map.setSky.mockClear()

    map.loadStyle()
    expect(map.setSky).not.toHaveBeenCalled()
  })
})
