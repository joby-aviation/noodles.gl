// Tests for field bindings - two-way synchronization between fields and timeline tracks

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BooleanField,
  ColorField,
  NumberField,
  Point2DField,
  Point3DField,
  StringField,
  Vec2Field,
  Vec3Field,
} from '../../noodles/fields'
import type { IOperator, Operator } from '../../noodles/operators'
import {
  bindFieldToTimeline,
  bindOperatorToTimeline,
  cleanupRemovedOperators,
  fieldValueToKeyframeValue,
  getFieldDefaultKeyframeValue,
  getFieldPath,
  keyframeValueToFieldValue,
  opIdToObjectName,
} from '../field-bindings'
import { getTimelineStore, useTimelineStore } from '../timeline-store'

// Minimal operator mock — only needs id and locked for bindFieldToTimeline
function makeOp(id: string): Operator<IOperator> {
  return { id, locked: { value: false } } as unknown as Operator<IOperator>
}

// Operator mock with a single NumberField input — for bindOperatorToTimeline
function makeOpWithInputs(
  id: string,
  fieldName: string,
  field: NumberField
): Operator<IOperator> {
  return { id, locked: { value: false }, inputs: { [fieldName]: field } } as unknown as Operator<IOperator>
}

describe('opIdToObjectName', () => {
  it('converts simple operator ID', () => {
    expect(opIdToObjectName('/my-operator')).toBe('my-operator')
  })

  it('converts nested operator ID with spaces', () => {
    expect(opIdToObjectName('/container/nested')).toBe('container / nested')
  })

  it('handles deeply nested paths', () => {
    expect(opIdToObjectName('/a/b/c/d')).toBe('a / b / c / d')
  })

  it('handles single character segments', () => {
    expect(opIdToObjectName('/x/y')).toBe('x / y')
  })
})

describe('getFieldPath', () => {
  it('builds simple field path', () => {
    expect(getFieldPath('/my-op', 'value')).toBe('my-op / value')
  })

  it('builds field path with subpath', () => {
    expect(getFieldPath('/my-op', 'viewState', ['latitude'])).toBe('my-op / viewState / latitude')
  })

  it('builds field path with multiple subpath segments', () => {
    expect(getFieldPath('/container/op', 'config', ['nested', 'deep'])).toBe(
      'container / op / config / nested / deep'
    )
  })

  it('handles empty subpath', () => {
    expect(getFieldPath('/op', 'field', [])).toBe('op / field')
  })

  it('handles undefined subpath', () => {
    expect(getFieldPath('/op', 'field')).toBe('op / field')
  })
})

