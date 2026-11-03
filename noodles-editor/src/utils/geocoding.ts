import { describeKey, getKeysStore } from '../noodles/keys-store'
import { analytics } from './analytics'
import { debugGeocode } from './debug'

export interface GeocodingResult {
  place_name: string
  coordinates: { longitude: number; latitude: number }
  context?: string // Additional context like city, state, or full address
}

// Type definitions for Google Places API (New) - AutocompleteSuggestion
// See: https://developers.google.com/maps/documentation/javascript/place-autocomplete-new
interface AutocompleteSuggestionRequest {
  input: string
  includedPrimaryTypes?: string[]
  includedRegionCodes?: string[]
  language?: string
  region?: string
}

// Mapbox Geocoding API response types
// See: https://docs.mapbox.com/api/search/geocoding/
interface MapboxFeature {
  place_name: string
  center: [number, number] // [longitude, latitude]
}

interface MapboxGeocodingResponse {
  features?: MapboxFeature[]
}

// Photon API response types
// See: https://photon.komoot.io/
interface PhotonFeature {
  properties: {
    name?: string
    street?: string
  }
  geometry: {
    coordinates: [number, number] // [longitude, latitude]
  }
}

interface PhotonGeocodingResponse {
  features?: PhotonFeature[]
}

// Track if Google Maps API is loaded to avoid duplicate imports
let googleMapsLoaded = false
let googleMapsPromise: Promise<void> | null = null
let loadingApiKey: string | null = null
let loadedApiKey: string | null = null

// How the Maps JavaScript API script is fetched, replaceable in tests
export const googleMapsScript = {
  load: (url: string): Promise<unknown> => import(/* @vite-ignore */ url),
}

// The key the Maps JavaScript API was loaded with. It can't switch keys afterwards.
export function getLoadedGoogleMapsKey(): string | null {
  return loadedApiKey
}

// Load Google Maps JavaScript API
export async function loadGoogleMapsAPI(apiKey: string): Promise<void> {
  if (googleMapsLoaded) {
    // Carrying on would bill and restrict requests under the old key, not the active one
    if (apiKey !== loadedApiKey) {
      throw new Error(
        'Google Maps is still using the previous API key. Reload the page to use the new one.'
      )
    }
    return
  }

  // If currently loading, check if it's the same key
  if (googleMapsPromise) {
    if (loadingApiKey !== apiKey) {
      throw new Error(
        'Google Maps API is already loading with a different API key. Please wait for the current load to complete.'
      )
    }
    return googleMapsPromise
  }

  loadingApiKey = apiKey
  // Google calls this when it rejects the key, e.g. for a site the key isn't restricted to
  Object.assign(window, {
    gm_authFailure: () => getKeysStore().reportKeyRejected('googleMaps', apiKey),
  })
  googleMapsPromise = new Promise<void>((resolve, reject) => {
    const callbackName = `googleMapsCallback_${Date.now()}`

    window[callbackName] = () => {
      googleMapsLoaded = true
      loadedApiKey = apiKey
      loadingApiKey = null
      resolve()
      delete window[callbackName]
    }

    const params = new URLSearchParams({
      v: 'weekly',
      key: apiKey,
      libraries: 'places',
      loading: 'async',
      callback: callbackName,
    })

    googleMapsScript
      .load(`https://maps.googleapis.com/maps/api/js?${params.toString()}`)
      .catch(error => {
        // Forget the failed load, so the next request tries again
        googleMapsPromise = null
        loadingApiKey = null
        delete window[callbackName]
        debugGeocode('Google Maps failed to load:', error)
        // The browser's message has the script URL in it, and so the key
        reject(new Error("Couldn't load Google Maps. Check your connection and try again."))
      })
  })

  return googleMapsPromise
}

