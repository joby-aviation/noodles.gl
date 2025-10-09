import { beforeEach, describe, expect, it, vi } from 'vitest'
import z from 'zod/v4'
import { hexToColor } from '../utils/color'
import {
  ArrayField,
  ColorField,
  CompoundPropsField,
  DataField,
  FeatureCollectionField,
  FeatureField,
  Field,
  FunctionField,
  GeometryField,
  getFieldReferences,
  JSONUrlField,
  LayerField,
  ListField,
  NumberField,
  Point2DField,
  Point3DField,
  parseChoices,
  StringField,
  StringLiteralField,
} from './fields'
import { NumberOp } from './operators'
import { opMap } from './store'
import { canConnect } from './utils/can-connect'

describe('basic Fields', () => {
  it('supports a basic field', () => {
    const field = new NumberField()
    expect(field.value).toEqual(0)
  })

  it('allows overriding the default value', () => {
    const field = new NumberField(5)
    expect(field.value).toEqual(5)
  })

  it('allows setting values', () => {
    expect.assertions(3)
    const field = new NumberField(0)
    field.subscribe(val => {
      expect(field.value).toEqual(10)
      expect(val).toEqual(10)
    })
    field.setValue(10)
  })

  it('listens to other fields', () => {
    const field = new NumberField(0)
    const other = new NumberField(5)
    field.addConnection('test-op-1', other, 'value')
    expect(field.value).toEqual(5)
    other.setValue(10)
    expect(field.value).toEqual(10)
  })

  it('allows transforming values', () => {
    const field = new NumberField(5, { transform: (d: number) => d * 2 })
    expect(field.value).toEqual(10)
  })

  it('allows adding a reference connection', () => {
    const spy = vi.fn()
    const field = new NumberField(5)
    const other = new NumberField(10)
    field.subscribe(spy)
    field.addConnection('test-op-1', other, 'reference')
    expect(field.value).toEqual(5)
    other.setValue(20)
    expect(field.value).toEqual(5)
    expect(spy).toHaveBeenCalled()
  })

  it('allows initialization with no value', () => {
    const field = new LayerField()
    expect(field.value).toEqual(undefined)

    const noSetValue = vi.fn()
    class EmptyMockField extends Field {
      static defaultValue = undefined
      createSchema() { }
      setValue() {
        noSetValue()
      }
    }
    new EmptyMockField()
    expect(noSetValue).not.toHaveBeenCalled()

    // null values should call setValue since they're considered intentional
    const nullSetValue = vi.fn()
    class NullMockField extends Field {
      static defaultValue = null
      createSchema() {
        z.null()
      }
      setValue() {
        nullSetValue()
      }
    }
    new NullMockField()
    expect(nullSetValue).toHaveBeenCalled()
  })

  it('always initializes optional field values', () => {
    const mockSetValue = vi.fn()
    class EmptyMockField extends Field {
      static defaultValue = undefined
      createSchema() {
        return z.unknown()
      }
      setValue(value: unknown) {
        mockSetValue(value)
      }
    }
    new EmptyMockField(5, { optional: true })
    expect(mockSetValue).toHaveBeenCalledWith(5)
  })
})

describe('optional Fields', () => {
  it('supports optional fields', () => {
    const field = new NumberField(undefined, { optional: true })
    expect(field.value).toEqual(undefined)
    field.setValue(5)
    expect(field.value).toEqual(5)
  })

  it('allows setting values to undefined', () => {
    const field = new NumberField(5, { optional: true })
    expect(field.value).toEqual(5)
    field.setValue(undefined)
    expect(field.value).toEqual(undefined)
  })

  it('supports required fields', () => {
    const field = new NumberField(1, { optional: false })
    expect(field.value).toEqual(1)
    field.setValue(undefined)
    expect(field.value).toEqual(1)
  })
})

describe('ArrayField', () => {
  it('allows ArrayFields to wrap other fields', () => {
    const dataField = new DataField([1, 2, 3])
    const arrayField = new ArrayField(new NumberField(5))

    expect(arrayField.value).toEqual([])

    expect(canConnect(arrayField, dataField)).toBe(true)
  })
})

