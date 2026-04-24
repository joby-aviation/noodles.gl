import { Temporal } from 'temporal-polyfill'
import { beforeEach, describe, expect, it } from 'vitest'
import { ColorRampOp, MapRangeOp, ScatterplotLayerOp, SwitchOp } from './operators'

describe('Accessor Integration Tests', () => {
  describe('ColorRampOp with accessors', () => {
    let op: ColorRampOp

    beforeEach(() => {
      op = new ColorRampOp('/test/color-ramp')
      op.createListeners()
    })

    it('should handle static value input', () => {
      op.inputs.value.setValue(0.5)
      op.inputs.colorScheme.setValue('viridis')

      const result = op.execute(op.data)

      expect(typeof result.color).toBe('string')
      expect(result.color).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it('should handle accessor function input', () => {
      const accessor = (d: { value: number }) => d.value
      op.inputs.value.setValue(accessor)
      op.inputs.colorScheme.setValue('viridis')

      const result = op.execute(op.data)

      expect(typeof result.color).toBe('function')

      // Test the composed accessor
      const colorFn = result.color as (d: { value: number }) => string
      const color1 = colorFn({ value: 0.2 })
      const color2 = colorFn({ value: 0.8 })

      expect(color1).toMatch(/^#[0-9a-f]{6}$/i)
      expect(color2).toMatch(/^#[0-9a-f]{6}$/i)
      expect(color1).not.toBe(color2) // Different values should give different colors
    })

    it('should propagate accessor through color scale', () => {
      const countAccessor = (d: { count: number }) => d.count / 100 // normalize
      op.inputs.value.setValue(countAccessor)
      op.inputs.colorScheme.setValue('inferno')

      const result = op.execute(op.data)

      const colorFn = result.color as (d: { count: number }) => string
      expect(typeof colorFn).toBe('function')

      // Test with different data points
      const lowValueColor = colorFn({ count: 20 }) // 0.2
      const highValueColor = colorFn({ count: 80 }) // 0.8

      expect(lowValueColor).toMatch(/^#[0-9a-f]{6}$/i)
      expect(highValueColor).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })

  describe('MapRangeOp with accessors', () => {
    let op: MapRangeOp

    beforeEach(() => {
      op = new MapRangeOp('/test/map-range')
      op.createListeners()
    })

    it('should handle static value input', () => {
      op.inputs.val.setValue(50)
      op.inputs.inMin.setValue(0)
      op.inputs.inMax.setValue(100)
      op.inputs.outMin.setValue(0)
      op.inputs.outMax.setValue(1)

      const result = op.execute(op.data)

      expect(typeof result.scaled).toBe('number')
      expect(result.scaled).toBe(0.5)
    })

    it('should handle accessor function input', () => {
      const accessor = (d: { value: number }) => d.value
      op.inputs.val.setValue(accessor)
      op.inputs.inMin.setValue(0)
      op.inputs.inMax.setValue(100)
      op.inputs.outMin.setValue(0)
      op.inputs.outMax.setValue(10)

      const result = op.execute(op.data)

      expect(typeof result.scaled).toBe('function')

      const scaledFn = result.scaled as (d: { value: number }) => number
      expect(scaledFn({ value: 0 })).toBe(0)
      expect(scaledFn({ value: 50 })).toBe(5)
      expect(scaledFn({ value: 100 })).toBe(10)
    })

    it('should compose with dynamic range parameters', () => {
      const accessor = (d: { temperature: number }) => d.temperature
      op.inputs.val.setValue(accessor)
      op.inputs.inMin.setValue(-20)
      op.inputs.inMax.setValue(40)
      op.inputs.outMin.setValue(0)
      op.inputs.outMax.setValue(1)

      const result = op.execute(op.data)

      const scaledFn = result.scaled as (d: { temperature: number }) => number
      expect(scaledFn({ temperature: -20 })).toBeCloseTo(0)
      expect(scaledFn({ temperature: 10 })).toBeCloseTo(0.5)
      expect(scaledFn({ temperature: 40 })).toBeCloseTo(1)
    })
  })

  describe('Chained accessors: MapRange -> ColorRamp', () => {
    let mapRangeOp: MapRangeOp
    let colorRampOp: ColorRampOp

    beforeEach(() => {
      mapRangeOp = new MapRangeOp('/test/map-range')
      colorRampOp = new ColorRampOp('/test/color-ramp')
      mapRangeOp.createListeners()
      colorRampOp.createListeners()
    })

    it('should compose count -> normalize -> color', () => {
      // Step 1: MapRange normalizes count from 0-100 to 0-1
      const countAccessor = (d: { count: number }) => d.count
      mapRangeOp.inputs.val.setValue(countAccessor)
      mapRangeOp.inputs.inMin.setValue(0)
      mapRangeOp.inputs.inMax.setValue(100)
      mapRangeOp.inputs.outMin.setValue(0)
      mapRangeOp.inputs.outMax.setValue(1)

      const mapRangeResult = mapRangeOp.execute(mapRangeOp.data)

      expect(typeof mapRangeResult.scaled).toBe('function')

      // Step 2: ColorRamp takes normalized value and produces color
      colorRampOp.inputs.value.setValue(mapRangeResult.scaled)
      colorRampOp.inputs.colorScheme.setValue('viridis')

      const colorRampResult = colorRampOp.execute(colorRampOp.data)

      expect(typeof colorRampResult.color).toBe('function')

      // Step 3: Test the composed chain
      const colorFn = colorRampResult.color as (d: { count: number }) => string
      const color1 = colorFn({ count: 20 }) // 0.2 normalized
      const color2 = colorFn({ count: 80 }) // 0.8 normalized

      expect(color1).toMatch(/^#[0-9a-f]{6}$/i)
      expect(color2).toMatch(/^#[0-9a-f]{6}$/i)
      expect(color1).not.toBe(color2)
    })

    it('should handle multiple data points in sequence', () => {
      const accessor = (d: { value: number }) => d.value
      mapRangeOp.inputs.val.setValue(accessor)
      mapRangeOp.inputs.inMin.setValue(0)
      mapRangeOp.inputs.inMax.setValue(10)
      mapRangeOp.inputs.outMin.setValue(0)
      mapRangeOp.inputs.outMax.setValue(1)

      const mapRangeResult = mapRangeOp.execute(mapRangeOp.data)

      colorRampOp.inputs.value.setValue(mapRangeResult.scaled)
      colorRampOp.inputs.colorScheme.setValue('plasma')

      const colorRampResult = colorRampOp.execute(colorRampOp.data)

      const colorFn = colorRampResult.color as (d: { value: number }) => string

      // Process multiple data points
      const dataPoints = [{ value: 0 }, { value: 2.5 }, { value: 5 }, { value: 7.5 }, { value: 10 }]

      const colors = dataPoints.map(d => colorFn(d))

      // All should be valid hex colors
      colors.forEach(color => {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      })

      // Colors should be distinct
      const uniqueColors = new Set(colors)
      expect(uniqueColors.size).toBeGreaterThan(1)
    })
  })

  describe('ScatterplotLayerOp with accessor inputs', () => {
    let scatterplotOp: ScatterplotLayerOp
    let colorRampOp: ColorRampOp

    beforeEach(() => {
      scatterplotOp = new ScatterplotLayerOp('/test/scatterplot')
      colorRampOp = new ColorRampOp('/test/color-ramp')
      scatterplotOp.createListeners()
      colorRampOp.createListeners()
    })

    it('should accept composed accessor for getFillColor', () => {
      // Create color accessor
      const valueAccessor = (d: { value: number }) => d.value
      colorRampOp.inputs.value.setValue(valueAccessor)
      colorRampOp.inputs.colorScheme.setValue('viridis')

      const colorRampResult = colorRampOp.execute(colorRampOp.data)

      // Set it on the scatterplot layer
      scatterplotOp.inputs.getFillColor.setValue(colorRampResult.color)
      scatterplotOp.inputs.data.setValue([{ value: 0.5 }])

      const layerConfig = scatterplotOp.execute(scatterplotOp.data)

      // Layer should have the composed accessor
      expect(typeof layerConfig.layer.getFillColor).toBe('function')

      // Verify updateTriggers includes getFillColor (it's an accessor field)
      expect(layerConfig.layer.updateTriggers).toHaveProperty('getFillColor')
    })

    it('should handle multiple composed accessors', () => {
      // Create color accessor from ColorRampOp
      const colorValueAccessor = (d: { category: number }) => d.category
      colorRampOp.inputs.value.setValue(colorValueAccessor)
      colorRampOp.inputs.colorScheme.setValue('inferno')

      const colorRampResult = colorRampOp.execute(colorRampOp.data)

      // Create radius accessor from MapRangeOp
      const mapRangeOp = new MapRangeOp('/test/map-range')
      const sizeAccessor = (d: { size: number }) => d.size
      mapRangeOp.inputs.val.setValue(sizeAccessor)
      mapRangeOp.inputs.inMin.setValue(0)
      mapRangeOp.inputs.inMax.setValue(100)
      mapRangeOp.inputs.outMin.setValue(100)
      mapRangeOp.inputs.outMax.setValue(1000)

      const mapRangeResult = mapRangeOp.execute(mapRangeOp.data)

      // Set both on scatterplot
      scatterplotOp.inputs.getFillColor.setValue(colorRampResult.color)
      scatterplotOp.inputs.getRadius.setValue(mapRangeResult.scaled)
      scatterplotOp.inputs.data.setValue([
        { category: 0.2, size: 50 },
        { category: 0.8, size: 75 },
      ])

      const layerConfig = scatterplotOp.execute(scatterplotOp.data)

      // Both should be functions (composed accessors)
      expect(typeof layerConfig.layer.getFillColor).toBe('function')
      expect(typeof layerConfig.layer.getRadius).toBe('function')

      // Test composed accessors work correctly
      const fillColorFn = layerConfig.layer.getFillColor as (d: {
        category: number
        size: number
      }) => string
      const getRadiusFn = layerConfig.layer.getRadius as (d: {
        category: number
        size: number
      }) => number

      const dataPoint1 = { category: 0.2, size: 50 }
      const dataPoint2 = { category: 0.8, size: 100 }

      // Colors come back as arrays [r,g,b,a] because of hexToColor transform
      const color1 = fillColorFn(dataPoint1)
      const color2 = fillColorFn(dataPoint2)
      expect(Array.isArray(color1)).toBe(true)
      expect(Array.isArray(color2)).toBe(true)
      expect(color1.length).toBe(4)
      expect(color2.length).toBe(4)

      expect(getRadiusFn(dataPoint1)).toBe(550) // (50/100) * 900 + 100
      expect(getRadiusFn(dataPoint2)).toBe(1000) // (100/100) * 900 + 100
    })
  })

  describe('Real-world viral accessor scenario', () => {
    it('should handle: data.count -> MapRange -> ColorRamp -> ScatterplotLayer.getFillColor', () => {
      // Setup: count accessor
      const countAccessor = (d: { count: number; id: number }) => d.count

      // Step 1: MapRange (normalize 0-200 to 0-1)
      const mapRange = new MapRangeOp('/map-range')
      mapRange.inputs.val.setValue(countAccessor)
      mapRange.inputs.inMin.setValue(0)
      mapRange.inputs.inMax.setValue(200)
      mapRange.inputs.outMin.setValue(0)
      mapRange.inputs.outMax.setValue(1)

      const { scaled } = mapRange.execute(mapRange.data)

      // Step 2: ColorRamp (map 0-1 to color)
      const colorRamp = new ColorRampOp('/color-ramp')
      colorRamp.inputs.value.setValue(scaled)
      colorRamp.inputs.colorScheme.setValue('plasma')

      const { color } = colorRamp.execute(colorRamp.data)

      // Step 3: ScatterplotLayer
      const scatterplot = new ScatterplotLayerOp('/scatterplot')
      scatterplot.inputs.getFillColor.setValue(color)
      scatterplot.inputs.getPosition.setValue((d: { id: number }) => [d.id, d.id, 0])
      scatterplot.inputs.data.setValue([
        { count: 50, id: 1 },
        { count: 100, id: 2 },
        { count: 150, id: 3 },
      ])

      const { layer } = scatterplot.execute(scatterplot.data)

      // Verify the entire chain works
      expect(typeof layer.getFillColor).toBe('function')
      expect(typeof layer.getPosition).toBe('function')

      const fillColorFn = layer.getFillColor as (d: { count: number; id: number }) => string
      const positionFn = layer.getPosition as (d: { count: number; id: number }) => [number, number]

      // Test with actual data points
      const low = { count: 50, id: 1 }
      const mid = { count: 100, id: 2 }
      const high = { count: 150, id: 3 }

      const lowColor = fillColorFn(low)
      const midColor = fillColorFn(mid)
      const highColor = fillColorFn(high)

      // All colors should be valid arrays (hexToColor transform)
      expect(Array.isArray(lowColor)).toBe(true)
      expect(Array.isArray(midColor)).toBe(true)
      expect(Array.isArray(highColor)).toBe(true)

      // Colors should differ (plasma is gradient)
      expect(JSON.stringify(lowColor)).not.toBe(JSON.stringify(midColor))

      // Positions should work
      expect(positionFn(low)).toEqual([1, 1, 0])
      expect(positionFn(mid)).toEqual([2, 2, 0])
      expect(positionFn(high)).toEqual([3, 3, 0])
    })
  })

  describe('SwitchOp with accessors', () => {
    let op: SwitchOp

    beforeEach(() => {
      op = new SwitchOp('/test/switch')
      op.createListeners()
    })

    it('should handle static index without blend', () => {
      op.inputs.values.setValue(['red', 'green', 'blue'])
      op.inputs.index.setValue(1)
      op.inputs.blend.setValue(false)

      const result = op.execute(op.data)
      expect(result.value).toBe('green')
    })

    it('should handle static index with blend', () => {
      op.inputs.values.setValue([0, 100, 200])
      op.inputs.index.setValue(1.5)
      op.inputs.blend.setValue(true)

      const result = op.execute(op.data)
      expect(result.value).toBe(150)
    })

    it('should handle accessor index without blend', () => {
      const indexAccessor = (d: { category: number }) => d.category
      op.inputs.values.setValue(['red', 'green', 'blue'])
      op.inputs.index.setValue(indexAccessor)
      op.inputs.blend.setValue(false)

      const result = op.execute(op.data)
      expect(typeof result.value).toBe('function')

      const valueFn = result.value as (d: { category: number }) => string
      expect(valueFn({ category: 0 })).toBe('red')
      expect(valueFn({ category: 1 })).toBe('green')
      expect(valueFn({ category: 2 })).toBe('blue')
    })

    it('should handle accessor index with blend', () => {
      const indexAccessor = (d: { progress: number }) => d.progress
      op.inputs.values.setValue([0, 100, 200])
      op.inputs.index.setValue(indexAccessor)
      op.inputs.blend.setValue(true)

      const result = op.execute(op.data)
      expect(typeof result.value).toBe('function')

      const valueFn = result.value as (d: { progress: number }) => number
      expect(valueFn({ progress: 0 })).toBe(0)
      expect(valueFn({ progress: 1 })).toBe(100)
      expect(valueFn({ progress: 1.5 })).toBe(150)
      expect(valueFn({ progress: 2 })).toBe(200)
    })

    it('should handle empty values array', () => {
      const indexAccessor = (d: { idx: number }) => d.idx
      op.inputs.values.setValue([])
      op.inputs.index.setValue(indexAccessor)
      op.inputs.blend.setValue(false)

      const result = op.execute(op.data)
      const valueFn = result.value as (d: { idx: number }) => unknown
      expect(valueFn({ idx: 0 })).toBeUndefined()
    })

    it('should clamp negative indices to 0', () => {
      const indexAccessor = (d: { idx: number }) => d.idx
      op.inputs.values.setValue(['first', 'second', 'third'])
      op.inputs.index.setValue(indexAccessor)
      op.inputs.blend.setValue(false)

      const result = op.execute(op.data)
      const valueFn = result.value as (d: { idx: number }) => string
      expect(valueFn({ idx: -1 })).toBe('first')
      expect(valueFn({ idx: -10 })).toBe('first')
    })

    it('should clamp indices beyond bounds', () => {
      const indexAccessor = (d: { idx: number }) => d.idx
      op.inputs.values.setValue(['first', 'second', 'third'])
      op.inputs.index.setValue(indexAccessor)
      op.inputs.blend.setValue(false)

      const result = op.execute(op.data)
      const valueFn = result.value as (d: { idx: number }) => string
      expect(valueFn({ idx: 5 })).toBe('third')
      expect(valueFn({ idx: 100 })).toBe('third')
    })

    it('should handle single value array', () => {
      const indexAccessor = (d: { idx: number }) => d.idx
      op.inputs.values.setValue(['only'])
      op.inputs.index.setValue(indexAccessor)
      op.inputs.blend.setValue(true)

      const result = op.execute(op.data)
      const valueFn = result.value as (d: { idx: number }) => string
      expect(valueFn({ idx: 0 })).toBe('only')
      expect(valueFn({ idx: 5 })).toBe('only')
    })

    it('should interpolate Temporal objects with accessor', () => {
      const indexAccessor = (d: { progress: number }) => d.progress
      const start = Temporal.Instant.from('2024-01-01T00:00:00Z')
      const end = Temporal.Instant.from('2024-01-02T00:00:00Z')

      op.inputs.values.setValue([start, end])
      op.inputs.index.setValue(indexAccessor)
      op.inputs.blend.setValue(true)

      const result = op.execute(op.data)
      const valueFn = result.value as (d: { progress: number }) => typeof start
      const midpoint = valueFn({ progress: 0.5 })

      expect(midpoint).toBeInstanceOf(Temporal.Instant)
      expect(midpoint.toString()).toBe('2024-01-01T12:00:00Z')
    })

    it('should chain with MapRangeOp', () => {
      // MapRange: normalize 0-100 to 0-2 (for selecting from 3 values)
      const mapRange = new MapRangeOp('/test/map-range')
      mapRange.createListeners()
      const countAccessor = (d: { count: number }) => d.count
      mapRange.inputs.val.setValue(countAccessor)
      mapRange.inputs.inMin.setValue(0)
      mapRange.inputs.inMax.setValue(100)
      mapRange.inputs.outMin.setValue(0)
      mapRange.inputs.outMax.setValue(2)

      const { scaled } = mapRange.execute(mapRange.data)

      // Switch: select color based on normalized value
      op.inputs.values.setValue(['red', 'yellow', 'green'])
      op.inputs.index.setValue(scaled)
      op.inputs.blend.setValue(false)

      const result = op.execute(op.data)
      const colorFn = result.value as (d: { count: number }) => string

      expect(colorFn({ count: 0 })).toBe('red')
      expect(colorFn({ count: 50 })).toBe('yellow')
      expect(colorFn({ count: 100 })).toBe('green')
    })

    it('should work with deck.gl ScatterplotLayer', () => {
      const categoryAccessor = (d: { category: number }) => d.category
      op.inputs.values.setValue(['#ff0000', '#00ff00', '#0000ff'])
      op.inputs.index.setValue(categoryAccessor)
      op.inputs.blend.setValue(false)

      const { value: colorAccessor } = op.execute(op.data)

      const scatterplot = new ScatterplotLayerOp('/test/scatterplot')
      scatterplot.createListeners()
      scatterplot.inputs.data.setValue([
        { category: 0, pos: [0, 0] },
        { category: 1, pos: [1, 1] },
        { category: 2, pos: [2, 2] },
      ])
      scatterplot.inputs.getFillColor.setValue(colorAccessor)
      scatterplot.inputs.getPosition.setValue((d: { pos: number[] }) => d.pos)

      const { layer } = scatterplot.execute(scatterplot.data)

      expect(typeof layer.getFillColor).toBe('function')

      // Test that the accessor works correctly with actual data
      const fillColorFn = layer.getFillColor as (d: { category: number; pos: number[] }) => number[]
      expect(fillColorFn({ category: 0, pos: [0, 0] })).toEqual([255, 0, 0, 255])
      expect(fillColorFn({ category: 1, pos: [1, 1] })).toEqual([0, 255, 0, 255])
      expect(fillColorFn({ category: 2, pos: [2, 2] })).toEqual([0, 0, 255, 255])
    })
  })
})
