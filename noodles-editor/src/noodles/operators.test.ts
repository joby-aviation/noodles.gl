import { describe, expect, it, vi } from 'vitest'
import { NumberField } from './fields'
import {
  AccessorOp,
  BoundingBoxOp,
  CodeOp,
  DeckRendererOp,
  DuckDbOp,
  ExpressionOp,
  FilterOp,
  GeoJsonTransformOp,
  JSONOp,
  LayerPropsOp,
  MapViewOp,
  MathOp,
  MergeOp,
  NumberOp,
  ObjectMergeOp,
  Operator,
  ProjectOp,
  RectangleOp,
  ScatterplotLayerOp,
  SelectOp,
  SwitchOp,
} from './operators'
import { opMap } from './store'
import { isAccessor } from './utils/accessor-helpers'

describe('basic Operators', () => {
  it('creates an Operator', () => {
    const operator = new NumberOp('/num-0')
    expect(operator.data.val).toEqual(0)
    expect(operator.outputData.val).toEqual(0)
  })
})

describe('Operator par and out', () => {
  it('supports accessing properties with par and out', () => {
    const operator = new NumberOp('/num-0')
    expect(operator.par.val).toEqual(0)
    expect(operator.out.val).toEqual(0)
    operator.inputs.val.setValue(1)
    expect(operator.par.val).toEqual(1)
  })

  it('throws on trying to set par or out', () => {
    const operator = new NumberOp('/num-0')
    expect(() => {
      operator.par.val = 1
    }).toThrow()
    expect(() => {
      operator.out.val = 1
    }).toThrow()
  })
})
describe('Operator pathToProps', () => {
  it('sets up the pathToProps for every field', () => {
    const operator = new NumberOp('/num-0')
    expect(operator.inputs.val.pathToProps).toEqual(['/num-0', 'par', 'val'])
    expect(operator.outputs.val.pathToProps).toEqual(['/num-0', 'out', 'val'])
  })

  it('creates pathToProps for nested objects', () => {
    const operator = new ProjectOp('/project-0')
    expect(operator.inputs.viewState.fields.zoom.pathToProps).toEqual([
      '/project-0',
      'par',
      'viewState',
      'zoom',
    ])
  })

  it('creates pathToProps for wrapped accessor Fields', () => {
    const operator = new ScatterplotLayerOp('/scatterplot-0')
    expect(operator.inputs.getFillColor.pathToProps).toEqual([
      '/scatterplot-0',
      'par',
      'getFillColor',
    ])
  })

  it('creates pathToProps for wrapped ListFields', () => {
    const operator = new ExpressionOp('/expression-0')
    expect(operator.inputs.data.pathToProps).toEqual(['/expression-0', 'par', 'data'])
    expect(operator.inputs.data.field.pathToProps).toEqual(['/expression-0', 'par', 'data'])
  })
})

