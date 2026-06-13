import { describe, expect, it, vi } from 'vitest'

// Mock the store — getOpEntries returns empty array (no existing operators)
vi.mock('../../store', () => ({
  getOpEntries: () => [],
}))

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
const { createGeoJsonFileDropNodes, createGeoJsonTableDropNodes, isGeoJson } = await import(
  './geojson-import-nodes'
)

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

  describe('createGeoJsonTableDropNodes', () => {
    it('creates TableEditorOp and ViewerOp', () => {
      const result = createGeoJsonTableDropNodes(sampleGeoJson, basePosition)

      const nodeTypes = result.nodes.map(n => n.type)
      expect(nodeTypes).toContain('TableEditorOp')
      expect(nodeTypes).toContain('ViewerOp')
      expect(result.nodes).toHaveLength(2)
    })

    it('flattens Point features with point2d geometry column', () => {
      const pointsOnly = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [-74.006, 40.7128] },
            properties: { name: 'NYC' },
          },
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] },
            properties: { name: 'LA' },
          },
        ],
      }

      const result = createGeoJsonTableDropNodes(pointsOnly, basePosition)
      const tableOp = result.nodes.find(n => n.type === 'TableEditorOp')
      const schema = tableOp?.data.inputs.schema as {
        columns: Array<{ name: string; type: string }>
      }

      expect(schema.columns[0]).toEqual(
        expect.objectContaining({ name: 'geometry', type: 'point2d' })
      )
    })

    it('stores non-Point geometry as JSON string', () => {
      const result = createGeoJsonTableDropNodes(sampleGeoJson, basePosition)
      const tableOp = result.nodes.find(n => n.type === 'TableEditorOp')
      const data = tableOp?.data.inputs.data as Array<Record<string, unknown>>

      // LineString geometry should be a JSON string
      const lineRow = data[1]
      expect(typeof lineRow.geometry).toBe('string')
      const parsed = JSON.parse(lineRow.geometry as string)
      expect(parsed.type).toBe('LineString')
    })

    it('creates columns from feature properties', () => {
      const result = createGeoJsonTableDropNodes(sampleGeoJson, basePosition)
      const tableOp = result.nodes.find(n => n.type === 'TableEditorOp')
      const schema = tableOp?.data.inputs.schema as {
        columns: Array<{ name: string; type: string }>
      }

      const colNames = schema.columns.map(c => c.name)
      expect(colNames).toContain('geometry')
      expect(colNames).toContain('name')
    })

    it('infers number columns from numeric properties', () => {
      const numericGeoJson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { count: 42, label: 'test' },
          },
        ],
      }

      const result = createGeoJsonTableDropNodes(numericGeoJson, basePosition)
      const tableOp = result.nodes.find(n => n.type === 'TableEditorOp')
      const schema = tableOp?.data.inputs.schema as {
        columns: Array<{ name: string; type: string }>
      }

      const countCol = schema.columns.find(c => c.name === 'count')
      const labelCol = schema.columns.find(c => c.name === 'label')
      expect(countCol?.type).toBe('number')
      expect(labelCol?.type).toBe('string')
    })

    it('connects TableEditorOp to ViewerOp', () => {
      const result = createGeoJsonTableDropNodes(sampleGeoJson, basePosition)

      const tableToViewer = result.edges.find(
        e => e.sourceHandle === 'out.data' && e.targetHandle === 'par.data'
      )
      expect(tableToViewer).toBeDefined()
      expect(result.edges).toHaveLength(1)
    })

    it('handles empty FeatureCollection', () => {
      const empty = { type: 'FeatureCollection' as const, features: [] }
      const result = createGeoJsonTableDropNodes(empty, basePosition)
      const tableOp = result.nodes.find(n => n.type === 'TableEditorOp')
      const data = tableOp?.data.inputs.data as unknown[]
      expect(data).toHaveLength(0)
    })

    it('collects property keys from all features', () => {
      const mixedProps = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { a: 1 },
          },
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [1, 1] },
            properties: { b: 'hello' },
          },
        ],
      }

      const result = createGeoJsonTableDropNodes(mixedProps, basePosition)
      const tableOp = result.nodes.find(n => n.type === 'TableEditorOp')
      const schema = tableOp?.data.inputs.schema as {
        columns: Array<{ name: string }>
      }
      const data = tableOp?.data.inputs.data as Array<Record<string, unknown>>

      const colNames = schema.columns.map(c => c.name)
      expect(colNames).toContain('a')
      expect(colNames).toContain('b')

      // Missing properties filled with null
      expect(data[0].b).toBeNull()
      expect(data[1].a).toBeNull()
    })
  })

  describe('isGeoJson', () => {
    it('returns true for valid FeatureCollection', () => {
      expect(isGeoJson({ type: 'FeatureCollection', features: [] })).toBe(true)
    })

    it('returns false for null', () => {
      expect(isGeoJson(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isGeoJson(undefined)).toBe(false)
    })

    it('returns false for non-object types', () => {
      expect(isGeoJson('string')).toBe(false)
      expect(isGeoJson(42)).toBe(false)
      expect(isGeoJson(true)).toBe(false)
    })

    it('returns false for objects without type field', () => {
      expect(isGeoJson({ features: [] })).toBe(false)
    })

    it('returns false for objects with wrong type', () => {
      expect(isGeoJson({ type: 'Feature', geometry: {}, properties: {} })).toBe(false)
    })

    it('returns false for FeatureCollection without features array', () => {
      expect(isGeoJson({ type: 'FeatureCollection', features: 'not-an-array' })).toBe(false)
      expect(isGeoJson({ type: 'FeatureCollection' })).toBe(false)
    })
  })

  describe('error cases', () => {
    it('table import handles features with null properties', () => {
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: null,
          },
        ],
      }

      const result = createGeoJsonTableDropNodes(geojson as any, basePosition)
      const tableOp = result.nodes.find(n => n.type === 'TableEditorOp')
      expect(tableOp).toBeDefined()
      const data = tableOp?.data.inputs.data as unknown[]
      expect(data).toHaveLength(1)
    })

    it('table import handles mixed null and valid properties', () => {
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { name: 'valid' },
          },
          {
            type: 'Feature' as const,
            geometry: { type: 'Point', coordinates: [1, 1] },
            properties: null,
          },
        ],
      }

      const result = createGeoJsonTableDropNodes(geojson as any, basePosition)
      const tableOp = result.nodes.find(n => n.type === 'TableEditorOp')
      const data = tableOp?.data.inputs.data as Array<Record<string, unknown>>
      expect(data).toHaveLength(2)
      expect(data[0].name).toBe('valid')
      expect(data[1].name).toBeNull()
    })
  })
})
