import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore, useKeysStore } from '../../keys-store'
import { CARTO_VOYAGER, GeocodingDialog } from '../geocoding-dialog'

const mocks = vi.hoisted(() => ({
  flyTo: vi.fn(),
  geocodeWithGooglePlaces: vi.fn(),
  geocodeWithMapbox: vi.fn(),
  geocodeWithPhoton: vi.fn(),
}))

vi.mock('../../../utils/geocoding', () => ({
  geocodeWithGooglePlaces: mocks.geocodeWithGooglePlaces,
  geocodeWithMapbox: mocks.geocodeWithMapbox,
  geocodeWithPhoton: mocks.geocodeWithPhoton,
}))

vi.mock('react-map-gl/maplibre', () => ({
  Map: ({ children, mapStyle, onClick, onMove, zoom }: any) => (
    <div data-testid="geocoder-map" data-map-style={mapStyle} data-zoom={zoom}>
      <button
        type="button"
        onClick={() => onMove({ viewState: { longitude: 10, latitude: 20, zoom: 8 } })}
      >
        Pan map
      </button>
      <button type="button" onClick={() => onClick({ lngLat: { lng: -122.4194, lat: 37.7749 } })}>
        Click map
      </button>
      {children}
    </div>
  ),
  Marker: ({ longitude, latitude }: any) => (
    <div data-testid="selected-marker" data-longitude={longitude} data-latitude={latitude} />
  ),
  NavigationControl: () => null,
  useMap: () => ({ 'geocoding-map': { flyTo: mocks.flyTo } }),
}))

describe('GeocodingDialog interactions', () => {
  const initialValue = { longitude: -74.006, latitude: 40.7128 }
  const originalGetKey = getKeysStore().getKey

  beforeEach(() => {
    vi.useFakeTimers()
    useKeysStore.setState({
      browserKeys: {},
      projectKeys: undefined,
      saveInProject: false,
      // Ignore env keys so tests control which providers are configured
      getKey: key => useKeysStore.getState().browserKeys[key],
    })
    mocks.geocodeWithPhoton.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    useKeysStore.setState({ getKey: originalGetKey })
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  function renderDialog(onLocationSelected = vi.fn()) {
    render(
      <GeocodingDialog
        open
        onOpenChange={vi.fn()}
        onLocationSelected={onLocationSelected}
        initialValue={initialValue}
        mode="update-field"
      />
    )
    return onLocationSelected
  }

  function search(value: string) {
    fireEvent.change(screen.getByPlaceholderText('Search places or paste coordinates...'), {
      target: { value },
    })
    return act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
  }

  const bordeaux = {
    place_name: 'Bordeaux',
    coordinates: { longitude: -0.5792, latitude: 44.8378 },
    context: 'France',
  }

  it('opens at country-level zoom', () => {
    renderDialog()

    expect(screen.getByTestId('geocoder-map')).toHaveAttribute('data-zoom', '4')
  })

  it('uses the Voyager street style', () => {
    renderDialog()

    expect(screen.getByTestId('geocoder-map')).toHaveAttribute('data-map-style', CARTO_VOYAGER)
  })

  it('does not move the selected pin when the camera pans', () => {
    const onLocationSelected = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Pan map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Field' }))

    expect(onLocationSelected).toHaveBeenCalledWith(initialValue)
  })

  it('moves the selected pin when the map is clicked', () => {
    const onLocationSelected = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Click map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Field' }))

    expect(onLocationSelected).toHaveBeenCalledWith({
      longitude: -122.4194,
      latitude: 37.7749,
    })
  })

  it('badges Photon results and prompts for a key when none is configured', async () => {
    const onLocationSelected = renderDialog()
    mocks.geocodeWithPhoton.mockResolvedValue([bordeaux])

    await search('Bordeaux')

    const result = screen.getByRole('button', { name: /Bordeaux/ })
    expect(result).toHaveTextContent('Photon')
    expect(
      screen.getByRole('button', { name: 'Add a Mapbox or Google Maps key' })
    ).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: /Bordeaux/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Field' }))

    expect(mocks.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-0.5792, 44.8378] })
    )
    expect(onLocationSelected).toHaveBeenCalledWith({ longitude: -0.5792, latitude: 44.8378 })
  })

  it('uses keys added after the dialog mounted', async () => {
    renderDialog()
    act(() => {
      useKeysStore.setState({ browserKeys: { mapbox: 'pk.test' } })
    })
    mocks.geocodeWithMapbox.mockResolvedValue([bordeaux])

    await search('Bordeaux')

    expect(mocks.geocodeWithMapbox).toHaveBeenCalledWith('Bordeaux', 'pk.test')
    expect(mocks.geocodeWithPhoton).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Bordeaux/ })).toHaveTextContent('Mapbox')
  })

  it('explains a provider failure instead of prompting for a key that is already set', async () => {
    useKeysStore.setState({ browserKeys: { googleMaps: 'g-test', mapbox: 'pk.test' } })
    renderDialog()
    mocks.geocodeWithGooglePlaces.mockRejectedValue(
      new Error('Google Places failed: Requests from referer http://localhost:5173/ are blocked.')
    )
    mocks.geocodeWithMapbox.mockRejectedValue(
      new Error('Mapbox geocoding failed: 422 Query too long - 21/20 tokens')
    )
    mocks.geocodeWithPhoton.mockResolvedValue([bordeaux])

    await search('Bordeaux')

    expect(screen.getByRole('button', { name: /Bordeaux/ })).toHaveTextContent('Photon')
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(
      'Google Places failed: Requests from referer http://localhost:5173/ are blocked.'
    )
    expect(notice).toHaveTextContent('Mapbox geocoding failed: 422 Query too long - 21/20 tokens')
    expect(notice).toHaveTextContent('Showing Photon results.')
    // Pinned to the results dropdown so it is visible alongside the results
    expect(notice.parentElement).toContainElement(screen.getByRole('button', { name: /Bordeaux/ }))
    expect(
      screen.queryByRole('button', { name: 'Add a Mapbox or Google Maps key' })
    ).not.toBeInTheDocument()
  })

  it('badges Google results without any notice', async () => {
    useKeysStore.setState({ browserKeys: { googleMaps: 'g-test' } })
    renderDialog()
    mocks.geocodeWithGooglePlaces.mockResolvedValue([bordeaux])

    await search('Bordeaux')

    expect(screen.getByRole('button', { name: /Bordeaux/ })).toHaveTextContent('Google')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.geocodeWithMapbox).not.toHaveBeenCalled()
  })
})
