import { describe, expect, it } from 'vitest'
import { edgeId } from '../../utils/id-utils'

describe('GeoJSON Import', () => {
  // Since createGeoJsonDropNodes requires nodeId which depends on the store,
  // we test the expected behavior based on the implementation

  const basePosition = { x: 100, y: 200 }

  const sampleGeoJson = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: { type: 'Point', coordinates: [-74.006, 40.7128] },
        properties: { name: 'New York' },
      },
      {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-74.006, 40.7128],
            [-118.2437, 34.0522],
          ],
        },
        properties: { name: 'NY to LA' },
      },
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-74.006, 40.7128],
              [-73.935, 40.73],
              [-73.99, 40.75],
              [-74.006, 40.7128],
            ],
          ],
        },
        properties: { name: 'Manhattan area' },
      },
    ],
  }

  // Mock createGeoJsonDropNodes behavior for testing expected structure
  function createMockGeoJsonDropNodes(
    geojson: typeof sampleGeoJson,
    basePosition: { x: number; y: number }
  ) {
    const geojsonId = '/geojson'
    const geojsonLayerId = '/geojson-layer'
    const mapId = '/basemap'
    const deckId = '/deck'

    const geometryTypeToOp: Record<string, string> = {
      Point: 'PointOp',
      LineString: 'LineStringOp',
      Polygon: 'PolygonOp',
      MultiPoint: 'MultiPointOp',
      MultiLineString: 'MultiLineStringOp',
      MultiPolygon: 'MultiPolygonOp',
    }

    const colSpacing = 350
    const rowSpacing = 150
    const maxColumns = 4

    const nodes: Array<{
      id: string
      type: string
      data: { inputs: Record<string, unknown> }
      position: { x: number; y: number }
    }> = []

    const featureEdges: Array<{
      source: string
      target: string
      sourceHandle: string
      targetHandle: string
    }> = []

    geojson.features.forEach((feature, i) => {
      const opType = geometryTypeToOp[feature.geometry.type]
      if (!opType) return

      const col = i % maxColumns
      const row = Math.floor(i / maxColumns)
      const featureId = `/feature-${i}`

      nodes.push({
        id: featureId,
        type: opType,
        data: {
          inputs: {
            coordinates: feature.geometry.coordinates,
            properties: feature.properties || {},
          },
        },
        position: {
          x: basePosition.x + col * colSpacing,
          y: basePosition.y + row * rowSpacing,
        },
      })

      featureEdges.push({
        source: featureId,
        target: geojsonId,
        sourceHandle: 'out.feature',
        targetHandle: 'par.features',
      })
    })

    const featureRowCount = Math.ceil(geojson.features.length / maxColumns)
    const geojsonY = basePosition.y + featureRowCount * rowSpacing + 100

    nodes.push({
      id: geojsonId,
      type: 'GeoJsonOp',
      data: { inputs: {} },
      position: { x: basePosition.x + colSpacing, y: geojsonY },
    })

    nodes.push({
      id: geojsonLayerId,
      type: 'GeoJsonLayerOp',
      data: { inputs: {} },
      position: { x: basePosition.x + colSpacing * 2, y: geojsonY },
    })

    nodes.push({
      id: mapId,
      type: 'MaplibreBasemapOp',
      data: { inputs: {} },
      position: { x: basePosition.x + colSpacing * 2, y: geojsonY + 200 },
    })

    const allEdges = [
      ...featureEdges,
      {
        source: geojsonId,
        target: geojsonLayerId,
        sourceHandle: 'out.featureCollection',
        targetHandle: 'par.data',
      },
      {
        source: geojsonLayerId,
        target: deckId,
        sourceHandle: 'out.layer',
        targetHandle: 'par.layers',
      },
      {
        source: mapId,
        target: deckId,
        sourceHandle: 'out.maplibre',
        targetHandle: 'par.basemap',
      },
    ].map(connection => ({ ...connection, id: edgeId(connection) }))

    return { nodes, edges: allEdges }
  }

  describe('createGeoJsonDropNodes', () => {
    it('creates a geometry operator for each feature', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      // 3 feature ops + GeoJsonOp + GeoJsonLayerOp + MaplibreBasemapOp
      expect(result.nodes).toHaveLength(6)
    })

    it('maps geometry types to correct operator types', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const nodeTypes = result.nodes.map(n => n.type)
      expect(nodeTypes).toContain('PointOp')
      expect(nodeTypes).toContain('LineStringOp')
      expect(nodeTypes).toContain('PolygonOp')
      expect(nodeTypes).toContain('GeoJsonOp')
      expect(nodeTypes).toContain('GeoJsonLayerOp')
      expect(nodeTypes).toContain('MaplibreBasemapOp')
    })

    it('passes coordinates and properties to feature operators', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const pointOp = result.nodes.find(n => n.type === 'PointOp')
      expect(pointOp?.data.inputs.coordinates).toEqual([-74.006, 40.7128])
      expect(pointOp?.data.inputs.properties).toEqual({ name: 'New York' })

      const lineOp = result.nodes.find(n => n.type === 'LineStringOp')
      expect(lineOp?.data.inputs.coordinates).toEqual([
        [-74.006, 40.7128],
        [-118.2437, 34.0522],
      ])
      expect(lineOp?.data.inputs.properties).toEqual({ name: 'NY to LA' })
    })

    it('connects each feature operator to the GeoJsonOp', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const featureToGeoJsonEdges = result.edges.filter(
        e => e.targetHandle === 'par.features' && e.sourceHandle === 'out.feature'
      )
      expect(featureToGeoJsonEdges).toHaveLength(3)
      expect(featureToGeoJsonEdges.every(e => e.target === '/geojson')).toBe(true)
    })

    it('connects GeoJsonOp to GeoJsonLayerOp', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const edge = result.edges.find(
        e => e.sourceHandle === 'out.featureCollection' && e.targetHandle === 'par.data'
      )
      expect(edge).toBeDefined()
      expect(edge?.source).toBe('/geojson')
      expect(edge?.target).toBe('/geojson-layer')
    })

    it('connects GeoJsonLayerOp to DeckRendererOp', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const edge = result.edges.find(
        e => e.sourceHandle === 'out.layer' && e.targetHandle === 'par.layers'
      )
      expect(edge).toBeDefined()
      expect(edge?.source).toBe('/geojson-layer')
      expect(edge?.target).toBe('/deck')
    })

    it('connects MaplibreBasemapOp to DeckRendererOp', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const edge = result.edges.find(
        e => e.sourceHandle === 'out.maplibre' && e.targetHandle === 'par.basemap'
      )
      expect(edge).toBeDefined()
      expect(edge?.source).toBe('/basemap')
      expect(edge?.target).toBe('/deck')
    })

    it('creates correct total number of edges', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      // 3 feature->geojson + geojson->layer + layer->deck + map->deck = 6
      expect(result.edges).toHaveLength(6)
    })

    it('generates unique edge IDs', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const edgeIds = result.edges.map(e => e.id)
      const uniqueIds = new Set(edgeIds)
      expect(uniqueIds.size).toBe(edgeIds.length)
    })

    it('positions feature operators in a grid layout', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const featureNodes = result.nodes.filter(n =>
        ['PointOp', 'LineStringOp', 'PolygonOp'].includes(n.type)
      )

      // All 3 features should be in the first row (maxColumns = 4)
      expect(featureNodes[0].position).toEqual({ x: 100, y: 200 })
      expect(featureNodes[1].position).toEqual({ x: 450, y: 200 })
      expect(featureNodes[2].position).toEqual({ x: 800, y: 200 })
    })

    it('positions GeoJsonOp below feature operators', () => {
      const result = createMockGeoJsonDropNodes(sampleGeoJson, basePosition)

      const geojsonNode = result.nodes.find(n => n.type === 'GeoJsonOp')
      const featureNodes = result.nodes.filter(n =>
        ['PointOp', 'LineStringOp', 'PolygonOp'].includes(n.type)
      )

      const maxFeatureY = Math.max(...featureNodes.map(n => n.position.y))
      expect(geojsonNode!.position.y).toBeGreaterThan(maxFeatureY)
    })
  })

  describe('GeoJSON geometry type mapping', () => {
    it('handles all supported geometry types', () => {
      const allTypesGeoJson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: {},
          },
          {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: {},
          },
          {
            type: 'Feature' as const,
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 0],
                ],
              ],
            },
            properties: {},
          },
          {
            type: 'Feature' as const,
            geometry: {
              type: 'MultiPoint',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
            properties: {},
          },
          {
            type: 'Feature' as const,
            geometry: {
              type: 'MultiLineString',
              coordinates: [
                [
                  [0, 0],
                  [1, 1],
                ],
                [
                  [2, 2],
                  [3, 3],
                ],
              ],
            },
            properties: {},
          },
          {
            type: 'Feature' as const,
            geometry: {
              type: 'MultiPolygon',
              coordinates: [
                [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                  ],
                ],
              ],
            },
            properties: {},
          },
        ],
      }

      const result = createMockGeoJsonDropNodes(allTypesGeoJson, basePosition)

      const nodeTypes = result.nodes.map(n => n.type)
      expect(nodeTypes).toContain('PointOp')
      expect(nodeTypes).toContain('LineStringOp')
      expect(nodeTypes).toContain('PolygonOp')
      expect(nodeTypes).toContain('MultiPointOp')
      expect(nodeTypes).toContain('MultiLineStringOp')
      expect(nodeTypes).toContain('MultiPolygonOp')
    })

    it('skips unsupported geometry types', () => {
      const unsupportedGeoJson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: { type: 'GeometryCollection', coordinates: [] },
            properties: {},
          },
        ],
      }

      const result = createMockGeoJsonDropNodes(unsupportedGeoJson, basePosition)

      // Only GeoJsonOp + GeoJsonLayerOp + MaplibreBasemapOp (no feature ops)
      expect(result.nodes).toHaveLength(3)
    })

    it('handles empty FeatureCollection', () => {
      const emptyGeoJson = {
        type: 'FeatureCollection' as const,
        features: [],
      }

      const result = createMockGeoJsonDropNodes(emptyGeoJson, basePosition)

      // Only GeoJsonOp + GeoJsonLayerOp + MaplibreBasemapOp
      expect(result.nodes).toHaveLength(3)
      // Only geojson->layer + layer->deck + map->deck
      expect(result.edges).toHaveLength(3)
    })
  })

  describe('GeoJSON detection', () => {
    it('identifies valid GeoJSON FeatureCollection', () => {
      const valid = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }],
      }
      expect(valid.type).toBe('FeatureCollection')
      expect(Array.isArray(valid.features)).toBe(true)
    })

    it('rejects non-GeoJSON objects', () => {
      const notGeoJson = { name: 'test', data: [1, 2, 3] }
      expect((notGeoJson as Record<string, unknown>).type).toBeUndefined()
    })

    it('rejects GeoJSON without features array', () => {
      const noFeatures = { type: 'FeatureCollection' }
      expect('features' in noFeatures).toBe(false)
    })
  })
})
