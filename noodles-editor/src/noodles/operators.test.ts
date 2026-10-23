import { LayerExtension } from '@deck.gl/core'
import { PathStyleExtension } from '@deck.gl/extensions'
import * as deckWidgets from '@deck.gl/widgets'
import * as turf from '@turf/turf'
import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from './keys-store'
import {
  BoundingBoxOp,
  ChartOp,
  CodeOp,
  DirectionsOp,
  FileOp,
  GeocoderOp,
  LayerPropsOp,
} from './operators'

describe('CodeOp', () => {
  it('executes a CodeOp', async () => {
    const operator = new CodeOp('code-0', { code: ['return d + 1'] }, false)
    expect(operator.inputs.code.value).toEqual('return d + 1')

    const val = await operator.execute({
      data: [1],
      code: 'return d + 1',
    })
    expect(val.data).toEqual(2)

    const val2 = await operator.execute({
      data: [1],
      code: 'return data',
    })
    expect(val2.data).toEqual([1])
  })

  it('resolves a Promise', async () => {
    const operator = new CodeOp('/code-0')
    const val = await operator.execute({
      data: [1],
      code: 'return new Promise((resolve) => resolve(d + 1))',
    })
    expect(val.data).toEqual(2)
  })

  it('supports parsing async code execution', async () => {
    const operator = new CodeOp('/code-0')
    const val = await operator.execute({
      data: [1],
      code: 'return await new Promise((resolve) => resolve(d + 1))',
    })
    expect(val.data).toEqual(2)
  })

  it('sets the this context to the operator', async () => {
    const operator = new CodeOp('/code-0')
    const val = await operator.execute({
      data: [1],
      code: 'return this',
    })
    expect(val.data).toEqual(operator)
  })
})