describe('fieldValueToKeyframeValue', () => {
  describe('NumberField', () => {
    it('passes through number values', () => {
      const field = new NumberField(0)
      expect(fieldValueToKeyframeValue(field, 42)).toBe(42)
      expect(fieldValueToKeyframeValue(field, -3.14)).toBe(-3.14)
      expect(fieldValueToKeyframeValue(field, 0)).toBe(0)
    })
  })

  describe('BooleanField', () => {
    it('passes through boolean values', () => {
      const field = new BooleanField(false)
      expect(fieldValueToKeyframeValue(field, true)).toBe(true)
      expect(fieldValueToKeyframeValue(field, false)).toBe(false)
    })
  })

  describe('StringField', () => {
    it('passes through string values', () => {
      const field = new StringField('')
      expect(fieldValueToKeyframeValue(field, 'hello')).toBe('hello')
      expect(fieldValueToKeyframeValue(field, '')).toBe('')
    })
  })

  describe('ColorField', () => {
    it('converts hex color to RGBA', () => {
      const field = new ColorField('#000000')
      const result = fieldValueToKeyframeValue(field, '#ff0000')
      expect(result).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    })

    it('converts array color to RGBA', () => {
      const field = new ColorField('#000000')
      const result = fieldValueToKeyframeValue(field, [255, 128, 0, 255])
      expect(result).toHaveProperty('r')
      expect(result).toHaveProperty('g')
      expect(result).toHaveProperty('b')
      expect(result).toHaveProperty('a')
    })

    it('passes through RGBA object', () => {
      const field = new ColorField('#000000')
      const rgba = { r: 0.5, g: 0.25, b: 0.75, a: 1 }
      expect(fieldValueToKeyframeValue(field, rgba)).toEqual(rgba)
    })
  })

  describe('Vec2Field', () => {
    it('converts array to Vec2 object', () => {
      const field = new Vec2Field({ x: 0, y: 0 })
      expect(fieldValueToKeyframeValue(field, [10, 20])).toEqual({ x: 10, y: 20 })
    })

    it('normalizes object format', () => {
      const field = new Vec2Field({ x: 0, y: 0 })
      expect(fieldValueToKeyframeValue(field, { x: 5, y: 15 })).toEqual({ x: 5, y: 15 })
    })
  })

  describe('Vec3Field', () => {
    it('converts array to Vec3 object', () => {
      const field = new Vec3Field({ x: 0, y: 0, z: 0 })
      expect(fieldValueToKeyframeValue(field, [1, 2, 3])).toEqual({ x: 1, y: 2, z: 3 })
    })

    it('normalizes object format', () => {
      const field = new Vec3Field({ x: 0, y: 0, z: 0 })
      expect(fieldValueToKeyframeValue(field, { x: 4, y: 5, z: 6 })).toEqual({ x: 4, y: 5, z: 6 })
    })
  })

  describe('Point2DField', () => {
    it('converts array to Point2D object', () => {
      const field = new Point2DField({ lng: 0, lat: 0 })
      expect(fieldValueToKeyframeValue(field, [-122.4, 37.8])).toEqual({ lng: -122.4, lat: 37.8 })
    })

    it('normalizes object format', () => {
      const field = new Point2DField({ lng: 0, lat: 0 })
      expect(fieldValueToKeyframeValue(field, { lng: -74, lat: 40.7 })).toEqual({
        lng: -74,
        lat: 40.7,
      })
    })
  })

  describe('Point3DField', () => {
    it('converts array to Point3D object', () => {
      const field = new Point3DField({ lng: 0, lat: 0, alt: 0 })
      expect(fieldValueToKeyframeValue(field, [-122.4, 37.8, 1000])).toEqual({
        lng: -122.4,
        lat: 37.8,
        alt: 1000,
      })
    })

    it('normalizes object format', () => {
      const field = new Point3DField({ lng: 0, lat: 0, alt: 0 })
      expect(fieldValueToKeyframeValue(field, { lng: -74, lat: 40.7, alt: 500 })).toEqual({
        lng: -74,
        lat: 40.7,
        alt: 500,
      })
    })
  })
})

