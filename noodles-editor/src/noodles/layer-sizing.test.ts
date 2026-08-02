import { describe, expect, it } from 'vitest'
import {
  ArcLayerOp,
  GreatCircleLayerOp,
  IconLayerOp,
  LineLayerOp,
  PathLayerOp,
  TripsLayerOp,
} from './operators'

// Helper to get all input values from an operator
function getInputProps(op: { inputs: Record<string, { value: unknown }> }) {
  const props: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(op.inputs)) {
    props[key] = field.value
  }
  return props
}

describe('Layer Sizing and Width Units', () => {
  describe('IconLayerOp', () => {
    it('should accept sizeBasis values: height and width', async () => {
      const iconLayer = new IconLayerOp('/test-icon')

      iconLayer.inputs.sizeBasis.setValue('height')
      let result = await iconLayer.execute(getInputProps(iconLayer))
      expect(result.layer.sizeBasis).toBe('height')

      iconLayer.inputs.sizeBasis.setValue('width')
      result = await iconLayer.execute(getInputProps(iconLayer))
      expect(result.layer.sizeBasis).toBe('width')
    })

    it('should accept sizeUnits values: pixels, meters, and common', async () => {
      const iconLayer = new IconLayerOp('/test-icon')

      iconLayer.inputs.sizeUnits.setValue('pixels')
      let result = await iconLayer.execute(getInputProps(iconLayer))
      expect(result.layer.sizeUnits).toBe('pixels')

      iconLayer.inputs.sizeUnits.setValue('meters')
      result = await iconLayer.execute(getInputProps(iconLayer))
      expect(result.layer.sizeUnits).toBe('meters')

      iconLayer.inputs.sizeUnits.setValue('common')
      result = await iconLayer.execute(getInputProps(iconLayer))
      expect(result.layer.sizeUnits).toBe('common')
    })

    it('should have correct default values', async () => {
      const iconLayer = new IconLayerOp('/test-icon')
      const result = await iconLayer.execute(getInputProps(iconLayer))

      expect(result.layer.sizeUnits).toBe('pixels')
      expect(result.layer.sizeBasis).toBe('height')
      expect(result.layer.sizeScale).toBe(1)
      expect(result.layer.sizeMinPixels).toBe(0)
      expect(result.layer.sizeMaxPixels).toBe(2048)
    })
  })

  describe('PathLayerOp', () => {
    it('should accept widthUnits values: pixels, meters, and common', async () => {
      const pathLayer = new PathLayerOp('/test-path')

      pathLayer.inputs.widthUnits.setValue('pixels')
      let result = await pathLayer.execute(getInputProps(pathLayer))
      expect(result.layer.widthUnits).toBe('pixels')

      pathLayer.inputs.widthUnits.setValue('meters')
      result = await pathLayer.execute(getInputProps(pathLayer))
      expect(result.layer.widthUnits).toBe('meters')

      pathLayer.inputs.widthUnits.setValue('common')
      result = await pathLayer.execute(getInputProps(pathLayer))
      expect(result.layer.widthUnits).toBe('common')
    })

    it('should have correct default values', async () => {
      const pathLayer = new PathLayerOp('/test-path')
      const result = await pathLayer.execute(getInputProps(pathLayer))

      expect(result.layer.widthUnits).toBe('meters')
      expect(result.layer.widthScale).toBe(20)
      expect(result.layer.widthMinPixels).toBe(2)
    })
  })

  describe('TripsLayerOp', () => {
    it('should accept widthUnits values: pixels, meters, and common', async () => {
      const tripsLayer = new TripsLayerOp('/test-trips')

      tripsLayer.inputs.widthUnits.setValue('pixels')
      let result = await tripsLayer.execute(getInputProps(tripsLayer))
      expect(result.layer.widthUnits).toBe('pixels')

      tripsLayer.inputs.widthUnits.setValue('meters')
      result = await tripsLayer.execute(getInputProps(tripsLayer))
      expect(result.layer.widthUnits).toBe('meters')

      tripsLayer.inputs.widthUnits.setValue('common')
      result = await tripsLayer.execute(getInputProps(tripsLayer))
      expect(result.layer.widthUnits).toBe('common')
    })

    it('should have correct default values', async () => {
      const tripsLayer = new TripsLayerOp('/test-trips')
      const result = await tripsLayer.execute(getInputProps(tripsLayer))

      expect(result.layer.widthUnits).toBe('meters')
      expect(result.layer.widthScale).toBe(20)
      expect(result.layer.widthMinPixels).toBe(2)
    })
  })

  describe('ArcLayerOp', () => {
    it('should accept widthUnits values: pixels, meters, and common', async () => {
      const arcLayer = new ArcLayerOp('/test-arc')

      arcLayer.inputs.widthUnits.setValue('pixels')
      let result = await arcLayer.execute(getInputProps(arcLayer))
      expect(result.layer.widthUnits).toBe('pixels')

      arcLayer.inputs.widthUnits.setValue('meters')
      result = await arcLayer.execute(getInputProps(arcLayer))
      expect(result.layer.widthUnits).toBe('meters')

      arcLayer.inputs.widthUnits.setValue('common')
      result = await arcLayer.execute(getInputProps(arcLayer))
      expect(result.layer.widthUnits).toBe('common')
    })

    it('should have correct default values', async () => {
      const arcLayer = new ArcLayerOp('/test-arc')
      const result = await arcLayer.execute(getInputProps(arcLayer))

      expect(result.layer.widthUnits).toBe('meters')
      // Note: ArcLayerOp doesn't have widthScale/widthMinPixels/widthMaxPixels
    })
  })

  describe('LineLayerOp', () => {
    it('should accept widthUnits values: pixels, meters, and common', async () => {
      const lineLayer = new LineLayerOp('/test-line')

      lineLayer.inputs.widthUnits.setValue('pixels')
      let result = await lineLayer.execute(getInputProps(lineLayer))
      expect(result.layer.widthUnits).toBe('pixels')

      lineLayer.inputs.widthUnits.setValue('meters')
      result = await lineLayer.execute(getInputProps(lineLayer))
      expect(result.layer.widthUnits).toBe('meters')

      lineLayer.inputs.widthUnits.setValue('common')
      result = await lineLayer.execute(getInputProps(lineLayer))
      expect(result.layer.widthUnits).toBe('common')
    })

    it('should have correct default values', async () => {
      const lineLayer = new LineLayerOp('/test-line')
      const result = await lineLayer.execute(getInputProps(lineLayer))

      expect(result.layer.widthUnits).toBe('pixels')
      expect(result.layer.widthScale).toBe(1)
      expect(result.layer.widthMinPixels).toBe(0)
      expect(result.layer.widthMaxPixels).toBe(100)
    })
  })

  describe('GreatCircleLayerOp', () => {
    it('should accept widthUnits values: pixels, meters, and common', async () => {
      const greatCircleLayer = new GreatCircleLayerOp('/test-great-circle')

      greatCircleLayer.inputs.widthUnits.setValue('pixels')
      let result = await greatCircleLayer.execute(getInputProps(greatCircleLayer))
      expect(result.layer.widthUnits).toBe('pixels')

      greatCircleLayer.inputs.widthUnits.setValue('meters')
      result = await greatCircleLayer.execute(getInputProps(greatCircleLayer))
      expect(result.layer.widthUnits).toBe('meters')

      greatCircleLayer.inputs.widthUnits.setValue('common')
      result = await greatCircleLayer.execute(getInputProps(greatCircleLayer))
      expect(result.layer.widthUnits).toBe('common')
    })

    it('should have correct default values', async () => {
      const greatCircleLayer = new GreatCircleLayerOp('/test-great-circle')
      const result = await greatCircleLayer.execute(getInputProps(greatCircleLayer))

      expect(result.layer.widthUnits).toBe('pixels')
      expect(result.layer.widthScale).toBe(1)
      expect(result.layer.widthMinPixels).toBe(0)
      expect(result.layer.widthMaxPixels).toBe(100)
    })
  })
})
