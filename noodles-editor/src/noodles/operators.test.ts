import * as deckWidgets from '@deck.gl/widgets'
import * as turf from '@turf/turf'
import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberField, StringField } from './fields'
import { getKeysStore } from './keys-store'
import {
  AccessorOp,
  BitmapOverlayWidgetOp,
  BoundingBoxOp,
  CategoricalColorRampOp,
  ChartOp,
  CodeOp,
  CompassWidgetOp,
  ConcatOp,
  CrossOp,
  DeckRendererOp,
  DirectionsOp,
  DuckDbOp,
  ExpressionOp,
  FileOp,
  FilterOp,
  FpsWidgetOp,
  FullscreenWidgetOp,
  GeocoderOp,
  GeoJsonLayerOp,
  GeoJsonTransformOp,
  JSONOp,
  KmlToGeoJsonOp,
  LayerPropsOp,
  MaplibreBasemapOp,
  MapViewOp,
  MapViewStateOp,
  MathOp,
  MergeOp,
  NetworkOp,
  NumberOp,
  Operator,
  PointOp,
  ProjectOp,
  RampOp,
  RectangleOp,
  RerouteOp,
  ScaleWidgetOp,
  ScatterplotLayerOp,
  ScreenshotWidgetOp,
  SelectOp,
  SmoothOp,
  SwitchOp,
  Tile3DLayerOp,
  TimeSeriesOp,
  ZoomWidgetOp,
} from './operators'
import { deleteOp, getOpStore, setOp } from './store'
import { isAccessor } from './utils/accessor-helpers'
import { canConnect } from './utils/can-connect'

describe('basic Operators', () => {
  it('creates an Operator', () => {
    const operator = new NumberOp('/num-0')
    expect(operator.data.val).toEqual(0)
    expect(operator.outputData.val).toEqual(0)
  })
})

