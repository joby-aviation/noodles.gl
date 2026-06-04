import { describe, expect, it } from 'vitest'
import {
  detectLayerAttributes,
  extractLayerAttributes,
  generateLayerAttributeColumns,
  type LayerAttributeSpec,
} from './layer-attribute-detector'

describe('layer-attribute-detector', () => {
  describe('detectLayerAttributes', () => {
    it('detects simple scalar expression in layer accessor field', () => {
      // Mock setup
      const mockOperators = new Map([
        [
          '/scatterplot',
          {
            constructor: { displayName: 'ScatterplotLayer' },
            inputs: {
              getRadius: {
                accessor: true,
                value: 'population * 50',
              },
            },
          },
        ],
      ])

      const getOperator = (id: string) => mockOperators.get(id) as any
      const getDownstreamIds = (id: string) => {
        if (id === '/file') return ['/scatterplot']
        return []
      }

      const attributes = detectLayerAttributes('/file', getOperator, getDownstreamIds)

      expect(attributes).toHaveLength(1)
      expect(attributes[0]).toMatchObject({
        layerOpId: '/scatterplot',
        fieldName: 'getRadius',
        attributeName: 'radius',
        expression: 'population * 50',
        size: 1,
        type: 'float',
      })
      expect(attributes[0].sqlColumns).toEqual(['(population * 50)'])
    })

    it('detects array expression in getPosition field', () => {
      const mockOperators = new Map([
        [
          '/scatterplot',
          {
            constructor: { displayName: 'ScatterplotLayer' },
            inputs: {
              getPosition: {
                accessor: true,
                value: '[d.lng, d.lat, 0]',
              },
            },
          },
        ],
      ])

      const getOperator = (id: string) => mockOperators.get(id) as any
      const getDownstreamIds = (id: string) => (id === '/file' ? ['/scatterplot'] : [])

      const attributes = detectLayerAttributes('/file', getOperator, getDownstreamIds)

      expect(attributes).toHaveLength(1)
      expect(attributes[0]).toMatchObject({
        layerOpId: '/scatterplot',
        fieldName: 'getPosition',
        attributeName: 'position',
        expression: '[d.lng, d.lat, 0]',
        size: 3,
        type: 'float',
      })
      expect(attributes[0].sqlColumns).toEqual(['lng', 'lat', '0'])
    })

    it('skips non-translatable expressions', () => {
      const mockOperators = new Map([
        [
          '/scatterplot',
          {
            constructor: { displayName: 'ScatterplotLayer' },
            inputs: {
              getRadius: {
                accessor: true,
                value: 'd.value > 100 ? 50 : 10', // ternary not supported
              },
            },
          },
        ],
      ])

      const getOperator = (id: string) => mockOperators.get(id) as any
      const getDownstreamIds = (id: string) => (id === '/file' ? ['/scatterplot'] : [])

      const attributes = detectLayerAttributes('/file', getOperator, getDownstreamIds)

      expect(attributes).toHaveLength(0)
    })

    it('skips non-string values (functions, objects)', () => {
      const mockOperators = new Map([
        [
          '/scatterplot',
          {
            constructor: { displayName: 'ScatterplotLayer' },
            inputs: {
              getRadius: {
                accessor: true,
                value: (d: any) => d.population * 50, // function
              },
            },
          },
        ],
      ])

      const getOperator = (id: string) => mockOperators.get(id) as any
      const getDownstreamIds = (id: string) => (id === '/file' ? ['/scatterplot'] : [])

      const attributes = detectLayerAttributes('/file', getOperator, getDownstreamIds)

      expect(attributes).toHaveLength(0)
    })

    it('detects multiple accessor fields in single layer', () => {
      const mockOperators = new Map([
        [
          '/scatterplot',
          {
            constructor: { displayName: 'ScatterplotLayer' },
            inputs: {
              getRadius: {
                accessor: true,
                value: 'population',
              },
              getPosition: {
                accessor: true,
                value: '[d.lng, d.lat, 0]',
              },
            },
          },
        ],
      ])

      const getOperator = (id: string) => mockOperators.get(id) as any
      const getDownstreamIds = (id: string) => (id === '/file' ? ['/scatterplot'] : [])

      const attributes = detectLayerAttributes('/file', getOperator, getDownstreamIds)

      expect(attributes).toHaveLength(2)
      expect(attributes.map(a => a.fieldName).sort()).toEqual(['getPosition', 'getRadius'])
    })

    it('detects layers indirectly downstream (via intermediate operators)', () => {
      const mockOperators = new Map([
        [
          '/filter',
          {
            constructor: { displayName: 'Filter' },
            inputs: {},
          },
        ],
        [
          '/scatterplot',
          {
            constructor: { displayName: 'ScatterplotLayer' },
            inputs: {
              getRadius: {
                accessor: true,
                value: 'population',
              },
            },
          },
        ],
      ])

      const getOperator = (id: string) => mockOperators.get(id) as any
      const getDownstreamIds = (id: string) => {
        if (id === '/file') return ['/filter']
        if (id === '/filter') return ['/scatterplot']
        return []
      }

      const attributes = detectLayerAttributes('/file', getOperator, getDownstreamIds)

      expect(attributes).toHaveLength(1)
      expect(attributes[0].layerOpId).toBe('/scatterplot')
    })
  })

  describe('generateLayerAttributeColumns', () => {
    it('generates SQL columns for scalar attribute', () => {
      const attributes: LayerAttributeSpec[] = [
        {
          layerOpId: '/scatterplot',
          fieldName: 'getRadius',
          attributeName: 'radius',
          expression: 'population * 50',
          size: 1,
          type: 'float',
          sqlColumns: ['(population * 50)'],
        },
      ]

      const columns = generateLayerAttributeColumns(attributes)

      expect(columns).toEqual(['CAST((population * 50) AS FLOAT) AS __attr_radius_0'])
    })

    it('generates SQL columns for vector attribute', () => {
      const attributes: LayerAttributeSpec[] = [
        {
          layerOpId: '/scatterplot',
          fieldName: 'getPosition',
          attributeName: 'position',
          expression: '[d.lng, d.lat, 0]',
          size: 3,
          type: 'float',
          sqlColumns: ['lng', 'lat', '0'],
        },
      ]

      const columns = generateLayerAttributeColumns(attributes)

      expect(columns).toEqual([
        'CAST(lng AS FLOAT) AS __attr_position_0',
        'CAST(lat AS FLOAT) AS __attr_position_1',
        'CAST(0 AS FLOAT) AS __attr_position_2',
      ])
    })

    it('generates UTINYINT for uint8 type (colors)', () => {
      const attributes: LayerAttributeSpec[] = [
        {
          layerOpId: '/scatterplot',
          fieldName: 'getFillColor',
          attributeName: 'fillColor',
          expression: '[d.r, d.g, d.b, 255]',
          size: 4,
          type: 'uint8',
          sqlColumns: ['r', 'g', 'b', '255'],
        },
      ]

      const columns = generateLayerAttributeColumns(attributes)

      expect(columns).toEqual([
        'CAST(r AS UTINYINT) AS __attr_fillColor_0',
        'CAST(g AS UTINYINT) AS __attr_fillColor_1',
        'CAST(b AS UTINYINT) AS __attr_fillColor_2',
        'CAST(255 AS UTINYINT) AS __attr_fillColor_3',
      ])
    })
  })

  describe('extractLayerAttributes', () => {
    it('extracts scalar attribute from Arrow table', () => {
      const mockTable = {
        schema: {
          fields: [
            { name: 'id' },
            { name: '__attr_radius_0' },
          ],
        },
        numRows: 3,
        getChild: (name: string) => {
          if (name === '__attr_radius_0') {
            return { toArray: () => [10, 20, 30] }
          }
          throw new Error(`Column ${name} not found`)
        },
      }

      const attributes: LayerAttributeSpec[] = [
        {
          layerOpId: '/scatterplot',
          fieldName: 'getRadius',
          attributeName: 'radius',
          expression: 'population',
          size: 1,
          type: 'float',
          sqlColumns: ['population'],
        },
      ]

      const result = extractLayerAttributes(mockTable, attributes)

      expect(result).toHaveProperty('radius')
      expect(result.radius.size).toBe(1)
      expect(result.radius.values).toBeInstanceOf(Float32Array)
      expect(Array.from(result.radius.values)).toEqual([10, 20, 30])
    })

    it('extracts and interleaves vector attribute from Arrow table', () => {
      const mockTable = {
        schema: {
          fields: [
            { name: 'id' },
            { name: '__attr_position_0' },
            { name: '__attr_position_1' },
            { name: '__attr_position_2' },
          ],
        },
        numRows: 2,
        getChild: (name: string) => {
          if (name === '__attr_position_0') return { toArray: () => [1, 4] }
          if (name === '__attr_position_1') return { toArray: () => [2, 5] }
          if (name === '__attr_position_2') return { toArray: () => [3, 6] }
          throw new Error(`Column ${name} not found`)
        },
      }

      const attributes: LayerAttributeSpec[] = [
        {
          layerOpId: '/scatterplot',
          fieldName: 'getPosition',
          attributeName: 'position',
          expression: '[d.x, d.y, d.z]',
          size: 3,
          type: 'float',
          sqlColumns: ['x', 'y', 'z'],
        },
      ]

      const result = extractLayerAttributes(mockTable, attributes)

      expect(result).toHaveProperty('position')
      expect(result.position.size).toBe(3)
      expect(result.position.values).toBeInstanceOf(Float32Array)
      // Should be interleaved: [1,2,3, 4,5,6]
      expect(Array.from(result.position.values)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('returns empty object if columns not found', () => {
      const mockTable = {
        schema: {
          fields: [{ name: 'id' }],
        },
        numRows: 2,
        getChild: () => {
          throw new Error('Column not found')
        },
      }

      const attributes: LayerAttributeSpec[] = [
        {
          layerOpId: '/scatterplot',
          fieldName: 'getRadius',
          attributeName: 'radius',
          expression: 'population',
          size: 1,
          type: 'float',
          sqlColumns: ['population'],
        },
      ]

      const result = extractLayerAttributes(mockTable, attributes)

      expect(result).toEqual({})
    })

    it('handles uint8 type for colors', () => {
      const mockTable = {
        schema: {
          fields: [
            { name: '__attr_fillColor_0' },
            { name: '__attr_fillColor_1' },
            { name: '__attr_fillColor_2' },
            { name: '__attr_fillColor_3' },
          ],
        },
        numRows: 1,
        getChild: (name: string) => {
          if (name === '__attr_fillColor_0') return { toArray: () => [255] }
          if (name === '__attr_fillColor_1') return { toArray: () => [128] }
          if (name === '__attr_fillColor_2') return { toArray: () => [64] }
          if (name === '__attr_fillColor_3') return { toArray: () => [255] }
          throw new Error(`Column ${name} not found`)
        },
      }

      const attributes: LayerAttributeSpec[] = [
        {
          layerOpId: '/scatterplot',
          fieldName: 'getFillColor',
          attributeName: 'fillColor',
          expression: '[255, 128, 64, 255]',
          size: 4,
          type: 'uint8',
          sqlColumns: ['255', '128', '64', '255'],
        },
      ]

      const result = extractLayerAttributes(mockTable, attributes)

      expect(result).toHaveProperty('fillColor')
      expect(result.fillColor.values).toBeInstanceOf(Uint8Array)
      expect(Array.from(result.fillColor.values)).toEqual([255, 128, 64, 255])
    })
  })
})
