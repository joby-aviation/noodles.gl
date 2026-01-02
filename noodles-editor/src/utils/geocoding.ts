import { getKeysStore } from '../noodles/keys-store'

export interface GeocodingResult {
  place_name: string
  coordinates: { longitude: number; latitude: number }
}

// Track if Google Maps API is loaded to avoid duplicate imports
let googleMapsLoaded = false
let googleMapsPromise: Promise<void> | null = null

/**
 * Load Google Maps JavaScript API with Places library
 */
async function loadGoogleMapsAPI(apiKey: string): Promise<void> {
  if (googleMapsLoaded) return
  if (googleMapsPromise) return googleMapsPromise

  googleMapsPromise = new Promise<void>((resolve, reject) => {
    // Create a unique callback name
    const callbackName = `googleMapsCallback_${Date.now()}`

    // Set up the callback
    ;(window as any)[callbackName] = () => {
      googleMapsLoaded = true
      resolve()
      delete (window as any)[callbackName]
    }

    const params = new URLSearchParams({
      v: 'weekly',
      key: apiKey,
      libraries: 'places',
      loading: 'async',
      callback: callbackName,
    })

    // Dynamically load the script
    import(/* @vite-ignore */ `https://maps.googleapis.com/maps/api/js?${params.toString()}`).catch(
      reject
    )
  })

  return googleMapsPromise
}

/**
 * Geocode using Google Places AutocompleteSuggestion API (recommended)
 * Returns autocomplete predictions for a search query
 */
export async function geocodeWithGooglePlaces(query: string): Promise<GeocodingResult[]> {
  const apiKey = getKeysStore().getKey('googleMaps')
  if (!apiKey) {
    throw new Error('Google Maps API key not configured')
  }

  // Load API if needed
  await loadGoogleMapsAPI(apiKey)

  // Use the new AutocompleteSuggestion API (recommended as of March 2025)
  const request = {
    input: query,
    includedPrimaryTypes: ['geocode'], // Addresses and place names
  }

  try {
    const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(
      request
    )

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
            fields: ['displayName', 'location'],
          })

          if (place.location) {
            results.push({
              place_name: place.displayName || suggestion.placePrediction.text.toString(),
              coordinates: {
                longitude: place.location.lng(),
                latitude: place.location.lat(),
              },
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

/**
 * Geocode using Mapbox Geocoding API
 */
export async function geocodeWithMapbox(
  query: string,
  apiKey: string
): Promise<GeocodingResult[]> {
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

/**
 * Geocode using Photon API (free, OSM-based)
 */
export async function geocodeWithPhoton(query: string): Promise<GeocodingResult[]> {
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
