import { LayerExtension, MapView } from '@deck.gl/core'
import { Temporal } from 'temporal-polyfill'
import { describe, expect, it, vi } from 'vitest'
import z from 'zod/v4'
import { hexToColor } from '../utils/color'
import {
  ArrayField,
  applyNodeUIMetadata,
  BboxField,
  ColorField,
  CompoundPropsField,
  captureNodeUIMetadata,
  DateField,
  deriveDecimalStep,
  ExtensionField,
  Field,
  FileUrlField,
  GeoJsonField,
  getFieldReferences,
  LayerField,
  ListField,
  MapLibreLayerField,
  MapStyleField,
  NumberField,
  Point2DField,
  Point3DField,
  parseChoices,
  StringLiteralField,
  Vec2Field,
  Vec3Field,
  ViewField,
  VisualizationField,
} from './fields'

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

  it('allows transforming values', () => {
    const field = new NumberField(5, { transform: (d: number) => d * 2 })
    expect(field.value).toEqual(10)
  })

  it('allows initialization with no value', () => {
    const field = new LayerField()
    expect(field.value).toEqual(undefined)

    const noSetValue = vi.fn()
    class EmptyMockField extends Field {
      static defaultValue = undefined
      createSchema() {}
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

describe('FileUrlField', () => {
  it('accepts string values', () => {
    const field = new FileUrlField('https://example.com/model.glb')
    expect(field.value).toEqual('https://example.com/model.glb')

    field.setValue('@/model.glb')
    expect(field.value).toEqual('@/model.glb')

    field.setValue('./data.json')
    expect(field.value).toEqual('./data.json')
  })

  it('stores the accept option on the instance', () => {
    const field = new FileUrlField('https://example.com/model.glb', { accept: '.glb,.gltf' })
    expect(field.accept).toEqual('.glb,.gltf')

    const noAccept = new FileUrlField()
    expect(noAccept.accept).toBeUndefined()
  })
})

describe('MapStyleField', () => {
  it('accepts string values (URLs)', () => {
    const field = new MapStyleField('https://example.com/style.json')
    expect(field.value).toEqual('https://example.com/style.json')

    field.setValue('@/style.json')
    expect(field.value).toEqual('@/style.json')

    field.setValue('mapbox://styles/mapbox/streets-v11')
    expect(field.value).toEqual('mapbox://styles/mapbox/streets-v11')
  })

  it('accepts style objects', () => {
    const styleObject = {
      version: 8,
      sources: {},
      layers: [],
    }
    const field = new MapStyleField()

    field.setValue(styleObject)
    expect(field.value).toEqual(styleObject)
  })

  it('rejects invalid types (numbers)', () => {
    const field = new MapStyleField()

    field.setValue(123 as unknown as string)
    // Should not update value on validation failure
    expect(field.value).toEqual('')
  })

  it('rejects invalid types (arrays)', () => {
    const field = new MapStyleField()

    field.setValue([1, 2, 3] as unknown as string)
    // Should not update value on validation failure
    expect(field.value).toEqual('')
  })

  it('stores options on the instance', () => {
    const field = new MapStyleField('', { accept: '.json' })
    expect(field.accept).toEqual('.json')
  })

  it('skips setValue when object content is deeply equal', () => {
    const field = new MapStyleField()
    const style1 = {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://tile.example.com/{z}/{x}/{y}.png'] } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    }
    const style2 = {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://tile.example.com/{z}/{x}/{y}.png'] } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    }

    field.setValue(style1)
    expect(field.value).toEqual(style1)

    const spy = vi.fn()
    field.subscribe(spy)
    spy.mockClear()

    field.setValue(style2)
    // Should not emit because content is identical
    expect(spy).not.toHaveBeenCalled()
  })

  it('updates when object content actually differs', () => {
    const field = new MapStyleField()
    const style1 = { version: 8, sources: {}, layers: [] }
    const style2 = { version: 8, sources: {}, layers: [{ id: 'new' }] }

    field.setValue(style1)
    const spy = vi.fn()
    field.subscribe(spy)
    spy.mockClear()

    field.setValue(style2)
    expect(spy).toHaveBeenCalled()
    expect(field.value).toEqual(style2)
  })

  it('always updates for string values (no deep equal needed)', () => {
    const field = new MapStyleField('https://example.com/style1.json')
    const spy = vi.fn()
    field.subscribe(spy)
    spy.mockClear()

    field.setValue('https://example.com/style2.json')
    expect(spy).toHaveBeenCalled()
    expect(field.value).toEqual('https://example.com/style2.json')
  })

  it('handles transition from string to object', () => {
    const field = new MapStyleField('https://example.com/style.json')
    const styleObj = { version: 8, sources: {}, layers: [] }

    field.setValue(styleObj)
    expect(field.value).toEqual(styleObj)
  })

  it('handles transition from object to string', () => {
    const field = new MapStyleField()
    field.setValue({ version: 8, sources: {}, layers: [] })

    field.setValue('https://example.com/style.json')
    expect(field.value).toEqual('https://example.com/style.json')
  })

  it('serializes and deserializes string values correctly', () => {
    const field = new MapStyleField('https://example.com/style.json')
    const serialized = JSON.parse(JSON.stringify(field.value))

    expect(serialized).toEqual('https://example.com/style.json')

    const newField = new MapStyleField()
    newField.setValue(serialized)
    expect(newField.value).toEqual('https://example.com/style.json')
  })

  it('serializes and deserializes object values correctly', () => {
    const styleObject = {
      version: 8,
      sources: { osm: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' } },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#000' } }],
    }
    const field = new MapStyleField()
    field.setValue(styleObject)

    const serialized = JSON.parse(JSON.stringify(field.value))
    expect(serialized).toEqual(styleObject)

    const newField = new MapStyleField()
    newField.setValue(serialized)
    expect(newField.value).toEqual(styleObject)
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
    field2.setValue(15)
    expect(field2.value).toEqual(5)
  })

  it('sets softMin and softMax on the instance', () => {
    const field1 = new NumberField()
    expect(field1.softMin, 'softMin default').toEqual(-Infinity)
    expect(field1.softMax, 'softMax default').toEqual(Infinity)

    const field2 = new NumberField(50, { softMin: 0, softMax: 100 })
    expect(field2.softMin, 'softMin').toEqual(0)
    expect(field2.softMax, 'softMax').toEqual(100)
  })

  it('allows values outside softMin/softMax (soft limits are UI hints only)', () => {
    const field = new NumberField(50, { softMin: 0, softMax: 100 })

    // Values outside soft limits should be accepted
    field.setValue(150)
    expect(field.value).toEqual(150)

    field.setValue(-50)
    expect(field.value).toEqual(-50)
  })

  it('enforces hard min/max while allowing soft limits to differ', () => {
    const field = new NumberField(50, {
      min: 0,
      max: 200,
      softMin: 10,
      softMax: 100,
    })

    // Values within hard limits but outside soft limits should be accepted
    field.setValue(5)
    expect(field.value).toEqual(5)

    field.setValue(150)
    expect(field.value).toEqual(150)

    // Values outside hard limits should be rejected
    field.setValue(-10)
    expect(field.value).toEqual(150) // unchanged

    field.setValue(250)
    expect(field.value).toEqual(150) // unchanged
  })

  it('supports softMax without softMin and vice versa', () => {
    const field1 = new NumberField(50, { softMax: 100 })
    expect(field1.softMin).toEqual(-Infinity)
    expect(field1.softMax).toEqual(100)

    const field2 = new NumberField(50, { softMin: 0 })
    expect(field2.softMin).toEqual(0)
    expect(field2.softMax).toEqual(Infinity)
  })

  it('supports combining hard min with soft max', () => {
    const field = new NumberField(50, { min: 0, softMax: 100 })
    expect(field.min).toEqual(0)
    expect(field.max).toEqual(Infinity)
    expect(field.softMin).toEqual(-Infinity)
    expect(field.softMax).toEqual(100)

    // Can exceed soft max
    field.setValue(200)
    expect(field.value).toEqual(200)

    // Cannot go below hard min
    field.setValue(-10)
    expect(field.value).toEqual(200) // unchanged
  })

  it.each([
    { value: 0.25, step: 0.01 },
    { value: -12.345, step: 0.001 },
    { value: 1.25e-4, step: 1e-6 },
    { value: 1.25e-13, step: 1e-15 },
    { value: -1.25e-13, step: 1e-15 },
  ])('derives a $step decimal step from $value', ({ value, step }) => {
    expect(deriveDecimalStep(value)).toBe(step)
  })

  it.each([42, 0, 1.25e13])('uses the declared fallback step for integer value %s', value => {
    expect(deriveDecimalStep(value, 0.25)).toBe(0.25)
  })

  it('ignores ordinary floating-point arithmetic noise when deriving a step', () => {
    expect(deriveDecimalStep(0.1 + 0.2)).toBe(0.1)
  })

  it('uses the declared step unless value-derived precision is explicitly enabled', () => {
    const semanticField = new NumberField(0.25, { step: 0.5 })
    // A number node's value field derives its step from its value's decimals
    const derived = new NumberField(0.25, { step: 1, deriveStepFromValue: true })

    expect(semanticField.getEffectiveStep()).toBe(0.5)
    expect(derived.getEffectiveStep()).toBe(0.01)

    semanticField.setStepOverride(0.01)
    expect(semanticField.getEffectiveStep()).toBe(0.01)
  })

  it('prefers an observable user-selected step over declared or derived steps', () => {
    const field = new NumberField(0.25, { step: 1, deriveStepFromValue: true })
    const observed: Array<number | undefined> = []
    const subscription = field.stepOverride$.subscribe(step => observed.push(step))

    field.setStepOverride(0.001)
    expect(field.getEffectiveStep()).toBe(0.001)
    field.setStepOverride(undefined)
    expect(field.getEffectiveStep()).toBe(0.01)
    expect(observed).toEqual([undefined, 0.001, undefined])

    subscription.unsubscribe()
  })

  it('captures and restores top-level and nested number-step overrides', () => {
    const plain = new NumberField(1)
    const nested = new NumberField(2)
    const fields = {
      plain,
      settings: new CompoundPropsField({ nested, untouched: new NumberField(3) }),
    }
    plain.setStepOverride(0.1)
    nested.setStepOverride(0.001)

    expect(captureNodeUIMetadata(fields)).toEqual({
      numberSteps: { plain: 0.1, 'settings.nested': 0.001 },
    })

    applyNodeUIMetadata(fields, { numberSteps: { plain: 10, 'settings.nested': 0.01 } })
    expect(plain.stepOverride).toBe(10)
    expect(nested.stepOverride).toBe(0.01)

    applyNodeUIMetadata(fields)
    expect(plain.stepOverride).toBeUndefined()
    expect(nested.stepOverride).toBeUndefined()
    expect(captureNodeUIMetadata(fields)).toBeUndefined()
  })
})

describe('StringLiteralField', () => {
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

describe('getFieldReferences self-parameter shorthand', () => {
  it('should extract self-parameter reference from shorthand syntax', () => {
    const refs = getFieldReferences('return d * {{par.val}}', '/code')
    expect(refs).toHaveLength(1)
    expect(refs[0].opId).toBe('/code')
    expect(refs[0].inOut).toBe('par')
    expect(refs[0].fieldPath).toBe('val')
    expect(refs[0].handleId).toBe('par.val')
  })

  it('should return empty for shorthand without thisOpId context', () => {
    const refs = getFieldReferences('return d * {{par.val}}')
    expect(refs).toHaveLength(0)
  })

  it('should handle mixed shorthand and standard references', () => {
    const refs = getFieldReferences('{{par.a}} + {{/other.par.b}}', '/code')
    expect(refs).toHaveLength(2)
    expect(refs.find(r => r.fieldPath === 'a')?.opId).toBe('/code')
    expect(refs.find(r => r.fieldPath === 'b')?.opId).toBe('/other')
  })

  it('should handle multiple self-parameter references', () => {
    const refs = getFieldReferences('{{par.scale}} * x + {{par.offset}}', '/code')
    expect(refs).toHaveLength(2)
    expect(refs[0].opId).toBe('/code')
    expect(refs[0].fieldPath).toBe('scale')
    expect(refs[1].opId).toBe('/code')
    expect(refs[1].fieldPath).toBe('offset')
  })

  it('should deduplicate self-parameter references', () => {
    const refs = getFieldReferences('{{par.val}} + {{par.val}} + {{par.val}}', '/code')
    expect(refs).toHaveLength(1)
    expect(refs[0].fieldPath).toBe('val')
  })

  it('should handle nested property access in self-parameter shorthand', () => {
    const refs = getFieldReferences('{{par.location.lng}}', '/code')
    expect(refs).toHaveLength(1)
    // Only the first part of the path is the field path
    expect(refs[0].fieldPath).toBe('location')
  })

  it('should not conflict with standard mustache syntax', () => {
    // Self-parameter shorthand + sibling reference + absolute path
    const refs = getFieldReferences('{{par.a}} + {{sibling.par.b}} + {{/other.par.c}}', '/code')
    expect(refs).toHaveLength(3)
    // All should resolve to their correct opIds
    const aRef = refs.find(r => r.fieldPath === 'a')
    const bRef = refs.find(r => r.fieldPath === 'b')
    const cRef = refs.find(r => r.fieldPath === 'c')
    expect(aRef?.opId).toBe('/code') // Self-reference shorthand
    expect(bRef?.opId).toBe('/sibling') // Sibling operator
    expect(cRef?.opId).toBe('/other') // Absolute path
  })
})

describe('LayerField', () => {
  it('contains layer type and id', () => {
    const field = new LayerField()
    field.setValue({ type: 'TestLayer', id: 'layer-1' })
    expect(field.value).toEqual({ type: 'TestLayer', id: 'layer-1' })
  })
})

describe('ViewField', () => {
  it('accepts supported view descriptors', () => {
    const field = new ViewField()
    field.setValue({ type: 'MapView', id: 'map-view', width: '50%' })

    expect(field.value).toEqual({ type: 'MapView', id: 'map-view', width: '50%' })
  })

  it('rejects unknown view types', () => {
    const field = new ViewField()
    field.setValue({ type: 'UnknownView' } as never)

    expect(field.value).toBeUndefined()
  })

  it('accepts existing View instances from custom operators', () => {
    const field = new ViewField()
    const view = new MapView({ id: 'custom-map-view' })
    field.setValue(view)

    expect(field.value).toBe(view)
  })
})

describe('ExtensionField', () => {
  it('accepts extension descriptors from extension operators', () => {
    const field = new ExtensionField()
    const value = { extension: { type: 'PathStyleExtension', dash: true }, props: {} }
    field.setValue(value)

    expect(field.value).toEqual(value)
  })

  it('accepts LayerExtension instances from custom operators', () => {
    class CustomExtension extends LayerExtension {}
    const field = new ExtensionField()
    const extension = new CustomExtension()
    field.setValue({ extension, props: { custom: 1 } })

    expect(field.value.extension).toBe(extension)
    expect(field.value.props).toEqual({ custom: 1 })
  })

  it('rejects extensions without a type', () => {
    const field = new ExtensionField()
    field.setValue({ extension: { dash: true }, props: {} })

    expect(field.value).toBeUndefined()
  })
})

describe('Point2DField', () => {
  it('transforms tuple to object by default (no options)', () => {
    const field = new Point2DField()
    field.setValue([1, 2])
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

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

  it('normalizes Longitude/Latitude column names', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ Longitude: 1, Latitude: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('normalizes case-insensitive column names', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ LONGITUDE: 1, LATITUDE: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('normalizes lowercase longitude/latitude', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ longitude: 1, latitude: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('normalizes mixed case column names', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ longitude: 1, Latitude: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('normalizes lon abbreviation', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ lon: 1, lat: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('preserves backward compatibility with lng/lat', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ lng: 1, lat: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2 })
  })

  it('normalizes with extra properties preserved', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    field.setValue({ Longitude: 1, Latitude: 2, name: 'Test', value: 42 })
    expect(field.value).toEqual({ lng: 1, lat: 2, name: 'Test', value: 42 })
  })

  it('normalizes Longitude/Latitude to tuple', () => {
    const field = new Point2DField(undefined, { returnType: 'tuple' })
    field.setValue({ Longitude: 1, Latitude: 2 })
    expect(field.value).toEqual([1, 2])
  })

  it('still accepts tuple formats', () => {
    const field1 = new Point2DField(undefined, { returnType: 'object' })
    field1.setValue([1, 2])
    expect(field1.value).toEqual({ lng: 1, lat: 2 })

    const field2 = new Point2DField(undefined, { returnType: 'object' })
    field2.setValue([1, 2, 3])
    expect(field2.value).toEqual({ lng: 1, lat: 2 })
  })

  it('extracts coordinates from GeoJSON Point Feature', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    const geoJsonFeature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [-118.4182302, 34.0576856],
      },
    }
    field.setValue(geoJsonFeature)
    expect(field.value).toEqual({ lng: -118.4182302, lat: 34.0576856 })
  })

  it('extracts coordinates from GeoJSON Point Feature with 3D coordinates', () => {
    const field = new Point2DField(undefined, { returnType: 'object' })
    const geoJsonFeature = {
      type: 'Feature',
      properties: { name: 'Test Point' },
      geometry: {
        type: 'Point',
        coordinates: [-117.8719428, 33.6784913, 100],
      },
    }
    field.setValue(geoJsonFeature)
    expect(field.value).toEqual({ lng: -117.8719428, lat: 33.6784913 })
  })

  it('extracts coordinates from GeoJSON Point Feature to tuple', () => {
    const field = new Point2DField(undefined, { returnType: 'tuple' })
    const geoJsonFeature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [-118.4182302, 34.0576856],
      },
    }
    field.setValue(geoJsonFeature)
    expect(field.value).toEqual([-118.4182302, 34.0576856])
  })

  it('extracts coordinates from bare GeoJSON Point geometry', () => {
    const field = new Point2DField()
    field.setValue({ type: 'Point', coordinates: [-73.78, 40.64] })
    expect(field.value).toEqual({ lng: -73.78, lat: 40.64 })
  })

  it('extracts coordinates from geometry column with [lng, lat] tuple', () => {
    const field = new Point2DField()
    field.setValue({ id: 1, geometry: [-73.78, 40.64] })
    expect(field.value).toEqual({ lng: -73.78, lat: 40.64 })
  })

  it('extracts coordinates from geometry column with GeoJSON Point', () => {
    const field = new Point2DField()
    field.setValue({ id: 1, geometry: { type: 'Point', coordinates: [-73.78, 40.64] } })
    expect(field.value).toEqual({ lng: -73.78, lat: 40.64 })
  })

  it('extracts coordinates from geometry column to tuple', () => {
    const field = new Point2DField(undefined, { returnType: 'tuple' })
    field.setValue({ id: 1, geometry: [-73.78, 40.64] })
    expect(field.value).toEqual([-73.78, 40.64])
  })
})

describe('Point3DField', () => {
  it('transforms tuple to object by default (no options)', () => {
    const field = new Point3DField()
    field.setValue([1, 2, 3])
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 3 })
  })

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

  it('normalizes Longitude/Latitude/Altitude column names', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue({ Longitude: 1, Latitude: 2, Altitude: 3 })
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 3 })
  })

  it('normalizes case-insensitive column names', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue({ LONGITUDE: 1, LATITUDE: 2, ALTITUDE: 3 })
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 3 })
  })

  it('normalizes Longitude/Latitude without Altitude', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue({ Longitude: 1, Latitude: 2 })
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 0 })
  })

  it('preserves backward compatibility with lng/lat/alt', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue({ lng: 1, lat: 2, alt: 3 })
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 3 })
  })

  it('normalizes with extra properties preserved', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    field.setValue({ Longitude: 1, Latitude: 2, Altitude: 3, name: 'Test' })
    expect(field.value).toEqual({ lng: 1, lat: 2, alt: 3, name: 'Test' })
  })

  it('normalizes Longitude/Latitude/Altitude to tuple', () => {
    const field = new Point3DField(undefined, { returnType: 'tuple' })
    field.setValue({ Longitude: 1, Latitude: 2, Altitude: 3 })
    expect(field.value).toEqual([1, 2, 3])
  })

  it('extracts coordinates from GeoJSON Point Feature', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    const geoJsonFeature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [-118.4182302, 34.0576856],
      },
    }
    field.setValue(geoJsonFeature)
    expect(field.value).toEqual({ lng: -118.4182302, lat: 34.0576856, alt: 0 })
  })

  it('extracts 3D coordinates from GeoJSON Point Feature', () => {
    const field = new Point3DField(undefined, { returnType: 'object' })
    const geoJsonFeature = {
      type: 'Feature',
      properties: { name: 'Airport' },
      geometry: {
        type: 'Point',
        coordinates: [-117.8719428, 33.6784913, 100],
      },
    }
    field.setValue(geoJsonFeature)
    expect(field.value).toEqual({ lng: -117.8719428, lat: 33.6784913, alt: 100 })
  })

  it('extracts coordinates from GeoJSON Point Feature to tuple', () => {
    const field = new Point3DField(undefined, { returnType: 'tuple' })
    const geoJsonFeature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [-118.4182302, 34.0576856, 50],
      },
    }
    field.setValue(geoJsonFeature)
    expect(field.value).toEqual([-118.4182302, 34.0576856, 50])
  })

  it('extracts 2D coordinates from GeoJSON Point Feature to tuple with alt=0', () => {
    const field = new Point3DField(undefined, { returnType: 'tuple' })
    const geoJsonFeature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [-118.4182302, 34.0576856],
      },
    }
    field.setValue(geoJsonFeature)
    expect(field.value).toEqual([-118.4182302, 34.0576856, 0])
  })

  it('extracts coordinates from bare GeoJSON Point geometry', () => {
    const field = new Point3DField()
    field.setValue({ type: 'Point', coordinates: [-73.78, 40.64, 100] })
    expect(field.value).toEqual({ lng: -73.78, lat: 40.64, alt: 100 })
  })

  it('extracts 2D coordinates from bare GeoJSON Point geometry with alt=0', () => {
    const field = new Point3DField()
    field.setValue({ type: 'Point', coordinates: [-73.78, 40.64] })
    expect(field.value).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
  })

  it('extracts coordinates from geometry column with [lng, lat] tuple', () => {
    const field = new Point3DField()
    field.setValue({ id: 1, geometry: [-73.78, 40.64] })
    expect(field.value).toEqual({ lng: -73.78, lat: 40.64, alt: 0 })
  })

  it('extracts coordinates from geometry column with [lng, lat, alt] tuple', () => {
    const field = new Point3DField()
    field.setValue({ id: 1, geometry: [-73.78, 40.64, 100] })
    expect(field.value).toEqual({ lng: -73.78, lat: 40.64, alt: 100 })
  })

  it('extracts coordinates from geometry column with GeoJSON Point', () => {
    const field = new Point3DField()
    field.setValue({ id: 1, geometry: { type: 'Point', coordinates: [-73.78, 40.64, 100] } })
    expect(field.value).toEqual({ lng: -73.78, lat: 40.64, alt: 100 })
  })

  it('extracts coordinates from geometry column to tuple', () => {
    const field = new Point3DField(undefined, { returnType: 'tuple' })
    field.setValue({ id: 1, geometry: [-73.78, 40.64, 100] })
    expect(field.value).toEqual([-73.78, 40.64, 100])
  })

  it('ignores geometry column with non-point data', () => {
    const field = new Point3DField()
    field.setValue({
      id: 1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    })
    // Should fall back to default since no valid point data
    expect(field.value).toEqual({ lng: 0, lat: 0, alt: 0 })
  })
})