describe('Error handling', () => {
  it('fails gracefully if execute throws an error', () => {
    class TestOp extends Operator<TestOp> {
      static displayName = 'TestOp'
      createInputs() {
        return {
          num: new NumberField(0),
        }
      }
      createOutputs() {
        return {}
      }
      execute(_: { num: number }) {
        // Simulate an error
        throw new Error('Test error')
      }
    }

    const operator = new TestOp('/test-0')

    const onError = vi.spyOn(operator, 'onError')
    const execute = vi.spyOn(operator, 'execute')
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(operator.inputs.num.value).toEqual(0)
    expect(onError).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(operator.outputData).toEqual({})

    operator.createListeners()

    expect(execute).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(operator.outputData).toEqual({})

    expect(execute.mock.calls[0][0]).toEqual({
      num: 0,
    })
    expect(onError.mock.calls[0][0]).toEqual(new Error('Test error'))
    expect(consoleWarn.mock.calls[0][0]).toEqual('Failure in [/test-0 (TestOp)]:')
    expect(consoleWarn.mock.calls[0][1]).toEqual('Test error')
    expect(consoleWarn.mock.calls[0][2]).toMatch(/TestOp.execute/)

    // Test that operation will continue listening without the subscription closing
    operator.inputs.num.setValue(1)

    expect(operator.inputs.num.value).toEqual(1)
    expect(operator.outputData).toEqual({})
    expect(execute).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(2)
    expect(consoleWarn).toHaveBeenCalledTimes(2)

    expect(execute.mock.calls[1][0]).toEqual({
      num: 1,
    })
    expect(onError.mock.calls[1][0]).toEqual(new Error('Test error'))
    expect(consoleWarn.mock.calls[1][0]).toEqual('Failure in [/test-0 (TestOp)]:')
    expect(consoleWarn.mock.calls[1][1]).toEqual('Test error')
  })
})

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

  it('parses mustache references to other operators', async () => {
    const numOp = new NumberOp('/num-0', { val: 1 }, false)
    opMap.set('/num-0', numOp)

    expect(numOp.inputs.val.value).toEqual(1)

    const code = 'return d + {{num-0.par.val}}'

    const operator = new CodeOp('/code-0', { code }, false)
    const val = await operator.execute({
      data: [1],
      code,
    })
    expect(val.data).toEqual(2)
  })
})

describe('JSONOp', () => {
  it('executes a JSONOp', () => {
    const text = '{"a": 1}'
    const operator = new JSONOp('json-0', { text }, false)
    const val = operator.execute({
      text,
    })
    expect(val.data).toEqual({ a: 1 })
  })

  it('supports references to other operators', () => {
    const numOp = new NumberOp('/num-0')
    numOp.outputs.val.setValue(1)
    opMap.set('/num-0', numOp)

    const text = '{ "a": {{num-0.out.val}} }'

    const operator = new JSONOp('/json-0', { text }, false)
    const val = operator.execute({
      text,
    })
    expect(val.data).toEqual({ a: 1 })
  })

  it('returns null for unresolved json references', () => {
    const text = '{ num: {{missing.par.val}} }'
    const operator = new JSONOp('json-0', { text }, false)
    expect(() => operator.execute({ text })).toThrowError('Field val not found on ./missing')
  })

  it('throws an error for missing fields in json references', () => {
    const text = '{ "num": {{num.par.missing}} }'
    const operator = new JSONOp('json-0', { text }, false)

    expect(() => operator.execute({ text })).toThrowError('Field missing not found on ./num')
  })
})

describe('ExpressionOp', () => {
  it('executes an ExpressionOp', () => {
    const operator = new ExpressionOp('/expression-0')
    const val = operator.execute({
      data: [1],
      expression: 'd + 1',
    })

    expect(val.data).toEqual(2)
    const val2 = operator.execute({
      data: [1],
      expression: 'data',
    })
    expect(val2.data).toEqual([1])
  })

  it('supports returning a Promise', () => {
    const operator = new ExpressionOp('/expression-0')
    const val = operator.execute({
      data: [],
      expression: 'new Promise(() => {})',
    })
    expect(val.data).toEqual(expect.any(Promise))
  })

  it('allows functions to be returned', () => {
    const operator = new ExpressionOp('/expression-0')
    const val = operator.execute({
      data: [1],
      expression: '[].map',
    })
    expect(val).toEqual({ data: Array.prototype.map })

    const val2 = operator.execute({
      data: [1],
      expression: 'async () => {}',
    })
    expect(val2).toEqual({ data: expect.any(Function) })
  })
})

describe('AccessorOp', () => {
  it('executes an AccessorOp', () => {
    const operator = new AccessorOp('/expression-0')
    const { accessor: val1 } = operator.execute({
      expression: 'd + 1',
    })
    expect(val1(1)).toEqual(2)

    const { accessor: val2 } = operator.execute({
      expression: 'dInfo',
    })
    expect(val2(undefined, { c: 3 })).toEqual({ c: 3 })
  })

  it('returns a function', () => {
    const operator = new AccessorOp('/expression-0')
    const val = operator.execute({
      expression: '',
    })
    expect(val.accessor).toEqual(expect.any(Function))
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
      zoom: 7.185340053829005,
    })
  })
})

