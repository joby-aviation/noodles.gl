import * as turf from '@turf/turf'
import type { DrawMode } from './map-tool-store'
import { formatArea, formatDistance, type LngLat, pathLength, polygonArea } from './measure-math'

// Pure geometry for the Draw tool: building features from clicked points, converting
// a finished shape between line and polygon, and deciding which follow-up actions
// make sense for what was drawn. Kept out of the overlay so it can be tested alone.

export type ShapeKind = DrawMode

export const MIN_POINTS: Record<ShapeKind, number> = { point: 1, line: 2, polygon: 3 }

export function buildShape(points: LngLat[], kind: ShapeKind): GeoJSON.Feature | null {
  if (points.length < MIN_POINTS[kind]) return null
  const coordinates = points.map(p => [p.lng, p.lat])
  let geometry: GeoJSON.Geometry
  if (kind === 'point') {
    geometry = { type: 'Point', coordinates: coordinates[0] }
  } else if (kind === 'line') {
    geometry = { type: 'LineString', coordinates }
  } else {
    geometry = { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
  }
  return { type: 'Feature', geometry, properties: {} }
}

export function shapeKind(feature: GeoJSON.Feature): ShapeKind | null {
  switch (feature.geometry?.type) {
    case 'Point':
      return 'point'
    case 'LineString':
      return 'line'
    case 'Polygon':
      return 'polygon'
    default:
      return null
  }
}

function samePosition(a: GeoJSON.Position, b: GeoJSON.Position): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

// A line with at least three distinct vertices becomes a polygon by joining its ends.
// A line that already ends where it started reuses that vertex instead of doubling it.
export function closeIntoPolygon(feature: GeoJSON.Feature): GeoJSON.Feature | null {
  if (feature.geometry?.type !== 'LineString') return null
  const coordinates = feature.geometry.coordinates
  const alreadyClosed =
    coordinates.length > 1 && samePosition(coordinates[0], coordinates[coordinates.length - 1])
  const open = alreadyClosed ? coordinates.slice(0, -1) : coordinates
  if (open.length < 3) return null
  return {
    ...feature,
    geometry: { type: 'Polygon', coordinates: [[...open, open[0]]] },
  }
}

// A polygon becomes its outline: the outer ring as a closed LineString.
export function openIntoLine(feature: GeoJSON.Feature): GeoJSON.Feature | null {
  if (feature.geometry?.type !== 'Polygon') return null
  const ring = feature.geometry.coordinates[0]
  if (!ring || ring.length < 4) return null
  return { ...feature, geometry: { type: 'LineString', coordinates: ring } }
}

function toLngLats(positions: GeoJSON.Position[]): LngLat[] {
  return positions.map(([lng, lat]) => ({ lng, lat }))
}

// Short description for the shape list, e.g. "Polygon · 1.24 km²"
export function describeShape(feature: GeoJSON.Feature): string {
  const geometry = feature.geometry
  if (geometry?.type === 'Polygon') {
    const ring = toLngLats(geometry.coordinates[0].slice(0, -1))
    return `Polygon · ${formatArea(polygonArea(ring))}`
  }
  if (geometry?.type === 'LineString') {
    const length = pathLength(toLngLats(geometry.coordinates))
    return `Line · ${formatDistance(length, 'kilometers')}`
  }
  return 'Point'
}

// Something the user can do with a finished drawing besides showing it as a layer.
// Each one opens the matching geo recipe with the drawing already wired into
// `shapeInput`, so only the remaining choices are left to the user.
export interface DrawFollowUp {
  id: string
  label: string
  icon: string
  recipeId: string
  shapeInput: string
  // The recipe only reads these kinds of geometry; other shapes are left out of
  // the GeoEditor it receives
  kinds: ShapeKind[]
  // The recipe reads only the first feature of this input, so several shapes are
  // merged into one boundary before they reach it
  singleFeature?: boolean
}

export const DRAW_FOLLOW_UPS: DrawFollowUp[] = [
  {
    id: 'clip',
    singleFeature: true,
    label: 'Clip data to shape',
    icon: 'pi pi-crop',
    recipeId: 'clip',
    shapeInput: 'mask',
    kinds: ['polygon'],
  },
  {
    id: 'points-inside',
    singleFeature: true,
    label: 'Find points inside',
    icon: 'pi pi-check-circle',
    recipeId: 'point-in-polygon',
    shapeInput: 'polygon',
    kinds: ['polygon'],
  },
  {
    id: 'along',
    label: 'Move a point along line',
    icon: 'pi pi-map-marker',
    recipeId: 'along',
    shapeInput: 'geojson',
    kinds: ['line'],
  },
  {
    id: 'buffer',
    label: 'Buffer',
    icon: 'pi pi-circle',
    recipeId: 'buffer',
    shapeInput: 'geojson',
    kinds: ['point', 'line', 'polygon'],
  },
]

// Follow-ups that apply to at least one drawn shape, in display order
export function followUpsFor(features: GeoJSON.Feature[]): DrawFollowUp[] {
  const kinds = new Set(features.map(shapeKind))
  return DRAW_FOLLOW_UPS.filter(followUp => followUp.kinds.some(kind => kinds.has(kind)))
}

export function featuresFor(
  followUp: DrawFollowUp,
  features: GeoJSON.Feature[]
): GeoJSON.Feature[] {
  const relevant = features.filter(feature => {
    const kind = shapeKind(feature)
    return kind !== null && followUp.kinds.includes(kind)
  })
  if (!followUp.singleFeature || relevant.length < 2) return relevant
  return [mergePolygons(relevant as GeoJSON.Feature<GeoJSON.Polygon>[])]
}

// Unions the polygons so overlaps don't double up; disjoint ones become a
// MultiPolygon. Falls back to stacking the rings if the union fails on bad geometry.
export function mergePolygons(polygons: GeoJSON.Feature<GeoJSON.Polygon>[]): GeoJSON.Feature {
  try {
    const merged = turf.union(turf.featureCollection(polygons))
    if (merged) return { ...merged, properties: {} }
  } catch {
    // fall through
  }
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: polygons.map(p => p.geometry.coordinates) },
    properties: {},
  }
}

export function toFeatureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features }
}
