import type { Operator } from '../operators'
import { arrowColumnNames } from './arrow-utils'
import { isArrowTable } from './arrow-utils'

// Mapping from accessor defaultAttribute names to common column name patterns
// Inspired by Houdini's attribute conventions (Cd for color, P for position, etc.)
const ATTRIBUTE_MAPPINGS: Record<string, string[]> = {
  position: ['position', 'pos', 'point', 'lnglat', 'coords', 'geometry', 'P'],
  lat: ['lat', 'latitude', 'y'],
  lng: ['lng', 'lon', 'longitude', 'x'],
  fillColor: ['Cd', 'color', 'fillColor', 'fill', 'rgba', 'rgb'],
  lineColor: ['lineColor', 'strokeColor', 'stroke', 'outline'],
  radius: ['radius', 'size', 'r', 'width', 'scale'],
  elevation: ['elevation', 'height', 'z', 'altitude'],
  text: ['text', 'label', 'name', 'title', 'description'],
  size: ['size', 'radius', 'scale', 'width'],
  angle: ['angle', 'rotation', 'heading', 'bearing'],
  width: ['width', 'lineWidth', 'strokeWidth', 'thickness'],
  sourcePosition: ['sourcePosition', 'sourcePos', 'origin', 'from', 'start'],
  targetPosition: ['targetPosition', 'targetPos', 'destination', 'to', 'end'],
}

// Check if data looks like GeoJSON/TopoJSON features
function isGeoJsonFeatureCollection(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return obj.type === 'FeatureCollection' && Array.isArray(obj.features)
}

function isGeoJsonFeature(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return obj.type === 'Feature' && typeof obj.geometry === 'object'
}

// Extract column names from data (Arrow table, object array, or GeoJSON)
export function extractSchemaFromData(data: unknown): string[] {
  if (isArrowTable(data)) {
    return arrowColumnNames(data)
  }

  // Handle GeoJSON FeatureCollection
  if (isGeoJsonFeatureCollection(data)) {
    const features = (data as { features: unknown[] }).features
    if (features.length > 0 && isGeoJsonFeature(features[0])) {
      const feature = features[0] as { properties?: Record<string, unknown> }
      const columns = feature.properties ? Object.keys(feature.properties) : []
      // GeoJSON always has 'geometry' available for position
      if (!columns.includes('geometry')) {
        columns.push('geometry')
      }
      return columns
    }
  }

  // Handle array of GeoJSON features
  if (Array.isArray(data) && data.length > 0 && isGeoJsonFeature(data[0])) {
    const feature = data[0] as { properties?: Record<string, unknown> }
    const columns = feature.properties ? Object.keys(feature.properties) : []
    if (!columns.includes('geometry')) {
      columns.push('geometry')
    }
    return columns
  }

  // Handle attribute-enhanced data format
  if (data && typeof data === 'object' && 'data' in data) {
    const innerData = (data as { data: unknown }).data
    if (Array.isArray(innerData) && innerData.length > 0 && typeof innerData[0] === 'object') {
      return Object.keys(innerData[0] as Record<string, unknown>)
    }
  }

  // Handle plain array
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    return Object.keys(data[0] as Record<string, unknown>)
  }

  return []
}

// Find best matching column name for a given default attribute
// Returns the matched column name or null if no match found
export function findBestColumnMatch(
  defaultAttribute: string,
  availableColumns: string[]
): string | null {
  const normalizedColumns = availableColumns.map(col => col.toLowerCase())
  const patterns = ATTRIBUTE_MAPPINGS[defaultAttribute] || []

  // Try exact match first (case-insensitive)
  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase()
    const index = normalizedColumns.indexOf(lowerPattern)
    if (index !== -1) {
      return availableColumns[index]
    }
  }

  return null
}

// Special case: detect GeoJSON geometry column
function detectGeoJsonGeometry(columns: string[]): boolean {
  return columns.includes('geometry')
}

// Special case: detect lat/lng pairs and construct position expression
function detectLatLngPair(columns: string[]): { lat: string; lng: string } | null {
  const normalizedColumns = columns.map(col => col.toLowerCase())

  const latPatterns = ['lat', 'latitude', 'y']
  const lngPatterns = ['lng', 'lon', 'longitude', 'x']

  let latCol: string | null = null
  let lngCol: string | null = null

  for (const pattern of latPatterns) {
    const index = normalizedColumns.indexOf(pattern)
    if (index !== -1) {
      latCol = columns[index]
      break
    }
  }

  for (const pattern of lngPatterns) {
    const index = normalizedColumns.indexOf(pattern)
    if (index !== -1) {
      lngCol = columns[index]
      break
    }
  }

  if (latCol && lngCol) {
    return { lat: latCol, lng: lngCol }
  }

  return null
}

// Check if a value is an attribute reference or expression (not a uniform value)
function isAttributeOrExpression(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return 'attributeName' in value || 'expression' in value
}

// Auto-fill accessor fields on a layer operator based on upstream data schema
export function autoFillLayerAccessors(
  targetOp: Operator<unknown>,
  sourceData: unknown
): void {
  const columns = extractSchemaFromData(sourceData)
  if (columns.length === 0) return

  // Check for GeoJSON geometry first, then lat/lng pair for position fields
  const hasGeoJsonGeometry = detectGeoJsonGeometry(columns)
  const latLngPair = detectLatLngPair(columns)

  for (const [fieldName, field] of Object.entries(targetOp.inputs)) {
    // Only auto-fill fields with defaultAttribute set
    if (!field.defaultAttribute) continue

    // Skip if field already has an attribute or expression value (user has customized it)
    const currentValue = field.value
    if (isAttributeOrExpression(currentValue)) continue

    // Skip if user has manually changed the value from default (uniform value mode)
    // Note: defaultValue might be pre-transform (e.g., '#fff') while value is post-transform ([255,255,255,255])
    // So we check if values are primitives and different, or if they're the same object reference
    const isPrimitive = (v: unknown) =>
      typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null
    if (isPrimitive(currentValue) && currentValue !== field.defaultValue) {
      continue
    }

    // Special handling for position fields with GeoJSON geometry
    if (field.defaultAttribute === 'position' && hasGeoJsonGeometry) {
      // Deck.gl GeoJsonLayer automatically extracts position from geometry
      // Use expression to access geometry.coordinates for point features
      field.setValue({ expression: 'd.geometry.type === "Point" ? d.geometry.coordinates : d.geometry' })
      field.autoDetected = true
      continue
    }

    // Special handling for position fields with lat/lng
    if (field.defaultAttribute === 'position' && latLngPair) {
      field.setValue({ expression: `[d.${latLngPair.lng}, d.${latLngPair.lat}, 0]` })
      field.autoDetected = true
      continue
    }

    // Try to match column to default attribute
    const matchedColumn = findBestColumnMatch(field.defaultAttribute, columns)
    if (matchedColumn) {
      field.setValue({ attributeName: matchedColumn })
      field.autoDetected = true
    }
  }
}