describe('MathOps', () => {
  it('performs a basic add operation', () => {
    const operator = new MathOp('/math-0')
    const val = operator.execute({
      operator: 'add',
      a: 1,
      b: 2,
    })
    expect(val.result).toEqual(3)
  })

  it('performs a divide operation', () => {
    const operator = new MathOp('/math-0')
    const val = operator.execute({
      operator: 'divide',
      a: 1,
      b: 2,
    })
    expect(val.result).toEqual(0.5)
  })

  it('accepts large numbers', () => {
    const operator = new MathOp('/math-0')
    const val = operator.execute({
      operator: 'multiply',
      a: 1000000000000000000,
      b: 1000000000000000000,
    })
    expect(val.result).toEqual(1000000000000000000000000000000000000)
  })
})

describe('FilterOp', () => {
  it('executes a FilterOp', () => {
    const operator = new FilterOp('/filter')
    const val = operator.execute({
      data: [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
      columnName: 'a',
      condition: 'equals',
      value: 1,
    })
    expect(val.data).toEqual([{ a: 1, b: 2 }])
  })

  it('sets the columnName choices', () => {
    const operator = new FilterOp(
      'filter',
      { columnName: 'a', condition: 'not equals', value: '0' },
      false
    )
    expect(operator.inputs.columnName.value).toEqual('a')
    expect(operator.inputs.condition.value).toEqual('not equals')
    expect(operator.inputs.value.value).toEqual('0')
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]
    operator.inputs.data.setValue(data)
    expect(operator.inputs.columnName.choices.map(c => c.value)).toEqual(['a', 'b'])
  })
})

describe('DuckDbOp', () => {
  it('executes a basic query on duckdb', async () => {
    const operator = new DuckDbOp('duckdb-0', { query: 'SELECT 1' }, false)
    const val = await operator.execute({
      query: 'SELECT 1 as v',
    })
    expect(val).toEqual({ data: [expect.objectContaining({ v: 1 })] })
  })

  it('allows references to other operators', async () => {
    const numOp = new NumberOp('/num-0', { val: 1 }, false)
    opMap.set('/num-0', numOp)

    const ddb = new DuckDbOp('/duckdb-0', {}, false)
    const val = await ddb.execute({ query: 'SELECT {{num-0.par.val}}' })

    // Wait for `mergeMap` in `createListeners` to run
    await Promise.resolve()
    expect(val).toEqual({ data: [expect.objectContaining({ $1: 1 })] })
  })

  it('supports nested references', async () => {
    const bbox = new BoundingBoxOp('/bbox', {}, false)
    opMap.set('/bbox', bbox)

    const ddb = new DuckDbOp('/ddb', {}, false)
    const val = await ddb.execute({ query: 'SELECT {{bbox.out.viewState.latitude}} as lat' })

    expect(val).toEqual({ data: [expect.objectContaining({ lat: 0 })] })
  })
})

describe('ScatterplotLayerOp', () => {
  it('creates a scatterplot layer', () => {
    const operator = new ScatterplotLayerOp('/scatterplot-0')
    const { layer } = operator.execute({})
    expect(layer).toBeDefined()
    expect(layer.type).toEqual('ScatterplotLayer')
    expect(layer.id).toEqual('/scatterplot-0')
    expect(layer.updateTriggers).toEqual({})
    expect(layer.extensions).toBeUndefined()
  })

  it('creates a scatterplot layer with extensions', () => {
    const operator = new ScatterplotLayerOp('/scatterplot-0')
    // Extensions are now kept as POJOs in the layer output
    // They will be instantiated later in noodles.tsx

    const { layer } = operator.execute({
      otherProp: 1,
      extensions: [{ extension: { type: 'TestExtension' }, props: { test: 2 } }],
    })
    // Extensions should be POJOs with the type property
    expect(layer.extensions).toEqual([{ type: 'TestExtension' }])
    // Extension props should still be merged into layer props
    expect(layer.test).toEqual(2)
    expect(layer.otherProp).toEqual(1)
  })

  it('creates a scatterplot layer with updateTriggers', () => {
    const operator = new ScatterplotLayerOp('/scatterplot-0')
    const { layer } = operator.execute({
      getPosition: 'test',
      otherProp: 1,
    })
    expect(layer.updateTriggers).toEqual({ getPosition: ['test'] })
    expect(layer.otherProp).toEqual(1)
  })
})

