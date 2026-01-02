import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import Map, { Marker } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useKeysStore } from '../keys-store'
import { analytics } from '../../utils/analytics'
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

// Parse Google Maps URLs
function parseGoogleMapsUrl(value: string): { lat: number; lng: number } | null {
  try {
    // Format 1: Direct coordinates (@lat,lng)
    const directMatch = value.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (directMatch) {
      return { lat: parseFloat(directMatch[1]), lng: parseFloat(directMatch[2]) }
    }

    // Format 2: Place URL with coordinates
    const placeMatch = value.match(/place\/[^/]+\/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (placeMatch) {
      return { lat: parseFloat(placeMatch[1]), lng: parseFloat(placeMatch[2]) }
    }

    // Note: Short links (goo.gl/maps/...) require async fetching - handled separately
    return null
  } catch {
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
      return data.features.map((feature: any) => ({
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
      return data.features.map((feature: any) => ({
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

export function GeocodingDialog({
  open,
  onOpenChange,
  onLocationSelected,
  initialValue,
  mode,
}: GeocodingDialogProps) {
  const [mapCoordinates, setMapCoordinates] = useState(initialValue || DEFAULT_LOCATION)
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodingSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const getKey = useKeysStore((state) => state.getKey)
  const mapboxKey = getKey('mapbox')

  // Reset map coordinates when dialog opens with new initial value
  useEffect(() => {
    if (open && initialValue) {
      setMapCoordinates(initialValue)
    }
  }, [open, initialValue])

  // Parse input and generate suggestions
  const parseInput = useCallback(
    async (value: string): Promise<GeocodingSuggestion[]> => {
      if (!value.trim()) return []

      // Priority 1: Check if Google Maps URL
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
        return coordResults.map((result) => ({
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

        return places.map((place) => ({
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
  const handleSuggestionSelect = useCallback((suggestion: GeocodingSuggestion) => {
    setMapCoordinates(suggestion.coordinates)
    setInputValue('')
    setSuggestions([])
    setShowDropdown(false)
  }, [])

  // Handle map click
  const handleMapClick = useCallback((event: any) => {
    setMapCoordinates({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    })
    analytics.track('geocoding_map_clicked')
  }, [])

  // Handle marker drag
  const handleMarkerDragEnd = useCallback((event: any) => {
    setMapCoordinates({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    })
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
              onChange={(e) => handleInputChange(e.target.value)}
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
                  suggestions.map((suggestion, i) => (
                    <div
                      key={i}
                      className={s.suggestionItem}
                      onMouseDown={() => handleSuggestionSelect(suggestion)}
                    >
                      {suggestion.label}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Map */}
          <div className={s.mapContainer}>
            <Map
              mapStyle={CARTO_DARK}
              style={{ width: '100%', height: '400px' }}
              longitude={mapCoordinates.longitude}
              latitude={mapCoordinates.latitude}
              zoom={mapCoordinates.zoom || 12}
              onClick={handleMapClick}
            >
              <Marker
                longitude={mapCoordinates.longitude}
                latitude={mapCoordinates.latitude}
                draggable
                onDragEnd={handleMarkerDragEnd}
              />
            </Map>
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