describe('BoundingBoxOp', () => {
  it('finds the bounding box of a list of points', () => {
    const operator = new BoundingBoxOp('/bbox-0')
    const val = operator.execute({
      data: [
        { lng: 1, lat: 2 },
        { lng: 3, lat: 4 },
      ],
      padding: 0,
    })
    expect(val.viewState).toEqual({
      latitude: 3.000457402301878,
      longitude: 2.0000000000000027,
      zoom: 9.566616522774169,
    })
  })

  const pointsViewState = () =>
    new BoundingBoxOp('/bbox-points').execute({
      data: [
        { lng: 1, lat: 2 },
        { lng: 3, lat: 4 },
      ],
      padding: 0,
    }).viewState

  it('accepts a GeoJsonOp FeatureCollection on its data input', () => {
    const geojson = new GeoJsonOp('/geojson-0')
    const operator = new BoundingBoxOp('/bbox-0')
    const featureCollection = geojson.execute({
      features: [turf.point([1, 2]), turf.point([3, 4])],
    }).featureCollection

    expect(canConnect(geojson.outputs.featureCollection, operator.inputs.data)).toBe(true)
    operator.inputs.data.setValue(featureCollection)
    expect(operator.inputs.data.value).toEqual(featureCollection)

    const val = operator.execute({ data: operator.inputs.data.value, padding: 0 })
    expect(val.bounds).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(val.viewState).toEqual(pointsViewState())
  })

  it('still parses a list of points on its data input', () => {
    const operator = new BoundingBoxOp('/bbox-0')
    operator.inputs.data.setValue([[1, 2], { longitude: 3, latitude: 4 }])
    expect(operator.inputs.data.value).toEqual([
      { lng: 1, lat: 2 },
      { lng: 3, lat: 4 },
    ])
  })

  it.each([
    ['an object without a GeoJSON type', { foo: 'bar' }],
    ['a Point without coordinates', { type: 'Point' }],
    ['a Polygon with non-array coordinates', { type: 'Polygon', coordinates: 'nope' }],
    ['a GeometryCollection without geometries', { type: 'GeometryCollection' }],
    [
      'a GeometryCollection with an incomplete geometry',
      { type: 'GeometryCollection', geometries: [{ type: 'LineString' }] },
    ],
    ['a Feature without a geometry', { type: 'Feature', properties: {} }],
    [
      'a Feature with an incomplete geometry',
      { type: 'Feature', properties: {}, geometry: { type: 'Point' } },
    ],
    ['a FeatureCollection without features', { type: 'FeatureCollection' }],
    [
      'a FeatureCollection with a non-Feature member',
      { type: 'FeatureCollection', features: [{ type: 'Point', coordinates: [1, 2] }] },
    ],
  ])('rejects %s', (_name, value) => {
    const operator = new BoundingBoxOp('/bbox-0')
    // Deliberately invalid input, so it can't match the field's type
    operator.inputs.data.setValue(value as unknown as GeoJSON.GeoJSON)
    expect(operator.inputs.data.value).toEqual([])
  })

  it('accepts a Feature with a null geometry', () => {
    const operator = new BoundingBoxOp('/bbox-0')
    // GeoJSON allows a null geometry, but @types/geojson's default Feature type doesn't
    const feature = {
      type: 'Feature',
      properties: {},
      geometry: null,
    } as unknown as GeoJSON.Feature
    operator.inputs.data.setValue(feature)
    expect(operator.inputs.data.value).toEqual(feature)
  })

  it('finds the bounding box of a single Feature', () => {
    const operator = new BoundingBoxOp('/bbox-0')
    const val = operator.execute({
      data: turf.lineString([
        [1, 2],
        [2, 3],
        [3, 4],
      ]),
      padding: 0,
    })
    expect(val.viewState).toEqual(pointsViewState())
  })

  it('finds the bounding box of a bare Geometry', () => {
    const operator = new BoundingBoxOp('/bbox-0')
    const val = operator.execute({
      data: {
        type: 'Polygon',
        coordinates: [
          [
            [1, 2],
            [3, 2],
            [3, 4],
            [1, 4],
            [1, 2],
          ],
        ],
      },
      padding: 0,
    })
    expect(val.viewState).toEqual(pointsViewState())
  })

  it('treats an empty FeatureCollection like an empty point list', () => {
    const operator = new BoundingBoxOp('/bbox-0')
    const empty = operator.execute({ data: [], padding: 0 })
    const val = operator.execute({
      data: { type: 'FeatureCollection', features: [] },
      padding: 0,
    })
    expect(val).toEqual(empty)
  })
})