describe('ListField', () => {
  it('allows ListFields accept multiple connections', () => {
    const field1 = new NumberField(1)
    const field2 = new NumberField(2)
    const listField = new ListField(new NumberField(5))

    expect(canConnect(field1, listField), 'numbers can connect to listField').toBe(true)

    listField.addConnection('field-1', field1, 'value')
    listField.addConnection('field-2', field2, 'value')

    expect(listField.value).toEqual([1, 2])
    expect(listField.subscriptions.size).toBe(2)

    field1.setValue(10)
    expect(listField.value).toEqual([10, 2])
  })
})

describe('JSONUrlField', () => {
  it('accepts primitive values from other fields', () => {
    const field = new StringField('test')
    const jsonField = new JSONUrlField()

    expect(canConnect(field, jsonField)).toBe(true)
    jsonField.addConnection('field', field, 'value')

    expect(jsonField.value).toEqual('test')
  })

  it('accepts primitive and compound values', () => {
    const field1 = new JSONUrlField(10)
    expect(field1.value).toEqual(10)
    field1.setValue({ a: 'b' })
    expect(field1.value).toEqual({ a: 'b' })
    const field2 = new JSONUrlField({ c: 'd' })
    expect(field2.value).toEqual({ c: 'd' })
    const field3 = new JSONUrlField([1, 2, 3])
    expect(field3.value).toEqual([1, 2, 3])
    const field4 = new JSONUrlField({ foo: 'bar' }, { accessor: true })
    expect(field4.value).toEqual({ foo: 'bar' })
    const field5 = new JSONUrlField([1, 2, 3], { accessor: true })
    expect(field5.value).toEqual([1, 2, 3])
    field5.setValue(arr => arr.map(n => n * 2))
    expect(field5.value([4, 5, 6])).toEqual([8, 10, 12])
  })

  it('accepts JSON strings but not parse them', () => {
    const field = new JSONUrlField('{"foo": "bar"}')
    expect(field.value).toEqual('{"foo": "bar"}')
    field.setValue('{"bar": "baz"}')
    expect(field.value).toEqual('{"bar": "baz"}')
  })

  it('accepts url strings', () => {
    const field = new JSONUrlField('https://example.com/data.json')
    expect(field.value).toEqual('https://example.com/data.json')

    field.setValue('data.json')
    expect(field.value).toEqual('data.json')

    field.setValue('/data.json')
    expect(field.value).toEqual('/data.json')

    field.setValue('./data.json')
    expect(field.value).toEqual('./data.json')
  })
})

describe('NumberField', () => {
  it('sets initializers on the instance', () => {
    const field1 = new NumberField()
    expect(field1.value, 'value').toEqual(0)
    expect(field1.min, 'min').toEqual(-Infinity)
    expect(field1.max, 'max').toEqual(Infinity)
    expect(field1.step, 'step').toEqual(0.1)

    const field2 = new NumberField(5, { min: 0, max: 10 })
    expect(field2.value, 'value').toEqual(5)
    expect(field2.min, 'min').toEqual(0)
    expect(field2.max, 'max').toEqual(10)
    expect(field2.step, 'step').toEqual(0.1)

    // setValue should fail if the value is out of bounds
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => { })
    field2.setValue(15)
    expect(field2.value).toEqual(5)
    expect(consoleWarn).toHaveBeenCalledWith(
      'Parse error',
      expect.arrayContaining([expect.objectContaining({ code: 'too_big' })])
    )
  })
})

