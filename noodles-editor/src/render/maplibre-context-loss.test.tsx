import { cleanup, render, waitFor } from '@testing-library/react'
import type { Map as MapLibre } from 'maplibre-gl'
import ReactMapGL, { type MapProps } from 'react-map-gl/maplibre'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mapRenderingDefaults } from './rendering-defaults'

// MapLibre sets map.style to null when the WebGL context is lost (the browser drops
// old contexts when too many are open, and GPU resets after sleep do the same). Until
// the context comes back, anything that reads map.style crashes. Production saw both:
//   - "Cannot read properties of null (reading '_loaded')" from react-map-gl's setProps
//     when React re-rendered the map while the context was lost
//   - "Cannot read properties of null (reading 'imageManager')" from MapLibre's own
//     _contextRestored when the style had not finished loading before the loss

const LOADED_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#000' } },
  ],
}

// A style that never finishes loading, so the context is lost before the style loads
const UNLOADABLE_STYLE = '/__maplibre-context-loss-test__/missing-style.json'

// Headless Chromium never fires webglcontextrestored after WEBGL_lose_context, so the
// tests dispatch the events MapLibre listens for on its canvas. MapLibre runs the same
// handlers as for a real loss; the context itself stays usable for the restored painter.
function dispatchContextEvent(map: MapLibre, type: 'webglcontextlost' | 'webglcontextrestored') {
  map.getCanvas().dispatchEvent(new WebGLContextEvent(type, { cancelable: true }))
}

describe('MapLibre WebGL context loss', () => {
  let errors: unknown[]
  const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message)

  beforeEach(() => {
    vi.useRealTimers()
    errors = []
    window.addEventListener('error', onError)
  })

  afterEach(() => {
    window.removeEventListener('error', onError)
    cleanup()
    vi.useFakeTimers({ now: new Date('2025-02-01T00:00:00Z') })
  })

  function renderMap(props: MapProps) {
    let map: MapLibre | null = null
    const element = (zoom: number) => (
      <div style={{ width: 200, height: 120 }}>
        <ReactMapGL
          {...mapRenderingDefaults}
          {...props}
          ref={ref => {
            if (ref) map = ref.getMap()
          }}
          longitude={0}
          latitude={0}
          zoom={zoom}
        />
      </div>
    )
    const result = render(element(1))
    return {
      getMap: () => map,
      rerenderWithZoom: (zoom: number) => result.rerender(element(zoom)),
    }
  }

  it('survives a React re-render while the context is lost', async () => {
    let loaded = false
    const { getMap, rerenderWithZoom } = renderMap({
      mapStyle: LOADED_STYLE,
      onLoad: () => {
        loaded = true
      },
    })
    await waitFor(() => expect(loaded).toBe(true), { timeout: 10_000 })
    const map = getMap()!

    dispatchContextEvent(map, 'webglcontextlost')
    expect(map.style).toBeNull()

    // The editor re-renders the map on every camera or timeline change
    rerenderWithZoom(2)
    rerenderWithZoom(3)

    dispatchContextEvent(map, 'webglcontextrestored')

    expect(errors).toEqual([])
    expect(map.style).not.toBeNull()
  })

  it('survives a context restore when the style had not loaded yet', async () => {
    const { getMap } = renderMap({ mapStyle: UNLOADABLE_STYLE, onError: () => {} })
    await waitFor(() => expect(getMap()).not.toBeNull())
    const map = getMap()!
    expect(map.isStyleLoaded()).toBeFalsy()

    dispatchContextEvent(map, 'webglcontextlost')
    dispatchContextEvent(map, 'webglcontextrestored')

    expect(errors).toEqual([])
  })
})
