import { beforeEach, describe, expect, it } from 'vitest'
import { ColorRampOp, MapRangeOp, ScatterplotLayerOp } from './operators'

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
      const colorFn = result.color as Function
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

      const colorFn = result.color as Function
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

      const scaledFn = result.scaled as Function
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

      const scaledFn = result.scaled as Function
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
      const colorFn = colorRampResult.color as Function
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

      const colorFn = colorRampResult.color as Function

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
      const fillColorFn = layerConfig.layer.getFillColor as Function
      const getRadiusFn = layerConfig.layer.getRadius as Function

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

      const fillColorFn = layer.getFillColor as Function
      const positionFn = layer.getPosition as Function

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
})
