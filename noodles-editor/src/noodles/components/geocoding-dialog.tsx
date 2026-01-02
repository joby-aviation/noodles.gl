import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type MapLayerMouseEvent,
  Map as MapLibre,
  Marker,
  type MarkerDragEvent,
  NavigationControl,
  useMap,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { analytics } from '../../utils/analytics'
import { useKeysStore } from '../keys-store'
import s from './geocoding-dialog.module.css'

const DEFAULT_LOCATION = { longitude: -74.006, latitude: 40.7128, zoom: 12 } // NYC
const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

interface GeocodingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLocationSelected: (result: { longitude: number; latitude: number }) => void
  initialValue?: { longitude: number; latitude: number }
  mode: 'create-node' | 'update-field'
}

interface GeocodingSuggestion {
  type: 'url' | 'coordinates' | 'place'
  label: string
  coordinates: { longitude: number; latitude: number }
  confidence?: number
}

interface MapCoordinates {
  longitude: number
  latitude: number
  zoom?: number
}

interface MapboxFeature {
  place_name: string
  center: [number, number]
}

interface PhotonFeature {
  properties: {
    name?: string
    street?: string
  }
  geometry: {
    coordinates: [number, number]
  }
}

// Parse Google Maps URLs (synchronous - for direct/place URLs)
function parseGoogleMapsUrl(value: string): { lat: number; lng: number } | null {
  try {
    // Format 1: Direct coordinates (@lat,lng)
    const directMatch = value.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (directMatch) {
      return { lat: parseFloat(directMatch[1]), lng: parseFloat(directMatch[2]) }
    }

    // Format 2: Place URL with coordinates (NOTE: these are camera center, not place location)
    const placeMatch = value.match(/place\/[^/]+\/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (placeMatch) {
      return { lat: parseFloat(placeMatch[1]), lng: parseFloat(placeMatch[2]) }
    }

    return null
  } catch {
    return null
  }
}

// Resolve short Google Maps URLs by fetching and following redirects
async function resolveShortGoogleMapsUrl(
  value: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    // Check if it's a short URL (goo.gl or maps.app.goo.gl)
    const isShortUrl =
      value.includes('goo.gl/maps/') ||
      value.includes('maps.app.goo.gl/') ||
      value.includes('g.co/maps/')

    if (!isShortUrl) {
      return null
    }

    // Fetch the URL with redirect: 'follow' to get the final URL
    const response = await fetch(value, {
      method: 'HEAD',
      redirect: 'follow',
    })

    // Parse the final URL
    const finalUrl = response.url
    return parseGoogleMapsUrl(finalUrl)
  } catch (error) {
    console.error('Error resolving short Google Maps URL:', error)
    return null
  }
}

// Parse coordinate pairs with ambiguity handling
function parseCoordinates(value: string): Array<{
  label: string
  coordinates: { longitude: number; latitude: number }
  confidence: number
}> {
  try {
    // Extract number pairs (decimal format)
    const numbers = value.match(/-?\d+\.?\d*/g)?.map(parseFloat)
    if (!numbers || numbers.length !== 2) return []

    const [a, b] = numbers
    const results: Array<{
      label: string
      coordinates: { longitude: number; latitude: number }
      confidence: number
    }> = []

    // Check which interpretation is valid
    const aCanBeLat = a >= -90 && a <= 90
    const aCanBeLng = a >= -180 && a <= 180
    const bCanBeLat = b >= -90 && b <= 90
    const bCanBeLng = b >= -180 && b <= 180

    // Confidence heuristic
    const guessConfidence = (num1: number, num2: number, order: 'lat-lng' | 'lng-lat'): number => {
      if (Math.abs(num1) > 90 && Math.abs(num2) <= 90) return order === 'lng-lat' ? 1.0 : 0.3
      if (Math.abs(num2) > 90 && Math.abs(num1) <= 90) return order === 'lat-lng' ? 1.0 : 0.3
      return order === 'lat-lng' ? 0.7 : 0.5 // lat-first is more common
    }

    // Option 1: a=lat, b=lng
    if (aCanBeLat && bCanBeLng) {
      const confidence = guessConfidence(a, b, 'lat-lng')
      results.push({
        label: `Lat ${a.toFixed(5)}, Lng ${b.toFixed(5)}`,
        coordinates: { latitude: a, longitude: b },
        confidence,
      })
    }

    // Option 2: a=lng, b=lat (if both are ambiguous)
    if (aCanBeLng && bCanBeLat && aCanBeLat && bCanBeLng && a !== b) {
      const confidence = guessConfidence(a, b, 'lng-lat')
      results.push({
        label: `Lng ${a.toFixed(5)}, Lat ${b.toFixed(5)}`,
        coordinates: { latitude: b, longitude: a },
        confidence,
      })
    }

    // Sort by confidence (highest first)
    return results.sort((a, b) => b.confidence - a.confidence)
  } catch {
    return []
  }
}