// Geocode using Google Places AutocompleteSuggestion API (recommended)
// Returns autocomplete predictions for a search query
export async function geocodeWithGooglePlaces(query: string): Promise<GeocodingResult[]> {
  const keysStore = getKeysStore()
  const apiKey = keysStore.getKey('googleMaps')
  if (!apiKey) {
    throw new Error('Google Maps API key not configured')
  }

  // Load API if needed
  await loadGoogleMapsAPI(apiKey)

  // Use the new AutocompleteSuggestion API (recommended as of March 2025)
  const request: AutocompleteSuggestionRequest = {
    input: query,
    // Don't restrict primary types - allow both geocodes (addresses) and establishments (businesses)
  }

  try {
    const { suggestions } =
      await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request)

    if (!suggestions || suggestions.length === 0) {
      return []
    }

    // Get place details for each suggestion (up to 5)
    const results: GeocodingResult[] = []

    for (const suggestion of suggestions.slice(0, 5)) {
      try {
        if (suggestion.placePrediction) {
          const place = suggestion.placePrediction.toPlace()
          await place.fetchFields({
            fields: ['displayName', 'location', 'formattedAddress'],
          })

          if (place.location) {
            const displayName = place.displayName || suggestion.placePrediction.text.toString()
            // Extract context from formatted address (everything after the first part)
            const fullAddress = place.formattedAddress || ''
            // Remove the display name from the address to get just the context (city, state, country)
            const context = fullAddress.replace(displayName, '').replace(/^,\s*/, '').trim()

            results.push({
              place_name: displayName,
              coordinates: {
                longitude: place.location.lng(),
                latitude: place.location.lat(),
              },
              context: context || undefined,
            })
          }
        }
      } catch (error) {
        debugGeocode('Error fetching place details:', error)
        // Continue with other suggestions even if one fails
      }
    }

    return results
  } catch (error) {
    debugGeocode('Google Places API error:', error)
    analytics.track('geocoding_failed', {
      service: 'google',
      statusCode: undefined,
      reason:
        error instanceof Error && error.message.includes('API key')
          ? 'api_key_missing'
          : 'network_error',
    })
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Google Places failed using ${describeKey('googleMaps', apiKey)}: ${message}`, {
      cause: error,
    })
  }
}

// Geocode using Mapbox Geocoding API
export async function geocodeWithMapbox(query: string, apiKey: string): Promise<GeocodingResult[]> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${apiKey}&limit=5`
  const response = await fetch(url)
  if (!response.ok) {
    const reason =
      response.status === 429
        ? 'rate_limit'
        : response.status === 404
          ? 'not_found'
          : 'network_error'
    analytics.track('geocoding_failed', {
      service: 'mapbox',
      statusCode: response.status,
      reason,
    })
    // Mapbox explains rejections in the body, e.g. "Query too long - 21/20 tokens"
    const body: { message?: string } | undefined = await response.json?.().catch(() => undefined)
    const detail = `${response.status} ${body?.message || response.statusText}`
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Mapbox rejected ${describeKey('mapbox', apiKey)} (${detail})`)
    }
    throw new Error(`Mapbox geocoding failed: ${detail}`)
  }

  const data: MapboxGeocodingResponse = await response.json()
  const results = (data.features ?? []).map(feature => ({
    place_name: feature.place_name,
    coordinates: {
      longitude: feature.center[0],
      latitude: feature.center[1],
    },
  }))

  return results
}

// Geocode using Photon API (free, OSM-based)
export async function geocodeWithPhoton(query: string): Promise<GeocodingResult[]> {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`
    const response = await fetch(url)
    const data: PhotonGeocodingResponse = await response.json()

    if (data.features) {
      return data.features.map(feature => ({
        place_name: feature.properties.name || feature.properties.street || 'Unknown location',
        coordinates: {
          longitude: feature.geometry.coordinates[0],
          latitude: feature.geometry.coordinates[1],
        },
      }))
    }
    return []
  } catch (error) {
    debugGeocode('Photon geocoding error:', error)
    return []
  }
}
