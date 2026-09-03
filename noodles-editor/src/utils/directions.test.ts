import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore, useKeysStore } from '../noodles/keys-store'
import { DRIVING_TRAFFIC, getDirections, resolveOriginDepartureTime } from './directions'

vi.mock('./geocoding', () => ({
  loadGoogleMapsAPI: vi.fn().mockResolvedValue(undefined),
}))

const NYC = { lat: 40.7128, lng: -74.006 }

describe('resolveOriginDepartureTime', () => {
  const now = Temporal.Instant.from('2029-01-01T00:00:00Z')

  it('interprets the wall clock time in the origin timezone', () => {
    const result = resolveOriginDepartureTime({
      origin: NYC,
      localTime: Temporal.PlainDateTime.from('2030-01-15T12:00:00'),
      now,
    })

    expect(result.toISOString()).toBe('2030-01-15T17:00:00.000Z')
  })

  it.each([
    '2030-03-10T02:30:00',
    '2030-11-03T01:30:00',
  ])('rejects DST times that do not identify one instant: %s', localTime => {
    expect(() =>
      resolveOriginDepartureTime({
        origin: NYC,
        localTime: Temporal.PlainDateTime.from(localTime),
        now,
      })
    ).toThrow(/ambiguous or does not exist/)
  })

  it('rejects departures in the past', () => {
    expect(() =>
      resolveOriginDepartureTime({
        origin: NYC,
        localTime: Temporal.PlainDateTime.from('2020-01-15T12:00:00'),
        now,
      })
    ).toThrow(/must be in the future/)
  })

  it('reports timezone lookup failures', () => {
    expect(() =>
      resolveOriginDepartureTime({
        origin: { lat: 100, lng: 0 },
        localTime: Temporal.PlainDateTime.from('2030-01-15T12:00:00'),
        now,
      })
    ).toThrow(/determine the departure timezone/)
  })
})

describe('Google traffic-aware directions', () => {
  const computeRoutes = vi.fn()
  const importLibrary = vi.fn()

  beforeEach(() => {
    useKeysStore.setState({ browserKeys: {}, projectKeys: undefined, saveInProject: false })
    getKeysStore().setBrowserKey('googleMaps', 'test-google-key')
    computeRoutes.mockResolvedValue({
      routes: [
        {
          distanceMeters: 1000,
          durationMillis: 120_000,
          path: [
            { lng: -74.006, lat: 40.7128 },
            { lng: -73.996, lat: 40.7228 },
          ],
        },
      ],
    })
    importLibrary.mockResolvedValue({
      PolylineQuality: { HIGH_QUALITY: 'HIGH_QUALITY' },
      Route: { computeRoutes },
      RoutingPreference: { TRAFFIC_AWARE_OPTIMAL: 'TRAFFIC_AWARE_OPTIMAL' },
      TrafficModel: { BEST_GUESS: 'bestguess' },
      TravelMode: { DRIVING: 'DRIVING' },
    })
    vi.stubGlobal('google', { maps: { importLibrary } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('omits departureTime when departing now', async () => {
    const result = await getDirections({
      origin: NYC,
      destination: { lat: 40.7228, lng: -73.996 },
      mode: DRIVING_TRAFFIC,
    })

    expect(computeRoutes).toHaveBeenCalledWith(
      expect.not.objectContaining({ departureTime: expect.anything() })
    )
    expect(computeRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
        trafficModel: 'bestguess',
      })
    )
    expect(result).toMatchObject({ distance: 1000, duration: 120 })
    expect(result.timestamps).toHaveLength(2)
  })

  it('converts a scheduled origin-local departure before requesting a route', async () => {
    await getDirections({
      origin: NYC,
      destination: { lat: 40.7228, lng: -73.996 },
      mode: DRIVING_TRAFFIC,
      departureTime: Temporal.PlainDateTime.from('2030-01-15T12:00:00'),
    })

    expect(computeRoutes).toHaveBeenCalledWith(
      expect.objectContaining({ departureTime: new Date('2030-01-15T17:00:00.000Z') })
    )
  })

  it('requires a Google Maps key', async () => {
    vi.spyOn(getKeysStore(), 'getKey').mockReturnValue(undefined)

    await expect(
      getDirections({
        origin: NYC,
        destination: { lat: 40.7228, lng: -73.996 },
        mode: DRIVING_TRAFFIC,
      })
    ).rejects.toThrow(/Google Maps API key not configured/)
  })

  it('reports incomplete routes', async () => {
    computeRoutes.mockResolvedValue({ routes: [] })

    await expect(
      getDirections({
        origin: NYC,
        destination: { lat: 40.7228, lng: -73.996 },
        mode: DRIVING_TRAFFIC,
      })
    ).rejects.toThrow(/Google returned no complete route/)
  })
})