describe('Vec2Field', () => {
  it('transforms tuple to object by default (no options)', () => {
    const field = new Vec2Field()
    field.setValue([3, 7])
    expect(field.value).toEqual({ x: 3, y: 7 })
  })

  it('transforms tuple to object with explicit option', () => {
    const field = new Vec2Field(undefined, { returnType: 'object' })
    field.setValue([3, 7])
    expect(field.value).toEqual({ x: 3, y: 7 })
  })

  it('parses object to object', () => {
    const field = new Vec2Field(undefined, { returnType: 'object' })
    field.setValue({ x: 5, y: 9 })
    expect(field.value).toEqual({ x: 5, y: 9 })
  })

  it('transforms object to tuple', () => {
    const field = new Vec2Field(undefined, { returnType: 'tuple' })
    field.setValue({ x: 5, y: 9 })
    expect(field.value).toEqual([5, 9])
  })

  it('parses tuple to tuple', () => {
    const field = new Vec2Field(undefined, { returnType: 'tuple' })
    field.setValue([3, 7])
    expect(field.value).toEqual([3, 7])
  })
})

describe('Vec3Field', () => {
  it('transforms tuple to object by default (no options)', () => {
    const field = new Vec3Field()
    field.setValue([1, 2, 3])
    expect(field.value).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('transforms tuple to object with explicit option', () => {
    const field = new Vec3Field(undefined, { returnType: 'object' })
    field.setValue([1, 2, 3])
    expect(field.value).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('parses object to object', () => {
    const field = new Vec3Field(undefined, { returnType: 'object' })
    field.setValue({ x: 4, y: 5, z: 6 })
    expect(field.value).toEqual({ x: 4, y: 5, z: 6 })
  })

  it('transforms object to tuple', () => {
    const field = new Vec3Field(undefined, { returnType: 'tuple' })
    field.setValue({ x: 4, y: 5, z: 6 })
    expect(field.value).toEqual([4, 5, 6])
  })

  it('parses tuple to tuple', () => {
    const field = new Vec3Field(undefined, { returnType: 'tuple' })
    field.setValue([1, 2, 3])
    expect(field.value).toEqual([1, 2, 3])
  })
})

describe('ColorField', () => {
  it('creates a field with default color value', () => {
    const field = new ColorField()
    expect(field.value).toBe('#0000ffff')
  })

  it('normalizes 6-char hex to 8-char hex via schema', () => {
    const field = new ColorField()

    field.setValue('#ff0000')
    expect(field.value).toBe('#ff0000ff')

    field.setValue('#00ff0080')
    expect(field.value).toBe('#00ff0080')
  })

  it('deserializes both old and new formats', () => {
    expect(ColorField.deserialize('#ff0000')).toBe('#ff0000')
    expect(ColorField.deserialize('#ff000080')).toBe('#ff000080')
    expect(ColorField.deserialize([255, 0, 0, 128])).toBe('#ff000080')
  })

  it('handles loading old project files with 6-char hex', () => {
    const deserialized = ColorField.deserialize('#00ff00')
    const field = new ColorField(deserialized)
    expect(field.value).toBe('#00ff00ff')
  })
})

describe('DateField', () => {
  it('creates a field with default PlainDateTime value', () => {
    const field = new DateField()
    expect(field.value).toBeInstanceOf(Temporal.PlainDateTime)
  })

  it('allows setting a PlainDateTime value', () => {
    const field = new DateField()
    const testDate = Temporal.PlainDateTime.from('2024-03-15T10:30:00')
    field.setValue(testDate)
    expect(field.value).toEqual(testDate)
  })

  it('parses ISO datetime strings to PlainDateTime', () => {
    const field = new DateField()
    const isoString = '2024-03-15T10:30:00'
    field.setValue(isoString)
    expect(field.value).toBeInstanceOf(Temporal.PlainDateTime)
    expect(field.value.toString()).toBe(isoString)
  })

  it('converts Date objects to PlainDateTime in UTC', () => {
    const field = new DateField()
    const jsDate = new Date('2024-03-15T10:30:00Z')
    field.setValue(jsDate)
    expect(field.value).toBeInstanceOf(Temporal.PlainDateTime)
    // Should be timezone-independent
    expect(field.value.year).toBe(2024)
    expect(field.value.month).toBe(3)
    expect(field.value.day).toBe(15)
  })

  it('serializes PlainDateTime to ISO string', () => {
    const field = new DateField()
    const testDate = Temporal.PlainDateTime.from('2024-03-15T10:30:00')
    field.setValue(testDate)
    const serialized = field.serialize()
    expect(typeof serialized).toBe('string')
    expect(serialized).toBe('2024-03-15T10:30:00')
  })

  it('deserializes ISO string to PlainDateTime', () => {
    const isoString = '2024-03-15T10:30:00'
    const deserialized = DateField.deserialize(isoString)
    expect(deserialized).toBeInstanceOf(Temporal.PlainDateTime)
    expect(deserialized.toString()).toBe(isoString)
  })

  it('handles timezone-independent date comparisons', () => {
    const field1 = new DateField()
    const field2 = new DateField()

    // Set the same date using different methods
    field1.setValue('2024-03-15T10:30:00')
    field2.setValue(Temporal.PlainDateTime.from('2024-03-15T10:30:00'))

    expect(Temporal.PlainDateTime.compare(field1.value, field2.value)).toBe(0)
  })

  it('maintains precision without timezone conversion issues', () => {
    const field = new DateField()
    const testDate = Temporal.PlainDateTime.from('2024-03-15T23:59:59')
    field.setValue(testDate)

    // Verify exact time components are preserved
    expect(field.value.year).toBe(2024)
    expect(field.value.month).toBe(3)
    expect(field.value.day).toBe(15)
    expect(field.value.hour).toBe(23)
    expect(field.value.minute).toBe(59)
    expect(field.value.second).toBe(59)
  })

  it('handles roundtrip serialization correctly', () => {
    const field = new DateField()
    const originalDate = Temporal.PlainDateTime.from('2024-03-15T10:30:45')
    field.setValue(originalDate)

    // Serialize and deserialize
    const serialized = field.serialize()
    const deserialized = DateField.deserialize(serialized)

    expect(Temporal.PlainDateTime.compare(originalDate, deserialized)).toBe(0)
  })
})

describe('Field showByDefault option', () => {
  it('defaults showByDefault to true', () => {
    const field = new NumberField(0)
    expect(field.showByDefault).toBe(true)
  })

  it('respects showByDefault: false option', () => {
    const field = new NumberField(0, { showByDefault: false })
    expect(field.showByDefault).toBe(false)
  })

  it('respects showByDefault: true option explicitly', () => {
    const field = new NumberField(0, { showByDefault: true })
    expect(field.showByDefault).toBe(true)
  })

  it('works with CompoundPropsField', () => {
    const field = new CompoundPropsField(
      { x: new NumberField(0), y: new NumberField(0) },
      { showByDefault: false }
    )
    expect(field.showByDefault).toBe(false)
  })

  it('works with ListField', () => {
    const field = new ListField(new NumberField(), { showByDefault: false })
    expect(field.showByDefault).toBe(false)
  })
})

describe('GeoJsonField', () => {
  it('should have correct type', () => {
    const field = new GeoJsonField()
    expect((field.constructor as typeof Field).type).toBe('geojson')
  })

  it('should have default value as FeatureCollection', () => {
    const field = new GeoJsonField()
    expect(field.value).toEqual({ type: 'FeatureCollection', features: [] })
  })

  it('should accept GeoJSON feature', () => {
    const field = new GeoJsonField()
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [0, 0],
      },
      properties: {},
    }
    field.setValue(feature)
    expect(field.value).toEqual(feature)
  })

  it('should accept GeoJSON FeatureCollection', () => {
    const field = new GeoJsonField()
    const featureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [0, 0],
          },
          properties: {},
        },
      ],
    }
    field.setValue(featureCollection)
    expect(field.value).toEqual(featureCollection)
  })
})

