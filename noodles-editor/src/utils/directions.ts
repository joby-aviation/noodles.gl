import polyline from '@mapbox/polyline'
import haversine from 'haversine-distance'
import { getKeysStore } from '../noodles/keys-store'
import { loadGoogleMapsAPI } from './geocoding'

export type AnimatedDirections = {
  distance: number
  duration: number
  durationFormatted: string
  path: number[][]
  timestamps: number[]
}

// Mapbox Directions API response types
// See: https://docs.mapbox.com/api/navigation/directions/
interface MapboxRoute {
  geometry: string // polyline-encoded string
  distance: number // meters
  duration: number // seconds
}

interface MapboxDirectionsResponse {
  code: string
  message?: string
  routes: MapboxRoute[]
}

export const DRIVING = 'driving'
export const TRANSIT = 'transit'

export async function getDirections({
  origin,
  destination,
  mode = DRIVING,
}: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  mode?: typeof DRIVING | typeof TRANSIT
}): Promise<AnimatedDirections> {
  switch (mode) {
    case DRIVING:
      return getDrivingDirections({ origin, destination })
    case TRANSIT:
      return getTransitDirections({ origin, destination })
    default:
      throw new Error(`Invalid mode: ${mode}`)
  }
}

// OSRM public demo server response types
interface OSRMRoute {
  geometry: {
    type: 'LineString'
    coordinates: [number, number][] // [lng, lat]
  }
  distance: number // meters
  duration: number // seconds
}

interface OSRMDirectionsResponse {
  code: string
  message?: string
  routes: OSRMRoute[]
}

async function getDrivingDirectionsOSRM({
  origin,
  destination,
}: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
}): Promise<AnimatedDirections> {
  // NOTE: router.project-osrm.org is a public demo server — not for production traffic.
  // Replace with a self-hosted or commercial OSRM endpoint before shipping.
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`
  )
  const data: OSRMDirectionsResponse = await res.json()

  if (data.code !== 'Ok') {
    throw new Error(data.message || `OSRM routing failed: ${data.code}`)
  }

  const [{ geometry, distance, duration }] = data.routes
  const coords = geometry.coordinates // already [lng, lat]

  // use millisecond precision for smooth motion
  const speed = distance / duration / 1000
  const timestamps = [0]

  for (let i = 1; i < coords.length; i++) {
    const prev = timestamps[i - 1]
    // haversine expects [lat, lng]
    const dist = haversine([coords[i - 1][1], coords[i - 1][0]], [coords[i][1], coords[i][0]])
    timestamps.push(prev + dist / speed)
  }

  const durationFormatted = `${Math.round(duration / 60)} mins, ${Math.round(duration % 60)} secs`

  return {
    distance,
    duration,
    durationFormatted,
    path: coords as number[][], // already [lng, lat] — no swap needed
    timestamps,
  }
}

async function getDrivingDirections({
  origin,
  destination,
}: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
}): Promise<AnimatedDirections> {
  const keysStore = getKeysStore()
  const token = keysStore.getKey('mapbox')

  if (token) {
    const res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?access_token=${token}&overview=full`
    )
    const data: MapboxDirectionsResponse = await res.json()

    if (data.code === 'NoSegment' || data.code === 'InvalidInput') {
      throw new Error(data.message)
    }

    const [{ geometry, distance, duration }] = data.routes

    // use millisecond precision for smooth motion
    // https://docs.unfolded.ai/studio/layer-reference/trip#geojson-as-input
    const speed = distance / duration / 1000
    const coords = polyline.decode(geometry)

    const startTime = 0
    const timestamps = [startTime]

    for (let i = 1; i < coords.length; i++) {
      const prev = timestamps[i - 1]
      const dist = haversine(coords[i - 1], coords[i])
      const delta = dist / speed
      timestamps.push(prev + delta)
    }

    const path = coords.map(([lat, lng]) => [lng, lat])
    const durationFormatted = `${Math.round(duration / 60)} mins, ${Math.round(duration % 60)} secs`

    return { distance, duration, durationFormatted, path, timestamps }
  }

  // Fall back to OSRM public demo server (free, no key required)
  try {
    return await getDrivingDirectionsOSRM({ origin, destination })
  } catch (error) {
    throw new Error(
      `Directions failed using free OSRM fallback: ${error instanceof Error ? error.message : error}. ` +
        'Add a Mapbox access token in Settings > API Keys for more reliable routing.'
    )
  }
}

async function getTransitDirections({
  origin,
  destination,
}: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
}): Promise<AnimatedDirections> {
  const keysStore = getKeysStore()
  const apiKey = keysStore.getKey('googleMaps')
  if (!apiKey) {
    throw new Error(
      'Google Maps API key not configured. Please add your key in Settings > API Keys.'
    )
  }

  await loadGoogleMapsAPI(apiKey)

  const directionsService = new google.maps.DirectionsService()
  const request: google.maps.DirectionsRequest = {
    origin: `${origin.lat}, ${origin.lng}`,
    destination: `${destination.lat}, ${destination.lng}`,
    travelMode: google.maps.TravelMode.TRANSIT,
  }

  const data = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
    directionsService.route(request, (result, status) => {
      if (status === 'OK' && result) {
        resolve(result)
      } else {
        reject(new Error(status))
      }
    })
  })

  const [
    {
      overview_polyline,
      legs: [
        {
          duration: { text: durationFormatted, value: duration },
          distance: { value: distance },
        },
      ],
    },
  ] = data.routes

  const coords = polyline.decode(overview_polyline)
  const path = coords.map(([lat, lng]) => [lng, lat])

  return {
    path,
    timestamps: [],
    distance,
    duration,
    durationFormatted,
  }
}
