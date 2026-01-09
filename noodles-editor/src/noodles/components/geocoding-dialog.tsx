import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type MapLayerMouseEvent,
  Map as MapLibre,
  Marker,
  NavigationControl,
  useMap,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { analytics } from '../../utils/analytics'
import {
  type GeocodingResult,
  geocodeWithGooglePlaces,
  geocodeWithMapbox,
  geocodeWithPhoton,
} from '../../utils/geocoding'
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
  type: 'coordinates' | 'place'
  label: string
  coordinates: { longitude: number; latitude: number }
  confidence?: number
}

interface MapCoordinates {
  longitude: number
  latitude: number
  zoom?: number
}

// Parse coordinate pairs with ambiguity handling
export function parseCoordinates(value: string): Array<{
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

    // Helper to create informative labels based on confidence
    const createLabel = (
      first: number,
      second: number,
      confidence: number,
      format: 'lat-lng' | 'lng-lat'
    ): string => {
      const coords = `${first.toFixed(5)}, ${second.toFixed(5)}`
      const formatLabel = format === 'lat-lng' ? '(Lat, Lng)' : '(Lng, Lat)'

      // Only add context when there's ambiguity
      if (confidence === 1.0) {
        return `${coords} ${formatLabel}`
      }
      if (confidence === 0.7) {
        return `${coords} ${formatLabel} • Most common`
      }
      if (confidence === 0.5) {
        return `${coords} ${formatLabel} • Alternative`
      }
      return `${coords} ${formatLabel}`
    }

    // Option 1: a=lat, b=lng
    if (aCanBeLat && bCanBeLng) {
      const confidence = guessConfidence(a, b, 'lat-lng')
      results.push({
        label: createLabel(a, b, confidence, 'lat-lng'),
        coordinates: { latitude: a, longitude: b },
        confidence,
      })
    }

    // Option 2: a=lng, b=lat (if both are ambiguous)
    if (aCanBeLng && bCanBeLat && aCanBeLat && bCanBeLng && a !== b) {
      const confidence = guessConfidence(a, b, 'lng-lat')
      results.push({
        label: createLabel(a, b, confidence, 'lng-lat'),
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
  const googleMapsKey = getKey('googleMaps')
  const mapboxKey = getKey('mapbox')

  // Access the map instance for flyTo animations
  const { [MAP_ID]: mapInstance } = useMap()

  // Reset map coordinates when dialog opens with new initial value
  useEffect(() => {
    if (open && initialValue) {
      setMapCoordinates(initialValue)
    }
  }, [open, initialValue])

  // Cleanup debounce timeout on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [])

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

      // Priority 1: Check if coordinate pair
      const coordResults = parseCoordinates(value)
      if (coordResults.length > 0) {
        analytics.track('geocoding_parsed', { method: 'coordinates' })
        return coordResults.map(result => ({
          type: 'coordinates' as const,
          label: `📍 ${result.label}`,
          coordinates: result.coordinates,
          confidence: result.confidence,
        }))
      }

      // Priority 2: Treat as search query
      if (value.trim().length > 2) {
        let places: GeocodingResult[] = []
        let method = 'photon' // Default fallback

        // Try Google Places first
        if (googleMapsKey) {
          try {
            places = await geocodeWithGooglePlaces(value)
            method = 'google_places'
          } catch (error) {
            console.warn('Google Places failed, falling back to Mapbox/Photon:', error)
          }
        }

        // Fall back to Mapbox if Google failed or no Google key
        if (places.length === 0 && mapboxKey) {
          try {
            places = await geocodeWithMapbox(value, mapboxKey)
            method = 'mapbox'
          } catch (error) {
            console.warn('Mapbox failed, falling back to Photon:', error)
          }
        }

        // Final fallback to Photon
        if (places.length === 0) {
          places = await geocodeWithPhoton(value)
          method = 'photon'
        }

        analytics.track('geocoding_search', { method })

        return places.map(place => ({
          type: 'place' as const,
          label: place.context
            ? `🔍 ${place.place_name} • ${place.context}`
            : `🔍 ${place.place_name}`,
          coordinates: place.coordinates,
        }))
      }

      return []
    },
    [googleMapsKey, mapboxKey]
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

  // Handle map click (preserve zoom level)
  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    setMapCoordinates(prev => ({
      ...prev,
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
    }))
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
              placeholder="Search places or paste coordinates..."
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
                  suggestions.map((suggestion, index) => (
                    <button
                      type="button"
                      key={`${suggestion.label}-${index}`}
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
          {mapCoordinates.longitude != null && mapCoordinates.latitude != null && (
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
                />
              </MapLibre>
            </div>
          )}

          {/* Footer */}
          <div className={s.dialogFooter}>
            <div className={s.coordinateDisplay}>
              {mapCoordinates.longitude != null && mapCoordinates.latitude != null
                ? `${mapCoordinates.latitude.toFixed(5)}, ${mapCoordinates.longitude.toFixed(5)}`
                : 'Loading...'}
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