describe('DeckRendererOp', () => {
  it('returns views if provided', () => {
    const operator = new DeckRendererOp('/deck-0')
    const {
      vis: {
        deckProps: { views },
      },
    } = operator.execute({
      layers: [],
      effects: [],
      views: ['view1', 'view2'],
      layerFilter: () => true,
    })
    expect(views).toEqual(['view1', 'view2'])
    const {
      vis: { deckProps },
    } = operator.execute({})
    expect(deckProps.views).not.toBeDefined()
  })

  it('returns undefined mapProps when basemap is null', () => {
    const operator = new DeckRendererOp('/deck-0')
    const {
      vis: { mapProps, deckProps },
    } = operator.execute({
      layers: [],
      effects: [],
      views: [],
      layerFilter: () => true,
      basemap: null,
      viewState: { longitude: -122, latitude: 37, zoom: 10, pitch: 0, bearing: 0 },
    })
    expect(mapProps).toBeUndefined()
    expect(deckProps.viewState).toEqual({
      longitude: -122,
      latitude: 37,
      zoom: 10,
      pitch: 0,
      bearing: 0,
    })
  })

  it('merges basemap with viewState properties when basemap is provided', () => {
    const operator = new DeckRendererOp('/deck-0')
    const basemap = {
      style: 'mapbox://styles/mapbox/streets-v11',
      longitude: -100,
      latitude: 40,
      zoom: 5,
    }
    const viewState = {
      longitude: -122,
      latitude: 37,
      pitch: 30,
      transitionDuration: 1000,
      nestedView: { bearing: 45 },
    }

    const {
      vis: { mapProps, deckProps },
    } = operator.execute({
      layers: [],
      effects: [],
      views: [],
      layerFilter: () => true,
      basemap,
      viewState,
    })

    expect(deckProps.viewState).toEqual({
      longitude: -122,
      latitude: 37,
      pitch: 30,
      nestedView: { bearing: 45 },
      transitionDuration: 1000,
    })
    expect(mapProps).toEqual({
      style: 'mapbox://styles/mapbox/streets-v11',
      longitude: -122,
      latitude: 37,
      zoom: 5,
      pitch: 30,
    })
  })
})

describe('MapViewOp', () => {
  it('returns valid clearColor', () => {
    const operator = new MapViewOp('/map-0')
    const { view } = operator.execute({
      clearColor: [127.5, 0, 127.5, 255],
    })
    expect(view.props.clearColor).toEqual([127.5, 0, 127.5, 255])
  })
})