describe('ChartOp', () => {
  it('hides yField for histograms', () => {
    const op = new ChartOp('/chart-1', { chartType: 'histogram' })
    expect(op.isFieldVisible('yField')).toBe(false)

    op.inputs.chartType.setValue('bar')
    expect(op.isFieldVisible('yField')).toBe(true)
  })

  it('stops updating yField visibility once disposed', () => {
    const op = new ChartOp('/chart-1')
    op.dispose()
    op.inputs.chartType.setValue('histogram')
    expect(op.isFieldVisible('yField')).toBe(true)
  })

  it('generates a bar chart from data', () => {
    const op = new ChartOp('/chart-1')
    const result = op.execute({
      data: [
        { category: 'A', value: 10 },
        { category: 'B', value: 20 },
      ],
      chartType: 'bar',
      xField: 'category',
      yField: 'value',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).toBeDefined()
    expect(result.chart).toBeInstanceOf(HTMLElement)
  })

  it('generates a histogram from data', () => {
    const op = new ChartOp('/chart-1')
    const result = op.execute({
      data: [{ value: 10 }, { value: 20 }, { value: 15 }, { value: 25 }],
      chartType: 'histogram',
      xField: 'value',
      yField: '',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).toBeDefined()
    expect(result.chart).toBeInstanceOf(HTMLElement)
  })

  it('generates a scatterplot from data', () => {
    const op = new ChartOp('/chart-1')
    const result = op.execute({
      data: [
        { x: 1, y: 2 },
        { x: 2, y: 3 },
        { x: 3, y: 5 },
      ],
      chartType: 'scatter',
      xField: 'x',
      yField: 'y',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).toBeDefined()
    expect(result.chart).toBeInstanceOf(HTMLElement)
  })

  it('updates field choices when data changes', () => {
    const op = new ChartOp('/chart-1', {}, false)
    const data = [
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]
    op.inputs.data.setValue(data)

    expect(op.inputs.xField.choices.map(c => c.value)).toEqual(['x', 'y', 'z'])
    expect(op.inputs.yField.choices.map(c => c.value)).toEqual(['x', 'y', 'z'])
  })

  it('handles empty data gracefully', () => {
    const op = new ChartOp('/chart-1')
    const result = op.execute({
      data: [],
      chartType: 'bar',
      xField: 'x',
      yField: 'y',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).toBeNull()
  })

  it('handles non-array data gracefully', () => {
    const op = new ChartOp('/chart-1')
    const result = op.execute({
      data: { x: 1, y: 2 } as any,
      chartType: 'bar',
      xField: 'x',
      yField: 'y',
      width: 640,
      height: 400,
      color: '#4269d0',
      title: '',
      xLabel: '',
      yLabel: '',
    })

    expect(result.chart).toBeNull()
  })
})

describe('LayerPropsOp', () => {
  it('passes through a layer without modifications', () => {
    const operator = new LayerPropsOp('/layer-props-0')
    const inputLayer = {
      id: 'test-layer',
      type: 'ScatterplotLayer',
      data: [],
    }
    const { layer } = operator.execute({
      layer: inputLayer,
      operation: '',
      beforeId: '',
      additionalProps: {},
    })
    expect(layer).toEqual(inputLayer)
  })

  it('adds operation prop to a layer', () => {
    const operator = new LayerPropsOp('/layer-props-0')
    const inputLayer = {
      id: 'mask-layer',
      type: 'GeoJsonLayer',
      data: [],
    }
    const { layer } = operator.execute({
      layer: inputLayer,
      operation: 'mask',
      beforeId: '',
      additionalProps: {},
    })
    expect(layer).toEqual({
      ...inputLayer,
      operation: 'mask',
    })
  })

  it('adds beforeId prop to a layer', () => {
    const operator = new LayerPropsOp('/layer-props-0')
    const inputLayer = {
      id: 'test-layer',
      type: 'ScatterplotLayer',
      data: [],
    }
    const { layer } = operator.execute({
      layer: inputLayer,
      operation: '',
      beforeId: 'text-layer',
      additionalProps: {},
    })
    expect(layer).toEqual({
      ...inputLayer,
      beforeId: 'text-layer',
    })
  })

  it('adds additional props to a layer', () => {
    const operator = new LayerPropsOp('/layer-props-0')
    const inputLayer = {
      id: 'test-layer',
      type: 'ScatterplotLayer',
      data: [],
    }
    const { layer } = operator.execute({
      layer: inputLayer,
      operation: '',
      beforeId: '',
      additionalProps: { customProp: 'custom-value', anotherProp: 123 },
    })
    expect(layer).toEqual({
      ...inputLayer,
      customProp: 'custom-value',
      anotherProp: 123,
    })
  })

  it('combines operation, beforeId, and additionalProps', () => {
    const operator = new LayerPropsOp('/layer-props-0')
    const inputLayer = {
      id: 'complex-layer',
      type: 'PathLayer',
      data: [],
      existingProp: 'value',
    }
    const { layer } = operator.execute({
      layer: inputLayer,
      operation: 'mask',
      beforeId: 'labels',
      additionalProps: { pickable: true, autoHighlight: true },
    })
    expect(layer).toEqual({
      ...inputLayer,
      operation: 'mask',
      beforeId: 'labels',
      pickable: true,
      autoHighlight: true,
    })
  })

  it('does not add empty optional fields', () => {
    const operator = new LayerPropsOp('/layer-props-0')
    const inputLayer = {
      id: 'test-layer',
      type: 'ScatterplotLayer',
      data: [],
    }
    const { layer } = operator.execute({
      layer: inputLayer,
      operation: '',
      beforeId: '',
      additionalProps: {},
    })
    expect(layer.operation).toBeUndefined()
    expect(layer.beforeId).toBeUndefined()
  })
})

describe('FileOp', () => {
  // Mock fetch for testing
  const originalFetch = global.fetch
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('JSON format', () => {
    it('should parse JSON from text input', async () => {
      const operator = new FileOp('/file-json-text')
      const testData = { test: 'data', value: 123 }
      const result = await operator.execute({
        format: 'json',
        url: '',
        text: JSON.stringify(testData),
        autoType: true,
        pulse: 0,
      })
      expect(result.data).toEqual(testData)
    })

    it('should fetch and parse JSON from URL', async () => {
      const operator = new FileOp('/file-json-url')
      const testData = { test: 'remote', value: 456 }
      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve(testData),
      })

      const result = await operator.execute({
        format: 'json',
        url: 'https://example.com/data.json',
        text: '',
        autoType: true,
        pulse: 0,
      })
      expect(result.data).toEqual(testData)
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/data.json')
    })

    it('should throw error for invalid JSON', async () => {
      const operator = new FileOp('/file-invalid-json')
      await expect(
        operator.execute({
          format: 'json',
          url: '',
          text: 'invalid json',
          autoType: true,
          pulse: 0,
        })
      ).rejects.toThrow()
    })
  })

  describe('CSV format', () => {
    it('should only show autoType input when format is csv or tsv', () => {
      const operator = new FileOp('/file-format-autotype-visibility')
      expect(operator.isFieldVisible('autoType')).toBe(false)
      operator.inputs.format.setValue('csv')
      expect(operator.isFieldVisible('autoType')).toBe(true)
      operator.inputs.format.setValue('tsv')
      expect(operator.isFieldVisible('autoType')).toBe(true)
      operator.inputs.format.setValue('json')
      expect(operator.isFieldVisible('autoType')).toBe(false)
    })

    it('should parse CSV from text input', async () => {
      const operator = new FileOp('/file-csv-text')
      const csvText = 'name,value\nJohn,30\nJane,25'
      const result = await operator.execute({
        format: 'csv',
        url: '',
        text: csvText,
        autoType: true,
        pulse: 0,
      })
      // DSVRowArray is an array with extra properties, check the actual content
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toEqual({ name: 'John', value: 30 })
      expect(result.data[1]).toEqual({ name: 'Jane', value: 25 })
    })

    it('should parse CSV without autoType as strings', async () => {
      const operator = new FileOp('/file-csv-no-autotype')
      const csvText = 'name,value\nJohn,30\nJane,25'
      const result = await operator.execute({
        format: 'csv',
        url: '',
        text: csvText,
        autoType: false,
        pulse: 0,
      })
      // DSVRowArray is an array with extra properties, check the actual content
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toEqual({ name: 'John', value: '30' })
      expect(result.data[1]).toEqual({ name: 'Jane', value: '25' })
    })
  })

  describe('TSV format', () => {
    it('should parse TSV from text input', async () => {
      const operator = new FileOp('/file-tsv-text')
      const tsvText = 'name\tvalue\nJohn\t30\nJane\t25'
      const result = await operator.execute({
        format: 'tsv',
        url: '',
        text: tsvText,
        autoType: true,
        pulse: 0,
      })
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toEqual({ name: 'John', value: 30 })
      expect(result.data[1]).toEqual({ name: 'Jane', value: 25 })
    })

    it('should parse TSV without autoType as strings', async () => {
      const operator = new FileOp('/file-tsv-no-autotype')
      const tsvText = 'name\tvalue\nJohn\t30\nJane\t25'
      const result = await operator.execute({
        format: 'tsv',
        url: '',
        text: tsvText,
        autoType: false,
        pulse: 0,
      })
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toEqual({ name: 'John', value: '30' })
      expect(result.data[1]).toEqual({ name: 'Jane', value: '25' })
    })
  })

  describe('Text format', () => {
    it('should return text from text input', async () => {
      const operator = new FileOp('/file-text')
      const textContent = 'This is plain text content\nwith multiple lines'
      const result = await operator.execute({
        format: 'text',
        url: '',
        text: textContent,
        autoType: true,
        pulse: 0,
      })
      expect(result.data).toEqual(textContent)
    })

    it('should fetch text from URL', async () => {
      const operator = new FileOp('/file-text-url')
      const textContent = 'Remote text content'
      global.fetch = vi.fn().mockResolvedValue({
        text: () => Promise.resolve(textContent),
      })

      const result = await operator.execute({
        format: 'text',
        url: 'https://example.com/file.txt',
        text: '',
        autoType: true,
        pulse: 0,
      })
      expect(result.data).toEqual(textContent)
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/file.txt')
    })

    it('should return empty string when no input provided', async () => {
      const operator = new FileOp('/file-text-empty')
      const result = await operator.execute({
        format: 'text',
        url: '',
        text: '',
        autoType: true,
        pulse: 0,
      })
      expect(result.data).toEqual('')
    })
  })

  describe('Binary format', () => {
    it('should convert text input to Uint8Array', async () => {
      const operator = new FileOp('/file-binary-uint8')
      const textContent = 'Binary data as text'
      const result = await operator.execute({
        format: 'binary',
        url: '',
        text: textContent,
        autoType: true,
        pulse: 0,
      })

      // Result should be a Uint8Array
      expect(result.data).toBeInstanceOf(Uint8Array)

      // Convert back to string to verify
      const decoder = new TextDecoder()
      expect(decoder.decode(result.data as Uint8Array)).toEqual(textContent)
    })

    it('should fetch binary data from URL', async () => {
      const operator = new FileOp('/file-binary-url')
      const binaryData = new ArrayBuffer(8)
      const view = new Uint8Array(binaryData)
      view.set([1, 2, 3, 4, 5, 6, 7, 8])

      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(binaryData),
      })

      const result = await operator.execute({
        format: 'binary',
        url: 'https://example.com/file.bin',
        text: '',
        autoType: true,
        pulse: 0,
      })

      expect(result.data).toEqual(binaryData)
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/file.bin')
    })

    it('should return empty Uint8Array when no input provided', async () => {
      const operator = new FileOp('/file-uint8-empty')
      const result = await operator.execute({
        format: 'binary',
        url: '',
        text: '',
        autoType: true,
        pulse: 0,
      })

      expect(result.data).toBeInstanceOf(Uint8Array)
      expect((result.data as Uint8Array).length).toEqual(0)
    })

    it('should handle UTF-8 encoded text in binary format', async () => {
      const operator = new FileOp('/file-utf8-binary')
      const textWithEmoji = 'Hello 👋 World'
      const result = await operator.execute({
        format: 'binary',
        url: '',
        text: textWithEmoji,
        autoType: true,
        pulse: 0,
      })

      expect(result.data).toBeInstanceOf(Uint8Array)

      // Decode and verify
      const decoder = new TextDecoder()
      expect(decoder.decode(result.data as Uint8Array)).toEqual(textWithEmoji)
    })
  })

  describe('Error handling', () => {
    it('should throw error with descriptive message on fetch failure', async () => {
      const operator = new FileOp('/file-fetch-error')
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      await expect(
        operator.execute({
          format: 'json',
          url: 'https://example.com/data.json',
          text: '',
          autoType: true,
          pulse: 0,
        })
      ).rejects.toThrow('Unable to read file "https://example.com/data.json": Network error')
    })

    it('should throw error for unsupported format', async () => {
      const operator = new FileOp('/file-unsupported-error')
      await expect(
        operator.execute({
          format: 'unsupported' as any,
          url: '',
          text: 'test',
          autoType: true,
          pulse: 0,
        })
      ).rejects.toThrow('Unsupported format: unsupported')
    })
  })
})