describe('keyframeValueToFieldValue', () => {
  describe('NumberField', () => {
    it('passes through number values', () => {
      const field = new NumberField(0)
      expect(keyframeValueToFieldValue(field, 42)).toBe(42)
    })
  })

  describe('BooleanField', () => {
    it('passes through boolean values', () => {
      const field = new BooleanField(false)
      expect(keyframeValueToFieldValue(field, true)).toBe(true)
    })
  })

  describe('StringField', () => {
    it('passes through string values', () => {
      const field = new StringField('')
      expect(keyframeValueToFieldValue(field, 'test')).toBe('test')
    })
  })

  describe('ColorField', () => {
    it('converts RGBA to hex (with alpha)', () => {
      const field = new ColorField('#000000')
      const result = keyframeValueToFieldValue(field, { r: 1, g: 0, b: 0, a: 1 })
      // rgbaToHex returns 8-character hex with alpha (#rrggbbaa)
      expect(result).toBe('#ff0000ff')
    })

    it('handles fractional RGBA values', () => {
      const field = new ColorField('#000000')
      const result = keyframeValueToFieldValue(field, { r: 0.5, g: 0.5, b: 0.5, a: 1 })
      expect(typeof result).toBe('string')
      // rgbaToHex returns 8-character hex with alpha (#rrggbbaa)
      expect(result).toMatch(/^#[0-9a-f]{8}$/i)
    })
  })

  describe('Vec2Field', () => {
    it('returns Vec2 object as-is', () => {
      const field = new Vec2Field({ x: 0, y: 0 })
      expect(keyframeValueToFieldValue(field, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    })
  })

  describe('Vec3Field', () => {
    it('returns Vec3 object as-is', () => {
      const field = new Vec3Field({ x: 0, y: 0, z: 0 })
      expect(keyframeValueToFieldValue(field, { x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 })
    })
  })

  describe('Point2DField', () => {
    it('returns Point2D object as-is', () => {
      const field = new Point2DField({ lng: 0, lat: 0 })
      expect(keyframeValueToFieldValue(field, { lng: -122, lat: 37 })).toEqual({
        lng: -122,
        lat: 37,
      })
    })
  })

  describe('Point3DField', () => {
    it('returns Point3D object as-is', () => {
      const field = new Point3DField({ lng: 0, lat: 0, alt: 0 })
      expect(keyframeValueToFieldValue(field, { lng: -122, lat: 37, alt: 100 })).toEqual({
        lng: -122,
        lat: 37,
        alt: 100,
      })
    })
  })
})

describe('getFieldDefaultKeyframeValue', () => {
  it('gets default from NumberField', () => {
    const field = new NumberField(42)
    expect(getFieldDefaultKeyframeValue(field)).toBe(42)
  })

  it('gets default from BooleanField', () => {
    const field = new BooleanField(true)
    expect(getFieldDefaultKeyframeValue(field)).toBe(true)
  })

  it('gets default from StringField', () => {
    const field = new StringField('default')
    expect(getFieldDefaultKeyframeValue(field)).toBe('default')
  })

  it('gets default from Vec2Field', () => {
    const field = new Vec2Field({ x: 5, y: 10 })
    expect(getFieldDefaultKeyframeValue(field)).toEqual({ x: 5, y: 10 })
  })

  it('gets default from Point3DField', () => {
    const field = new Point3DField({ lng: -122.4, lat: 37.8, alt: 500 })
    expect(getFieldDefaultKeyframeValue(field)).toEqual({ lng: -122.4, lat: 37.8, alt: 500 })
  })
})

describe('round-trip conversion', () => {
  it('NumberField value survives round-trip', () => {
    const field = new NumberField(0)
    const original = 123.456
    const kfValue = fieldValueToKeyframeValue(field, original)
    const restored = keyframeValueToFieldValue(field, kfValue)
    expect(restored).toBe(original)
  })

  it('BooleanField value survives round-trip', () => {
    const field = new BooleanField(false)
    const kfValue = fieldValueToKeyframeValue(field, true)
    const restored = keyframeValueToFieldValue(field, kfValue)
    expect(restored).toBe(true)
  })

  it('Vec2Field value survives round-trip', () => {
    const field = new Vec2Field({ x: 0, y: 0 })
    const original = { x: 100, y: 200 }
    const kfValue = fieldValueToKeyframeValue(field, original)
    const restored = keyframeValueToFieldValue(field, kfValue)
    expect(restored).toEqual(original)
  })

  it('Point3DField value survives round-trip', () => {
    const field = new Point3DField({ lng: 0, lat: 0, alt: 0 })
    const original = { lng: -122.4194, lat: 37.7749, alt: 1000 }
    const kfValue = fieldValueToKeyframeValue(field, original)
    const restored = keyframeValueToFieldValue(field, kfValue)
    expect(restored).toEqual(original)
  })
})

describe('bindFieldToTimeline - integration', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  describe('initial evaluation on bind', () => {
    it('syncs field to keyframe value at current position when track has keyframes', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(0)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)
      store.addKeyframe(fieldPath, { position: 0, value: 100, interpolation: 'linear' })

      const cleanup = bindFieldToTimeline(op, 'val', field)

      expect(field.value).toBe(100)

      cleanup()
    })

    it('syncs to interpolated value when position is between keyframes', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(0)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)
      store.addKeyframe(fieldPath, { position: 0, value: 0, interpolation: 'linear' })
      store.addKeyframe(fieldPath, { position: 10, value: 100, interpolation: 'linear' })
      store.setPosition(5)

      const cleanup = bindFieldToTimeline(op, 'val', field)

      expect(field.value).toBeCloseTo(50, 0)

      cleanup()
    })

    it('leaves field value unchanged when track has no keyframes', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(42)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)

      const cleanup = bindFieldToTimeline(op, 'val', field)

      expect(field.value).toBe(42)

      cleanup()
    })
  })

  describe('scrubbing updates field value', () => {
    it('updates field as position changes', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(0)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)
      store.addKeyframe(fieldPath, { position: 0, value: 0, interpolation: 'linear' })
      store.addKeyframe(fieldPath, { position: 10, value: 100, interpolation: 'linear' })

      const cleanup = bindFieldToTimeline(op, 'val', field)

      store.setPosition(5)
      expect(field.value).toBeCloseTo(50, 0)

      store.setPosition(10)
      expect(field.value).toBe(100)

      cleanup()
    })

    it('does not update field when no keyframes exist', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(42)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)

      const cleanup = bindFieldToTimeline(op, 'val', field)

      store.setPosition(5)
      expect(field.value).toBe(42)

      cleanup()
    })
  })

  describe('auto-keyframe insertion on value change', () => {
    it('inserts keyframe when new value differs from interpolated', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(0)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)
      store.addKeyframe(fieldPath, { position: 0, value: 0, interpolation: 'linear' })

      const cleanup = bindFieldToTimeline(op, 'val', field)
      store.setPosition(5)

      // interpolated value at T=5 with one keyframe (value=0) is still 0
      // setting to 50 should create a new keyframe
      field.setValue(50)

      const track = store.getTrack(fieldPath)
      expect(track?.keyframes).toHaveLength(2)
      const newKf = track?.keyframes.find(kf => Math.abs(kf.position - 5) < 0.001)
      expect(newKf?.value).toBe(50)

      cleanup()
    })

    it('does not insert keyframe when new value matches interpolated', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(0)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)
      store.addKeyframe(fieldPath, { position: 0, value: 0, interpolation: 'linear' })

      const cleanup = bindFieldToTimeline(op, 'val', field)
      store.setPosition(5)

      // interpolated value at T=5 is 0 (only one keyframe) — setting same value is a no-op
      field.setValue(0)

      const track = store.getTrack(fieldPath)
      expect(track?.keyframes).toHaveLength(1)

      cleanup()
    })

    it('does not insert keyframe when track has no keyframes', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(0)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)

      const cleanup = bindFieldToTimeline(op, 'val', field)

      field.setValue(42)

      const track = store.getTrack(fieldPath)
      expect(track?.keyframes).toHaveLength(0)

      cleanup()
    })

    it('updates existing keyframe at current position instead of inserting', () => {
      const op = makeOp('/test-op')
      const field = new NumberField(0)
      const store = getTimelineStore()
      const fieldPath = 'test-op / val'

      store.getOrCreateTrack(fieldPath, 0)
      store.addKeyframe(fieldPath, { position: 0, value: 0, interpolation: 'linear' })
      store.addKeyframe(fieldPath, { position: 5, value: 50, interpolation: 'linear' })

      const cleanup = bindFieldToTimeline(op, 'val', field)
      store.setPosition(5)

      // at T=5 there IS a keyframe — changing value should update it, not add another
      field.setValue(75)

      const track = store.getTrack(fieldPath)
      expect(track?.keyframes).toHaveLength(2)
      const kfAt5 = track?.keyframes.find(kf => Math.abs(kf.position - 5) < 0.001)
      expect(kfAt5?.value).toBe(75)

      cleanup()
    })
  })
})