describe('BboxField', () => {
  it('should normalize object input to object format by default', () => {
    const field = new BboxField()
    const bbox = {
      southwest: { lng: -74.05, lat: 40.68 },
      northeast: { lng: -73.9, lat: 40.82 },
    }
    field.setValue(bbox)
    expect(field.value).toEqual(bbox)
  })

  it('should normalize tuple input to object format by default', () => {
    const field = new BboxField()
    field.setValue([
      [-74.05, 40.68],
      [-73.9, 40.82],
    ] as any)
    expect(field.value).toEqual({
      southwest: { lng: -74.05, lat: 40.68 },
      northeast: { lng: -73.9, lat: 40.82 },
    })
  })

  it('should normalize object input to tuple format with returnType: tuple', () => {
    const field = new BboxField(undefined, { returnType: 'tuple' })
    field.setValue({
      southwest: { lng: -74.05, lat: 40.68 },
      northeast: { lng: -73.9, lat: 40.82 },
    } as any)
    expect(field.value).toEqual([
      [-74.05, 40.68],
      [-73.9, 40.82],
    ])
  })

  it('should normalize tuple input to tuple format with returnType: tuple', () => {
    const field = new BboxField(undefined, { returnType: 'tuple' })
    field.setValue([
      [-74.05, 40.68],
      [-73.9, 40.82],
    ] as any)
    expect(field.value).toEqual([
      [-74.05, 40.68],
      [-73.9, 40.82],
    ])
  })

  it('should normalize mixed object/array points to tuple format', () => {
    const field = new BboxField(undefined, { returnType: 'tuple' })
    field.setValue({
      southwest: [-74.05, 40.68],
      northeast: { lng: -73.9, lat: 40.82 },
    } as any)
    expect(field.value).toEqual([
      [-74.05, 40.68],
      [-73.9, 40.82],
    ])
  })

  it('should normalize tuple of objects to object format', () => {
    const field = new BboxField()
    field.setValue([
      { lng: -74.05, lat: 40.68 },
      { lng: -73.9, lat: 40.82 },
    ] as any)
    expect(field.value).toEqual({
      southwest: { lng: -74.05, lat: 40.68 },
      northeast: { lng: -73.9, lat: 40.82 },
    })
  })
})

describe('MapLibreLayerField', () => {
  const layer = {
    id: 'test-custom-layer',
    type: 'custom' as const,
    code: '{ render() {} }',
    renderingMode: '3d' as const,
    params: { color: '#ff0000', opacity: 0.5 },
  }

  // A one-argument z.record() has no value type in Zod 4, so parsing params threw
  // "Cannot read properties of undefined (reading '_zod')"
  it('accepts a custom layer with params', () => {
    expect(new MapLibreLayerField().schema.safeParse(layer).success).toBe(true)
    expect(new ListField(new MapLibreLayerField()).schema.safeParse([layer]).success).toBe(true)
  })

  it('accepts maplibreLayers with params on a VisualizationField', () => {
    const vis = { deckProps: {}, maplibreLayers: [layer] }
    expect(new VisualizationField().schema.safeParse(vis).success).toBe(true)
  })
})
