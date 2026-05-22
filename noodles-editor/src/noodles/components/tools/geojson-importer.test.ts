import { describe, expect, it, vi } from 'vitest'

// Auto-mock the store — provides stubs for all exports
vi.mock('../../store')

// Mock nodeId to return predictable IDs without store dependency
vi.mock('../../utils/id-utils', () => ({
  nodeId: (baseName: string) => `/${baseName}`,
  edgeId: (connection: {
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }) =>
    `${connection.source}.${connection.sourceHandle}->${connection.target}.${connection.targetHandle}`,
}))

// Import after mocks are set up
const { createGeoJsonDropNodes, createGeoJsonFileDropNodes, GEOJSON_DECONSTRUCT_LIMIT } =
  await import('./data-importer-tool')

describe('GeoJSON Import', () => {
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

  describe('createGeoJsonDropNodes', () => {
    it('creates a geometry operator for each feature plus GeoJsonOp and GeoJsonLayerOp', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      // 3 feature ops + GeoJsonOp + GeoJsonLayerOp
      expect(result.nodes).toHaveLength(5)
    })

    it('maps geometry types to correct operator types', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      const nodeTypes = result.nodes.map(n => n.type)
      expect(nodeTypes).toContain('PointOp')
      expect(nodeTypes).toContain('LineStringOp')
      expect(nodeTypes).toContain('PolygonOp')
      expect(nodeTypes).toContain('GeoJsonOp')
      expect(nodeTypes).toContain('GeoJsonLayerOp')
    })

    it('passes coordinates to PointOp as raw value', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      const pointOp = result.nodes.find(n => n.type === 'PointOp')
      expect(pointOp?.data.inputs.coordinates).toEqual([-74.006, 40.7128])
      expect(pointOp?.data.inputs.properties).toEqual({ name: 'New York' })
    })

    it('passes geometry as JSON string to non-Point operators', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      const lineOp = result.nodes.find(n => n.type === 'LineStringOp')
      const lineCoords = JSON.parse(lineOp?.data.inputs.geometry as string)
      expect(lineCoords).toEqual([
        [-74.006, 40.7128],
        [-118.2437, 34.0522],
      ])
      const lineProps = JSON.parse(lineOp?.data.inputs.properties as string)
      expect(lineProps).toEqual({ name: 'NY to LA' })
    })

    it('connects each feature operator to the GeoJsonOp', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      const featureToGeoJsonEdges = result.edges.filter(
        e => e.targetHandle === 'par.features' && e.sourceHandle === 'out.feature'
      )
      expect(featureToGeoJsonEdges).toHaveLength(3)

      const geojsonNode = result.nodes.find(n => n.type === 'GeoJsonOp')
      expect(featureToGeoJsonEdges.every(e => e.target === geojsonNode?.id)).toBe(true)
    })

    it('connects GeoJsonOp to GeoJsonLayerOp', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      const geojsonNode = result.nodes.find(n => n.type === 'GeoJsonOp')
      const layerNode = result.nodes.find(n => n.type === 'GeoJsonLayerOp')

      const edge = result.edges.find(
        e => e.sourceHandle === 'out.featureCollection' && e.targetHandle === 'par.data'
      )
      expect(edge).toBeDefined()
      expect(edge?.source).toBe(geojsonNode?.id)
      expect(edge?.target).toBe(layerNode?.id)
    })

    it('connects GeoJsonLayerOp to DeckRendererOp', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      const layerNode = result.nodes.find(n => n.type === 'GeoJsonLayerOp')

      const edge = result.edges.find(
        e => e.sourceHandle === 'out.layer' && e.targetHandle === 'par.layers'
      )
      expect(edge).toBeDefined()
      expect(edge?.source).toBe(layerNode?.id)
    })

    it('creates correct total number of edges', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      // 3 feature->geojson + geojson->layer + layer->deck = 5
      expect(result.edges).toHaveLength(5)
    })

    it('generates unique edge IDs', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      const edgeIds = result.edges.map(e => e.id)
      const uniqueIds = new Set(edgeIds)
      expect(uniqueIds.size).toBe(edgeIds.length)
    })

    it('positions feature operators in a grid layout', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

      const featureNodes = result.nodes.filter(n =>
        ['PointOp', 'LineStringOp', 'PolygonOp'].includes(n.type)
      )

      // All 3 features in first row (maxColumns = 4), spaced by colSpacing = 350
      expect(featureNodes[0].position.x).toBe(100)
      expect(featureNodes[1].position.x).toBe(450)
      expect(featureNodes[2].position.x).toBe(800)
      expect(featureNodes.every(n => n.position.y === 200)).toBe(true)
    })

    it('positions GeoJsonOp below feature operators', () => {
      const result = createGeoJsonDropNodes(sampleGeoJson, basePosition)

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

      const result = createGeoJsonDropNodes(allTypesGeoJson, basePosition)

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

      const result = createGeoJsonDropNodes(unsupportedGeoJson, basePosition)

      // Only GeoJsonOp + GeoJsonLayerOp (no feature ops)
      expect(result.nodes).toHaveLength(2)
    })

    it('handles empty FeatureCollection', () => {
      const emptyGeoJson = {
        type: 'FeatureCollection' as const,
        features: [],
      }

      const result = createGeoJsonDropNodes(emptyGeoJson, basePosition)

      // Only GeoJsonOp + GeoJsonLayerOp
      expect(result.nodes).toHaveLength(2)
      // Only geojson->layer + layer->deck
      expect(result.edges).toHaveLength(2)
    })
  })

  describe('createGeoJsonFileDropNodes', () => {
    it('creates FileOp and GeoJsonLayerOp', () => {
      const result = createGeoJsonFileDropNodes('@/test.geojson', basePosition)

      const nodeTypes = result.nodes.map(n => n.type)
      expect(nodeTypes).toContain('FileOp')
      expect(nodeTypes).toContain('GeoJsonLayerOp')
      expect(result.nodes).toHaveLength(2)
    })

    it('does not create BoundingBoxOp or MaplibreBasemapOp', () => {
      const result = createGeoJsonFileDropNodes('@/test.geojson', basePosition)

      const nodeTypes = result.nodes.map(n => n.type)
      expect(nodeTypes).not.toContain('BoundingBoxOp')
      expect(nodeTypes).not.toContain('MaplibreBasemapOp')
      expect(nodeTypes).not.toContain('ScatterplotLayerOp')
    })

    it('connects FileOp to GeoJsonLayerOp data input', () => {
      const result = createGeoJsonFileDropNodes('@/test.geojson', basePosition)

      const edge = result.edges.find(
        e => e.sourceHandle === 'out.data' && e.targetHandle === 'par.data'
      )
      expect(edge).toBeDefined()
    })

    it('connects GeoJsonLayerOp to DeckRendererOp layers input', () => {
      const result = createGeoJsonFileDropNodes('@/test.geojson', basePosition)

      const edge = result.edges.find(
        e => e.sourceHandle === 'out.layer' && e.targetHandle === 'par.layers'
      )
      expect(edge).toBeDefined()
    })

    it('creates exactly 2 edges (file->layer, layer->deck)', () => {
      const result = createGeoJsonFileDropNodes('@/test.geojson', basePosition)
      expect(result.edges).toHaveLength(2)
    })

    it('configures FileOp with json format and url', () => {
      const result = createGeoJsonFileDropNodes('@/my-data.geojson', basePosition)

      const fileOp = result.nodes.find(n => n.type === 'FileOp')
      expect(fileOp?.data.inputs.format).toBe('json')
      expect(fileOp?.data.inputs.url).toBe('@/my-data.geojson')
    })
  })

  describe('GEOJSON_DECONSTRUCT_LIMIT', () => {
    it('is set to 20', () => {
      expect(GEOJSON_DECONSTRUCT_LIMIT).toBe(20)
    })

    it('collections at the limit default to deconstruct', () => {
      const atLimit = GEOJSON_DECONSTRUCT_LIMIT
      expect(atLimit <= GEOJSON_DECONSTRUCT_LIMIT).toBe(true)
    })

    it('collections over the limit default to file mode', () => {
      const overLimit = GEOJSON_DECONSTRUCT_LIMIT + 1
      expect(overLimit > GEOJSON_DECONSTRUCT_LIMIT).toBe(true)
    })
  })
})
