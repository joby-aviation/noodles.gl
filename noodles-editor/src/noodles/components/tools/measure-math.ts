import type { DistanceUnit } from './map-tool-store'

// Spherical geodesy for the measure tool. Shared by the on-map overlay and the
// coordinate-entry dialog so both report the same numbers.

const EARTH_RADIUS_KM = 6371

export interface LngLat {
  lng: number
  lat: number
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

// Great-circle distance in kilometres
export function haversineDistance(a: LngLat, b: LngLat): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// Total length of an open path, in kilometres
export function pathLength(points: LngLat[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineDistance(points[i - 1], points[i])
  return total
}

// Spherical excess area of a closed ring, in square kilometres
export function polygonArea(points: LngLat[]): number {
  if (points.length < 3) return 0
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    total +=
      toRadians(next.lng - current.lng) *
      (2 + Math.sin(toRadians(current.lat)) + Math.sin(toRadians(next.lat)))
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2)
}

const UNIT_PER_KM: Record<DistanceUnit, number> = {
  kilometers: 1,
  miles: 0.621371,
  meters: 1000,
  nauticalmiles: 0.539957,
}

export const UNIT_LABELS: Record<DistanceUnit, string> = {
  kilometers: 'km',
  miles: 'mi',
  meters: 'm',
  nauticalmiles: 'nmi',
}

export function convertDistance(km: number, unit: DistanceUnit): number {
  return km * UNIT_PER_KM[unit]
}

// Format a distance already converted into `unit`. Short readings switch to a finer
// unit so a few metres does not display as "0.00 km".
export function formatDistance(value: number, unit: DistanceUnit): string {
  if (unit === 'meters') {
    if (value >= 1000) return `${(value / 1000).toFixed(2)} km`
    return `${value.toFixed(1)} m`
  }
  if (value < 0.01) return `${convertDistance(value / UNIT_PER_KM[unit], 'meters').toFixed(1)} m`
  return `${value.toFixed(2)} ${UNIT_LABELS[unit]}`
}

export function formatArea(squareKm: number): string {
  if (squareKm < 1) return `${(squareKm * 1_000_000).toFixed(0)} m²`
  if (squareKm > 1_000_000) return `${(squareKm / 1_000_000).toFixed(2)} million km²`
  return `${squareKm.toFixed(2)} km²`
}