describe('MapViewStateOp center', () => {
  it('accepts Geocoder and Point outputs', () => {
    const geocoder = new GeocoderOp('/geocoder')
    const point = new PointOp('/point')
    const operator = new MapViewStateOp('/map-view-state')

    expect(canConnect(geocoder.outputs.location, operator.inputs.center)).toBe(true)
    expect(canConnect(point.outputs.feature, operator.inputs.center)).toBe(true)
  })

  it('creates a view state centered on a geographic point', () => {
    const operator = new MapViewStateOp('/map-view-state')

    expect(
      operator.execute({
        center: { lng: -118.2437, lat: 34.0522 },
        zoom: 10,
        pitch: 35,
        bearing: -15,
      })
    ).toEqual({
      viewState: {
        longitude: -118.2437,
        latitude: 34.0522,
        zoom: 10,
        pitch: 35,
        bearing: -15,
      },
    })
  })

  it('normalizes a GeoJSON Point feature before creating the view state', () => {
    const point = new PointOp('/point')
    const operator = new MapViewStateOp('/map-view-state')
    const { feature } = point.execute({
      coordinates: { lng: -73.9857, lat: 40.7484 },
      properties: {},
    })

    operator.inputs.center.setValue(feature)

    expect(
      operator.execute({
        center: operator.inputs.center.value,
        zoom: 14,
        pitch: 0,
        bearing: 0,
      })
    ).toEqual({
      viewState: {
        longitude: -73.9857,
        latitude: 40.7484,
        zoom: 14,
        pitch: 0,
        bearing: 0,
      },
    })
  })

  it('keeps legacy longitude and latitude parameter aliases reactive', () => {
    const operator = new MapViewStateOp('/map-view-state')
    operator.inputs.center.setValue({ lng: 12.5, lat: -7.25 })

    const legacyParameters = operator.par as unknown as Record<string, unknown>
    expect(legacyParameters.longitude).toBe(12.5)
    expect(legacyParameters.latitude).toBe(-7.25)
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
  it('fails gracefully if execute throws an error', async () => {
    class TestOp extends Operator<TestOp> {
      static displayName = 'TestOp'
      static description = 'Test operator for error handling'
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

    expect(operator.inputs.num.value).toEqual(0)
    expect(onError).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(operator.outputData).toEqual({})

    // In pull-based model, pull() triggers execution and handles errors
    await expect(operator.pull()).rejects.toThrow('Test error')

    expect(execute).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(operator.outputData).toEqual({})

    expect(execute.mock.calls[0][0]).toEqual({
      num: 0,
    })
    expect(onError.mock.calls[0][0]).toEqual(new Error('Test error'))

    // Test that pull can be called again after error
    operator.inputs.num.setValue(1)

    expect(operator.inputs.num.value).toEqual(1)
    expect(operator.outputData).toEqual({})

    await expect(operator.pull()).rejects.toThrow('Test error')

    expect(execute).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(2)

    expect(execute.mock.calls[1][0]).toEqual({
      num: 1,
    })
    expect(onError.mock.calls[1][0]).toEqual(new Error('Test error'))
  })
})

describe('Connection error tracking', () => {
  it('tracks connection errors on operators', () => {
    const operator = new NumberOp('/num-0')

    // Initially no connection errors
    expect(operator.hasConnectionErrors()).toBe(false)
    expect(operator.connectionErrors.value.size).toBe(0)

    // Add a connection error
    const edgeId = '/source.out.val->/num-0.par.val'
    operator.addConnectionError(edgeId, 'Type mismatch: string cannot connect to number')

    expect(operator.hasConnectionErrors()).toBe(true)
    expect(operator.connectionErrors.value.get(edgeId)).toBe(
      'Type mismatch: string cannot connect to number'
    )
    expect(operator.getConnectionErrorMessages()).toEqual([
      'Type mismatch: string cannot connect to number',
    ])

    // Remove the connection error
    operator.removeConnectionError(edgeId)

    expect(operator.hasConnectionErrors()).toBe(false)
    expect(operator.connectionErrors.value.size).toBe(0)
  })

  it('tracks multiple connection errors', () => {
    const operator = new MergeOp('/merge-0')

    operator.addConnectionError('edge1', 'Error 1')
    operator.addConnectionError('edge2', 'Error 2')

    expect(operator.hasConnectionErrors()).toBe(true)
    expect(operator.connectionErrors.value.size).toBe(2)
    expect(operator.getConnectionErrorMessages()).toContain('Error 1')
    expect(operator.getConnectionErrorMessages()).toContain('Error 2')

    // Remove one error
    operator.removeConnectionError('edge1')

    expect(operator.hasConnectionErrors()).toBe(true)
    expect(operator.connectionErrors.value.size).toBe(1)
    expect(operator.getConnectionErrorMessages()).toEqual(['Error 2'])
  })

  it('is reactive via BehaviorSubject', () => {
    const operator = new NumberOp('/num-0')
    const errors: Map<string, string>[] = []

    const subscription = operator.connectionErrors.subscribe(e => errors.push(new Map(e)))

    operator.addConnectionError('edge1', 'Error 1')
    operator.addConnectionError('edge2', 'Error 2')
    operator.removeConnectionError('edge1')

    subscription.unsubscribe()

    expect(errors.length).toBe(4) // Initial + 3 updates
    expect(errors[0].size).toBe(0) // Initial empty state
    expect(errors[1].size).toBe(1) // After adding edge1
    expect(errors[2].size).toBe(2) // After adding edge2
    expect(errors[3].size).toBe(1) // After removing edge1
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
    setOp('/num-0', numOp)

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

describe('CodeOp op() error handling', () => {
  beforeEach(() => {
    getOpStore().batch(() => {
      const numOp = new NumberOp('/num')
      numOp.inputs.val.setValue(42)
      setOp('/num', numOp)
    })
  })

  afterEach(() => {
    deleteOp('/num')
  })

  it('should throw clear error when operator not found with absolute path', async () => {
    const codeOp = new CodeOp('/code')
    await expect(
      codeOp.execute({
        data: [],
        code: 'return op("/missing").par.value',
      })
    ).rejects.toThrow("Operator '/missing' not found")
  })

  it('should throw clear error when operator not found with relative path', async () => {
    const codeOp = new CodeOp('/code')
    setOp('/code', codeOp)

    try {
      await expect(
        codeOp.execute({
          data: [],
          code: 'return op("./missing").out.data',
        })
      ).rejects.toThrow("Operator './missing' not found")
    } finally {
      deleteOp('/code')
    }
  })

  it('should throw clear error when operator not found in mustache syntax', async () => {
    const codeOp = new CodeOp('/code')
    await expect(
      codeOp.execute({
        data: [],
        code: 'return {{/missing.par.value}}',
      })
    ).rejects.toThrow("Operator '/missing' not found")
  })

  it('should still work with valid operator references', async () => {
    const codeOp = new CodeOp('/code')
    const result = await codeOp.execute({
      data: [],
      code: 'return op("/num").par.val',
    })
    expect(result.data).toBe(42)
  })
})

describe('CodeOp self-parameter references', () => {
  it('should allow CodeOp to reference its own custom parameter with shorthand syntax', async () => {
    const codeOp = new CodeOp('/code-self')
    setOp('/code-self', codeOp)

    codeOp.addCustomInput({
      id: 'val-id',
      name: 'val',
      type: 'number',
      order: 0,
      defaultValue: 5,
    })

    codeOp.inputs.val.setValue(10)

    const result = await codeOp.execute({
      data: [[1, 2, 3]],
      code: 'return d.map(x => x * {{par.val}})',
    })
    expect(result.data).toEqual([10, 20, 30])
  })

  it('should allow CodeOp to reference its own custom parameter with simple relative syntax', async () => {
    const codeOp = new CodeOp('/code-self-rel')
    setOp('/code-self-rel', codeOp)

    codeOp.addCustomInput({
      id: 'multiplier-id',
      name: 'multiplier',
      type: 'number',
      order: 0,
      defaultValue: 1,
    })

    codeOp.inputs.multiplier.setValue(5)

    // Using the operator ID directly (simple relative syntax, equivalent to ./code-self-rel)
    const result = await codeOp.execute({
      data: [[2, 4, 6]],
      code: 'return d.map(x => x * {{code-self-rel.par.multiplier}})',
    })
    expect(result.data).toEqual([10, 20, 30])
  })

  it('should allow CodeOp to reference its own custom parameter with absolute syntax', async () => {
    const codeOp = new CodeOp('/code-self-abs')
    setOp('/code-self-abs', codeOp)

    codeOp.addCustomInput({
      id: 'offset-id',
      name: 'offset',
      type: 'number',
      order: 0,
      defaultValue: 0,
    })

    codeOp.inputs.offset.setValue(100)

    const result = await codeOp.execute({
      data: [[1, 2, 3]],
      code: 'return d.map(x => x + {{/code-self-abs.par.offset}})',
    })
    expect(result.data).toEqual([101, 102, 103])
  })

  it('should work with multiple self-parameter references', async () => {
    const codeOp = new CodeOp('/code-multi')
    setOp('/code-multi', codeOp)

    codeOp.addCustomInput({
      id: 'scale-id',
      name: 'scale',
      type: 'number',
      order: 0,
      defaultValue: 1,
    })

    codeOp.addCustomInput({
      id: 'offset-id',
      name: 'offset',
      type: 'number',
      order: 1,
      defaultValue: 0,
    })

    codeOp.inputs.scale.setValue(2)
    codeOp.inputs.offset.setValue(10)

    const result = await codeOp.execute({
      data: [[1, 2, 3]],
      code: 'return d.map(x => x * {{par.scale}} + {{par.offset}})',
    })
    expect(result.data).toEqual([12, 14, 16])
  })

  it('should work with string custom parameters', async () => {
    const codeOp = new CodeOp('/code-string')
    setOp('/code-string', codeOp)

    codeOp.addCustomInput({
      id: 'prefix-id',
      name: 'prefix',
      type: 'string',
      order: 0,
      defaultValue: '',
    })

    codeOp.inputs.prefix.setValue('item_')

    const result = await codeOp.execute({
      data: [['a', 'b', 'c']],
      code: 'return d.map(x => {{par.prefix}} + x)',
    })
    expect(result.data).toEqual(['item_a', 'item_b', 'item_c'])
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
    setOp('/num-0', numOp)

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

  it('throws SyntaxError for invalid expressions and logs warning', () => {
    const operator = new ExpressionOp('/expression-syntax-error')

    expect(() => {
      operator.execute({
        data: [],
        expression: 'return }', // Invalid syntax
      })
    }).toThrow(SyntaxError)
  })

  describe('friendly error messages', () => {
    const testCases = [
      { expression: '[1, 2', expectedMessage: "Missing 1 closing ']'" },
      { expression: 'foo(', expectedMessage: "Missing 1 closing ')'" },
      { expression: '{a: 1', expectedMessage: "Missing 1 closing '}'" },
      { expression: '[[1, 2]', expectedMessage: "Missing 1 closing ']'" },
      {
        expression: 'd +',
        expectedMessage: 'Expression incomplete - missing value after operator',
      },
      {
        expression: 'd.',
        expectedMessage: 'Expression incomplete - missing property name after "."',
      },
      // Note: trailing comma with unclosed bracket reports the bracket issue (more important)
      { expression: '[1, 2,', expectedMessage: "Missing 1 closing ']'" },
    ]

    testCases.forEach(({ expression, expectedMessage }) => {
      it(`shows "${expectedMessage}" for "${expression}"`, () => {
        const operator = new ExpressionOp('/test-expr')

        // Verify the thrown error has the friendly message
        expect(() => {
          operator.execute({ data: [], expression })
        }).toThrow(expectedMessage)
      })
    })
  })
})

describe('ExpressionOp op() error handling', () => {
  beforeEach(() => {
    const numOp = new NumberOp('/num')
    numOp.inputs.val.setValue(100)
    setOp('/num', numOp)
  })

  afterEach(() => {
    deleteOp('/num')
  })

  it('should throw clear error when operator not found', () => {
    const exprOp = new ExpressionOp('/expr')
    expect(() =>
      exprOp.execute({
        data: [],
        expression: 'op("/nonexistent").par.value',
      })
    ).toThrow("Operator '/nonexistent' not found")
  })

  it('should throw clear error accessing out field of missing operator', () => {
    const exprOp = new ExpressionOp('/expr')
    expect(() =>
      exprOp.execute({
        data: [],
        expression: 'op("/missing").out.result',
      })
    ).toThrow("Operator '/missing' not found")
  })

  it('should still work with valid operator references', () => {
    const exprOp = new ExpressionOp('/expr')
    const result = exprOp.execute({
      data: [1],
      expression: 'd + op("/num").par.val',
    })
    expect(result.data).toBe(101)
  })
})

describe('AccessorOp', () => {
  it('executes an AccessorOp', () => {
    const operator = new AccessorOp('/expression-0')
    const { accessor: val1 } = operator.execute({
      expression: 'd + 1',
    })
    expect(val1(1, { index: 0 })).toEqual(2)

    const { accessor: val2 } = operator.execute({
      expression: 'data.c + i',
    })
    expect(val2(undefined, { index: 1, data: { c: 3 } })).toEqual(4)
  })

  it('returns a function', () => {
    const operator = new AccessorOp('/expression-0')
    const val = operator.execute({
      expression: '',
    })
    expect(val.accessor).toEqual(expect.any(Function))
  })
})

describe('AccessorOp op() error handling', () => {
  beforeEach(() => {
    const numOp = new NumberOp('/num')
    numOp.inputs.val.setValue(5)
    setOp('/num', numOp)
  })

  afterEach(() => {
    deleteOp('/num')
  })

  it('should return undefined when operator not found (errors swallowed)', () => {
    const accessorOp = new AccessorOp('/accessor')
    const { accessor } = accessorOp.execute({
      expression: 'op("/missing").par.value',
    })
    // AccessorOp has try-catch that swallows errors and returns undefined
    // to prevent GPU crashes in deck.gl
    const result = accessor({ value: 10 }, { index: 0, data: [] })
    expect(result).toBeUndefined()
  })

  it('should still work with valid operator references', () => {
    const accessorOp = new AccessorOp('/accessor')
    const { accessor } = accessorOp.execute({
      expression: 'd.value * op("/num").par.val',
    })
    const result = accessor({ value: 10 }, { index: 0, data: [] })
    expect(result).toBe(50)
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

describe('ChartOp', () => {
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
    setOp('/num-0', numOp)

    const ddb = new DuckDbOp('/duckdb-0', {}, false)
    const val = await ddb.execute({ query: 'SELECT {{num-0.par.val}}' })

    // Wait for async operations to complete
    await Promise.resolve()
    expect(val).toEqual({ data: [expect.objectContaining({ $1: 1 })] })
  })

  it('supports nested references', async () => {
    const bbox = new BoundingBoxOp('/bbox', {}, false)
    setOp('/bbox', bbox)

    const ddb = new DuckDbOp('/ddb', {}, false)
    const val = await ddb.execute({ query: 'SELECT {{bbox.out.viewState.latitude}} as lat' })

    expect(val).toEqual({ data: [expect.objectContaining({ lat: 0 })] })
  })

  it('throws an error for unresolved references', async () => {
    const ddb = new DuckDbOp('/ddb', {}, false)
    await expect(ddb.execute({ query: 'SELECT {{missing.par.val}}' })).rejects.toThrowError(
      'Field val not found on ./missing'
    )
  })

  it('errors on a select including a semicolon', async () => {
    const ddb = new DuckDbOp('/ddb', {}, false)
    await expect(ddb.execute({ query: "SELECT '1;10'" })).rejects.toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('Parser Error: unterminated quoted string'),
      })
    )
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
      zoom: 5, // carried from basemap (not overridden by viewState)
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

  it('returns mapProps with empty mapStyle when basemap has an empty mapStyle', () => {
    // The operator passes the empty mapStyle through unchanged.
    // It's timeline-editor's basemapEnabled check that treats it as "no basemap".
    const operator = new DeckRendererOp('/deck-0')
    const {
      vis: { mapProps },
    } = operator.execute({
      basemap: { mapStyle: '', latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 },
      viewState: {},
    })
    expect(mapProps).toBeDefined()
    expect(mapProps?.mapStyle).toBe('')
  })

  it('includes basemap viewState in deckProps when mapStyle is empty (transparent mode)', () => {
    // When mapStyle is empty, timeline-editor switches to standalone DeckGL (basemapEnabled=false).
    // deckProps.viewState must carry the geo position so layers render at the correct location.
    const operator = new DeckRendererOp('/deck-0')
    const {
      vis: { deckProps },
    } = operator.execute({
      basemap: { mapStyle: '', latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 },
      viewState: {},
    })
    expect(deckProps.viewState).toEqual({
      latitude: 37,
      longitude: -122,
      zoom: 10,
      pitch: 0,
      bearing: 0,
    })
  })
})

describe('MaplibreBasemapOp', () => {
  it('passes mapStyle through to output', () => {
    const op = new MaplibreBasemapOp('/maplibre-0')
    const result = op.execute({
      mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
      projection: 'mercator',
      viewState: { latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 },
      sky: {
        enabled: false,
        skyColor: '#88C6FC',
        horizonColor: '#ffffff',
        skyHorizonBlend: 0.8,
        atmosphereBlend: 0.5,
      },
      light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
    })
    expect(result.maplibre.mapStyle).toBe(
      'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'
    )
  })

  it('passes empty mapStyle through without modification', () => {
    // An empty mapStyle signals "no basemap" (transparent). The operator passes it through
    // unchanged; timeline-editor detects it via basemapEnabled and skips MapLibre rendering,
    // which prevents the "There is no style added to the map" crash.
    const op = new MaplibreBasemapOp('/maplibre-0')
    const result = op.execute({
      mapStyle: '',
      projection: 'mercator',
      viewState: { latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 },
      sky: {
        enabled: false,
        skyColor: '#88C6FC',
        horizonColor: '#ffffff',
        skyHorizonBlend: 0.8,
        atmosphereBlend: 0.5,
      },
      light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
    })
    expect(result.maplibre.mapStyle).toBe('')
  })

  it('accepts and passes through style objects', () => {
    const op = new MaplibreBasemapOp('/maplibre-0')
    const styleObject = {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
        },
      },
      layers: [
        {
          id: 'osm',
          type: 'raster',
          source: 'osm',
        },
      ],
    }

    const result = op.execute({
      mapStyle: styleObject as unknown as string,
      projection: 'mercator',
      viewState: { latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 },
      sky: {
        enabled: false,
        skyColor: '#88C6FC',
        horizonColor: '#ffffff',
        skyHorizonBlend: 0.8,
        atmosphereBlend: 0.5,
      },
      light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
    })

    expect(result.maplibre.mapStyle).toEqual(styleObject)
    expect(typeof result.maplibre.mapStyle).toBe('object')
  })

  it('output field accepts both strings and objects', () => {
    const op = new MaplibreBasemapOp('/maplibre-0')

    // Test with string
    const resultString = op.execute({
      mapStyle: 'https://example.com/style.json',
      projection: 'mercator',
      viewState: { latitude: 0, longitude: 0, zoom: 0, pitch: 0, bearing: 0 },
      sky: {
        enabled: false,
        skyColor: '#88C6FC',
        horizonColor: '#ffffff',
        skyHorizonBlend: 0.8,
        atmosphereBlend: 0.5,
      },
      light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
    })
    expect(typeof resultString.maplibre.mapStyle).toBe('string')

    // Test with object
    const styleObj = { version: 8, sources: {}, layers: [] }
    const resultObject = op.execute({
      mapStyle: styleObj as unknown as string,
      projection: 'mercator',
      viewState: { latitude: 0, longitude: 0, zoom: 0, pitch: 0, bearing: 0 },
      sky: {
        enabled: false,
        skyColor: '#88C6FC',
        horizonColor: '#ffffff',
        skyHorizonBlend: 0.8,
        atmosphereBlend: 0.5,
      },
      light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
    })
    expect(typeof resultObject.maplibre.mapStyle).toBe('object')
    expect(resultObject.maplibre.mapStyle).toEqual(styleObj)
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
      values: [0, 100, 200],
      index: 1.5,
      blend: true,
    })
    expect(res.value).toEqual(150)

    // Test blending at index 2.0 (exact index) with 4 values
    const res2 = operator.execute({
      values: [0, 100, 200, 300],
      index: 2.0,
      blend: true,
    })
    expect(res2.value).toEqual(200)

    const res3 = operator.execute({
      values: [
        [0, 20],
        [100, 40],
        [200, 60],
      ],
      index: 1.5,
      blend: true,
    })
    expect(res3.value).toEqual([150, 50])

    const res4 = operator.execute({
      values: [
        { lng: 0, lat: 10 },
        { lng: 100, lat: 20 },
        { lng: 200, lat: 30 },
      ],
      index: 1.7,
      blend: true,
    })
    expect(res4.value).toEqual({ lng: 170, lat: 27 })

    // Test edge case: index beyond array length (should clamp)
    const res5 = operator.execute({
      values: [0, 100, 200],
      index: 5.0,
      blend: true,
    })
    expect(res5.value).toEqual(200)
  })

  describe('Temporal blending', () => {
    it('blends Temporal.Instant values', () => {
      const operator = new SwitchOp('/switch-temporal-1')
      const instant1 = Temporal.Instant.fromEpochMilliseconds(0)
      const instant2 = Temporal.Instant.fromEpochMilliseconds(1000)
      const instant3 = Temporal.Instant.fromEpochMilliseconds(2000)

      // Test blending between instant1 and instant2 at 50%
      const result1 = operator.execute({
        values: [instant1, instant2, instant3],
        index: 0.5,
        blend: true,
      })
      expect(result1.value).toBeInstanceOf(Temporal.Instant)
      expect(result1.value.epochMilliseconds).toBe(500)

      // Test blending between instant2 and instant3 at 75%
      const result2 = operator.execute({
        values: [instant1, instant2, instant3],
        index: 1.75,
        blend: true,
      })
      expect(result2.value).toBeInstanceOf(Temporal.Instant)
      expect(result2.value.epochMilliseconds).toBe(1750)
    })

    it('blends Temporal.PlainDate values', () => {
      const operator = new SwitchOp('/switch-temporal-2')
      const date1 = Temporal.PlainDate.from('2024-01-01')
      const date2 = Temporal.PlainDate.from('2024-01-11')
      const date3 = Temporal.PlainDate.from('2024-01-21')

      // Test blending between date1 and date2 at 50%
      const result1 = operator.execute({
        values: [date1, date2, date3],
        index: 0.5,
        blend: true,
      })
      expect(result1.value).toBeInstanceOf(Temporal.PlainDate)
      // Should be approximately 5 days between Jan 1 and Jan 11
      expect(result1.value.toString()).toBe('2024-01-06')

      // Test blending at exact index
      const result2 = operator.execute({
        values: [date1, date2, date3],
        index: 1.0,
        blend: true,
      })
      expect(result2.value).toBeInstanceOf(Temporal.PlainDate)
      expect(result2.value.toString()).toBe('2024-01-11')
    })

    it('blends Temporal.PlainDateTime values', () => {
      const operator = new SwitchOp('/switch-temporal-3')
      const dt1 = Temporal.PlainDateTime.from('2024-01-01T00:00:00')
      const dt2 = Temporal.PlainDateTime.from('2024-01-01T12:00:00')

      // Test blending at 50% (6 hours between)
      const result = operator.execute({
        values: [dt1, dt2],
        index: 0.5,
        blend: true,
      })
      expect(result.value).toBeInstanceOf(Temporal.PlainDateTime)
      expect(result.value.toString()).toBe('2024-01-01T06:00:00')
    })

    it('blends Temporal.ZonedDateTime values and preserves timezone', () => {
      const operator = new SwitchOp('/switch-temporal-4')
      const zdt1 = Temporal.ZonedDateTime.from({
        year: 2024,
        month: 1,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
        timeZone: 'America/New_York',
      })
      const zdt2 = Temporal.ZonedDateTime.from({
        year: 2024,
        month: 1,
        day: 1,
        hour: 12,
        minute: 0,
        second: 0,
        timeZone: 'America/New_York',
      })

      // Test blending at 50%
      const result = operator.execute({
        values: [zdt1, zdt2],
        index: 0.5,
        blend: true,
      })
      expect(result.value).toBeInstanceOf(Temporal.ZonedDateTime)
      expect(result.value.timeZoneId).toBe('America/New_York')
      expect(result.value.hour).toBe(6)
    })

    it('handles Temporal values beyond array bounds', () => {
      const operator = new SwitchOp('/switch-temporal-6')
      const instant1 = Temporal.Instant.fromEpochMilliseconds(0)
      const instant2 = Temporal.Instant.fromEpochMilliseconds(1000)

      // Index beyond array should clamp to last value
      const result = operator.execute({
        values: [instant1, instant2],
        index: 5.0,
        blend: true,
      })
      expect(result.value).toBe(instant2)
      expect(result.value.epochMilliseconds).toBe(1000)
    })

    it('does not blend when blend is false', () => {
      const operator = new SwitchOp('/switch-temporal-8')
      const instant1 = Temporal.Instant.fromEpochMilliseconds(0)
      const instant2 = Temporal.Instant.fromEpochMilliseconds(1000)

      // Should just return the value at floor(index)
      const result = operator.execute({
        values: [instant1, instant2],
        index: 0.7,
        blend: false,
      })
      expect(result.value).toBe(instant1)
    })
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

describe('SmoothOp', () => {
  it('should pass through unchanged with window size 1', () => {
    const op = new SmoothOp('/smooth-0')
    const inputFeature = turf.lineString([
      [0, 0],
      [1, 1],
      [2, 0],
      [3, 1],
      [4, 0],
    ])

    const result = op.execute({
      feature: inputFeature,
      windowSize: 1,
      method: 'boxcar',
    })

    expect(result.feature.geometry.coordinates).toEqual(inputFeature.geometry.coordinates)
  })

  it('should apply boxcar smoothing to LineString', () => {
    const op = new SmoothOp('/smooth-1')
    const inputFeature = turf.lineString([
      [0, 0],
      [1, 1],
      [2, 0],
      [3, 1],
      [4, 0],
    ])

    const result = op.execute({
      feature: inputFeature,
      windowSize: 3,
      method: 'boxcar',
    })

    expect(result.feature.type).toBe('Feature')
    expect(result.feature.geometry.type).toBe('LineString')
    // Middle point [2,0] should be average of [1,1], [2,0], [3,1]
    // lon: (1+2+3)/3 = 2, lat: (1+0+1)/3 = 0.666...
    expect(result.feature.geometry.coordinates[2][0]).toBeCloseTo(2, 5)
    expect(result.feature.geometry.coordinates[2][1]).toBeCloseTo(2 / 3, 5)
    expect(result.feature).toMatchSnapshot()
  })

  it('should preserve extra coordinate channels', () => {
    const op = new SmoothOp('/smooth-2')
    const inputFeature = turf.lineString([
      [0, 0, 100],
      [1, 1, 200],
      [2, 0, 150],
    ])

    const result = op.execute({
      feature: inputFeature,
      windowSize: 3,
      method: 'boxcar',
    })

    // Altitude values preserved (not smoothed)
    expect(result.feature.geometry.coordinates[0][2]).toBe(100)
    expect(result.feature.geometry.coordinates[1][2]).toBe(200)
    expect(result.feature.geometry.coordinates[2][2]).toBe(150)
  })

  it('should apply Gaussian smoothing differently than boxcar', () => {
    const op = new SmoothOp('/smooth-3')
    const inputFeature = turf.lineString([
      [0, 0],
      [1, 1],
      [2, 0],
      [3, 1],
      [4, 0],
    ])

    const boxcarResult = op.execute({
      feature: inputFeature,
      windowSize: 5,
      method: 'boxcar',
    })

    const gaussianResult = op.execute({
      feature: inputFeature,
      windowSize: 5,
      method: 'gaussian',
    })

    // Gaussian should weight center point more heavily
    const boxcarY = boxcarResult.feature.geometry.coordinates[2][1]
    const gaussianY = gaussianResult.feature.geometry.coordinates[2][1]
    expect(gaussianY).not.toBeCloseTo(boxcarY, 5)
  })

  it('should handle MultiLineString', () => {
    const op = new SmoothOp('/smooth-4')
    const inputFeature = turf.multiLineString([
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      [
        [5, 5],
        [6, 6],
        [7, 5],
      ],
    ])

    const result = op.execute({
      feature: inputFeature,
      windowSize: 3,
      method: 'boxcar',
    })

    expect(result.feature.geometry.type).toBe('MultiLineString')
    expect(result.feature.geometry.coordinates).toHaveLength(2)
  })

  it('should pass through non-line geometries unchanged', () => {
    const op = new SmoothOp('/smooth-5')
    const pointFeature = turf.point([0, 0])

    const result = op.execute({
      feature: pointFeature,
      windowSize: 5,
      method: 'boxcar',
    })

    expect(result.feature).toEqual(pointFeature)
  })

  it('should preserve feature properties', () => {
    const op = new SmoothOp('/smooth-6')
    const inputFeature = turf.lineString(
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      { name: 'test-route', id: 123 }
    )

    const result = op.execute({
      feature: inputFeature,
      windowSize: 3,
      method: 'boxcar',
    })

    expect(result.feature.properties).toEqual({ name: 'test-route', id: 123 })
  })

  it('should handle edge points with asymmetric windows', () => {
    const op = new SmoothOp('/smooth-7')
    const inputFeature = turf.lineString([
      [0, 0],
      [2, 2],
      [4, 4],
    ])

    const result = op.execute({
      feature: inputFeature,
      windowSize: 5, // Larger than array
      method: 'boxcar',
    })

    // First point should be average of available points (itself and neighbors)
    // With window=5, radius=2, but only indices 0,1,2 exist
    const firstPoint = result.feature.geometry.coordinates[0]
    expect(firstPoint[0]).toBeCloseTo(2, 5) // (0+2+4)/3
    expect(firstPoint[1]).toBeCloseTo(2, 5)
  })

  it('should handle two-point LineStrings', () => {
    const op = new SmoothOp('/smooth-8')
    const twoPointFeature = turf.lineString([
      [0, 0],
      [1, 1],
    ])

    const result = op.execute({
      feature: twoPointFeature,
      windowSize: 5,
      method: 'boxcar',
    })

    // With only two points, smoothing should have minimal effect
    expect(result.feature.geometry.type).toBe('LineString')
    expect(result.feature.geometry.coordinates).toHaveLength(2)
  })
})

describe('Viral Accessor Tests', () => {
  describe('MathOp', () => {
    it('should handle static values', () => {
      const op = new MathOp('test-math-1')

      const result = op.execute({ operator: 'add', a: 5, b: 3 })

      expect(result.result).toBe(8)
      expect(isAccessor(result.result)).toBe(false)
    })

    it('should handle accessor function for a', () => {
      const op = new MathOp('test-math-2')

      const accessor = (d: { value: number }) => d.value
      const result = op.execute({ operator: 'add', a: accessor, b: 10 })

      expect(isAccessor(result.result)).toBe(true)
      expect((result.result as unknown as (d: { value: number }) => number)({ value: 5 })).toBe(15)
    })

    it('should handle accessor function for b', () => {
      const op = new MathOp('test-math-3')

      const accessor = (d: { value: number }) => d.value
      const result = op.execute({ operator: 'multiply', a: 3, b: accessor })

      expect(isAccessor(result.result)).toBe(true)
      expect((result.result as unknown as (d: { value: number }) => number)({ value: 4 })).toBe(12)
    })

    it('should handle accessor functions for both a and b', () => {
      const op = new MathOp('test-math-4')

      const accessorA = (d: { x: number }) => d.x
      const accessorB = (d: { y: number }) => d.y
      const result = op.execute({ operator: 'subtract', a: accessorA, b: accessorB })

      expect(isAccessor(result.result)).toBe(true)
      expect(
        (result.result as unknown as (d: { x: number; y: number }) => number)({ x: 10, y: 3 })
      ).toBe(7)
    })

    it('should handle unary operations with accessor', () => {
      const op = new MathOp('test-math-5')

      const accessor = (d: { angle: number }) => d.angle
      const result = op.execute({ operator: 'sine', a: accessor, b: 0 })

      expect(isAccessor(result.result)).toBe(true)
      expect((result.result as unknown as (d: { angle: number }) => number)({ angle: 0 })).toBe(0)
      expect(
        (result.result as unknown as (d: { angle: number }) => number)({ angle: Math.PI / 2 })
      ).toBeCloseTo(1, 5)
    })
  })

  describe('ExpressionOp', () => {
    it('should handle static values', () => {
      const op = new ExpressionOp('test-expr-1')

      const result = op.execute({ data: [10, 20, 30], expression: 'd * 2' })

      expect(result.data).toBe(20)
      expect(isAccessor(result.data)).toBe(false)
    })

    it('should handle accessor function in data', () => {
      const op = new ExpressionOp('test-expr-2')

      const accessor = (d: { count: number }) => d.count
      const result = op.execute({ data: [accessor, 10], expression: 'd + 5' })

      expect(isAccessor(result.data)).toBe(true)
      expect((result.data as unknown as (d: { count: number }) => number)({ count: 15 })).toBe(20)
    })

    it('should handle multiple accessor functions in data', () => {
      const op = new ExpressionOp('test-expr-3')

      const accessor1 = (d: { x: number }) => d.x
      const accessor2 = (d: { y: number }) => d.y
      const result = op.execute({
        data: [accessor1, accessor2],
        expression: 'data[0] + data[1]',
      })

      expect(isAccessor(result.data)).toBe(true)
      expect(
        (result.data as unknown as (d: { x: number; y: number }) => number)({ x: 5, y: 10 })
      ).toBe(15)
    })

    it('should handle mixed static and accessor values', () => {
      const op = new ExpressionOp('test-expr-4')

      const accessor = (d: { value: number }) => d.value
      const result = op.execute({
        data: [accessor, 100, 50],
        expression: 'd * data[1] / data[2]',
      })

      expect(isAccessor(result.data)).toBe(true)
      expect((result.data as unknown as (d: { value: number }) => number)({ value: 10 })).toBe(20)
    })
  })

  describe('ConcatOp', () => {
    it('should handle static arrays', () => {
      const op = new ConcatOp('test-concat-1')

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
      const op = new ConcatOp('test-concat-2')

      const accessor = (d: { items: number[] }) => d.items
      const result = op.execute({ values: [accessor, [7, 8]], depth: 1 })

      expect(isAccessor(result.data)).toBe(true)
      expect(
        (result.data as unknown as (d: { items: number[] }) => number[])({ items: [5, 6] })
      ).toEqual([5, 6, 7, 8])
    })

    it('should handle multiple accessor functions in values', () => {
      const op = new ConcatOp('test-concat-3')

      const accessor1 = (d: { first: number[] }) => d.first
      const accessor2 = (d: { second: number[] }) => d.second
      const result = op.execute({ values: [accessor1, accessor2], depth: 1 })

      expect(isAccessor(result.data)).toBe(true)
      expect(
        (result.data as unknown as (d: { first: number[]; second: number[] }) => number[])({
          first: [1, 2],
          second: [3, 4],
        })
      ).toEqual([1, 2, 3, 4])
    })

    it('should handle depth parameter with accessors', () => {
      const op = new ConcatOp('test-concat-4')

      const accessor = (d: { nested: number[][] }) => d.nested
      const result = op.execute({ values: [accessor, [[7, 8]]], depth: 2 })

      expect(isAccessor(result.data)).toBe(true)
      expect(
        (result.data as unknown as (d: { nested: number[][] }) => number[])({
          nested: [
            [1, 2],
            [3, 4],
          ],
        })
      ).toEqual([1, 2, 3, 4, 7, 8])
    })

    it('should handle mixed static and accessor values', () => {
      const op = new ConcatOp('test-concat-5')

      const accessor = (d: { dynamic: number[] }) => d.dynamic
      const result = op.execute({ values: [[1, 2], accessor, [5, 6]], depth: 1 })

      expect(isAccessor(result.data)).toBe(true)
      expect(
        (result.data as unknown as (d: { dynamic: number[] }) => number[])({ dynamic: [3, 4] })
      ).toEqual([1, 2, 3, 4, 5, 6])
    })
  })

  describe('CrossOp', () => {
    it('should generate all unique pairs from array', () => {
      const op = new CrossOp('test-cross-1')
      const result = op.execute({ data: [1, 2, 3] })
      expect(result.pairs).toEqual([
        [1, 2],
        [1, 3],
        [2, 3],
      ])
    })

    it('should handle empty array', () => {
      const op = new CrossOp('test-cross-2')
      const result = op.execute({ data: [] })
      expect(result.pairs).toEqual([])
    })

    it('should handle single element array', () => {
      const op = new CrossOp('test-cross-3')
      const result = op.execute({ data: [1] })
      expect(result.pairs).toEqual([])
    })

    it('should preserve element types', () => {
      const op = new CrossOp('test-cross-4')
      const result = op.execute({
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      })
      expect(result.pairs.length).toBe(3)
      expect(result.pairs[0][0]).toEqual({ id: 1 })
      expect(result.pairs[0][1]).toEqual({ id: 2 })
    })

    it('should handle two elements', () => {
      const op = new CrossOp('test-cross-5')
      const result = op.execute({ data: ['a', 'b'] })
      expect(result.pairs).toEqual([['a', 'b']])
    })
  })

  describe('Chained Viral Accessors', () => {
    it('should chain MathOp with ExpressionOp', () => {
      const mathOp = new MathOp('test-chain-1')

      const accessor = (d: { price: number }) => d.price
      const mathResult = mathOp.execute({ operator: 'multiply', a: accessor, b: 1.1 })

      const exprOp = new ExpressionOp('test-chain-2')

      const exprResult = exprOp.execute({
        data: [mathResult.result],
        expression: 'Math.round(d)',
      })

      expect(isAccessor(exprResult.data)).toBe(true)
      expect((exprResult.data as unknown as (d: { price: number }) => number)({ price: 100 })).toBe(
        110
      )
    })

    it('should chain accessor functions through ConcatOp', () => {
      const accessor1 = (d: { x: number }) => [d.x, d.x + 1]
      const accessor2 = (d: { y: number }) => [d.y * 2]

      const concatOp = new ConcatOp('test-chain-5')

      const concatResult = concatOp.execute({
        values: [accessor1, accessor2],
        depth: 1,
      })

      expect(isAccessor(concatResult.data)).toBe(true)
      expect(
        (concatResult.data as unknown as (d: { x: number; y: number }) => number[])({ x: 5, y: 10 })
      ).toEqual([5, 6, 20])
    })
  })

  describe('MergeOp', () => {
    it('should handle static objects', () => {
      const op = new MergeOp('test-merge-1')

      const result = op.execute({ objects: [{ a: 1 }, { b: 2 }] })

      expect(result.object).toEqual({ a: 1, b: 2 })
      expect(isAccessor(result.object)).toBe(false)
    })

    it('should handle accessor function in objects', () => {
      const op = new MergeOp('test-merge-2')

      const accessor = (d: { x: number }) => ({ a: d.x })
      const result = op.execute({ objects: [accessor, { b: 2 }] })

      expect(isAccessor(result.object)).toBe(true)
      expect(
        (result.object as unknown as (d: { x: number }) => Record<string, number>)({ x: 5 })
      ).toEqual({ a: 5, b: 2 })
    })

    it('should handle multiple accessor functions in objects', () => {
      const op = new MergeOp('test-merge-3')

      const accessor1 = (d: { x: number }) => ({ a: d.x })
      const accessor2 = (d: { y: number }) => ({ b: d.y })
      const result = op.execute({ objects: [accessor1, accessor2] })

      expect(isAccessor(result.object)).toBe(true)
      expect(
        (result.object as unknown as (d: { x: number; y: number }) => Record<string, number>)({
          x: 5,
          y: 10,
        })
      ).toEqual({ a: 5, b: 10 })
    })

    it('should handle overlapping properties with accessors', () => {
      const op = new MergeOp('test-merge-4')

      const accessor = (d: { value: number }) => ({ a: d.value })
      const result = op.execute({ objects: [{ a: 1, b: 2 }, accessor] })

      expect(isAccessor(result.object)).toBe(true)
      // Later objects override earlier ones (Object.assign behavior)
      expect(
        (result.object as unknown as (d: { value: number }) => Record<string, number>)({
          value: 10,
        })
      ).toEqual({ a: 10, b: 2 })
    })

    it('should handle mixed static and accessor values', () => {
      const op = new MergeOp('test-merge-5')

      const accessor1 = (d: { x: number }) => ({ x: d.x })
      const accessor2 = (d: { y: number }) => ({ y: d.y })
      const result = op.execute({ objects: [accessor1, { z: 3 }, accessor2] })

      expect(isAccessor(result.object)).toBe(true)
      expect(
        (result.object as unknown as (d: { x: number; y: number }) => Record<string, number>)({
          x: 1,
          y: 2,
        })
      ).toEqual({ x: 1, z: 3, y: 2 })
    })
  })
})

describe('SelectOp', () => {
  it('returns undefined for empty array', () => {
    const operator = new SelectOp('/select-0')
    const result = operator.execute({
      data: [],
      index: 0,
      wrap: false,
    })
    expect(result.value).toEqual(undefined)
  })

  it('selects element', () => {
    const operator = new SelectOp('/select-1')
    const result = operator.execute({
      data: ['a', 'b', 'c'],
      index: 1,
      wrap: false,
    })
    expect(result.value).toEqual('b')
  })

  it('clamps index', () => {
    const operator = new SelectOp('/select-2')
    const result = operator.execute({
      data: [10, 20, 30],
      index: -5,
      wrap: false,
    })
    expect(result.value).toEqual(10)
    const result2 = operator.execute({
      data: [10, 20, 30],
      index: 5,
      wrap: false,
    })
    expect(result2.value).toEqual(30)
  })

  it('floors decimal index values', () => {
    const operator = new SelectOp('/select-4')
    const result = operator.execute({
      data: ['a', 'b', 'c', 'd'],
      index: 2.7,
      wrap: false,
    })
    expect(result.value).toEqual('c')
  })

  it('wraps index around array bounds when wrap is true', () => {
    const operator = new SelectOp('/select-5')
    // Positive wrap
    expect(operator.execute({ data: ['a', 'b', 'c'], index: 3, wrap: true }).value).toEqual('a')
    expect(operator.execute({ data: ['a', 'b', 'c'], index: 5, wrap: true }).value).toEqual('c')
    // Negative wrap
    expect(operator.execute({ data: ['a', 'b', 'c'], index: -1, wrap: true }).value).toEqual('c')
    expect(operator.execute({ data: ['a', 'b', 'c'], index: -4, wrap: true }).value).toEqual('c')
  })
})

describe('TimeSeriesOp', () => {
  it('returns empty array when no data is provided', () => {
    const operator = new TimeSeriesOp('timeseries-0')
    const result = operator.execute({
      data: [],
      currentTime: 0,
      getTimestamps: (d: any) => d?.timestamps || [],
      getValues: (d: any) => d?.values || [],
      getProperties: (d: any) => d,
    })
    expect(result.data).toEqual([])
  })

  it('interpolates time-varying values with accessor-based API', () => {
    const operator = new TimeSeriesOp('timeseries-0')
    const result = operator.execute({
      data: [
        {
          id: 'trip-1',
          model: 'Boeing',
          timestamps: [0, 10, 20],
          values: [
            { heading: 360, speed: 100 },
            { heading: 45, speed: 120 },
            { heading: 90, speed: 110 },
          ],
        },
        {
          id: 'trip-2',
          model: 'Airbus',
          timestamps: [0, 10],
          values: [
            { heading: 180, speed: 150 },
            { heading: 270, speed: 170 },
          ],
        },
      ],
      currentTime: 5,
      getTimestamps: (d: any) => d.timestamps,
      getValues: (d: any) => d.values,
      getProperties: (d: any) => d,
    })

    expect(result.data as any).toHaveLength(2)

    // First trip at midpoint between 0 and 10
    expect((result.data as any)[0].id).toEqual('trip-1')
    expect((result.data as any)[0].model).toEqual('Boeing')
    expect((result.data as any)[0].heading).toEqual(202.5) // (360 + 45) / 2
    expect((result.data as any)[0].speed).toEqual(110) // (100 + 120) / 2
    expect((result.data as any)[0].time).toEqual(5)

    // Second trip at midpoint
    expect((result.data as any)[1].id).toEqual('trip-2')
    expect((result.data as any)[1].model).toEqual('Airbus')
    expect((result.data as any)[1].heading).toEqual(225) // (180 + 270) / 2
    expect((result.data as any)[1].speed).toEqual(160) // (150 + 170) / 2
    expect((result.data as any)[1].time).toEqual(5)
  })

  it('handles time values outside of data time domain', () => {
    const operator = new TimeSeriesOp('timeseries-0')
    const data = [
      {
        id: 'trip-1',
        timestamps: [5, 10],
        values: [
          { heading: 100, altitude: 1000 },
          { heading: 200, altitude: 2000 },
        ],
      },
    ]

    // Before first timestamp - clamps to first point
    const resultBefore = operator.execute({
      data,
      currentTime: 0,
      getTimestamps: (d: any) => d.timestamps,
      getValues: (d: any) => d.values,
      getProperties: (d: any) => d,
    })

    expect((resultBefore.data as any)[0].heading).toEqual(100)
    expect((resultBefore.data as any)[0].altitude).toEqual(1000)
    expect((resultBefore.data as any)[0].time).toEqual(0) // Uses currentTime from execute

    // After last timestamp - clamps to last point
    const resultAfter = operator.execute({
      data,
      currentTime: 20,
      getTimestamps: (d: any) => d.timestamps,
      getValues: (d: any) => d.values,
      getProperties: (d: any) => d,
    })

    expect((resultAfter.data as any)[0].heading).toEqual(200)
    expect((resultAfter.data as any)[0].altitude).toEqual(2000)
    expect((resultAfter.data as any)[0].time).toEqual(20) // Uses currentTime from execute
  })

  it('preserves all static properties via getProperties accessor', () => {
    const operator = new TimeSeriesOp('timeseries-0')
    const result = operator.execute({
      data: [
        {
          id: 'trip-1',
          model: 'Boeing 737',
          route: 'SFO-LAX',
          timestamps: [0, 10],
          path: [
            [0, 0],
            [1, 1],
          ],
          values: [
            { heading: 90, altitude: 1000 },
            { heading: 120, altitude: 1500 },
          ],
        },
      ],
      currentTime: 5,
      getTimestamps: (d: any) => d.timestamps,
      getValues: (d: any) => d.values,
      getProperties: (d: any) => d,
    })

    // All static properties should be preserved
    expect((result.data as any)[0].id).toEqual('trip-1')
    expect((result.data as any)[0].model).toEqual('Boeing 737')
    expect((result.data as any)[0].route).toEqual('SFO-LAX')
    expect((result.data as any)[0].timestamps).toEqual([0, 10])
    expect((result.data as any)[0].path).toEqual([
      [0, 0],
      [1, 1],
    ])

    // Interpolated values
    expect((result.data as any)[0].heading).toEqual(105)
    expect((result.data as any)[0].altitude).toEqual(1250)
    expect((result.data as any)[0].time).toEqual(5)
  })

  it('works with default accessors when data has expected shape', () => {
    const operator = new TimeSeriesOp('timeseries-0')
    // Use default input values which expect d.timestamps and d.values
    const result = operator.execute({
      data: [
        {
          id: 'trip-1',
          timestamps: [0, 10],
          values: [{ speed: 100 }, { speed: 200 }],
        },
      ],
      currentTime: 5,
      getTimestamps: (d: any) => d?.timestamps || [],
      getValues: (d: any) => d?.values || [],
      getProperties: (d: any) => d,
    })

    expect((result.data as any)[0].id).toEqual('trip-1')
    expect((result.data as any)[0].speed).toEqual(150)
    expect((result.data as any)[0].time).toEqual(5)
  })

  it('aligns with TripsLayer API - reusable getTimestamps accessor', () => {
    const operator = new TimeSeriesOp('timeseries-0')

    // This is the same accessor you'd use for TripsLayer
    const getTimestamps = (d: any) => d.timestamps
    const getValues = (d: any) => d.orientations

    const tripData = [
      {
        id: 'aircraft-1',
        timestamps: [0, 10, 20],
        path: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        orientations: [
          { heading: 0, pitch: 0, roll: 0 },
          { heading: 45, pitch: 5, roll: 10 },
          { heading: 90, pitch: 10, roll: 0 },
        ],
      },
    ]

    const result = operator.execute({
      data: tripData,
      currentTime: 5,
      getTimestamps,
      getValues,
      getProperties: (d: any) => d,
    })

    expect((result.data as any)[0].id).toEqual('aircraft-1')
    expect((result.data as any)[0].heading).toEqual(22.5) // interpolated
    expect((result.data as any)[0].pitch).toEqual(2.5) // interpolated
    expect((result.data as any)[0].roll).toEqual(5) // interpolated
    expect((result.data as any)[0].timestamps).toEqual([0, 10, 20]) // preserved from getProperties
    expect((result.data as any)[0].path).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]) // preserved from getProperties
  })

  it('reuses precomputed cache when only currentTime changes (scrubbing perf)', () => {
    const op = new TimeSeriesOp('/timeseries-cache-test')
    const data = [
      { timestamps: [0, 10], values: [{ x: 0 }, { x: 10 }] },
      { timestamps: [0, 10], values: [{ x: 100 }, { x: 200 }] },
    ]
    const getTimestamps = (d: any) => d.timestamps
    const getValues = (d: any) => d.values
    const getProperties = undefined

    // First execution builds the cache
    op.execute({ data, currentTime: 5, getTimestamps, getValues, getProperties })
    const cacheAfterFirst = (op as any)._precomputedTimeSeries

    // Second execution with different currentTime should reuse same cache reference
    op.execute({ data, currentTime: 7, getTimestamps, getValues, getProperties })
    expect((op as any)._precomputedTimeSeries).toBe(cacheAfterFirst)

    // Third execution with same currentTime should also reuse cache
    op.execute({ data, currentTime: 7, getTimestamps, getValues, getProperties })
    expect((op as any)._precomputedTimeSeries).toBe(cacheAfterFirst)
  })

  it('rebuilds cache when data reference changes', () => {
    const op = new TimeSeriesOp('/timeseries-cache-rebuild')
    const data1 = [{ timestamps: [0, 10], values: [{ x: 0 }, { x: 10 }] }]
    const data2 = [{ timestamps: [0, 10], values: [{ x: 0 }, { x: 10 }] }] // same content, different reference
    const getTimestamps = (d: any) => d.timestamps
    const getValues = (d: any) => d.values

    op.execute({ data: data1, currentTime: 5, getTimestamps, getValues, getProperties: undefined })
    const cacheAfterFirst = (op as any)._precomputedTimeSeries

    // New data reference should rebuild cache
    op.execute({ data: data2, currentTime: 5, getTimestamps, getValues, getProperties: undefined })
    expect((op as any)._precomputedTimeSeries).not.toBe(cacheAfterFirst)
  })

  it('rebuilds cache when accessor function reference changes', () => {
    const op = new TimeSeriesOp('/timeseries-accessor-change')
    const data = [{ timestamps: [0, 10], values: [{ x: 0 }, { x: 10 }] }]
    const getTimestamps1 = (d: any) => d.timestamps
    const getTimestamps2 = (d: any) => d.timestamps // same logic, different reference
    const getValues = (d: any) => d.values

    op.execute({
      data,
      currentTime: 5,
      getTimestamps: getTimestamps1,
      getValues,
      getProperties: undefined,
    })
    const cacheAfterFirst = (op as any)._precomputedTimeSeries

    // New accessor reference should rebuild cache
    op.execute({
      data,
      currentTime: 5,
      getTimestamps: getTimestamps2,
      getValues,
      getProperties: undefined,
    })
    expect((op as any)._precomputedTimeSeries).not.toBe(cacheAfterFirst)
  })
})

describe('KmlToGeoJsonOp', () => {
  it('should convert KML to GeoJSON', async () => {
    const operator = new KmlToGeoJsonOp('/kml-to-geojson-0')

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Test Point</name>
      <Point>
        <coordinates>-122.0822,37.4222,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`

    const result = await operator.execute({ kml })

    expect(result.geojson.type).toBe('FeatureCollection')
    expect(result.geojson.features).toHaveLength(1)
    expect(result.geojson.features[0].geometry.type).toBe('Point')
    expect(result.geojson.features[0].properties?.name).toBe('Test Point')
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
      const operator = new FileOp('/file-0')
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
      const operator = new FileOp('/file-1')
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
      const operator = new FileOp('/file-2')
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
    it('should parse CSV from text input', async () => {
      const operator = new FileOp('/file-3')
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

    it('should parse CSV without autoType', async () => {
      const operator = new FileOp('/file-4')
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
      const operator = new FileOp('/file-tsv-0')
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

    it('should parse TSV without autoType', async () => {
      const operator = new FileOp('/file-tsv-1')
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
      const operator = new FileOp('/file-5')
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
      const operator = new FileOp('/file-6')
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
      const operator = new FileOp('/file-7')
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
      const operator = new FileOp('/file-8')
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
      const operator = new FileOp('/file-9')
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
      const operator = new FileOp('/file-10')
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
      const operator = new FileOp('/file-11')
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
      const operator = new FileOp('/file-12')
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
      const operator = new FileOp('/file-13')
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

describe('Operator field visibility', () => {
  describe('isFieldVisible', () => {
    it('returns true by default when visibleFields.value is null', () => {
      const op = new NumberOp('/num-0')
      expect(op.visibleFields.value).toBe(null)
      expect(op.isFieldVisible('val')).toBe(true)
    })

    it('returns field.showByDefault when visibleFields.value is null', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      expect(op.visibleFields.value).toBe(null)
      // Core fields should be visible by default
      expect(op.isFieldVisible('data')).toBe(true)
      expect(op.isFieldVisible('visible')).toBe(true)
      // Hidden by default fields
      expect(op.isFieldVisible('extruded')).toBe(false)
      expect(op.isFieldVisible('extensions')).toBe(false)
    })

    it('returns true for fields in visibleFields set', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      op.visibleFields.next(new Set(['data', 'visible', 'extruded']))
      expect(op.isFieldVisible('data')).toBe(true)
      expect(op.isFieldVisible('visible')).toBe(true)
      expect(op.isFieldVisible('extruded')).toBe(true)
      expect(op.isFieldVisible('opacity')).toBe(false)
    })

    it('returns true for unknown fields when visibleFields.value is null', () => {
      const op = new NumberOp('/num-0')
      expect(op.isFieldVisible('nonexistent')).toBe(true)
    })
  })

  describe('visibleFields BehaviorSubject', () => {
    it('starts with null value', () => {
      const op = new NumberOp('/num-0')
      expect(op.visibleFields.value).toBe(null)
    })

    it('can be updated to a Set of field names via next()', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      op.visibleFields.next(new Set(['data', 'visible']))
      expect(op.visibleFields.value).toBeInstanceOf(Set)
      expect(op.visibleFields.value!.size).toBe(2)
      expect(op.visibleFields.value!.has('data')).toBe(true)
      expect(op.visibleFields.value!.has('visible')).toBe(true)
    })

    it('can be reset to null via next()', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      op.visibleFields.next(new Set(['data', 'visible']))
      op.visibleFields.next(null)
      expect(op.visibleFields.value).toBe(null)
    })

    it('notifies subscribers when value changes', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      const values: (Set<string> | null)[] = []
      const subscription = op.visibleFields.subscribe(v => values.push(v))

      op.visibleFields.next(new Set(['data']))
      op.visibleFields.next(new Set(['data', 'visible']))
      op.visibleFields.next(null)

      subscription.unsubscribe()

      expect(values).toHaveLength(4) // Initial null + 3 updates
      expect(values[0]).toBe(null)
      expect(values[1]!.has('data')).toBe(true)
      expect(values[2]!.has('visible')).toBe(true)
      expect(values[3]).toBe(null)
    })
  })

  describe('showField method', () => {
    it('shows a hidden field and preserves existing visible fields', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      // Initially visibleFields is null (using showByDefault defaults)
      expect(op.visibleFields.value).toBe(null)

      // 'pointType' has showByDefault: false
      expect(op.inputs.pointType.showByDefault).toBe(false)
      expect(op.isFieldVisible('pointType')).toBe(false)

      // Show the field
      op.showField('pointType')

      // Now visibleFields should be set with defaults + pointType
      expect(op.visibleFields.value).toBeInstanceOf(Set)
      expect(op.visibleFields.value!.has('pointType')).toBe(true)
      expect(op.isFieldVisible('pointType')).toBe(true)
      // Existing showByDefault fields should still be visible
      expect(op.visibleFields.value!.has('data')).toBe(true)

      // Show another hidden field - should preserve all existing visible fields
      op.showField('getText')

      // Should have all previously visible fields plus the new one
      expect(op.visibleFields.value!.has('data')).toBe(true)
      expect(op.visibleFields.value!.has('pointType')).toBe(true)
      expect(op.visibleFields.value!.has('getText')).toBe(true)
    })

    it('does nothing if field is already visible', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      // 'data' has showByDefault: true, so it's already visible
      expect(op.isFieldVisible('data')).toBe(true)

      // showField should not create a new Set if field is already visible via defaults
      op.showField('data')

      // visibleFields stays null since no change was needed
      expect(op.visibleFields.value).toBe(null)
    })
  })
})

describe('Tile3DLayerOp', () => {
  const GOOGLE_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json'
  const CESIUM_URL = 'https://assets.ion.cesium.com/242005/tileset.json'

  it('defaults to the Google tileset URL when provider is Google', async () => {
    const op = new Tile3DLayerOp('/tile3d-0')
    const { layer } = await op.execute({})
    expect(layer.type).toEqual('Tile3DLayer')
    expect(layer.data).toEqual(GOOGLE_URL)
  })

  it('uses the Cesium tileset URL when provider is Cesium', async () => {
    const op = new Tile3DLayerOp('/tile3d-0')
    const { layer } = await op.execute({ provider: 'Cesium' })
    expect(layer.data).toEqual(CESIUM_URL)
  })

  it('uses a custom tilesetUrl when provided, regardless of provider', async () => {
    const op = new Tile3DLayerOp('/tile3d-0')
    const custom = 'https://example.com/custom/tileset.json'
    const { layer: googleLayer } = await op.execute({ tilesetUrl: custom, provider: 'Google' })
    expect(googleLayer.data).toEqual(custom)

    const { layer: cesiumLayer } = await op.execute({ tilesetUrl: custom, provider: 'Cesium' })
    expect(cesiumLayer.data).toEqual(custom)

    const { layer: genericLayer } = await op.execute({ tilesetUrl: custom, provider: 'Generic' })
    expect(genericLayer.data).toEqual(custom)
  })

  it('falls back to the provider default when tilesetUrl is empty', async () => {
    const op = new Tile3DLayerOp('/tile3d-0')
    const { layer } = await op.execute({ tilesetUrl: '', provider: 'Cesium' })
    expect(layer.data).toEqual(CESIUM_URL)
  })

  it('hides tilesetUrl by default', () => {
    const op = new Tile3DLayerOp('/tile3d-0')
    expect(op.isFieldVisible('tilesetUrl')).toBe(false)
  })

  it('includes Generic in provider options', () => {
    const op = new Tile3DLayerOp('/tile3d-0')
    const values = op.inputs.provider.choices.map(c => c.value)
    expect(values).toContain('Generic')
  })
})

describe('RerouteOp', () => {
  it('passes a value through unchanged', () => {
    const op = new RerouteOp('/reroute-0')
    const data = [1, 2, 3]
    const result = op.execute({ value: data })
    expect(result.value).toBe(data)
  })

  it('passes undefined through when input is not connected', () => {
    const op = new RerouteOp('/reroute-0')
    const result = op.execute({ value: undefined })
    expect(result.value).toBeUndefined()
  })

  it('has a single value input and a single value output', () => {
    const op = new RerouteOp('/reroute-0')
    expect(Object.keys(op.inputs)).toEqual(['value'])
    expect(Object.keys(op.outputs)).toEqual(['value'])
  })
})

describe('RampOp', () => {
  const linear = 'linear' as const
  const smooth = 'smooth' as const

  const linearStops2 = [
    { id: 'a', pos: 0, val: 0, interp: linear },
    { id: 'b', pos: 1, val: 1, interp: linear },
  ]

  it('uses default smooth ramp when stops are empty', () => {
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 0, stops: [] }).value).toBe(0)
    expect(op.execute({ position: 1, stops: [] }).value).toBe(1)
    // smooth symmetric ramp: midpoint equals 0.5
    expect(op.execute({ position: 0.5, stops: [] }).value).toBeCloseTo(0.5, 5)
  })

  it('interpolates linearly between two stops with interp=linear', () => {
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 0, stops: linearStops2 }).value).toBe(0)
    expect(op.execute({ position: 0.25, stops: linearStops2 }).value).toBe(0.25)
    expect(op.execute({ position: 0.5, stops: linearStops2 }).value).toBe(0.5)
    expect(op.execute({ position: 1, stops: linearStops2 }).value).toBe(1)
  })

  it('clamps below the first stop position', () => {
    const stops = [
      { id: 'a', pos: 0.2, val: 5, interp: linear },
      { id: 'b', pos: 0.8, val: 10, interp: linear },
    ]
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 0, stops }).value).toBe(5)
    expect(op.execute({ position: 0.1, stops }).value).toBe(5)
  })

  it('clamps above the last stop position', () => {
    const stops = [
      { id: 'a', pos: 0.2, val: 5, interp: linear },
      { id: 'b', pos: 0.8, val: 10, interp: linear },
    ]
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 1, stops }).value).toBe(10)
    expect(op.execute({ position: 0.9, stops }).value).toBe(10)
  })

  it('interpolates linearly across multiple stops', () => {
    const stops = [
      { id: 'a', pos: 0, val: 0, interp: linear },
      { id: 'b', pos: 0.5, val: 10, interp: linear },
      { id: 'c', pos: 1, val: 0, interp: linear },
    ]
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 0.25, stops }).value).toBe(5)
    expect(op.execute({ position: 0.75, stops }).value).toBe(5)
  })

  it('hold interp returns left stop value until next stop', () => {
    const stops = [
      { id: 'a', pos: 0, val: 0, interp: 'hold' as const },
      { id: 'b', pos: 0.5, val: 10, interp: 'hold' as const },
      { id: 'c', pos: 1, val: 20, interp: 'hold' as const },
    ]
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 0.25, stops }).value).toBe(0)
    expect(op.execute({ position: 0.75, stops }).value).toBe(10)
    expect(op.execute({ position: 1, stops }).value).toBe(20)
  })

  it('smooth interp passes through endpoints and is symmetric', () => {
    const stops = [
      { id: 'a', pos: 0, val: 0, interp: smooth },
      { id: 'b', pos: 1, val: 1, interp: smooth },
    ]
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 0, stops }).value).toBeCloseTo(0, 5)
    expect(op.execute({ position: 1, stops }).value).toBeCloseTo(1, 5)
    expect(op.execute({ position: 0.5, stops }).value).toBeCloseTo(0.5, 5)
  })

  it('returns the only stop val for a single stop at any position', () => {
    const stops = [{ id: 'a', pos: 0.5, val: 42 }]
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 0, stops }).value).toBe(42)
    expect(op.execute({ position: 0.5, stops }).value).toBe(42)
    expect(op.execute({ position: 1, stops }).value).toBe(42)
  })

  it('sorts unsorted stops before interpolating', () => {
    const stops = [
      { id: 'b', pos: 1, val: 10, interp: linear },
      { id: 'a', pos: 0, val: 0, interp: linear },
    ]
    const op = new RampOp('/ramp-0')
    expect(op.execute({ position: 0.5, stops }).value).toBe(5)
  })
})

describe('Operator debugging', () => {
  it('has a breakpointEnabled property', () => {
    const op = new NumberOp('/num-0')
    expect(op.breakpointEnabled).toBeDefined()
    expect(op.breakpointEnabled.value).toBe(false)
  })

  it('can toggle breakpoint state', () => {
    const op = new NumberOp('/num-0')
    expect(op.breakpointEnabled.value).toBe(false)

    op.breakpointEnabled.next(true)
    expect(op.breakpointEnabled.value).toBe(true)

    op.breakpointEnabled.next(false)
    expect(op.breakpointEnabled.value).toBe(false)
  })

  it('breakpoint state is observable', async () => {
    const op = new NumberOp('/num-0')
    const states: boolean[] = []

    op.breakpointEnabled.subscribe(state => states.push(state))

    op.breakpointEnabled.next(true)
    op.breakpointEnabled.next(false)

    expect(states).toEqual([false, true, false])
  })
})

describe('BitmapOverlayWidgetOp', () => {
  it('creates a widget with default values', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    await op.pull()
    expect(op.outputData.widget).toBeDefined()
    expect(op.outputData.widget.id).toBe('/bitmap-overlay-0')
    expect(op.outputData.widget.type).toBe('BitmapOverlay')
    expect(op.outputData.widget.placement).toBe('top-right')
    expect(op.outputData.widget.width).toBe(200)
    expect(op.outputData.widget.height).toBe(200)
    expect(op.outputData.widget.opacity).toBe(1)
    expect(op.outputData.widget.scale).toBe(1)
  })

  it('accepts custom image URL', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.image.setValue('https://example.com/image.png')
    await op.pull()
    expect(op.outputData.widget.image).toBe('https://example.com/image.png')
  })

  it('accepts placement values', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.placement.setValue('bottom-left')
    await op.pull()
    expect(op.outputData.widget.placement).toBe('bottom-left')
  })

  it('accepts custom dimensions', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.width.setValue(300)
    op.inputs.height.setValue(400)
    await op.pull()
    expect(op.outputData.widget.width).toBe(300)
    expect(op.outputData.widget.height).toBe(400)
  })

  it('accepts opacity values', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.opacity.setValue(0.5)
    await op.pull()
    expect(op.outputData.widget.opacity).toBe(0.5)
  })

  it('accepts scale values', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.scale.setValue(2)
    await op.pull()
    expect(op.outputData.widget.scale).toBe(2)
  })

  it('includes viewId when provided', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.viewId.setValue('map-view')
    await op.pull()
    expect(op.outputData.widget.viewId).toBe('map-view')
  })

  it('excludes viewId when empty', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.viewId.setValue('')
    await op.pull()
    expect(op.outputData.widget.viewId).toBeUndefined()
  })

  it('supports fill placement for center positioning', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.placement.setValue('fill')
    await op.pull()
    expect(op.outputData.widget.placement).toBe('fill')
  })

  it('accepts offsetX values', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.offsetX.setValue(100)
    await op.pull()
    expect(op.outputData.widget.offsetX).toBe(100)
  })

  it('accepts offsetY values', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.offsetY.setValue(-50)
    await op.pull()
    expect(op.outputData.widget.offsetY).toBe(-50)
  })

  it('combines fill placement with offsets', async () => {
    const op = new BitmapOverlayWidgetOp('/bitmap-overlay-0')
    op.inputs.placement.setValue('fill')
    op.inputs.offsetX.setValue(100)
    op.inputs.offsetY.setValue(50)
    await op.pull()
    expect(op.outputData.widget.placement).toBe('fill')
    expect(op.outputData.widget.offsetX).toBe(100)
    expect(op.outputData.widget.offsetY).toBe(50)
  })
})

describe('ScaleWidgetOp', () => {
  it('creates a scale widget with deck.gl defaults', async () => {
    const op = new ScaleWidgetOp('/scale-widget-0')
    await op.pull()

    expect(op.outputData.widget).toEqual({
      id: '/scale-widget-0',
      type: '_ScaleWidget',
      placement: 'bottom-left',
      label: 'Scale',
    })
  })

  it('accepts custom scale widget properties', async () => {
    const op = new ScaleWidgetOp('/scale-widget-0')
    op.inputs.placement.setValue('top-right')
    op.inputs.label.setValue('Distance')
    op.inputs.viewId.setValue('map-view')
    await op.pull()

    expect(op.outputData.widget).toMatchObject({
      placement: 'top-right',
      label: 'Distance',
      viewId: 'map-view',
    })
  })

  it('excludes an empty viewId', async () => {
    const op = new ScaleWidgetOp('/scale-widget-0')
    op.inputs.viewId.setValue('')
    await op.pull()

    expect(op.outputData.widget.viewId).toBeUndefined()
  })
})

describe('deck.gl widget operators', () => {
  it.each([
    ['FpsWidgetOp', FpsWidgetOp, '_StatsWidget'],
    ['FullscreenWidgetOp', FullscreenWidgetOp, 'FullscreenWidget'],
    ['ZoomWidgetOp', ZoomWidgetOp, 'ZoomWidget'],
    ['CompassWidgetOp', CompassWidgetOp, 'CompassWidget'],
    ['ScaleWidgetOp', ScaleWidgetOp, '_ScaleWidget'],
    ['ScreenshotWidgetOp', ScreenshotWidgetOp, 'ScreenshotWidget'],
  ])('%s emits an available deck.gl widget constructor', async (_name, WidgetOp, type) => {
    const op = new WidgetOp('/widget-0')
    await op.pull()

    expect(op.outputData.widget.type).toBe(type)
    // biome-ignore lint/performance/noDynamicNamespaceImportAccess: Match the runtime widget lookup.
    expect(deckWidgets[type as keyof typeof deckWidgets]).toBeTypeOf('function')
  })
})

describe('Operator output deep equality for CompoundPropsField', () => {
  it('should not trigger field updates when CompoundPropsField content is identical', async () => {
    const op = new MaplibreBasemapOp('/maplibre-test')
    const nextSpy = vi.spyOn(op.outputs.maplibre, 'next')

    const viewState1 = { latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 }
    const sky1 = {
      enabled: false,
      skyColor: '#88C6FC',
      horizonColor: '#ffffff',
      skyHorizonBlend: 0.8,
      atmosphereBlend: 0.5,
    }
    const light1 = { anchor: 'viewport' as const, azimuthal: 210, polar: 30 }

    op.inputs.mapStyle.setValue('https://example.com/style.json')
    op.inputs.projection.setValue('mercator')
    op.inputs.viewState.setValue(viewState1)
    op.inputs.sky.setValue(sky1)
    op.inputs.light.setValue(light1)

    await op.pull()
    const callCount1 = nextSpy.mock.calls.length

    // Execute again with identical content but different object references
    const viewState2 = { latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 }
    const sky2 = {
      enabled: false,
      skyColor: '#88C6FC',
      horizonColor: '#ffffff',
      skyHorizonBlend: 0.8,
      atmosphereBlend: 0.5,
    }
    const light2 = { anchor: 'viewport' as const, azimuthal: 210, polar: 30 }

    op.inputs.viewState.setValue(viewState2)
    op.inputs.sky.setValue(sky2)
    op.inputs.light.setValue(light2)

    await op.pull()
    const callCount2 = nextSpy.mock.calls.length

    // field.next() should not be called again since content is identical
    expect(callCount2).toBe(callCount1)

    nextSpy.mockRestore()
  })

  it('should trigger field updates when CompoundPropsField content differs', async () => {
    const op = new MaplibreBasemapOp('/maplibre-test')
    const nextSpy = vi.spyOn(op.outputs.maplibre, 'next')

    op.inputs.mapStyle.setValue('https://example.com/style.json')
    op.inputs.projection.setValue('mercator')
    op.inputs.viewState.setValue({ latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 })
    op.inputs.sky.setValue({
      enabled: false,
      skyColor: '#88C6FC',
      horizonColor: '#ffffff',
      skyHorizonBlend: 0.8,
      atmosphereBlend: 0.5,
    })
    op.inputs.light.setValue({ anchor: 'viewport', azimuthal: 210, polar: 30 })

    await op.pull()
    const callCount1 = nextSpy.mock.calls.length

    // Change viewState to different values
    op.inputs.viewState.setValue({
      latitude: 40,
      longitude: -120,
      zoom: 12,
      pitch: 45,
      bearing: 90,
    })

    await op.pull()
    const callCount2 = nextSpy.mock.calls.length

    // field.next() should be called again since content changed
    expect(callCount2).toBeGreaterThan(callCount1)

    nextSpy.mockRestore()
  })

  it('should use reference equality for non-compound fields', async () => {
    const op = new NumberOp('/number-test')
    const nextSpy = vi.spyOn(op.outputs.val, 'next')

    op.inputs.val.setValue(42)
    await op.pull()
    const callCount1 = nextSpy.mock.calls.length

    // Set to same value
    op.inputs.val.setValue(42)
    await op.pull()
    const callCount2 = nextSpy.mock.calls.length

    // field.next() should not be called since value is identical (reference equality)
    expect(callCount2).toBe(callCount1)

    // Change to different value
    op.inputs.val.setValue(43)
    await op.pull()
    const callCount3 = nextSpy.mock.calls.length

    // field.next() should be called now
    expect(callCount3).toBeGreaterThan(callCount2)

    nextSpy.mockRestore()
  })

  it('should handle nested objects in CompoundPropsField correctly', async () => {
    const op = new MaplibreBasemapOp('/maplibre-test')
    const nextSpy = vi.spyOn(op.outputs.maplibre, 'next')

    const complexSky = {
      enabled: true,
      skyColor: '#123456',
      horizonColor: '#abcdef',
      skyHorizonBlend: 0.5,
      atmosphereBlend: 0.3,
    }

    op.inputs.mapStyle.setValue('https://example.com/style.json')
    op.inputs.projection.setValue('globe')
    op.inputs.viewState.setValue({ latitude: 0, longitude: 0, zoom: 1, pitch: 0, bearing: 0 })
    op.inputs.sky.setValue(complexSky)
    op.inputs.light.setValue({ anchor: 'map', azimuthal: 180, polar: 60 })

    await op.pull()
    const callCount1 = nextSpy.mock.calls.length

    // Set identical nested object with different reference
    const complexSky2 = {
      enabled: true,
      skyColor: '#123456',
      horizonColor: '#abcdef',
      skyHorizonBlend: 0.5,
      atmosphereBlend: 0.3,
    }
    op.inputs.sky.setValue(complexSky2)

    await op.pull()
    const callCount2 = nextSpy.mock.calls.length

    // Should not trigger update
    expect(callCount2).toBe(callCount1)

    nextSpy.mockRestore()
  })

  it('should detect changes in nested object properties', async () => {
    const op = new MaplibreBasemapOp('/maplibre-test')
    const nextSpy = vi.spyOn(op.outputs.maplibre, 'next')

    op.inputs.mapStyle.setValue('https://example.com/style.json')
    op.inputs.projection.setValue('mercator')
    op.inputs.viewState.setValue({ latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 })
    op.inputs.sky.setValue({
      enabled: false,
      skyColor: '#88C6FC',
      horizonColor: '#ffffff',
      skyHorizonBlend: 0.8,
      atmosphereBlend: 0.5,
    })
    op.inputs.light.setValue({ anchor: 'viewport', azimuthal: 210, polar: 30 })

    await op.pull()
    const callCount1 = nextSpy.mock.calls.length

    // Change only one nested property
    op.inputs.sky.setValue({
      enabled: false,
      skyColor: '#88C6FC',
      horizonColor: '#ffffff',
      skyHorizonBlend: 0.9, // Changed from 0.8
      atmosphereBlend: 0.5,
    })

    await op.pull()
    const callCount2 = nextSpy.mock.calls.length

    // Should trigger update
    expect(callCount2).toBeGreaterThan(callCount1)

    nextSpy.mockRestore()
  })

  it('should handle mapStyle updates correctly to prevent flickering', async () => {
    // This is the specific issue reported by the user
    const op = new MaplibreBasemapOp('/maplibre-test')
    const nextSpy = vi.spyOn(op.outputs.maplibre, 'next')

    const mapStyle = 'https://example.com/style.json'
    const projection = 'mercator'
    const sky = {
      enabled: false,
      skyColor: '#88C6FC',
      horizonColor: '#ffffff',
      skyHorizonBlend: 0.8,
      atmosphereBlend: 0.5,
    }
    const light = { anchor: 'viewport' as const, azimuthal: 210, polar: 30 }

    // Initial setup
    op.inputs.mapStyle.setValue(mapStyle)
    op.inputs.projection.setValue(projection)
    op.inputs.viewState.setValue({ latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 })
    op.inputs.sky.setValue(sky)
    op.inputs.light.setValue(light)

    await op.pull()
    const callCount1 = nextSpy.mock.calls.length

    // Simulate viewState update (common during animation/interaction)
    // but mapStyle, projection, sky, light remain the same
    op.inputs.viewState.setValue({
      latitude: 37.1,
      longitude: -122.1,
      zoom: 10.5,
      pitch: 0,
      bearing: 0,
    })

    await op.pull()
    const callCount2 = nextSpy.mock.calls.length

    // Should trigger update because viewState changed
    expect(callCount2).toBeGreaterThan(callCount1)

    // Now update viewState again with same values
    op.inputs.viewState.setValue({
      latitude: 37.1,
      longitude: -122.1,
      zoom: 10.5,
      pitch: 0,
      bearing: 0,
    })

    await op.pull()
    const callCount3 = nextSpy.mock.calls.length

    // Should NOT trigger update because nothing changed
    expect(callCount3).toBe(callCount2)

    nextSpy.mockRestore()
  })
})

describe('CategoricalColorRampOp', () => {
  it('initializes with accent scheme by default', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    expect(op.inputs.colorScheme.value).toBe('accent')
    expect(op.inputs.colorRamp.count).toBe(8)
  })

  it('maps categories to colors via execute', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    const result = op.execute({
      colorRamp: op.inputs.colorRamp.value,
      value: 'A',
    })
    expect(result.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('returns different colors for different categories', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    const colorA = op.execute({ colorRamp: op.inputs.colorRamp.value, value: 'A' })
    const colorB = op.execute({ colorRamp: op.inputs.colorRamp.value, value: 'B' })
    expect(colorA.color).not.toBe(colorB.color)
  })

  it('steps field slices fixed schemes to fewer colors', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    op.inputs.steps.setValue(10)
    op.inputs.colorScheme.setValue('category10')
    expect(op.inputs.colorRamp.count).toBe(10)

    op.inputs.steps.setValue(5)
    expect(op.inputs.colorRamp.count).toBe(5)
  })

  it('steps field selects correct array for stepped schemes', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    op.inputs.colorScheme.setValue('greyscale')
    op.inputs.steps.setValue(4)
    expect(op.inputs.colorRamp.count).toBe(4)

    op.inputs.steps.setValue(9)
    expect(op.inputs.colorRamp.count).toBe(9)
  })

  it('steps field rejects values below minimum', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    op.inputs.colorScheme.setValue('greyscale')
    op.inputs.steps.setValue(3)
    expect(op.inputs.colorRamp.count).toBe(3)

    op.inputs.steps.setValue(1)
    expect(op.inputs.steps.value).toBe(3)
  })

  it('steps clamps to max available for the scheme', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    op.inputs.colorScheme.setValue('category10')
    op.inputs.steps.setValue(11)
    expect(op.inputs.colorRamp.count).toBe(10)
  })

  it('changing colorScheme updates the ramp', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    op.inputs.steps.setValue(5)

    op.inputs.colorScheme.setValue('category10')
    expect(op.inputs.colorRamp.count).toBe(5)

    op.inputs.colorScheme.setValue('greyscale')
    expect(op.inputs.colorRamp.count).toBe(5)
  })

  it('greyscale scheme produces valid hex colors', () => {
    const op = new CategoricalColorRampOp('/cat-ramp-0')
    op.inputs.colorScheme.setValue('greyscale')
    const result = op.execute({
      colorRamp: op.inputs.colorRamp.value,
      value: 'category1',
    })
    expect(result.color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('DirectionsOp', () => {
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

  it('integrates PointOp output with DirectionsOp inputs', () => {
    // Create PointOps for NYC and Brooklyn
    const pointNyc = new PointOp('/point-nyc')
    pointNyc.inputs.coordinates.setValue({ lng: -74.006, lat: 40.7128 })

    const pointBrooklyn = new PointOp('/point-brooklyn')
    pointBrooklyn.inputs.coordinates.setValue({ lng: -73.935242, lat: 40.73061 })

    // Execute the operators to get outputs
    const nycOutput = pointNyc.execute({
      coordinates: { lng: -74.006, lat: 40.7128 },
      properties: {},
    })
    const brooklynOutput = pointBrooklyn.execute({
      coordinates: { lng: -73.935242, lat: 40.73061 },
      properties: {},
    })

    const nycFeature = nycOutput.feature
    const brooklynFeature = brooklynOutput.feature

    // Verify PointOp outputs are GeoJSON Point Features
    expect(nycFeature.type).toBe('Feature')
    expect(nycFeature.geometry.type).toBe('Point')
    expect(nycFeature.geometry.coordinates).toEqual([-74.006, 40.7128])

    // Wire PointOp outputs to DirectionsOp inputs
    const directionsOp = new DirectionsOp('/directions')
    directionsOp.inputs.origin.setValue(nycFeature)
    directionsOp.inputs.destination.setValue(brooklynFeature)

    // Verify DirectionsOp correctly parses the GeoJSON Features
    expect(directionsOp.inputs.origin.value).toEqual({ lng: -74.006, lat: 40.7128 })
    expect(directionsOp.inputs.destination.value).toEqual({ lng: -73.935242, lat: 40.73061 })
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
    geocoderOp.inputs.query.addConnection('query-connection', new StringField('Los Angeles'))
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

  it('preserves the user-selected result when its query is not connected', async () => {
    getKeysStore().setBrowserKey('mapbox', 'test-token')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const geocoderOp = new GeocoderOp('/geocoder')
    geocoderOp.outputs.location.next({ lng: -118.2437, lat: 34.0522 })

    await expect(geocoderOp.execute({ query: 'Los Angeles' })).resolves.toEqual({
      location: { lng: -118.2437, lat: 34.0522 },
      results: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a Mapbox API key', async () => {
    vi.spyOn(getKeysStore(), 'getKey').mockReturnValue(undefined)
    const geocoderOp = new GeocoderOp('/geocoder')

    await expect(geocoderOp.execute({ query: 'Los Angeles' })).rejects.toThrow(
      'Mapbox API key required (Settings > API Keys)'
    )
  })

  it('clears stale outputs when a connected query becomes blank', async () => {
    vi.spyOn(getKeysStore(), 'getKey').mockReturnValue('test-token')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        features: [{ place_name: 'Long Beach', center: [-118.1937, 33.7701] }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const geocoderOp = new GeocoderOp('/geocoder')
    geocoderOp.inputs.query.addConnection('query-connection', new StringField('Long Beach'))
    const firstResult = await geocoderOp.execute({ query: 'Long Beach' })
    geocoderOp.outputs.location.next(firstResult.location)
    geocoderOp.outputs.results.next(firstResult.results)

    await expect(geocoderOp.execute({ query: '   ' })).resolves.toEqual({
      location: { lng: 0, lat: 0 },
      results: [],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns empty outputs without error when Mapbox has no results', async () => {
    vi.spyOn(getKeysStore(), 'getKey').mockReturnValue('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ features: [] }),
      })
    )

    const geocoderOp = new GeocoderOp('/geocoder')
    geocoderOp.inputs.query.addConnection('query-connection', new StringField('Unknown place'))

    await expect(geocoderOp.execute({ query: 'Unknown place' })).resolves.toEqual({
      location: { lng: 0, lat: 0 },
      results: [],
    })
  })

  it('surfaces Mapbox service failures separately from empty results', async () => {
    vi.spyOn(getKeysStore(), 'getKey').mockReturnValue('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      })
    )

    const geocoderOp = new GeocoderOp('/geocoder')
    geocoderOp.inputs.query.addConnection('query-connection', new StringField('Long Beach'))

    await expect(geocoderOp.execute({ query: 'Long Beach' })).rejects.toThrow(
      'Mapbox geocoding failed: 429 Too Many Requests'
    )
  })
})

describe('NetworkOp with geometry column', () => {
  it('still accepts direct {lng, lat, alt} objects (backward compat)', () => {
    const networkOp = new NetworkOp('/network')
    const points = [
      { lng: -73.78, lat: 40.64, alt: 0 },
      { lng: -122.37, lat: 37.62, alt: 0 },
    ]

    networkOp.inputs.skyports.setValue(points)
    const result = networkOp.execute({ skyports: networkOp.inputs.skyports.value, hub: false })
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
    expect(result.routes[0].destination).toEqual({ lng: -122.37, lat: 37.62, alt: 0 })
  })

  it('still accepts {lng, lat} objects without alt (backward compat)', () => {
    const networkOp = new NetworkOp('/network')
    const points = [
      { lng: -73.78, lat: 40.64 },
      { lng: -122.37, lat: 37.62 },
    ]

    networkOp.inputs.skyports.setValue(points)
    const result = networkOp.execute({ skyports: networkOp.inputs.skyports.value, hub: false })
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
    expect(result.routes[0].destination).toEqual({ lng: -122.37, lat: 37.62, alt: 0 })
  })

  it('accepts rows with geometry column as [lng, lat] tuple', () => {
    const networkOp = new NetworkOp('/network')
    const tableData = [
      { name: 'JFK', geometry: [-73.78, 40.64] },
      { name: 'SFO', geometry: [-122.37, 37.62] },
      { name: 'LAX', geometry: [-118.41, 33.94] },
    ]

    networkOp.inputs.skyports.setValue(tableData)
    const result = networkOp.execute({ skyports: networkOp.inputs.skyports.value, hub: false })
    expect(result.routes).toHaveLength(3)
    expect(result.routes[0].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
    expect(result.routes[0].destination).toEqual({ lng: -122.37, lat: 37.62, alt: 0 })
  })

  it('accepts rows with geometry column as GeoJSON Point', () => {
    const networkOp = new NetworkOp('/network')
    const tableData = [
      { name: 'JFK', geometry: { type: 'Point', coordinates: [-73.78, 40.64] } },
      { name: 'SFO', geometry: { type: 'Point', coordinates: [-122.37, 37.62] } },
    ]

    networkOp.inputs.skyports.setValue(tableData)
    const result = networkOp.execute({ skyports: networkOp.inputs.skyports.value, hub: false })
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
    expect(result.routes[0].destination).toEqual({ lng: -122.37, lat: 37.62, alt: 0 })
  })

  it('accepts rows with geometry column as [lng, lat, alt] tuple', () => {
    const networkOp = new NetworkOp('/network')
    const tableData = [
      { name: 'JFK', geometry: [-73.78, 40.64, 100] },
      { name: 'SFO', geometry: [-122.37, 37.62, 200] },
    ]

    networkOp.inputs.skyports.setValue(tableData)
    const result = networkOp.execute({ skyports: networkOp.inputs.skyports.value, hub: false })
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 100 })
    expect(result.routes[0].destination).toEqual({ lng: -122.37, lat: 37.62, alt: 200 })
  })

  it('accepts rows with geometry column as GeoJSON Point with altitude', () => {
    const networkOp = new NetworkOp('/network')
    const tableData = [
      { name: 'JFK', geometry: { type: 'Point', coordinates: [-73.78, 40.64, 100] } },
      { name: 'SFO', geometry: { type: 'Point', coordinates: [-122.37, 37.62, 200] } },
    ]

    networkOp.inputs.skyports.setValue(tableData)
    const result = networkOp.execute({ skyports: networkOp.inputs.skyports.value, hub: false })
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 100 })
    expect(result.routes[0].destination).toEqual({ lng: -122.37, lat: 37.62, alt: 200 })
  })

  it('works in hub mode with geometry column', () => {
    const networkOp = new NetworkOp('/network')
    const tableData = [
      { name: 'HUB', geometry: [-73.78, 40.64] },
      { name: 'SFO', geometry: [-122.37, 37.62] },
      { name: 'LAX', geometry: [-118.41, 33.94] },
    ]

    networkOp.inputs.skyports.setValue(tableData)
    const result = networkOp.execute({ skyports: networkOp.inputs.skyports.value, hub: true })
    expect(result.routes).toHaveLength(2)
    expect(result.routes[0].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
    expect(result.routes[1].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
  })

  it('accepts bare GeoJSON Point geometry at top level via Point3DField', () => {
    const networkOp = new NetworkOp('/network')
    const tableData = [
      { type: 'Point', coordinates: [-73.78, 40.64] },
      { type: 'Point', coordinates: [-122.37, 37.62] },
    ]

    networkOp.inputs.skyports.setValue(tableData)
    const result = networkOp.execute({ skyports: networkOp.inputs.skyports.value, hub: false })
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0].origin).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
    expect(result.routes[0].destination).toEqual({ lng: -122.37, lat: 37.62, alt: 0 })
  })
})
