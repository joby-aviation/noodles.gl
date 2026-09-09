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
  Map: ({ children, mapStyle, onClick, onMove }: any) => (
    <div data-testid="geocoder-map" data-map-style={mapStyle}>
      <button
        type="button"
        onClick={() =>
          onMove({ viewState: { longitude: 10, latitude: 20, zoom: 8 } })
        }
      >
        Pan map
      </button>
      <button
        type="button"
        onClick={() => onClick({ lngLat: { lng: -122.4194, lat: 37.7749 } })}
      >
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
      getKey: () => undefined,
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

  it('shows the fallback provider and selects a search result', async () => {
    const onLocationSelected = renderDialog()
    mocks.geocodeWithPhoton.mockResolvedValue([
      {
        place_name: 'Bordeaux',
        coordinates: { longitude: -0.5792, latitude: 44.8378 },
        context: 'France',
      },
    ])

    fireEvent.change(screen.getByPlaceholderText('Search places or paste coordinates...'), {
      target: { value: 'Bordeaux' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByLabelText('Geocoding provider: Photon')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: /Bordeaux/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Update Field' }))

    expect(mocks.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-0.5792, 44.8378] })
    )
    expect(onLocationSelected).toHaveBeenCalledWith({ longitude: -0.5792, latitude: 44.8378 })
  })
})