describe('cleanupRemovedOperators', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('does not clean up bindings for operators still in the current set', () => {
    const field = new NumberField(0)
    const op = makeOpWithInputs('/my-op', 'val', field)
    const store = getTimelineStore()
    const fieldPath = 'my-op / val'

    store.getOrCreateTrack(fieldPath, 0)
    store.addKeyframe(fieldPath, { position: 0, value: 0, interpolation: 'linear' })
    store.addKeyframe(fieldPath, { position: 10, value: 100, interpolation: 'linear' })

    const cleanup = bindOperatorToTimeline(op)

    // op is still active — should NOT be cleaned up
    cleanupRemovedOperators(new Set(['/my-op']))

    // binding should still work: scrubbing should update field
    store.setPosition(5)
    expect(field.value).toBeCloseTo(50, 0)

    cleanup()
  })

  it('cleans up bindings for operators removed from the graph', () => {
    const field = new NumberField(0)
    const op = makeOpWithInputs('/removed-op', 'val', field)
    const store = getTimelineStore()
    const fieldPath = 'removed-op / val'

    store.getOrCreateTrack(fieldPath, 0)
    store.addKeyframe(fieldPath, { position: 0, value: 0, interpolation: 'linear' })
    store.addKeyframe(fieldPath, { position: 10, value: 100, interpolation: 'linear' })

    bindOperatorToTimeline(op)

    // simulate operator being removed — pass empty set
    cleanupRemovedOperators(new Set())

    // binding is gone — reset field to verify scrubbing no longer updates it
    field.next(0)
    store.setPosition(5)
    expect(field.value).toBe(0) // not updated to 50
  })

  it('bindings survive a rebind cycle (simulates operators useEffect re-run)', () => {
    const field = new NumberField(0)
    const op = makeOpWithInputs('/my-op', 'val', field)
    const store = getTimelineStore()
    const fieldPath = 'my-op / val'

    store.getOrCreateTrack(fieldPath, 0)
    store.addKeyframe(fieldPath, { position: 0, value: 0, interpolation: 'linear' })
    store.addKeyframe(fieldPath, { position: 10, value: 100, interpolation: 'linear' })

    // First bind (simulates initial effect run)
    const cleanup1 = bindOperatorToTimeline(op)
    cleanupRemovedOperators(new Set(['/my-op']))

    // Simulate effect cleanup + re-run (e.g., user moved a node in the graph)
    cleanup1()
    const cleanup2 = bindOperatorToTimeline(op)
    cleanupRemovedOperators(new Set(['/my-op']))

    // Binding should still work after the rebind cycle
    store.setPosition(5)
    expect(field.value).toBeCloseTo(50, 0)

    cleanup2()
  })
})
