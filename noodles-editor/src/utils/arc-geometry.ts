// Adapted from deck.gl's arc layer

export const mix = (from: number, to: number, t: number) => from + (to - from) * t

export const mixspace = (start: number, end: number, mixAmount: number[]) =>
  mixAmount.map(amount => mix(start, end, amount))

export const clamp = (x: number, lower: number, upper: number) =>
  Math.max(lower, Math.min(x, upper))

export const range = (stop: number) => Array.from({ length: stop }, (_, i) => i)

export const smoothstep = (edge0: number, edge1: number, _x: number) => {
  // Scale, bias and saturate x to 0..1 range
  const x = clamp((_x - edge0) / (edge1 - edge0), 0, 1)
  return x * x * (3 - 2 * x)
}

export const segmentRatios = (segmentCount = 100, smooth = true) =>
  range(segmentCount).map(
    smooth ? x => smoothstep(0, 1, x / (segmentCount - 1)) : x => mix(0, 1, x / (segmentCount - 1))
  )

export const paraboloid = (
  distance: number,
  sourceZ: number,
  targetZ: number,
  ratio: number,
  scaleHeight = 1.0
) => {
  // d: distance on the xy plane
  // r: ratio of the current point
  // p: ratio of the peak of the arc
  // h: height multiplier
  // z = f(r) = sqrt(r * (p * 2 - r)) * d * h
  // f(0) = 0
  // f(1) = dz

  const deltaZ = targetZ - sourceZ
  const dh = distance * scaleHeight
  if (dh === 0) return sourceZ + deltaZ * ratio

  const unitZ = deltaZ / dh
  const p2 = unitZ * unitZ + 1.0

  // sqrt does not deal with negative values, manually flip source and target if delta.z < 0
  const dir = 0 < deltaZ ? 0 : 1
  const z0 = mix(sourceZ, targetZ, dir)
  const r = mix(ratio, 1.0 - ratio, dir)
  return Math.sqrt(r * (p2 - r)) * dh + z0
}

export type Point = {
  lat: number
  lng: number
  alt: number
}

export const getArc = ({
  source,
  target,
  arcHeight,
  smoothHeight = true,
  smoothPosition = false,
  segmentCount = 250,
  wrapLongitude = true,
  tilt = 0, // Default is 0 (no tilt)
}: {
  source: Point
  target: Point
  arcHeight: number
  smoothHeight?: boolean
  smoothPosition?: boolean
  segmentCount?: number
  wrapLongitude?: boolean
  tilt?: number // Tilt angle in degrees (-90 to 90)
}) => {
  const _tilt = Math.max(-90, Math.min(90, tilt)) // clamp tilt

  const altSteps = segmentRatios(segmentCount, smoothHeight)
  const alts = altSteps.map(altStep => paraboloid(arcHeight, source.alt, target.alt, altStep))

  const positionSteps = segmentRatios(segmentCount, smoothPosition)

  // Calculate the shortest path longitude interpolation
  let lngs: number[]
  if (wrapLongitude) {
    const diff = target.lng - source.lng
    const deltaLng = diff > 180 ? diff - 360 : diff < -180 ? diff + 360 : diff // Adjust for anti-meridian crossing
    lngs = positionSteps.map(step => source.lng + deltaLng * step)
    // Normalize longitudes that wrap around
    lngs = lngs.map(lng => (lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng))
  } else {
    lngs = mixspace(source.lng, target.lng, positionSteps)
  }
  const lats = mixspace(source.lat, target.lat, positionSteps)

  const points = alts.map((alt, idx) => [lngs[idx], lats[idx], alt])

  return _tilt === 0 ? points : points.map(p => tiltPoint(p, source, target, _tilt))
}

export const tiltPoint = (point: number[], start: Point, end: Point, tilt: number) => {
  const [lng, lat, alt] = point

  const tiltRad = (tilt * Math.PI) / 180

  // Approximate Earth's radius in meters
  const EARTH_RADIUS = 6371000

  // Compute great-circle direction vector
  const dirX = end.lng - start.lng
  const dirY = end.lat - start.lat
  const magnitude = Math.sqrt(dirX * dirX + dirY * dirY) || 1 // Avoid division by zero

  const dirNormalizedX = dirX / magnitude
  const dirNormalizedY = dirY / magnitude

  // Compute perpendicular tilt direction (90-degree rotation)
  const tiltDirX = -dirNormalizedY
  const tiltDirY = dirNormalizedX

  // Compute displacement amount in meters
  const tiltDisplacement = alt * Math.sin(tiltRad) // z is altitude (already in meters)

  // Convert meters to lat/lng offsets
  const metersToDegreesLat = (tiltDisplacement / EARTH_RADIUS) * (180 / Math.PI)
  const metersToDegreesLng = metersToDegreesLat / Math.cos(lat * (Math.PI / 180)) // Adjust for latitude scale

  // Apply tilt displacement to longitude and latitude
  const tiltLng = tiltDirX * metersToDegreesLng
  const tiltLat = tiltDirY * metersToDegreesLat

  // Adjust altitude
  const tiltedZ = alt * Math.cos(tiltRad)

  return [lng + tiltLng, lat + tiltLat, tiltedZ]
}