describe('Custom Fields', () => {
  it('adds custom input definitions', () => {
    const operator = new CodeOp('/code-custom')

    expect(operator.customInputDefinitions).toEqual([])

    const def = {
      id: 'test-id',
      name: 'myParam',
      type: 'number',
      order: 0,
      defaultValue: 42,
    }

    operator.addCustomInput(def)

    expect(operator.customInputDefinitions).toHaveLength(1)
    expect(operator.customInputDefinitions[0]).toEqual(def)
    expect(operator.inputs.myParam).toBeDefined()
    expect(operator.inputs.myParam.value).toBe(42)
  })

  it('removes custom input definitions', () => {
    const operator = new CodeOp('/code-custom')

    operator.addCustomInput({
      id: 'id-1',
      name: 'param1',
      type: 'number',
      order: 0,
      defaultValue: 1,
    })
    operator.addCustomInput({
      id: 'id-2',
      name: 'param2',
      type: 'string',
      order: 1,
      defaultValue: 'hello',
    })

    expect(operator.customInputDefinitions).toHaveLength(2)

    operator.removeCustomInput('id-1')

    expect(operator.customInputDefinitions).toHaveLength(1)
    expect(operator.customInputDefinitions[0].name).toBe('param2')
    expect(operator.inputs.param1).toBeUndefined()
    expect(operator.inputs.param2).toBeDefined()
  })

  it('validates custom field names', () => {
    const operator = new CodeOp('/code-custom')

    // Empty name
    expect(operator.validateCustomFieldName('')).toBe('Name is required')

    // Invalid identifier
    expect(operator.validateCustomFieldName('123abc')).toBe(
      'Invalid identifier (use only letters, numbers, _, $)'
    )
    expect(operator.validateCustomFieldName('my-param')).toBe(
      'Invalid identifier (use only letters, numbers, _, $)'
    )

    // Conflicts with built-in field
    expect(operator.validateCustomFieldName('data')).toBe('Name conflicts with built-in field')
    expect(operator.validateCustomFieldName('code')).toBe('Name conflicts with built-in field')

    // Valid names
    expect(operator.validateCustomFieldName('myParam')).toBeNull()
    expect(operator.validateCustomFieldName('_private')).toBeNull()
    expect(operator.validateCustomFieldName('$special')).toBeNull()
  })

  it('emits customFieldsChanged on rebuildInputs', () => {
    const operator = new CodeOp('/code-custom')
    const changes: Array<typeof operator.customInputDefinitions> = []

    const subscription = operator.customFieldsChanged.subscribe(defs => {
      changes.push([...defs])
    })

    operator.addCustomInput({
      id: 'id-1',
      name: 'param1',
      type: 'number',
      order: 0,
      defaultValue: 1,
    })

    operator.addCustomInput({
      id: 'id-2',
      name: 'param2',
      type: 'boolean',
      order: 1,
      defaultValue: false,
    })

    subscription.unsubscribe()

    // Each addCustomInput calls rebuildInputs which emits
    expect(changes).toHaveLength(2)
    expect(changes[0]).toHaveLength(1)
    expect(changes[1]).toHaveLength(2)
  })

  it('preserves values when rebuilding inputs', () => {
    const operator = new CodeOp('/code-custom')

    operator.addCustomInput({
      id: 'id-1',
      name: 'myNumber',
      type: 'number',
      order: 0,
      defaultValue: 0,
    })

    // Set a non-default value
    operator.inputs.myNumber.setValue(999)
    expect(operator.inputs.myNumber.value).toBe(999)

    // Add another custom input (triggers rebuild)
    operator.addCustomInput({
      id: 'id-2',
      name: 'myString',
      type: 'string',
      order: 1,
      defaultValue: '',
    })

    // Original value should be preserved
    expect(operator.inputs.myNumber.value).toBe(999)
  })

  it('preserves a custom number field step override when rebuilding inputs', () => {
    const operator = new CodeOp('/code-custom')

    operator.addCustomInput({
      id: 'id-1',
      name: 'myNumber',
      type: 'number',
      order: 0,
      defaultValue: 0,
    })
    const numberField = operator.inputs.myNumber as NumberField
    numberField.setStepOverride(0.001)

    operator.addCustomInput({
      id: 'id-2',
      name: 'myString',
      type: 'string',
      order: 1,
      defaultValue: '',
    })

    expect((operator.inputs.myNumber as NumberField).stepOverride).toBe(0.001)
  })

  it('getAllInputs returns built-in and custom inputs', () => {
    const operator = new CodeOp('/code-custom')

    operator.addCustomInput({
      id: 'id-1',
      name: 'customParam',
      type: 'number',
      order: 0,
      defaultValue: 42,
    })

    const allInputs = operator.getAllInputs()

    // Built-in inputs
    expect(allInputs.data).toBeDefined()
    expect(allInputs.code).toBeDefined()

    // Custom input
    expect(allInputs.customParam).toBeDefined()
    expect(allInputs.customParam.value).toBe(42)
  })

  it('supports enableExpression in custom field definition', () => {
    const operator = new CodeOp('/code-custom')

    operator.addCustomInput({
      id: 'id-1',
      name: 'mode',
      type: 'string',
      order: 0,
      defaultValue: 'simple',
    })

    operator.addCustomInput({
      id: 'id-2',
      name: 'advancedSetting',
      type: 'number',
      order: 1,
      defaultValue: 100,
      enableExpression: "par.mode === 'advanced'",
    })

    expect(operator.customInputDefinitions[1].enableExpression).toBe("par.mode === 'advanced'")
  })
})

