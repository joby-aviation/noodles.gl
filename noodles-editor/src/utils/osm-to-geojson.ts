// OpenStreetMap JSON (an Overpass API answer) as GeoJSON: tagged nodes as points, ways as lines
// or polygons when closed, and multipolygon relations from their members' geometry.

export function osmToGeoJson(osmData: {
  elements?: Array<{
    type: string
    id: number
    lat?: number
    lon?: number
    tags?: Record<string, string>
    geometry?: Array<{ lat: number; lon: number }>
    nodes?: number[]
  }>
}): { type: 'FeatureCollection'; features: unknown[] } {
  const features: unknown[] = []

  // Build node map for way processing
  const nodeMap: Record<
    number,
    {
      id: number
      lat: number
      lon: number
      tags?: Record<string, string>
    }
  > = {}
  for (const element of osmData.elements || []) {
    if (element.type === 'node') {
      nodeMap[element.id] = element

      // Only create features for tagged nodes (POIs)
      if (element.tags) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [element.lon, element.lat],
          },
          properties: { ...element.tags, osm_id: element.id, osm_type: 'node' },
        })
      }
    }
  }

  // Process ways (lines and polygons)
  for (const element of osmData.elements || []) {
    if (element.type === 'way' && element.tags) {
      // If geometry is included (from 'out geom'), use it directly
      if (element.geometry) {
        const coordinates = element.geometry.map(node => [node.lon, node.lat])

        if (coordinates.length < 2) continue

        // Check if way is closed (polygon) using epsilon comparison for floating point coordinates
        const epsilon = 1e-9
        const isClosed =
          coordinates.length > 2 &&
          Math.abs(coordinates[0][0] - coordinates[coordinates.length - 1][0]) < epsilon &&
          Math.abs(coordinates[0][1] - coordinates[coordinates.length - 1][1]) < epsilon

        features.push({
          type: 'Feature',
          geometry: {
            type: isClosed ? 'Polygon' : 'LineString',
            coordinates: isClosed ? [coordinates] : coordinates,
          },
          properties: { ...element.tags, osm_id: element.id, osm_type: 'way' },
        })
      }
      // Otherwise try to build from nodes
      else if (element.nodes) {
        const coordinates = element.nodes
          .map((nodeId: number) => {
            const node = nodeMap[nodeId] || osmData.elements?.find(n => n.id === nodeId)
            return node?.lat !== undefined && node?.lon !== undefined ? [node.lon, node.lat] : null
          })
          .filter((coord): coord is [number, number] => coord !== null)

        if (coordinates.length < 2) continue

        // Check if way is closed (polygon)
        const isClosed = element.nodes[0] === element.nodes[element.nodes.length - 1]

        features.push({
          type: 'Feature',
          geometry: {
            type: isClosed ? 'Polygon' : 'LineString',
            coordinates: isClosed ? [coordinates] : coordinates,
          },
          properties: { ...element.tags, osm_id: element.id, osm_type: 'way' },
        })
      }
    }
  }

  // Process relations (multipolygons and other complex geometries)
  for (const element of osmData.elements || []) {
    if (element.type === 'relation' && element.tags) {
      // Relations with 'out geom;' include member geometries
      const members = (
        element as unknown as {
          members?: Array<{
            type: string
            ref: number
            role: string
            lat?: number
            lon?: number
            geometry?: Array<{ lat: number; lon: number }>
          }>
        }
      ).members

      if (!members) continue

      // Group members by role (outer/inner for multipolygons)
      const outerWays = members.filter(m => m.role === 'outer' && m.geometry)
      const innerWays = members.filter(m => m.role === 'inner' && m.geometry)

      if (outerWays.length > 0) {
        // Build polygon rings
        const outerRings = outerWays.map(way => way.geometry!.map(node => [node.lon, node.lat]))
        const innerRings = innerWays.map(way => way.geometry!.map(node => [node.lon, node.lat]))

        // If single outer ring, create Polygon; otherwise MultiPolygon
        if (outerRings.length === 1) {
          features.push({
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [outerRings[0], ...innerRings],
            },
            properties: { ...element.tags, osm_id: element.id, osm_type: 'relation' },
          })
        } else {
          // Multiple outer rings - create MultiPolygon
          features.push({
            type: 'Feature',
            geometry: {
              type: 'MultiPolygon',
              coordinates: outerRings.map(outer => [outer, ...innerRings]),
            },
            properties: { ...element.tags, osm_id: element.id, osm_type: 'relation' },
          })
        }
      }
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}