describe('StringLiteralField', () => {
  it('sets choices on the instance', () => {
    const field = new StringLiteralField('foo', ['foo', 'bar'])
    expect(field.value).toEqual('foo')
    expect(field.choices).toEqual([
      { label: 'foo', value: 'foo' },
      { label: 'bar', value: 'bar' },
    ])
    expect(canConnect(new StringField('foo'), field)).toBe(true)
    expect(canConnect(new NumberField(5), field)).toBe(false)
  })

  it('allows multiple ways of creating options', () => {
    const field1 = new StringLiteralField('one', ['one', 'two'])
    expect(field1.value).toEqual('one')
    expect(field1.choices).toEqual([
      { label: 'one', value: 'one' },
      { label: 'two', value: 'two' },
    ])
    const field2 = new StringLiteralField('three', { values: ['three', 'four'] })
    expect(field2.value).toEqual('three')
    expect(field2.choices).toEqual([
      { label: 'three', value: 'three' },
      { label: 'four', value: 'four' },
    ])
    const field3 = new StringLiteralField('five', {
      values: [
        { label: 'Five', value: 'five' },
        { label: 'Six', value: 'six' },
      ],
    })
    expect(field3.value).toEqual('five')
    expect(field3.choices).toEqual([
      { label: 'Five', value: 'five' },
      { label: 'Six', value: 'six' },
    ])
  })

  it('allows empty choices', () => {
    const field = new StringLiteralField('', [])
    expect(field.value).toEqual('')
    expect(field.choices).toEqual([])
    expect(canConnect(new StringField('foo'), field)).toBe(true)
    // expect(canConnect(new NumberField(5), field)).toBe(true)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => { })
    field.setValue('foo')
    // field.setValue(5)
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('allows reconfiguring options', () => {
    const field = new StringLiteralField('foo', [])
    const enhanceSchema = vi.spyOn(field, 'enhanceSchema')
    expect(field.value).toEqual('foo')
    expect(field.choices).toEqual([])
    field.setValue('bar')
    expect(field.value).toEqual('bar')
    expect(field.choices).toEqual([])
    field.updateChoices(['bar', 'baz'])
    expect(enhanceSchema).toHaveBeenCalledWith({
      values: [
        { label: 'bar', value: 'bar' },
        { label: 'baz', value: 'baz' },
      ],
    })
    expect(field.choices).toEqual([
      { label: 'bar', value: 'bar' },
      { label: 'baz', value: 'baz' },
    ])
    field.setValue('baz')
    expect(field.value).toEqual('baz')
    expect(field.choices).toEqual([
      { label: 'bar', value: 'bar' },
      { label: 'baz', value: 'baz' },
    ])
  })

  it('parses choices', () => {
    expect(parseChoices(['foo', 'bar'])).toEqual([
      { label: 'foo', value: 'foo' },
      { label: 'bar', value: 'bar' },
    ])
    expect(parseChoices({ values: ['foo', 'bar'] })).toEqual([
      { label: 'foo', value: 'foo' },
      { label: 'bar', value: 'bar' },
    ])
    expect(parseChoices({ values: { Foo: 'foo', Bar: 'bar' } })).toEqual([
      { label: 'Foo', value: 'foo' },
      { label: 'Bar', value: 'bar' },
    ])
  })
})

describe('CompoundPropsField', () => {
  it('allows CompoundPropsFields to wrap other fields', () => {
    const viewState = new CompoundPropsField({
      latitude: new NumberField(),
      longitude: new NumberField(),
      zoom: new NumberField(),
      pitch: new NumberField(),
      bearing: new NumberField(),
    })

    expect(viewState.value).toEqual({
      latitude: 0,
      longitude: 0,
      zoom: 0,
      pitch: 0,
      bearing: 0,
    })
  })

  it('allows CompoundPropsFields to accept connections', () => {
    const viewState = new CompoundPropsField({
      latitude: new NumberField(0, { min: -90, max: 90 }),
      longitude: new NumberField(0, { min: -180, max: 180 }),
      zoom: new NumberField(12, { min: 0, max: 24 }),
      pitch: new NumberField(0, { min: 0, max: 60 }),
      bearing: new NumberField(0),
    })

    const upstream = new CompoundPropsField({
      latitude: new NumberField(1, { min: -90, max: 90 }),
      longitude: new NumberField(2, { min: -180, max: 180 }),
      zoom: new NumberField(3, { min: 0, max: 24 }),
      pitch: new NumberField(4, { min: 0, max: 60 }),
      bearing: new NumberField(5),
    })

    expect(canConnect(upstream, viewState)).toBe(true)
    viewState.addConnection('upstream', upstream, 'value')

    expect(viewState.value).toEqual({
      latitude: 1,
      longitude: 2,
      zoom: 3,
      pitch: 4,
      bearing: 5,
    })

    upstream.fields.latitude.setValue(10)
    expect(viewState.value).toEqual({
      latitude: 10,
      longitude: 2,
      zoom: 3,
      pitch: 4,
      bearing: 5,
    })
  })

  it('fills in missing values', () => {
    const viewState = new CompoundPropsField({
      latitude: new NumberField(1, { min: -90, max: 90 }),
      longitude: new NumberField(2, { min: -180, max: 180 }),
      zoom: new NumberField(3, { min: 0, max: 24 }),
      pitch: new NumberField(4, { min: 0, max: 60 }),
      bearing: new NumberField(5),
    })

    const upstream = new CompoundPropsField({
      latitude: new NumberField(10, { min: -90, max: 90 }),
      longitude: new NumberField(20, { min: -180, max: 180 }),
      zoom: new NumberField(13, { min: 0, max: 24 }),
    })

    viewState.addConnection('upstream', upstream, 'value')

    expect(viewState.value).toEqual({
      latitude: 10,
      longitude: 20,
      zoom: 13,
      pitch: 4,
      bearing: 5,
    })
  })

  it('allows DataFields to connect to CompoundPropsFields', () => {
    const viewState = new CompoundPropsField({
      latitude: new NumberField(1, { min: -90, max: 90 }),
      longitude: new NumberField(2, { min: -180, max: 180 }),
      zoom: new NumberField(3, { min: 0, max: 24 }),
      pitch: new NumberField(4, { min: 0, max: 60 }),
      bearing: new NumberField(5),
    })

    const dataField = new DataField()
    viewState.addConnection('data', dataField, 'value')
    dataField.setValue({ latitude: 10, longitude: 20, zoom: 13, pitch: 4, bearing: 5 })

    expect(viewState.value).toEqual({
      latitude: 10,
      longitude: 20,
      zoom: 13,
      pitch: 4,
      bearing: 5,
    })
  })

  it('allows CompoundPropsFields to connect to DataFields', () => {
    const viewState = new CompoundPropsField({
      latitude: new NumberField(1, { min: -90, max: 90 }),
      longitude: new NumberField(2, { min: -180, max: 180 }),
      zoom: new NumberField(3, { min: 0, max: 24 }),
      pitch: new NumberField(4, { min: 0, max: 60 }),
      bearing: new NumberField(5),
    })

    const dataField = new DataField()
    viewState.addConnection('data', dataField, 'value')

    dataField.setValue({ latitude: 10, longitude: 20, zoom: 13, pitch: 4, bearing: 5 })

    expect(viewState.value).toEqual({
      latitude: 10,
      longitude: 20,
      zoom: 13,
      pitch: 4,
      bearing: 5,
    })
  })

  it('allows arbitrary DataFields to connect to CompoundPropsFields', () => {
    const compoundField = new CompoundPropsField({})

    const dataField = new DataField()
    compoundField.addConnection('data', dataField, 'value')
    dataField.setValue({ latitude: 10, longitude: 20, zoom: 13, pitch: 4, bearing: 5 })

    expect(compoundField.value).toEqual({
      latitude: 10,
      longitude: 20,
      zoom: 13,
      pitch: 4,
      bearing: 5,
    })
  })

  it('passes through extra values', () => {
    const viewState = new CompoundPropsField({
      latitude: new NumberField(1, { min: -90, max: 90 }),
      longitude: new NumberField(2, { min: -180, max: 180 }),
      zoom: new NumberField(3, { min: 0, max: 24 }),
      pitch: new NumberField(4, { min: 0, max: 60 }),
      bearing: new NumberField(5),
    })

    const upstream = new CompoundPropsField({
      latitude: new NumberField(10, { min: -90, max: 90 }),
      longitude: new NumberField(20, { min: -180, max: 180 }),
      zoom: new NumberField(13, { min: 0, max: 24 }),
      extra: new StringField('extra'),
    })

    viewState.addConnection('upstream', upstream, 'value')

    expect(viewState.value).toEqual({
      latitude: 10,
      longitude: 20,
      zoom: 13,
      pitch: 4,
      bearing: 5,
      extra: 'extra',
    })
    expect(upstream.value.extra).toBeDefined()
  })

  it('guards against undefined values', () => {
    const viewState = new CompoundPropsField({
      latitude: new NumberField(1, { min: -90, max: 90 }),
      longitude: new NumberField(2, { min: -180, max: 180 }),
      zoom: new NumberField(3, { min: 0, max: 24 }),
    })

    expect(() => {
      viewState.next(undefined)
    }).not.toThrow()

    expect(viewState.value).toEqual({
      latitude: 1,
      longitude: 2,
      zoom: 3,
    })
  })
})

describe('Accessor fields', () => {
  it('allows static values', () => {
    const field = new NumberField(5, { accessor: true })
    expect(field.value).toEqual(5)
  })

  it('allows callbacks', () => {
    const field = new NumberField(5, { accessor: true })
    field.setValue(d => d.amount)
    expect(field.value({ amount: 10 })).toEqual(10)
  })

  it('allows ColorFields to pass a string color', () => {
    const field = new ColorField('#ff0000', { accessor: true })
    expect(field.value).toEqual('#ff0000')
    expect(hexToColor(field.value)).toEqual([255, 0, 0, 255]) // ensure it's a valid color
    field.setValue('#00ff00')
    expect(field.value).toEqual('#00ff00')
  })

  it('allows ColorFields to pass a callback function', () => {
    const field = new ColorField('#ff0000', { accessor: true })
    expect(field.value).toEqual('#ff0000')
    field.setValue(d => d.color)
    expect(field.value({ color: '#00ff00' })).toEqual('#00ff00')
  })

  it('allows ArrayFields to pass a callback function', () => {
    const field = new ArrayField(new NumberField(), { accessor: true })
    expect(field.value).toEqual([])
    field.setValue(d => d.amount)
    expect(field.value({ amount: [1, 2, 3] })).toEqual([1, 2, 3])
  })

  it('supports FunctionFields', () => {
    const accessorField = new FunctionField()
    accessorField.setValue(d => [d.lng, d.lat])
    expect(accessorField.value).toBeInstanceOf(Function)
    expect(accessorField.value({ lng: 1, lat: 2 })).toEqual([1, 2])

    const getPositionField = new Point2DField(
      { lat: 10, lng: 20 },
      { returnType: 'tuple', accessor: true }
    )

    expect(getPositionField.value).toEqual([20, 10])

    getPositionField.setValue({ lng: 5, lat: 6 })
    expect(getPositionField.value).toEqual([5, 6])

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => { })
    expect(canConnect(accessorField, getPositionField), 'should connect').toBe(true)
    expect(consoleWarn.calls).toMatchInlineSnapshot('undefined')
    expect(consoleWarn, 'should not warn').not.toHaveBeenCalled()

    getPositionField.addConnection('getPosition', accessorField, 'value')

    expect(getPositionField.value).toBeInstanceOf(Function)
    // expect(getPositionField.value).toEqual(accessorField.value)
    expect(getPositionField.value({ lng: 7, lat: 8 })).toEqual([7, 8])
  })

  it('supports transforming values', () => {
    const field = new NumberField(5, { accessor: true, transform: d => d * 2 })
    expect(field.value).toEqual(10)
  })

  it('allows setting values with a transform', () => {
    const field = new NumberField(5, { accessor: true, transform: d => d * 2 })
    expect(field.value).toEqual(10)

    field.setValue(10)
    expect(field.value).toEqual(20)
  })

  it('allows setting an accessor callback with transform', () => {
    const field = new NumberField(5, { accessor: true, transform: d => d * 2 })
    field.setValue(d => d.amount)
    expect(field.value({ amount: 10 })).toEqual(20)
  })

  it('supports transforming ColorFields', () => {
    const field = new ColorField('#ff0000', { accessor: true, transform: hexToColor })
    expect(field.value).toEqual([255, 0, 0, 255])

    field.setValue('#00ff00')
    expect(field.value).toEqual([0, 255, 0, 255])
  })

  it('supports transforming ColorFields with a callback', () => {
    const field = new ColorField('#ff0000', { accessor: true, transform: hexToColor })
    field.setValue(d => d.color)
    expect(field.value).toBeInstanceOf(Function)
    expect(field.value({ color: '#0000ff' })).toEqual([0, 0, 255, 255])
  })
})

describe('Field references', () => {
  const numOp = new NumberOp('/num')
  beforeEach(() => {
    // Note that this is a global map, so we need to clear it before each test
    // to avoid cross-contamination. References currently rely on the opMap
    opMap.clear()

    numOp.inputs.val.setValue(10)
    opMap.set('/num', numOp)
  })

  it('allows references to other operators using {{mustache-syntax}}', () => {
    const parReferences = getFieldReferences('SELECT 5 + {{num.par.val}}')
    expect(parReferences.length).toEqual(1)
    const outReferences = getFieldReferences('SELECT 5 + {{num.out.val}}')
    expect(outReferences.length).toEqual(1)
  })

  it('supports multiple references', () => {
    const src = 'SELECT 5 + {{num.out.val}} + {{num.par.val}}'

    const references = getFieldReferences(src)
    expect(references.length).toEqual(2)
  })

  it('creates only one reference for a given field', () => {
    const src = '[{{geocoder.out.location.lng}}, {{geocoder.out.location.lat}}]'

    const references = getFieldReferences(src)
    expect(references.length).toEqual(1)
    expect(references[0].fieldPath).toEqual('location')
  })

  it('creates separate references for different field paths', () => {
    const src =
      '[{{geocoder.out.location.lng}}, {{geocoder.out.location.lat}}, {{geocoder.par.query}}]'

    const references = getFieldReferences(src)
    expect(references.length).toEqual(2)
    expect(references[0].fieldPath).toEqual('location')
    expect(references[1].fieldPath).toEqual('query')
  })

  it('supports multiple references with the same field path', () => {
    const src = '[{{zoom.par.val}}, {{pitch.par.val}}, {{bearing.par.val}}]'
    const references = getFieldReferences(src)
    expect(references.length).toEqual(3)
    expect(references[0].opId).toEqual('zoom')
    expect(references[1].opId).toEqual('pitch')
    expect(references[2].opId).toEqual('bearing')
  })

  it('supports multiple references to the same field and different operators', () => {
    const src = 'SELECT {{op1.par.val}} + {{op2.par.val}} + {{op1.par.val}}'

    const references = getFieldReferences(src)
    expect(references.length).toEqual(2)
    expect(references[0].opId).toEqual('op1')
    expect(references[1].opId).toEqual('op2')
  })

  it('transforms json', () => {
    const src = '{ num: {{num.par.val}} }'

    const references = getFieldReferences(src)
    expect(references.length).toEqual(1)
  })

  it('supports relative paths with ./ prefix', () => {
    const src = 'SELECT 5 + {{./sibling.out.val}}'
    const references = getFieldReferences(src)
    expect(references.length).toEqual(1)
    expect(references[0].opId).toEqual('./sibling')
  })

  it('supports relative paths with ../ prefix', () => {
    const src = 'SELECT 5 + {{../parent.out.val}}'
    const references = getFieldReferences(src)
    expect(references.length).toEqual(1)
    expect(references[0].opId).toEqual('../parent')
  })

  it('supports relative paths without prefix (equivalent to ./)', () => {
    const src = 'SELECT 5 + {{sibling.out.val}}'
    const references = getFieldReferences(src)
    expect(references.length).toEqual(1)
    expect(references[0].opId).toEqual('sibling')
  })

  it('supports absolute paths with / prefix', () => {
    const src = 'SELECT 5 + {{/absolute/path/to/operator.out.val}}'
    const references = getFieldReferences(src)
    expect(references.length).toEqual(1)
    expect(references[0].opId).toEqual('/absolute/path/to/operator')
  })

  it('supports complex nested relative paths', () => {
    const src = 'SELECT 5 + {{../../grandparent/sibling.out.val}}'
    const references = getFieldReferences(src)
    expect(references.length).toEqual(1)
    expect(references[0].opId).toEqual('../../grandparent/sibling')
  })
})

describe('LayerField', () => {
  it('contains layer type and id', () => {
    const field = new LayerField()
    field.setValue({ type: 'TestLayer', id: 'layer-1' })
    expect(field.value).toEqual({ type: 'TestLayer', id: 'layer-1' })
  })
})

describe('Point2DField', () => {
  it('parses object to object', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ lng: 1, lat: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('parse object should passthrough all keys', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ lng: 1, lat: 2, unknown: 3 })
    expect(field.value).toEqual({ lng: 1, lat: 2, unknown: 3 })
  })

  it('parses 2D tuple to object', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue([1, 2, 3])
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('parses 3D tuple to object (ignores alt)', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue([1, 2, 3])
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('parses object to tuple', () => {
    const field = new Point2DField(undefined, { returnType: 'tuple' })
    field.setValue({ lng: 1, lat: 2 })
    expect(field.value).toEqual([1, 2])
  })

  it('parses 3D object to tuple', () => {
    const field = new Point2DField(undefined, { returnType: 'tuple' })
    field.setValue({ lng: 1, lat: 2, alt: 3 })
    expect(field.value).toEqual([1, 2])
  })

  it('defaultValue is correct', () => {
    expect(Point2DField.defaultValue).toEqual({ lng: 0, lat: 0 })
  })
})

describe('Point3DField', () => {
  it('parses object to object', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue({ lng: 1, lat: 2, alt: 3 })
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 3 })
  })

  it('parse object should passthrough all keys', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue({ lng: 1, lat: 2, unknown: 3 })
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 0, unknown: 3 })
  })

  it('parses object missing alt to object', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue({ lng: 1, lat: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 0 })
  })

  it('parses tuple to object', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue([1, 2, 3])
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 3 })
  })

  it('parses 2D tuple to object with alt=0', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue([1, 2])
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 0 })
  })

  it('parses object to tuple', () => {
    const field = new Point3DField(undefined, { returnType: 'tuple' })
    field.setValue({ lng: 1, lat: 2, alt: 3 })
    expect(field.value).toEqual([1, 2, 3])
  })

  it('parses 2D object to tuple with alt=0', () => {
    const field = new Point3DField(undefined, { returnType: 'tuple' })
    field.setValue({ lng: 1, lat: 2 })
    expect(field.value).toEqual([1, 2, 0])
  })

  it('defaultValue is correct', () => {
    expect(Point3DField.defaultValue).toEqual({ lng: 0, lat: 0, alt: 0 })
  })
})