describe('DirectionsOp', () => {
  it('exposes traffic scheduling inputs with backward-compatible defaults', () => {
    const directionsOp = new DirectionsOp('/directions')

    expect(directionsOp.inputs.mode.value).toBe('transit')
    expect(directionsOp.inputs.departureMode.value).toBe('now')
    expect(directionsOp.inputs.departureTime.value).toBeInstanceOf(Temporal.PlainDateTime)
    expect(directionsOp.inputs.trafficModel.value).toBe('best-guess')
    expect(directionsOp.inputs.avoidTolls.value).toBe(false)
    expect(directionsOp.isFieldVisible('departureMode')).toBe(false)
    expect(directionsOp.isFieldVisible('departureTime')).toBe(false)
    expect(directionsOp.isFieldVisible('trafficModel')).toBe(false)
    expect(directionsOp.isFieldVisible('avoidTolls')).toBe(false)

    directionsOp.inputs.mode.setValue('driving-traffic')
    expect(directionsOp.isFieldVisible('departureMode')).toBe(true)
    expect(directionsOp.isFieldVisible('trafficModel')).toBe(true)
    expect(directionsOp.isFieldVisible('avoidTolls')).toBe(true)
    expect(directionsOp.isFieldVisible('departureTime')).toBe(false)
    directionsOp.inputs.departureMode.setValue('scheduled')
    expect(directionsOp.inputs.mode.value).toBe('driving-traffic')
    expect(directionsOp.inputs.departureMode.value).toBe('scheduled')
    expect(directionsOp.isFieldVisible('departureTime')).toBe(true)
  })

  it('accepts GeoJSON Point Features via Point2DField', () => {
    const directionsOp = new DirectionsOp('/directions')
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-74.006, 40.7128] },
      properties: {},
    }

    directionsOp.inputs.origin.setValue(feature)
    expect(directionsOp.inputs.origin.value).toEqual({ lng: -74.006, lat: 40.7128 })
  })

  it('still accepts plain { lng, lat } objects', () => {
    const directionsOp = new DirectionsOp('/directions')
    directionsOp.inputs.origin.setValue({ lng: -74.006, lat: 40.7128 })
    expect(directionsOp.inputs.origin.value).toEqual({ lng: -74.006, lat: 40.7128 })
  })

  it('ignores non-Point GeoJSON Features', () => {
    const directionsOp = new DirectionsOp('/directions')
    const lineFeature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      properties: {},
    }

    // Non-Point Feature won't parse — value should remain at default
    directionsOp.inputs.origin.setValue(lineFeature)
    expect(directionsOp.inputs.origin.value).toEqual({ lng: 0, lat: 0 })
  })
})

