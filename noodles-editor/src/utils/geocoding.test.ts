import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore, useKeysStore } from '../noodles/keys-store'
import {
  geocodeWithMapbox,
  getLoadedGoogleMapsKey,
  googleMapsScript,
  loadGoogleMapsAPI,
} from './geocoding'

describe('loadGoogleMapsAPI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Runs first: once the API loads, it stays loaded for the rest of the file
  it('tries again after the script fails to load', async () => {
    const load = vi
      .spyOn(googleMapsScript, 'load')
      .mockRejectedValueOnce(
        new TypeError(
          'Failed to fetch dynamically imported module: https://maps.googleapis.com/maps/api/js?key=test-google-key'
        )
      )
      .mockImplementationOnce(async url => {
        const callback = new URL(url).searchParams.get('callback')
        ;(window as unknown as Record<string, () => void>)[callback as string]()
      })
    const failure = await loadGoogleMapsAPI('test-google-key').catch((error: Error) => error)
    // Without the browser's message, which has the key in it
    expect(failure).toEqual(
      new Error("Couldn't load Google Maps. Check your connection and try again.")
    )

    await expect(loadGoogleMapsAPI('test-google-key')).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
    expect(getLoadedGoogleMapsKey()).toBe('test-google-key')
  })
})

describe('geocodeWithMapbox', () => {
  beforeEach(() => {
    useKeysStore.setState({ browserKeys: {}, projectKeys: undefined, keyOverrides: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const reject = (status: number, message: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ message }),
      })
    )

  it('names the project key Mapbox rejected', async () => {
    getKeysStore().setProjectKeys({ mapbox: 'pk.project' }, '/projects/a')
    reject(401, 'Not Authorized - Invalid Token')

    await expect(geocodeWithMapbox('Long Beach', 'pk.project')).rejects.toThrow(
      "Mapbox rejected the project's Mapbox token (401 Not Authorized - Invalid Token)"
    )
  })

  it('names the browser key Mapbox rejected', async () => {
    getKeysStore().setBrowserKey('mapbox', 'pk.mine')
    reject(403, 'Forbidden')

    await expect(geocodeWithMapbox('Long Beach', 'pk.mine')).rejects.toThrow(
      'Mapbox rejected your browser Mapbox token (403 Forbidden)'
    )
  })
})
