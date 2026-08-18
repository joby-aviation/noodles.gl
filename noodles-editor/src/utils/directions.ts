import polyline from '@mapbox/polyline'
import haversine from 'haversine-distance'
import { Temporal } from 'temporal-polyfill'
import tzLookup from 'tz-lookup'
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
export const DRIVING_TRAFFIC = 'driving-traffic'
export const TRANSIT = 'transit'

export type DirectionsMode = typeof DRIVING | typeof DRIVING_TRAFFIC | typeof TRANSIT

export function resolveOriginDepartureTime({
  origin,
  localTime,
  now = Temporal.Now.instant(),
}: {
  origin: { lat: number; lng: number }
  localTime: Temporal.PlainDateTime
  now?: Temporal.Instant
}): Date {
  let timeZone: string
  try {
    timeZone = tzLookup(origin.lat, origin.lng)
  } catch {
    throw new Error('Could not determine the departure timezone from the route origin.')
  }

  let instant: Temporal.Instant
  try {
    instant = localTime.toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant()
  } catch {
    throw new Error(
      `The departure time ${localTime.toString()} is ambiguous or does not exist in ${timeZone} because of daylight saving time.`
    )
  }

  if (Temporal.Instant.compare(instant, now) <= 0) {
    throw new Error(`Departure time must be in the future at the route origin (${timeZone}).`)
  }

  return new Date(instant.epochMilliseconds)
}

export async function getDirections({
  origin,
  destination,
  mode = DRIVING,
  departureTime,
}: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  mode?: DirectionsMode
  departureTime?: Temporal.PlainDateTime
}): Promise<AnimatedDirections> {
  switch (mode) {
    case DRIVING:
      return getDrivingDirections({ origin, destination })
    case DRIVING_TRAFFIC:
      return getTrafficAwareDrivingDirections({ origin, destination, departureTime })
    case TRANSIT:
      return getTransitDirections({ origin, destination })
    default:
      throw new Error(`Invalid mode: ${mode}`)
  }
}

function formatDuration(duration: number): string {
  return `${Math.round(duration / 60)} mins, ${Math.round(duration % 60)} secs`
}

function createTimestamps(path: number[][], distance: number, duration: number): number[] {
  if (path.length === 0 || distance <= 0 || duration <= 0) return []

  // Millisecond precision matches TripsLayer's existing route animation contract.
  const speed = distance / duration / 1000
  const timestamps = [0]
  for (let i = 1; i < path.length; i++) {
    const previous = timestamps[i - 1]
    const segmentDistance = haversine([path[i - 1][1], path[i - 1][0]], [path[i][1], path[i][0]])
    timestamps.push(previous + segmentDistance / speed)
  }
  return timestamps
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

  const timestamps = createTimestamps(coords, distance, duration)
  const durationFormatted = formatDuration(duration)

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

    const coords = polyline.decode(geometry)
    const path = coords.map(([lat, lng]) => [lng, lat])
    const timestamps = createTimestamps(path, distance, duration)
    const durationFormatted = formatDuration(duration)

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

async function getTrafficAwareDrivingDirections({
  origin,
  destination,
  departureTime,
}: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  departureTime?: Temporal.PlainDateTime
}): Promise<AnimatedDirections> {
  const apiKey = getKeysStore().getKey('googleMaps')
  if (!apiKey) {
    throw new Error(
      'Google Maps API key not configured. Add one in Settings > API Keys to use traffic-aware driving.'
    )
  }

  await loadGoogleMapsAPI(apiKey)
  const { PolylineQuality, Route, RoutingPreference, TrafficModel, TravelMode } =
    await google.maps.importLibrary('routes')

  const scheduledDeparture = departureTime
    ? resolveOriginDepartureTime({ origin, localTime: departureTime })
    : undefined

  try {
    const { routes } = await Route.computeRoutes({
      origin,
      destination,
      travelMode: TravelMode.DRIVING,
      routingPreference: RoutingPreference.TRAFFIC_AWARE_OPTIMAL,
      trafficModel: TrafficModel.BEST_GUESS,
      polylineQuality: PolylineQuality.HIGH_QUALITY,
      fields: ['path', 'distanceMeters', 'durationMillis'],
      ...(scheduledDeparture ? { departureTime: scheduledDeparture } : {}),
    })

    const route = routes?.[0]
    const distance = route?.distanceMeters
    const durationMillis = route?.durationMillis
    const path = route?.path?.map(point => [point.lng, point.lat])
    if (!route || distance === undefined || durationMillis == null || !path?.length) {
      throw new Error('Google returned no complete route.')
    }

    const duration = durationMillis / 1000
    return {
      distance,
      duration,
      durationFormatted: formatDuration(duration),
      path,
      timestamps: createTimestamps(path, distance, duration),
    }
  } catch (error) {
    throw new Error(
      `Google traffic directions failed: ${error instanceof Error ? error.message : String(error)}`
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