describe('GeocoderOp', () => {
  afterEach(() => {
    getKeysStore().clearBrowserKey('mapbox')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('geocodes its query when executed', async () => {
    getKeysStore().setBrowserKey('mapbox', 'test-token')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        features: [
          {
            place_name: 'Los Angeles, California, United States',
            center: [-118.2437, 34.0522],
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const geocoderOp = new GeocoderOp('/geocoder')
    const result = await geocoderOp.execute({ query: 'Los Angeles' })

    expect(result).toEqual({
      location: { lng: -118.2437, lat: 34.0522 },
      results: [
        {
          place_name: 'Los Angeles, California, United States',
          coordinates: { longitude: -118.2437, latitude: 34.0522 },
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mapbox.com/geocoding/v5/mapbox.places/Los%20Angeles.json?access_token=test-token&limit=5'
    )
  })

  it('requires a Mapbox API key', async () => {
    vi.spyOn(getKeysStore(), 'getKey').mockReturnValue(undefined)
    const geocoderOp = new GeocoderOp('/geocoder')

    await expect(geocoderOp.execute({ query: 'Los Angeles' })).rejects.toThrow(
      'Mapbox API key required (Settings > API Keys)'
    )
  })

  it('clears stale outputs when a connected query becomes blank', async () => {
    const getKeySpy = vi.spyOn(getKeysStore(), 'getKey').mockReturnValue('test-token')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        features: [{ place_name: 'Long Beach', center: [-118.1937, 33.7701] }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const geocoderOp = new GeocoderOp('/geocoder')
    const firstResult = await geocoderOp.execute({ query: 'Long Beach' })
    geocoderOp.outputs.location.next(firstResult.location)
    geocoderOp.outputs.results.next(firstResult.results)

    await expect(geocoderOp.execute({ query: '   ' })).resolves.toEqual({
      location: { lng: 0, lat: 0 },
      results: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    getKeySpy.mockRestore()
  })

  it('returns empty outputs without error when Mapbox has no results', async () => {
    const getKeySpy = vi.spyOn(getKeysStore(), 'getKey').mockReturnValue('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ features: [] }),
      })
    )

    const geocoderOp = new GeocoderOp('/geocoder')

    await expect(geocoderOp.execute({ query: 'Unknown place' })).resolves.toEqual({
      location: { lng: 0, lat: 0 },
      results: [],
    })
    getKeySpy.mockRestore()
  })

  it('surfaces Mapbox service failures separately from empty results', async () => {
    const getKeySpy = vi.spyOn(getKeysStore(), 'getKey').mockReturnValue('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      })
    )

    const geocoderOp = new GeocoderOp('/geocoder')

    await expect(geocoderOp.execute({ query: 'Long Beach' })).rejects.toThrow(
      'Mapbox geocoding failed: 429 Too Many Requests'
    )
    getKeySpy.mockRestore()
  })

  it('includes the reason Mapbox gives for rejecting a query', async () => {
    const getKeySpy = vi.spyOn(getKeysStore(), 'getKey').mockReturnValue('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: () => Promise.resolve({ message: 'Query too long - 21/20 tokens' }),
      })
    )

    const geocoderOp = new GeocoderOp('/geocoder')

    await expect(geocoderOp.execute({ query: 'Long Beach' })).rejects.toThrow(
      'Mapbox geocoding failed: 422 Query too long - 21/20 tokens'
    )
    getKeySpy.mockRestore()
  })
})
