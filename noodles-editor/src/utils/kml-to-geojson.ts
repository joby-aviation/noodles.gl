import { kml } from '@tmcw/togeojson'
import type { FeatureCollection } from 'geojson'

/**
 * Convert KML string to GeoJSON FeatureCollection
 * @param kmlString - KML string to convert
 * @returns GeoJSON FeatureCollection
 */
export function kmlToGeoJson(kmlString: string): FeatureCollection {
  // Parse KML string to XML DOM
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(kmlString, 'text/xml')

  // Check for parsing errors
  const parserError = xmlDoc.querySelector('parsererror')
  if (parserError) {
    throw new Error(`Failed to parse KML: ${parserError.textContent}`)
  }

  // Convert to GeoJSON
  return kml(xmlDoc)
}