// Geocoding search using Mapbox API
async function geocodeWithMapbox(
  query: string,
  apiKey: string
): Promise<Array<{ place_name: string; coordinates: { longitude: number; latitude: number } }>> {
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${apiKey}&limit=5`
    const response = await fetch(url)
    const data = await response.json()

    if (data.features) {
      return data.features.map((feature: MapboxFeature) => ({
        place_name: feature.place_name,
        coordinates: {
          longitude: feature.center[0],
          latitude: feature.center[1],
        },
      }))
    }
    return []
  } catch (error) {
    console.error('Mapbox geocoding error:', error)
    return []
  }
}

// Geocoding search using Photon API (free fallback)
async function geocodeWithPhoton(
  query: string
): Promise<Array<{ place_name: string; coordinates: { longitude: number; latitude: number } }>> {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`
    const response = await fetch(url)
    const data = await response.json()

    if (data.features) {
      return data.features.map((feature: PhotonFeature) => ({
        place_name: feature.properties.name || feature.properties.street || 'Unknown location',
        coordinates: {
          longitude: feature.geometry.coordinates[0],
          latitude: feature.geometry.coordinates[1],
        },
      }))
    }
    return []
  } catch (error) {
    console.error('Photon geocoding error:', error)
    return []
  }
}

const MAP_ID = 'geocoding-map'

