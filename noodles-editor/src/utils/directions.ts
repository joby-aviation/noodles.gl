import polyline from '@mapbox/polyline'
import haversine from 'haversine-distance'

const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

export type AnimatedDirections = {
  distance: number
  duration: number
  durationFormatted: string
  path: number[][]
  timestamps: number[]
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

async function getDrivingDirections({
  origin,
  destination,
}: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
}): Promise<AnimatedDirections> {
  const res = await fetch(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?access_token=${MAPBOX_ACCESS_TOKEN}&overview=full`
  )
  const data = await res.json()

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

  // Convert to Deck format
  const path = coords.map(([lat, lng]) => [lng, lat])

  const durationFormatted = `${Math.round(duration / 60)} mins, ${Math.round(duration % 60)} secs`

  return {
    distance,
    duration,
    durationFormatted,
    path,
    timestamps,
  }
}

async function getTransitDirections({
  origin,
  destination,
}: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
}): Promise<AnimatedDirections> {
  const params = new URLSearchParams({
    v: 'weekly',
    key: GOOGLE_MAPS_API_KEY,
  })

  await import(/* @vite-ignore */ `https://maps.googleapis.com/maps/api/js?${params.toString()}`)

  const directionsService = new google.maps.DirectionsService()
  const request = {
    origin: `${origin.lat}, ${origin.lng}`,
    destination: `${destination.lat}, ${destination.lng}`,
    travelMode: 'TRANSIT',
  }

  const data = await new Promise((resolve, reject) => {
    directionsService.route(request, (result, status) => {
      if (status === 'OK') {
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