describe('GeometryField coordinate detection', () => {
  it('recognizes standard lng/lat fields', () => {
    const field = new GeometryField()
    field.setValue({ lng: -122.4, lat: 37.8 })
    expect(field.value).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
  })

  it('recognizes longitude/latitude fields', () => {
    const field = new GeometryField()
    field.setValue({ longitude: -122.4, latitude: 37.8 })
    expect(field.value).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
  })

  it('recognizes lon/lat fields', () => {
    const field = new GeometryField()
    field.setValue({ lon: -122.4, lat: 37.8 })
    expect(field.value).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
  })

  it('recognizes underscore-prefixed fields (*_lng/*_lat)', () => {
    const field = new GeometryField()
    field.setValue({ pickup_lng: -122.4, pickup_lat: 37.8 })
    expect(field.value).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
  })

  it('recognizes underscore-prefixed fields (*_lon/*_lat)', () => {
    const field = new GeometryField()
    field.setValue({ dropoff_lon: -122.4, dropoff_lat: 37.8 })
    expect(field.value).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
  })

  it('recognizes underscore-prefixed fields (*_longitude/*_latitude)', () => {
    const field = new GeometryField()
    field.setValue({ pickup_longitude: -122.4, pickup_latitude: 37.8 })
    expect(field.value).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
  })

  it('is case-insensitive for coordinate fields', () => {
    const field = new GeometryField()
    field.setValue({ Longitude: -122.4, Latitude: 37.8 })
    expect(field.value).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
  })

  it('handles coordinate tuples', () => {
    const field = new GeometryField()
    field.setValue([-122.4, 37.8])
    expect(field.value).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
  })

  it('accepts GeoJSON geometry directly', () => {
    const field = new GeometryField()
    const geometry = {
      type: 'Point',
      coordinates: [-122.4, 37.8],
    }
    field.setValue(geometry)
    expect(field.value).toEqual(geometry)
  })

  it('preserves extra properties when detecting coordinates', () => {
    const field = new FeatureField()
    field.setValue({ lng: -122.4, lat: 37.8, name: 'San Francisco', population: 800000 })
    expect(field.value).toMatchObject({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [-122.4, 37.8],
      },
      properties: { lng: -122.4, lat: 37.8, name: 'San Francisco', population: 800000 },
    })
  })
})