export function GeocodingDialog({
  open,
  onOpenChange,
  onLocationSelected,
  initialValue,
  mode,
}: GeocodingDialogProps) {
  const [mapCoordinates, setMapCoordinates] = useState<MapCoordinates>(
    initialValue || DEFAULT_LOCATION
  )
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodingSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const getKey = useKeysStore(state => state.getKey)
  const mapboxKey = getKey('mapbox')

  // Access the map instance for flyTo animations
  const { [MAP_ID]: mapInstance } = useMap()

  // Reset map coordinates when dialog opens with new initial value
  useEffect(() => {
    if (open && initialValue) {
      setMapCoordinates(initialValue)
    }
  }, [open, initialValue])

  // Fly to a location with smooth animation
  const flyToLocation = useCallback(
    (coordinates: { longitude: number; latitude: number }, zoom = 14) => {
      if (mapInstance) {
        mapInstance.flyTo({
          center: [coordinates.longitude, coordinates.latitude],
          zoom,
          duration: 1500,
          essential: true,
        })
      }
      setMapCoordinates({ ...coordinates, zoom })
    },
    [mapInstance]
  )

  // Parse input and generate suggestions
  const parseInput = useCallback(
    async (value: string): Promise<GeocodingSuggestion[]> => {
      if (!value.trim()) return []

      // Priority 1a: Check if short Google Maps URL (requires async resolution)
      const shortUrlResult = await resolveShortGoogleMapsUrl(value)
      if (shortUrlResult) {
        analytics.track('geocoding_parsed', { method: 'short_url' })
        return [
          {
            type: 'url',
            label: `🔗 ${shortUrlResult.lat.toFixed(5)}, ${shortUrlResult.lng.toFixed(5)} (from short URL)`,
            coordinates: { longitude: shortUrlResult.lng, latitude: shortUrlResult.lat },
          },
        ]
      }

      // Priority 1b: Check if regular Google Maps URL
      const urlResult = parseGoogleMapsUrl(value)
      if (urlResult) {
        analytics.track('geocoding_parsed', { method: 'url' })
        return [
          {
            type: 'url',
            label: `🔗 ${urlResult.lat.toFixed(5)}, ${urlResult.lng.toFixed(5)} (from URL)`,
            coordinates: { longitude: urlResult.lng, latitude: urlResult.lat },
          },
        ]
      }

      // Priority 2: Check if coordinate pair
      const coordResults = parseCoordinates(value)
      if (coordResults.length > 0) {
        analytics.track('geocoding_parsed', { method: 'coordinates' })
        return coordResults.map(result => ({
          type: 'coordinates' as const,
          label: `📍 ${result.label}${result.confidence < 1 ? ' (possible)' : ''}`,
          coordinates: result.coordinates,
          confidence: result.confidence,
        }))
      }

      // Priority 3: Treat as search query
      if (value.trim().length > 2) {
        analytics.track('geocoding_search', { method: mapboxKey ? 'mapbox' : 'photon' })
        const places = mapboxKey
          ? await geocodeWithMapbox(value, mapboxKey)
          : await geocodeWithPhoton(value)

        return places.map(place => ({
          type: 'place' as const,
          label: `🔍 ${place.place_name}`,
          coordinates: place.coordinates,
        }))
      }

      return []
    },
    [mapboxKey]
  )

  // Handle input change with debouncing
  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value)
      setShowDropdown(true)

      // Clear existing timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }

      // Debounce parsing
      debounceTimeoutRef.current = setTimeout(async () => {
        setIsLoading(true)
        const results = await parseInput(value)
        setSuggestions(results)
        setIsLoading(false)
      }, 300)
    },
    [parseInput]
  )

  // Handle suggestion selection
  const handleSuggestionSelect = useCallback(
    (suggestion: GeocodingSuggestion) => {
      // Different zoom levels based on suggestion type
      const zoom = suggestion.type === 'place' ? 13 : 14
      flyToLocation(suggestion.coordinates, zoom)
      setInputValue('')
      setSuggestions([])
      setShowDropdown(false)
    },
    [flyToLocation]
  )

  // Handle map click
  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    setMapCoordinates({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    })
    analytics.track('geocoding_map_clicked')
  }, [])

  // Handle map movement (zoom/pan)
  const handleMove = useCallback((event: ViewStateChangeEvent) => {
    setMapCoordinates(prev => ({
      ...prev,
      longitude: event.viewState.longitude,
      latitude: event.viewState.latitude,
      zoom: event.viewState.zoom,
    }))
  }, [])

  // Handle marker drag (update in real-time)
  const handleMarkerDrag = useCallback((event: MarkerDragEvent) => {
    setMapCoordinates(prev => ({
      ...prev,
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    }))
  }, [])

  // Handle marker drag end (analytics only)
  const handleMarkerDragEnd = useCallback(() => {
    analytics.track('geocoding_marker_dragged')
  }, [])

  // Handle location confirmation
  const handleConfirm = useCallback(() => {
    onLocationSelected(mapCoordinates)
    analytics.track('geocoding_confirmed', { mode })
    onOpenChange(false)
  }, [mapCoordinates, onLocationSelected, mode, onOpenChange])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.dialogOverlay} />
        <Dialog.Content className={s.dialogContent}>
          <Dialog.Title className={s.dialogTitle}>
            {mode === 'create-node' ? 'Create Point' : 'Lookup Location'}
          </Dialog.Title>
          <Dialog.Description className={s.dialogDescription}>
            Search places, paste coordinates, or click on the map to select a location.
          </Dialog.Description>

          {/* Smart Input */}
          <div className={s.inputSection}>
            <input
              type="text"
              value={inputValue}
              onChange={e => handleInputChange(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              placeholder="Search places, paste coordinates, or Google Maps link..."
              className={s.smartInput}
            />

            {/* Autocomplete Dropdown */}
            {showDropdown && (suggestions.length > 0 || isLoading) && (
              <div className={s.suggestionsDropdown}>
                {isLoading ? (
                  <div className={s.suggestionItem}>
                    <i className="pi pi-spin pi-spinner" style={{ marginRight: '8px' }} />
                    Searching...
                  </div>
                ) : (
                  suggestions.map(suggestion => (
                    <button
                      type="button"
                      key={suggestion.label}
                      className={s.suggestionItem}
                      onMouseDown={() => handleSuggestionSelect(suggestion)}
                    >
                      {suggestion.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Map */}
          <div className={s.mapContainer}>
            <MapLibre
              id={MAP_ID}
              mapStyle={CARTO_DARK}
              style={{ width: '100%', height: '400px' }}
              longitude={mapCoordinates.longitude}
              latitude={mapCoordinates.latitude}
              zoom={mapCoordinates.zoom || 12}
              onMove={handleMove}
              onClick={handleMapClick}
            >
              <NavigationControl position="top-right" showCompass={false} />
              <Marker
                longitude={mapCoordinates.longitude}
                latitude={mapCoordinates.latitude}
                anchor="center"
                draggable
                onDrag={handleMarkerDrag}
                onDragEnd={handleMarkerDragEnd}
              />
            </MapLibre>
          </div>

          {/* Footer */}
          <div className={s.dialogFooter}>
            <div className={s.coordinateDisplay}>
              {mapCoordinates.latitude.toFixed(5)}, {mapCoordinates.longitude.toFixed(5)}
            </div>
            <button type="button" className={s.confirmButton} onClick={handleConfirm}>
              {mode === 'create-node' ? 'Create Point' : 'Update Field'}
            </button>
          </div>

          <Dialog.Close asChild>
            <button type="button" className={s.closeButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