describe('SwitchOp', () => {
  it('returns the value at the index', () => {
    const operator = new SwitchOp('/switch-0')
    const res = operator.execute({
      values: [],
      index: 0,
      blend: false,
    })
    expect(res.value).toEqual(undefined)

    const res2 = operator.execute({
      values: [1, 2, 3],
      index: 1,
      blend: false,
    })
    expect(res2.value).toEqual(2)
  })

  it('passes through nulls', () => {
    const operator = new SwitchOp('/switch-0')
    const { value } = operator.execute({
      values: [1, null, 3],
      index: 1,
      blend: false,
    })
    expect(value).toEqual(null)
  })

  it('blends values', () => {
    const operator = new SwitchOp('/switch-0')
    const res = operator.execute({
      values: [0, 100],
      index: 0.5,
      blend: true,
    })
    expect(res.value).toEqual(50)

    const res2 = operator.execute({
      values: [
        [0, 24],
        [100, 2],
      ],
      index: 0.5,
      blend: true,
    })
    expect(res2.value).toEqual([50, 13])

    const res3 = operator.execute({
      values: [
        { lng: 0, lat: 24 },
        { lng: 100, lat: 2 },
      ],
      index: 0.5,
      blend: true,
    })
    expect(res3.value).toEqual({ lng: 50, lat: 13 })
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

describe('GeoJsonTransformOp', () => {
  it('should return the same feature with default transform values', () => {
    const op = new GeoJsonTransformOp('/transform-0')

    // Create a simple rectangle using RectangleOp
    const rectOp = new RectangleOp('/rect-0')
    const { feature: inputFeature } = rectOp.execute({
      center: { lng: 0, lat: 0 },
      altitude: 0,
      width: 10,
      height: 10,
      properties: {},
    })

    const result = op.execute({
      feature: inputFeature,
      scale: 1,
      translateX: 0,
      translateY: 0,
      rotate: 0,
    })

    // With default values, the feature should be unchanged
    expect(result.feature).toEqual(inputFeature)
  })

  it('should rotate a feature around its centroid', () => {
    const op = new GeoJsonTransformOp('/transform-1')

    // Create a simple rectangle
    const rectOp = new RectangleOp('/rect-1')
    const { feature: inputFeature } = rectOp.execute({
      center: { lng: 0, lat: 0 },
      altitude: 0,
      width: 10,
      height: 10,
      properties: {},
    })

    const result = op.execute({
      feature: inputFeature,
      scale: 1,
      translateX: 0,
      translateY: 0,
      rotate: 90,
    })

    // The feature should be rotated 90 degrees
    expect(result.feature).toBeDefined()
    expect(result.feature.type).toBe('Feature')
    expect(result.feature.geometry.type).toBe('Polygon')
    // Verify that coordinates have changed
    expect(result.feature.geometry.coordinates).not.toEqual(inputFeature.geometry.coordinates)
    // Snapshot the transformed feature
    expect(result.feature).toMatchSnapshot()
  })

  it('should scale a feature from its centroid', () => {
    const op = new GeoJsonTransformOp('/transform-2')

    // Create a simple rectangle
    const rectOp = new RectangleOp('/rect-2')
    const { feature: inputFeature } = rectOp.execute({
      center: { lng: 0, lat: 0 },
      altitude: 0,
      width: 10,
      height: 10,
      properties: {},
    })

    const result = op.execute({
      feature: inputFeature,
      scale: 2,
      translateX: 0,
      translateY: 0,
      rotate: 0,
    })

    // The feature should be scaled by 2x
    expect(result.feature).toBeDefined()
    expect(result.feature.type).toBe('Feature')
    expect(result.feature.geometry.type).toBe('Polygon')
    // Verify that coordinates have changed
    expect(result.feature.geometry.coordinates).not.toEqual(inputFeature.geometry.coordinates)
    // Snapshot the transformed feature
    expect(result.feature).toMatchSnapshot()
  })

  it('should translate a feature', () => {
    const op = new GeoJsonTransformOp('/transform-3')

    // Create a simple rectangle
    const rectOp = new RectangleOp('/rect-3')
    const { feature: inputFeature } = rectOp.execute({
      center: { lng: 0, lat: 0 },
      altitude: 0,
      width: 10,
      height: 10,
      properties: {},
    })

    const result = op.execute({
      feature: inputFeature,
      scale: 1,
      translateX: 5,
      translateY: 5,
      rotate: 0,
    })

    // The feature should be translated
    expect(result.feature).toBeDefined()
    expect(result.feature.type).toBe('Feature')
    expect(result.feature.geometry.type).toBe('Polygon')
    // Verify that coordinates have changed
    expect(result.feature.geometry.coordinates).not.toEqual(inputFeature.geometry.coordinates)
    // Snapshot the transformed feature
    expect(result.feature).toMatchSnapshot()
  })

  it('should apply combined transformations in correct order', () => {
    const op = new GeoJsonTransformOp('/transform-4')

    // Create a simple rectangle
    const rectOp = new RectangleOp('/rect-4')
    const { feature: inputFeature } = rectOp.execute({
      center: { lng: 0, lat: 0 },
      altitude: 0,
      width: 10,
      height: 10,
      properties: {},
    })

    const result = op.execute({
      feature: inputFeature,
      scale: 2,
      translateX: 10,
      translateY: 10,
      rotate: 45,
    })

    // The feature should have all transformations applied
    expect(result.feature).toBeDefined()
    expect(result.feature.type).toBe('Feature')
    expect(result.feature.geometry.type).toBe('Polygon')
    // Verify that coordinates have changed significantly
    expect(result.feature.geometry.coordinates).not.toEqual(inputFeature.geometry.coordinates)
    // Snapshot the transformed feature
    expect(result.feature).toMatchSnapshot()
  })
})

describe('Viral Accessor Tests', () => {
  describe('MathOp', () => {
    it('should handle static values', () => {
      const op = new MathOp('test-math-1')
      op.createListeners()

      const result = op.execute({ operator: 'add', a: 5, b: 3 })

      expect(result.result).toBe(8)
      expect(isAccessor(result.result)).toBe(false)
    })

    it('should handle accessor function for a', () => {
      const op = new MathOp('test-math-2')
      op.createListeners()

      const accessor = (d: { value: number }) => d.value
      const result = op.execute({ operator: 'add', a: accessor, b: 10 })

      expect(isAccessor(result.result)).toBe(true)
      expect((result.result as Function)({ value: 5 })).toBe(15)
    })

    it('should handle accessor function for b', () => {
      const op = new MathOp('test-math-3')
      op.createListeners()

      const accessor = (d: { value: number }) => d.value
      const result = op.execute({ operator: 'multiply', a: 3, b: accessor })

      expect(isAccessor(result.result)).toBe(true)
      expect((result.result as Function)({ value: 4 })).toBe(12)
    })

    it('should handle accessor functions for both a and b', () => {
      const op = new MathOp('test-math-4')
      op.createListeners()

      const accessorA = (d: { x: number }) => d.x
      const accessorB = (d: { y: number }) => d.y
      const result = op.execute({ operator: 'subtract', a: accessorA, b: accessorB })

      expect(isAccessor(result.result)).toBe(true)
      expect((result.result as Function)({ x: 10, y: 3 })).toBe(7)
    })

    it('should handle unary operations with accessor', () => {
      const op = new MathOp('test-math-5')
      op.createListeners()

      const accessor = (d: { angle: number }) => d.angle
      const result = op.execute({ operator: 'sine', a: accessor, b: 0 })

      expect(isAccessor(result.result)).toBe(true)
      expect((result.result as Function)({ angle: 0 })).toBe(0)
      expect((result.result as Function)({ angle: Math.PI / 2 })).toBeCloseTo(1, 5)
    })
  })

  describe('ExpressionOp', () => {
    it('should handle static values', () => {
      const op = new ExpressionOp('test-expr-1')
      op.createListeners()

      const result = op.execute({ data: [10, 20, 30], expression: 'd * 2' })

      expect(result.data).toBe(20)
      expect(isAccessor(result.data)).toBe(false)
    })

    it('should handle accessor function in data', () => {
      const op = new ExpressionOp('test-expr-2')
      op.createListeners()

      const accessor = (d: { count: number }) => d.count
      const result = op.execute({ data: [accessor, 10], expression: 'd + 5' })

      expect(isAccessor(result.data)).toBe(true)
      expect((result.data as Function)({ count: 15 })).toBe(20)
    })

    it('should handle multiple accessor functions in data', () => {
      const op = new ExpressionOp('test-expr-3')
      op.createListeners()

      const accessor1 = (d: { x: number }) => d.x
      const accessor2 = (d: { y: number }) => d.y
      const result = op.execute({
        data: [accessor1, accessor2],
        expression: 'data[0] + data[1]',
      })

      expect(isAccessor(result.data)).toBe(true)
      expect((result.data as Function)({ x: 5, y: 10 })).toBe(15)
    })

    it('should handle mixed static and accessor values', () => {
      const op = new ExpressionOp('test-expr-4')
      op.createListeners()

      const accessor = (d: { value: number }) => d.value
      const result = op.execute({
        data: [accessor, 100, 50],
        expression: 'd * data[1] / data[2]',
      })

      expect(isAccessor(result.data)).toBe(true)
      expect((result.data as Function)({ value: 10 })).toBe(20)
    })
  })

  describe('MergeOp', () => {
    it('should handle static arrays', () => {
      const op = new MergeOp('test-merge-1')
      op.createListeners()

      const result = op.execute({
        values: [
          [1, 2],
          [3, 4],
        ],
        depth: 1,
      })

      expect(result.data).toEqual([1, 2, 3, 4])
      expect(isAccessor(result.data)).toBe(false)
    })

    it('should handle accessor function in values', () => {
      const op = new MergeOp('test-merge-2')
      op.createListeners()

      const accessor = (d: { items: number[] }) => d.items
      const result = op.execute({ values: [accessor, [7, 8]], depth: 1 })

      expect(isAccessor(result.data)).toBe(true)
      expect((result.data as Function)({ items: [5, 6] })).toEqual([5, 6, 7, 8])
    })

    it('should handle multiple accessor functions in values', () => {
      const op = new MergeOp('test-merge-3')
      op.createListeners()

      const accessor1 = (d: { first: number[] }) => d.first
      const accessor2 = (d: { second: number[] }) => d.second
      const result = op.execute({ values: [accessor1, accessor2], depth: 1 })

      expect(isAccessor(result.data)).toBe(true)
      expect((result.data as Function)({ first: [1, 2], second: [3, 4] })).toEqual([1, 2, 3, 4])
    })

    it('should handle depth parameter with accessors', () => {
      const op = new MergeOp('test-merge-4')
      op.createListeners()

      const accessor = (d: { nested: number[][] }) => d.nested
      const result = op.execute({ values: [accessor, [[7, 8]]], depth: 2 })

      expect(isAccessor(result.data)).toBe(true)
      expect(
        (result.data as Function)({
          nested: [
            [1, 2],
            [3, 4],
          ],
        })
      ).toEqual([1, 2, 3, 4, 7, 8])
    })

    it('should handle mixed static and accessor values', () => {
      const op = new MergeOp('test-merge-5')
      op.createListeners()

      const accessor = (d: { dynamic: number[] }) => d.dynamic
      const result = op.execute({ values: [[1, 2], accessor, [5, 6]], depth: 1 })

      expect(isAccessor(result.data)).toBe(true)
      expect((result.data as Function)({ dynamic: [3, 4] })).toEqual([1, 2, 3, 4, 5, 6])
    })
  })

  describe('Chained Viral Accessors', () => {
    it('should chain MathOp with ExpressionOp', () => {
      const mathOp = new MathOp('test-chain-1')
      mathOp.createListeners()

      const accessor = (d: { price: number }) => d.price
      const mathResult = mathOp.execute({ operator: 'multiply', a: accessor, b: 1.1 })

      const exprOp = new ExpressionOp('test-chain-2')
      exprOp.createListeners()

      const exprResult = exprOp.execute({
        data: [mathResult.result],
        expression: 'Math.round(d)',
      })

      expect(isAccessor(exprResult.data)).toBe(true)
      expect((exprResult.data as Function)({ price: 100 })).toBe(110)
    })

    it('should chain accessor functions through MergeOp', () => {
      const accessor1 = (d: { x: number }) => [d.x, d.x + 1]
      const accessor2 = (d: { y: number }) => [d.y * 2]

      const mergeOp = new MergeOp('test-chain-5')
      mergeOp.createListeners()

      const mergeResult = mergeOp.execute({
        values: [accessor1, accessor2],
        depth: 1,
      })

      expect(isAccessor(mergeResult.data)).toBe(true)
      expect((mergeResult.data as Function)({ x: 5, y: 10 })).toEqual([5, 6, 20])
    })
  })

  describe('ObjectMergeOp', () => {
    it('should handle static objects', () => {
      const op = new ObjectMergeOp('test-objmerge-1')
      op.createListeners()

      const result = op.execute({ objects: [{ a: 1 }, { b: 2 }] })

      expect(result.object).toEqual({ a: 1, b: 2 })
      expect(isAccessor(result.object)).toBe(false)
    })

    it('should handle accessor function in objects', () => {
      const op = new ObjectMergeOp('test-objmerge-2')
      op.createListeners()

      const accessor = (d: { x: number }) => ({ a: d.x })
      const result = op.execute({ objects: [accessor, { b: 2 }] })

      expect(isAccessor(result.object)).toBe(true)
      expect((result.object as Function)({ x: 5 })).toEqual({ a: 5, b: 2 })
    })

    it('should handle multiple accessor functions in objects', () => {
      const op = new ObjectMergeOp('test-objmerge-3')
      op.createListeners()

      const accessor1 = (d: { x: number }) => ({ a: d.x })
      const accessor2 = (d: { y: number }) => ({ b: d.y })
      const result = op.execute({ objects: [accessor1, accessor2] })

      expect(isAccessor(result.object)).toBe(true)
      expect((result.object as Function)({ x: 5, y: 10 })).toEqual({ a: 5, b: 10 })
    })

    it('should handle overlapping properties with accessors', () => {
      const op = new ObjectMergeOp('test-objmerge-4')
      op.createListeners()

      const accessor = (d: { value: number }) => ({ a: d.value })
      const result = op.execute({ objects: [{ a: 1, b: 2 }, accessor] })

      expect(isAccessor(result.object)).toBe(true)
      // Later objects override earlier ones (Object.assign behavior)
      expect((result.object as Function)({ value: 10 })).toEqual({ a: 10, b: 2 })
    })

    it('should handle mixed static and accessor values', () => {
      const op = new ObjectMergeOp('test-objmerge-5')
      op.createListeners()

      const accessor1 = (d: { x: number }) => ({ x: d.x })
      const accessor2 = (d: { y: number }) => ({ y: d.y })
      const result = op.execute({ objects: [accessor1, { z: 3 }, accessor2] })

      expect(isAccessor(result.object)).toBe(true)
      expect((result.object as Function)({ x: 1, y: 2 })).toEqual({ x: 1, z: 3, y: 2 })
    })
  })
})

describe('SelectOp', () => {
  it('returns undefined for empty array', () => {
    const operator = new SelectOp('/select-0')
    const result = operator.execute({
      data: [],
      index: 0,
    })
    expect(result.value).toEqual(undefined)
  })

  it('selects element', () => {
    const operator = new SelectOp('/select-1')
    const result = operator.execute({
      data: ['a', 'b', 'c'],
      index: 1,
    })
    expect(result.value).toEqual('b')
  })

  it('clamps index', () => {
    const operator = new SelectOp('/select-2')
    const result = operator.execute({
      data: [10, 20, 30],
      index: -5,
    })
    expect(result.value).toEqual(10)
    const result2 = operator.execute({
      data: [10, 20, 30],
      index: 5,
    })
    expect(result2.value).toEqual(30)
  })

  it('floors decimal index values', () => {
    const operator = new SelectOp('/select-4')
    const result = operator.execute({
      data: ['a', 'b', 'c', 'd'],
      index: 2.7,
    })
    expect(result.value).toEqual('c')
  })
})