describe('FeatureField coordinate detection', () => {
  it('recognizes longitude/latitude and preserves properties', () => {
    const field = new FeatureField()
    field.setValue({ longitude: 10, latitude: 20, name: 'Test Point' })
    expect(field.value.type).toEqual('Feature')
    expect(field.value.geometry).toEqual({
      type: 'Point',
      coordinates: [10, 20],
    })
    expect(field.value.properties).toMatchObject({
      longitude: 10,
      latitude: 20,
      name: 'Test Point',
    })
  })

  it('recognizes _lng/_lat variations', () => {
    const field = new FeatureField()
    field.setValue({ _lng: 5, _lat: 15 })
    expect(field.value.geometry).toEqual({
      type: 'Point',
      coordinates: [5, 15],
    })
  })

  it('accepts GeoJSON features directly', () => {
    const field = new FeatureField()
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [-122.4, 37.8],
      },
      properties: { name: 'Test' },
    }
    field.setValue(feature)
    expect(field.value).toEqual(feature)
  })
})

describe('FeatureCollectionField creates individual Point features', () => {
  it('converts array of lng/lat objects to individual Point features', () => {
    const field = new FeatureCollectionField()
    field.setValue([
      { lng: 1, lat: 2 },
      { lng: 3, lat: 4 },
      { lng: 5, lat: 6 },
    ])

    expect(field.value.type).toEqual('FeatureCollection')
    expect(field.value.features).toHaveLength(3)
    expect(field.value.features[0]).toMatchObject({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [1, 2],
      },
    })
    expect(field.value.features[1]).toMatchObject({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [3, 4],
      },
    })
    expect(field.value.features[2]).toMatchObject({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [5, 6],
      },
    })
  })

  it('converts array of longitude/latitude objects to individual Point features', () => {
    const field = new FeatureCollectionField()
    field.setValue([
      { longitude: 10, latitude: 20, name: 'Point A' },
      { longitude: 30, latitude: 40, name: 'Point B' },
    ])

    expect(field.value.type).toEqual('FeatureCollection')
    expect(field.value.features).toHaveLength(2)
    expect(field.value.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [10, 20],
    })
    expect(field.value.features[0].properties).toMatchObject({
      longitude: 10,
      latitude: 20,
      name: 'Point A',
    })
  })

  it('converts array of coordinate tuples to individual Point features', () => {
    const field = new FeatureCollectionField()
    field.setValue([
      [1, 2],
      [3, 4],
      [5, 6],
    ])

    expect(field.value.type).toEqual('FeatureCollection')
    expect(field.value.features).toHaveLength(3)
    expect(field.value.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [1, 2],
    })
    // All features should be Point, not MultiPoint
    for (const feature of field.value.features) {
      expect(feature.geometry.type).toEqual('Point')
    }
  })

  it('recognizes _lng/_lat and other variations', () => {
    const field = new FeatureCollectionField()
    field.setValue([
      { _lng: 1, _lat: 2 },
      { lon: 3, lat: 4 },
      { _longitude: 5, _latitude: 6 },
    ])

    expect(field.value.features).toHaveLength(3)
    expect(field.value.features[0].geometry.coordinates).toEqual([1, 2])
    expect(field.value.features[1].geometry.coordinates).toEqual([3, 4])
    expect(field.value.features[2].geometry.coordinates).toEqual([5, 6])
  })

  it('preserves properties for each point', () => {
    const field = new FeatureCollectionField()
    field.setValue([
      { lng: 1, lat: 2, name: 'First', value: 100 },
      { lng: 3, lat: 4, name: 'Second', value: 200 },
    ])

    expect(field.value.features[0].properties).toMatchObject({
      lng: 1,
      lat: 2,
      name: 'First',
      value: 100,
    })
    expect(field.value.features[1].properties).toMatchObject({
      lng: 3,
      lat: 4,
      name: 'Second',
      value: 200,
    })
  })

  it('accepts existing FeatureCollection directly', () => {
    const field = new FeatureCollectionField()
    const featureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: {},
        },
      ],
    }
    field.setValue(featureCollection)
    expect(field.value).toEqual(featureCollection)
  })

  it('accepts array of Features directly', () => {
    const field = new FeatureCollectionField()
    const features = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: {},
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [3, 4] },
        properties: {},
      },
    ]
    field.setValue(features)
    expect(field.value.type).toEqual('FeatureCollection')
    expect(field.value.features).toEqual(features)
  })

  it('does not create MultiPoint geometries', () => {
    const field = new FeatureCollectionField()
    field.setValue([
      { lng: 1, lat: 2 },
      { lng: 3, lat: 4 },
    ])

    // Verify no MultiPoint geometries are created
    for (const feature of field.value.features) {
      expect(feature.geometry.type).not.toEqual('MultiPoint')
      expect(feature.geometry.type).toEqual('Point')
    }
  })
})
