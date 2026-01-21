import { getKeysStore } from '../noodles/keys-store'

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

// Load Google Maps JavaScript API
export async function loadGoogleMapsAPI(apiKey: string): Promise<void> {
  if (googleMapsLoaded) return

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
  googleMapsPromise = new Promise<void>((resolve, reject) => {
    const callbackName = `googleMapsCallback_${Date.now()}`

    window[callbackName] = () => {
      googleMapsLoaded = true
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

    import(/* @vite-ignore */ `https://maps.googleapis.com/maps/api/js?${params.toString()}`).catch(
      error => {
        loadingApiKey = null
        reject(error)
      }
    )
  })

  return googleMapsPromise
}

// Geocode using Google Places AutocompleteSuggestion API (recommended)
// Returns autocomplete predictions for a search query
export async function geocodeWithGooglePlaces(query: string): Promise<GeocodingResult[]> {
  const apiKey = getKeysStore().getKey('googleMaps')
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
        console.error('Error fetching place details:', error)
        // Continue with other suggestions even if one fails
      }
    }

    return results
  } catch (error) {
    console.error('Google Places API error:', error)
    throw error
  }
}

// Geocode using Mapbox Geocoding API
export async function geocodeWithMapbox(query: string, apiKey: string): Promise<GeocodingResult[]> {
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${apiKey}&limit=5`
    const response = await fetch(url)
    const data: MapboxGeocodingResponse = await response.json()

    if (data.features) {
      return data.features.map(feature => ({
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
    console.error('Photon geocoding error:', error)
    return []
  }
}
