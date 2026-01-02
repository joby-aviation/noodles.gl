import { getKeysStore } from '../noodles/keys-store'

export interface GeocodingResult {
  place_name: string
  coordinates: { longitude: number; latitude: number }
}

// Track if Google Maps API is loaded to avoid duplicate imports
let googleMapsLoaded = false

/**
 * Load Google Maps JavaScript API
 */
async function loadGoogleMapsAPI(apiKey: string): Promise<void> {
  if (googleMapsLoaded) return

  const params = new URLSearchParams({
    v: 'weekly',
    key: apiKey,
  })

  await import(/* @vite-ignore */ `https://maps.googleapis.com/maps/api/js?${params.toString()}`)
  googleMapsLoaded = true
}

/**
 * Geocode using Google Places Autocomplete Service
 * Returns autocomplete predictions for a search query
 */
export async function geocodeWithGooglePlaces(query: string): Promise<GeocodingResult[]> {
  const apiKey = getKeysStore().getKey('googleMaps')
  if (!apiKey) {
    throw new Error('Google Maps API key not configured')
  }

  // Load API if needed
  await loadGoogleMapsAPI(apiKey)

  // Get autocomplete predictions
  const autocompleteService = new google.maps.places.AutocompleteService()
  const predictions = await new Promise<google.maps.places.AutocompletePrediction[]>(
    (resolve, reject) => {
      autocompleteService.getPlacePredictions(
        {
          input: query,
          types: ['geocode'], // Addresses and place names
        },
        (results, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            resolve(results)
          } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            resolve([])
          } else {
            reject(new Error(`Google Places API error: ${status}`))
          }
        }
      )
    }
  )

  // Geocode each prediction to get coordinates
  const geocoder = new google.maps.Geocoder()
  const results: GeocodingResult[] = []

  for (const prediction of predictions.slice(0, 5)) {
    try {
      const geocodeResult = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
        geocoder.geocode({ placeId: prediction.place_id }, (results, status) => {
          if (status === google.maps.GeocoderStatus.OK && results) {
            resolve(results)
          } else {
            reject(new Error(`Geocoding failed: ${status}`))
          }
        })
      })

      if (geocodeResult[0]) {
        const location = geocodeResult[0].geometry.location
        results.push({
          place_name: prediction.description,
          coordinates: {
            longitude: location.lng(),
            latitude: location.lat(),
          },
        })
      }
    } catch (error) {
      console.error('Error geocoding place:', error)
      // Continue with other predictions even if one fails
    }
  }

  return results
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
