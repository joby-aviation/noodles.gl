import { describe, expect, it } from 'vitest'
import type { AttributeEnhancedData } from './fields'
import {
  BezierCurveOp,
  CategoricalColorRampOp,
  ColorRampOp,
  CombineRGBAOp,
  CombineXYOp,
  CombineXYZOp,
  ConcatOp,
  HSLOp,
  MapRangeOp,
  MathOp,
  MergeOp,
  RampOp,
  SplitRGBAOp,
  SplitXYOp,
  SplitXYZOp,
  SwitchOp,
} from './operators'

function makeAttrData(
  attributes: Record<string, { values: Float32Array | Uint8Array; size: number }>
): AttributeEnhancedData {
  const len = Object.values(attributes)[0]?.values.length / Object.values(attributes)[0]?.size ?? 0
  return {
    data: Array.from({ length: len }, (_, i) => ({ i })),
    attributes,
  }
}

describe('Attribute-first operators', () => {
  describe('MapRangeOp', () => {
    it('maps a uniform value', () => {
      const op = new MapRangeOp('/test')
      const result = op.execute({
        data: undefined,
        val: 0.5,
        inMin: 0,
        inMax: 1,
        outMin: 0,
        outMax: 100,
      })
      expect(result.scaled).toBe(50)
    })

    it('maps an attribute column', () => {
      const op = new MapRangeOp('/test')
      const data = makeAttrData({
        temperature: { values: new Float32Array([0, 0.5, 1]), size: 1 },
      })
      const result = op.execute({
        data,
        val: 'temperature' as any,
        inMin: 0,
        inMax: 1,
        outMin: 0,
        outMax: 100,
      })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.temperature
      expect(outAttr).toBeDefined()
      expect(outAttr!.values[0]).toBeCloseTo(0)
      expect(outAttr!.values[1]).toBeCloseTo(50)
      expect(outAttr!.values[2]).toBeCloseTo(100)
    })

    it('passes through data when val is uniform', () => {
      const op = new MapRangeOp('/test')
      const data = makeAttrData({ x: { values: new Float32Array([1]), size: 1 } })
      const result = op.execute({ data, val: 0.5, inMin: 0, inMax: 1, outMin: 0, outMax: 10 })
      expect(result.scaled).toBe(5)
    })
  })

  describe('MathOp', () => {
    it('adds two uniform values', () => {
      const op = new MathOp('/test')
      const result = op.execute({ data: undefined, operator: 'add', a: 3, b: 4 })
      expect(result.result).toBe(7)
    })

    it('multiplies an attribute column by a uniform scalar', () => {
      const op = new MathOp('/test')
      const data = makeAttrData({
        radius: { values: new Float32Array([1, 2, 3]), size: 1 },
      })
      const result = op.execute({ data, operator: 'multiply', a: 'radius' as any, b: 10 })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.radius
      expect(outAttr).toBeDefined()
      expect(outAttr!.values[0]).toBeCloseTo(10)
      expect(outAttr!.values[1]).toBeCloseTo(20)
      expect(outAttr!.values[2]).toBeCloseTo(30)
    })

    it('applies unary sqrt to an attribute column', () => {
      const op = new MathOp('/test')
      const data = makeAttrData({
        area: { values: new Float32Array([4, 9, 16]), size: 1 },
      })
      const result = op.execute({ data, operator: 'sqrt', a: 'area' as any, b: 0 })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.area
      expect(outAttr!.values[0]).toBeCloseTo(2)
      expect(outAttr!.values[1]).toBeCloseTo(3)
      expect(outAttr!.values[2]).toBeCloseTo(4)
    })

    it('adds two attribute columns element-wise', () => {
      const op = new MathOp('/test')
      const data = makeAttrData({
        x: { values: new Float32Array([1, 2, 3]), size: 1 },
        y: { values: new Float32Array([10, 20, 30]), size: 1 },
      })
      const result = op.execute({ data, operator: 'add', a: 'x' as any, b: 'y' as any })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.x
      expect(outAttr!.values[0]).toBeCloseTo(11)
      expect(outAttr!.values[1]).toBeCloseTo(22)
      expect(outAttr!.values[2]).toBeCloseTo(33)
    })
  })

  describe('ColorRampOp', () => {
    it('maps a uniform value to a color', () => {
      const op = new ColorRampOp('/test')
      const inputs = op.inputs
      const result = op.execute({
        data: undefined,
        outputAttribute: 'fillColor',
        colorRamp: inputs.colorRamp.value,
        colorScheme: 'viridis',
        value: 0.5,
      })
      expect(result.color).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it('maps an attribute column to RGBA colors', () => {
      const op = new ColorRampOp('/test')
      const inputs = op.inputs
      const data = makeAttrData({
        normalized: { values: new Float32Array([0, 0.5, 1]), size: 1 },
      })
      const result = op.execute({
        data,
        outputAttribute: 'fillColor',
        colorRamp: inputs.colorRamp.value,
        colorScheme: 'viridis',
        value: 'normalized' as any,
      })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.fillColor
      expect(outAttr).toBeDefined()
      expect(outAttr!.size).toBe(4)
      expect(outAttr!.values.length).toBe(12) // 3 items * 4 components
    })
  })

  describe('CombineXYZOp', () => {
    it('combines uniform values', () => {
      const op = new CombineXYZOp('/test')
      const result = op.execute({ data: undefined, x: 1, y: 2, z: 3 })
      expect(result.xyz).toEqual({ x: 1, y: 2, z: 3 })
    })

    it('combines attribute columns into a 3-component position attribute', () => {
      const op = new CombineXYZOp('/test')
      const data = makeAttrData({
        lng: { values: new Float32Array([-74, -122, -87]), size: 1 },
        lat: { values: new Float32Array([40, 37, 41]), size: 1 },
      })
      const result = op.execute({ data, x: 'lng' as any, y: 'lat' as any, z: 0 })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.position
      expect(outAttr).toBeDefined()
      expect(outAttr!.size).toBe(3)
      // First position: [-74, 40, 0]
      expect(outAttr!.values[0]).toBeCloseTo(-74)
      expect(outAttr!.values[1]).toBeCloseTo(40)
      expect(outAttr!.values[2]).toBeCloseTo(0)
      // Second position: [-122, 37, 0]
      expect(outAttr!.values[3]).toBeCloseTo(-122)
      expect(outAttr!.values[4]).toBeCloseTo(37)
      expect(outAttr!.values[5]).toBeCloseTo(0)
    })
  })

  describe('CombineXYOp', () => {
    it('combines attribute columns into a 2-component attribute', () => {
      const op = new CombineXYOp('/test')
      const data = makeAttrData({
        u: { values: new Float32Array([0.1, 0.5, 0.9]), size: 1 },
        v: { values: new Float32Array([0.2, 0.6, 0.8]), size: 1 },
      })
      const result = op.execute({ data, x: 'u' as any, y: 'v' as any })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.position
      expect(outAttr!.size).toBe(2)
      expect(outAttr!.values[0]).toBeCloseTo(0.1)
      expect(outAttr!.values[1]).toBeCloseTo(0.2)
    })
  })

  describe('SplitXYZOp', () => {
    it('splits a 3-component attribute into x, y, z attributes', () => {
      const op = new SplitXYZOp('/test')
      const data = makeAttrData({
        position: { values: new Float32Array([1, 2, 3, 4, 5, 6]), size: 3 },
      })
      const result = op.execute({ data, attribute: 'position', vec: { x: 0, y: 0, z: 0 } })
      const outData = result.data as AttributeEnhancedData
      expect(outData.attributes?.x.values).toEqual(new Float32Array([1, 4]))
      expect(outData.attributes?.y.values).toEqual(new Float32Array([2, 5]))
      expect(outData.attributes?.z.values).toEqual(new Float32Array([3, 6]))
    })

    it('falls back to static vec when no attribute', () => {
      const op = new SplitXYZOp('/test')
      const result = op.execute({ data: undefined, attribute: '', vec: { x: 10, y: 20, z: 30 } })
      expect(result.x).toBe(10)
      expect(result.y).toBe(20)
      expect(result.z).toBe(30)
    })
  })

  describe('SplitXYOp', () => {
    it('splits a 2-component attribute into x, y attributes', () => {
      const op = new SplitXYOp('/test')
      const data = makeAttrData({
        uv: { values: new Float32Array([0.1, 0.2, 0.3, 0.4]), size: 2 },
      })
      const result = op.execute({ data, attribute: 'uv', vec: { x: 0, y: 0 } })
      const outData = result.data as AttributeEnhancedData
      expect(outData.attributes?.x.values).toEqual(new Float32Array([0.1, 0.3]))
      expect(outData.attributes?.y.values).toEqual(new Float32Array([0.2, 0.4]))
    })
  })

  describe('CombineRGBAOp', () => {
    it('combines uniform values to a hex color', () => {
      const op = new CombineRGBAOp('/test')
      const result = op.execute({
        data: undefined,
        outputAttribute: 'fillColor',
        r: 255,
        g: 0,
        b: 0,
        a: 255,
      })
      expect(result.color).toBeDefined()
    })

    it('combines attribute channels into a 4-component color attribute', () => {
      const op = new CombineRGBAOp('/test')
      const data = makeAttrData({
        red: { values: new Float32Array([255, 0, 128]), size: 1 },
      })
      const result = op.execute({
        data,
        outputAttribute: 'fillColor',
        r: 'red' as any,
        g: 128,
        b: 0,
        a: 255,
      })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.fillColor
      expect(outAttr!.size).toBe(4)
      expect(outAttr!.values[0]).toBe(255) // r
      expect(outAttr!.values[1]).toBe(128) // g
      expect(outAttr!.values[2]).toBe(0) // b
      expect(outAttr!.values[3]).toBe(255) // a
    })
  })

  describe('SplitRGBAOp', () => {
    it('splits a 4-component color attribute into r, g, b, a', () => {
      const op = new SplitRGBAOp('/test')
      const data = makeAttrData({
        fillColor: { values: new Uint8Array([255, 128, 0, 200, 0, 255, 64, 255]), size: 4 },
      })
      const result = op.execute({ data, attribute: 'fillColor', color: '#000000' })
      const outData = result.data as AttributeEnhancedData
      expect(outData.attributes?.r.values).toEqual(new Float32Array([255, 0]))
      expect(outData.attributes?.g.values).toEqual(new Float32Array([128, 255]))
      expect(outData.attributes?.b.values).toEqual(new Float32Array([0, 64]))
      expect(outData.attributes?.a.values).toEqual(new Float32Array([200, 255]))
    })
  })

  describe('HSLOp', () => {
    it('produces a hex color from uniform values', () => {
      const op = new HSLOp('/test')
      const result = op.execute({
        data: undefined,
        outputAttribute: 'fillColor',
        h: 0,
        s: 1,
        l: 0.5,
      })
      expect(result.color).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it('produces a color attribute from h attribute column', () => {
      const op = new HSLOp('/test')
      const data = makeAttrData({
        hue: { values: new Float32Array([0, 120, 240]), size: 1 },
      })
      const result = op.execute({
        data,
        outputAttribute: 'fillColor',
        h: 'hue' as any,
        s: 1,
        l: 0.5,
      })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.fillColor
      expect(outAttr).toBeDefined()
      expect(outAttr!.size).toBe(4)
      expect(outAttr!.values.length).toBe(12) // 3 * 4
      // First color (h=0, red): r≈255
      expect(outAttr!.values[0]).toBeGreaterThan(200)
    })
  })

  describe('BezierCurveOp', () => {
    it('evaluates a uniform factor', () => {
      const op = new BezierCurveOp('/test')
      const result = op.execute({ data: undefined, factor: 0.5, curve: undefined })
      expect(typeof result.value).toBe('number')
    })

    it('evaluates an attribute column through the curve', () => {
      const op = new BezierCurveOp('/test')
      const data = makeAttrData({
        t: { values: new Float32Array([0, 0.25, 0.5, 0.75, 1]), size: 1 },
      })
      const result = op.execute({ data, factor: 't' as any, curve: undefined })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.t
      expect(outAttr).toBeDefined()
      expect(outAttr!.values.length).toBe(5)
      // Bezier curve should map [0,1] to [0,1] with some easing
      expect(outAttr!.values[0]).toBeCloseTo(0, 1)
      expect(outAttr!.values[4]).toBeCloseTo(1, 1)
    })
  })

  describe('CategoricalColorRampOp', () => {
    it('maps a static string value to a color', () => {
      const op = new CategoricalColorRampOp('/test')
      const result = op.execute({
        data: undefined,
        outputAttribute: 'fillColor',
        colorRamp: op.inputs.colorRamp.value,
        colorScheme: 'category10',
        value: 'categoryA',
      })
      expect(result.color).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it('maps a data column to a RGBA color attribute', () => {
      const op = new CategoricalColorRampOp('/test')
      const data: AttributeEnhancedData = {
        data: [{ type: 'bus' }, { type: 'train' }, { type: 'bus' }],
        attributes: {},
      }
      const result = op.execute({
        data,
        outputAttribute: 'fillColor',
        colorRamp: op.inputs.colorRamp.value,
        colorScheme: 'category10',
        value: 'type',
      })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.fillColor
      expect(outAttr).toBeDefined()
      expect(outAttr!.size).toBe(4)
      expect(outAttr!.values.length).toBe(12)
      // Same category should produce same color
      expect(outAttr!.values[0]).toBe(outAttr!.values[8]) // bus r == bus r
      expect(outAttr!.values[1]).toBe(outAttr!.values[9]) // bus g == bus g
    })
  })

  describe('RampOp', () => {
    it('maps a uniform position through the ramp', () => {
      const op = new RampOp('/test')
      const result = op.execute({ data: undefined, position: 0.5, stops: undefined })
      expect(typeof result.value).toBe('number')
      expect(result.value).toBeGreaterThanOrEqual(0)
      expect(result.value).toBeLessThanOrEqual(1)
    })

    it('maps an attribute column through the ramp', () => {
      const op = new RampOp('/test')
      const data = makeAttrData({
        t: { values: new Float32Array([0, 0.5, 1]), size: 1 },
      })
      const result = op.execute({ data, position: 't' as any, stops: undefined })
      const outAttr = (result.data as AttributeEnhancedData).attributes?.t
      expect(outAttr).toBeDefined()
      expect(outAttr!.values[0]).toBeCloseTo(0, 1)
      expect(outAttr!.values[2]).toBeCloseTo(1, 1)
    })

    it('uses custom stops', () => {
      const op = new RampOp('/test')
      const stops = [
        { pos: 0, val: 10, interp: 'linear' },
        { pos: 1, val: 20, interp: 'linear' },
      ]
      const result = op.execute({ data: undefined, position: 0.5, stops })
      expect(result.value).toBeCloseTo(15)
    })
  })

  describe('SwitchOp', () => {
    it('selects a value by index', () => {
      const op = new SwitchOp('/test')
      const result = op.execute({ values: ['a', 'b', 'c'], index: 1, blend: false })
      expect(result.value).toBe('b')
    })

    it('clamps out-of-bounds indices', () => {
      const op = new SwitchOp('/test')
      expect(op.execute({ values: ['a', 'b'], index: 5, blend: false }).value).toBe('b')
      expect(op.execute({ values: ['a', 'b'], index: -1, blend: false }).value).toBe('a')
    })

    it('blends between numeric values', () => {
      const op = new SwitchOp('/test')
      const result = op.execute({ values: [0, 100], index: 0.5, blend: true })
      expect(result.value).toBeCloseTo(50)
    })
  })

  describe('ConcatOp', () => {
    it('concatenates arrays', () => {
      const op = new ConcatOp('/test')
      const result = op.execute({
        values: [
          [1, 2],
          [3, 4],
        ],
        depth: 1,
      })
      expect(result.data).toEqual([1, 2, 3, 4])
    })

    it('respects depth parameter', () => {
      const op = new ConcatOp('/test')
      const result = op.execute({ values: [[[1, 2]], [[3, 4]]], depth: 2 })
      expect(result.data).toEqual([1, 2, 3, 4])
    })
  })

  describe('MergeOp', () => {
    it('merges objects', () => {
      const op = new MergeOp('/test')
      const result = op.execute({ objects: [{ a: 1 }, { b: 2 }, { c: 3 }] })
      expect(result.object).toEqual({ a: 1, b: 2, c: 3 })
    })

    it('later objects override earlier ones', () => {
      const op = new MergeOp('/test')
      const result = op.execute({ objects: [{ a: 1 }, { a: 2 }] })
      expect(result.object).toEqual({ a: 2 })
    })
  })
})
