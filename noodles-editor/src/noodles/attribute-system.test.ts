import { tableFromArrays } from 'apache-arrow'
import { beforeEach, describe, expect, it } from 'vitest'
import { ArcLayerOp, CreateAttributeOp, IconLayerOp, ScatterplotLayerOp } from './operators'

describe('Attribute System', () => {
  describe('CreateAttributeOp', () => {
    let op: CreateAttributeOp

    beforeEach(() => {
      op = new CreateAttributeOp('/test/create-attr')
      op.createListeners()
    })

    it('should create attribute from column reference', () => {
      const data = [
        { x: 1, y: 2, value: 10 },
        { x: 3, y: 4, value: 20 },
        { x: 5, y: 6, value: 30 },
      ]

      op.inputs.data.setValue(data)
      op.inputs.name.setValue('myValue')
      op.inputs.source.setValue('column')
      op.inputs.column.setValue('value')
      op.inputs.size.setValue(1)

      const result = op.execute(op.data)

      expect(result.data).toHaveProperty('data')
      expect(result.data).toHaveProperty('attributes')
      expect(result.data.attributes).toHaveProperty('myValue')
      expect(result.data.attributes.myValue.values).toBeInstanceOf(Float32Array)
      expect(Array.from(result.data.attributes.myValue.values)).toEqual([10, 20, 30])
      expect(result.data.attributes.myValue.size).toBe(1)
    })

    it('should create attribute from expression', () => {
      const data = [
        { value: 5 },
        { value: 10 },
        { value: 15 },
      ]

      op.inputs.data.setValue(data)
      op.inputs.name.setValue('doubled')
      op.inputs.source.setValue('expression')
      op.inputs.expression.setValue('d.value * 2')
      op.inputs.size.setValue(1)

      const result = op.execute(op.data)

      expect(result.data.attributes.doubled.values).toBeInstanceOf(Float32Array)
      expect(Array.from(result.data.attributes.doubled.values)).toEqual([10, 20, 30])
    })

    it('should create multi-component attribute from array expression', () => {
      const data = [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]

      op.inputs.data.setValue(data)
      op.inputs.name.setValue('position')
      op.inputs.source.setValue('expression')
      op.inputs.expression.setValue('[d.x, d.y, 0]')
      op.inputs.size.setValue(3)

      const result = op.execute(op.data)

      expect(result.data.attributes.position.values).toBeInstanceOf(Float32Array)
      expect(Array.from(result.data.attributes.position.values)).toEqual([1, 2, 0, 3, 4, 0])
      expect(result.data.attributes.position.size).toBe(3)
    })

    it('should create uint8 attribute for colors', () => {
      const data = [
        { r: 255, g: 0, b: 0 },
        { r: 0, g: 255, b: 0 },
      ]

      op.inputs.data.setValue(data)
      op.inputs.name.setValue('color')
      op.inputs.source.setValue('expression')
      op.inputs.expression.setValue('[d.r, d.g, d.b, 255]')
      op.inputs.type.setValue('uint8')
      op.inputs.size.setValue(4)

      const result = op.execute(op.data)

      expect(result.data.attributes.color.values).toBeInstanceOf(Uint8Array)
      expect(Array.from(result.data.attributes.color.values)).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
    })

    it('should extract column from Arrow table', () => {
      const table = tableFromArrays({
        lat: [40.7, 34.0, 51.5],
        lng: [-74.0, -118.2, -0.1],
        value: [100, 200, 300],
      })

      op.inputs.data.setValue(table)
      op.inputs.name.setValue('metric')
      op.inputs.source.setValue('column')
      op.inputs.column.setValue('value')
      op.inputs.size.setValue(1)

      const result = op.execute(op.data)

      expect(result.data.attributes.metric.values).toBeInstanceOf(Float32Array)
      expect(Array.from(result.data.attributes.metric.values)).toEqual([100, 200, 300])
    })

    it('should extract nested column from Arrow table', () => {
      const table = tableFromArrays({
        coords: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      })

      op.inputs.data.setValue(table)
      op.inputs.name.setValue('xCoord')
      op.inputs.source.setValue('column')
      op.inputs.column.setValue('coords.x')
      op.inputs.size.setValue(1)

      const result = op.execute(op.data)

      expect(Array.from(result.data.attributes.xCoord.values)).toEqual([1, 3])
    })

    it('should chain multiple attribute operations', () => {
      const data = [
        { lat: 40.7, lng: -74.0, value: 100 },
        { lat: 34.0, lng: -118.2, value: 200 },
      ]

      const op1 = new CreateAttributeOp('/test/attr1')
      op1.createListeners()
      op1.inputs.data.setValue(data)
      op1.inputs.name.setValue('position')
      op1.inputs.source.setValue('expression')
      op1.inputs.expression.setValue('[d.lng, d.lat, 0]')
      op1.inputs.size.setValue(3)

      const result1 = op1.execute(op1.data)

      const op2 = new CreateAttributeOp('/test/attr2')
      op2.createListeners()
      op2.inputs.data.setValue(result1.data)
      op2.inputs.name.setValue('radius')
      op2.inputs.source.setValue('expression')
      op2.inputs.expression.setValue('d.value / 10')
      op2.inputs.size.setValue(1)

      const result2 = op2.execute(op2.data)

      expect(result2.data.attributes).toHaveProperty('position')
      expect(result2.data.attributes).toHaveProperty('radius')
      expect(Array.from(result2.data.attributes.radius.values)).toEqual([10, 20])
    })
  })

  describe('ScatterplotLayerOp with attributes', () => {
    let layerOp: ScatterplotLayerOp
    let attrOp: CreateAttributeOp

    beforeEach(() => {
      layerOp = new ScatterplotLayerOp('/test/layer')
      layerOp.createListeners()

      attrOp = new CreateAttributeOp('/test/attr')
      attrOp.createListeners()
    })

    it('should use binary attributes when available', () => {
      const data = [
        { lng: -74.0, lat: 40.7, radius: 50 },
        { lng: -118.2, lat: 34.0, radius: 100 },
      ]

      attrOp.inputs.data.setValue(data)
      attrOp.inputs.name.setValue('position')
      attrOp.inputs.source.setValue('expression')
      attrOp.inputs.expression.setValue('[d.lng, d.lat, 0]')
      attrOp.inputs.size.setValue(3)

      const attrResult = attrOp.execute(attrOp.data)

      layerOp.inputs.data.setValue(attrResult.data)

      const layerResult = layerOp.execute(layerOp.data)

      expect(layerResult.layer.data).toHaveLength(2)
      expect(layerResult.layer.getPosition).toHaveProperty('values')
      expect(layerResult.layer.getPosition).toHaveProperty('size')
      expect(layerResult.layer.getPosition.size).toBe(3)

      const posValues = Array.from(layerResult.layer.getPosition.values)
      expect(posValues).toHaveLength(6)
      expect(posValues[0]).toBeCloseTo(-74.0, 5)
      expect(posValues[1]).toBeCloseTo(40.7, 5)
      expect(posValues[2]).toBe(0)
      expect(posValues[3]).toBeCloseTo(-118.2, 5)
      expect(posValues[4]).toBeCloseTo(34.0, 5)
      expect(posValues[5]).toBe(0)
    })

    it('should fall back to accessor functions when no attributes', () => {
      const data = [
        { lng: -74.0, lat: 40.7 },
        { lng: -118.2, lat: 34.0 },
      ]

      layerOp.inputs.data.setValue(data)
      layerOp.inputs.getPosition.setValue([0, 0, 0])

      const layerResult = layerOp.execute(layerOp.data)

      expect(layerResult.layer.data).toEqual(data)
      expect(Array.isArray(layerResult.layer.getPosition)).toBe(true)
    })

    it('should handle multiple attributes on same layer', () => {
      const data = [
        { lng: -74.0, lat: 40.7, size: 10, r: 255, g: 0, b: 0 },
        { lng: -118.2, lat: 34.0, size: 20, r: 0, g: 255, b: 0 },
      ]

      let enrichedData = data

      const posOp = new CreateAttributeOp('/test/pos')
      posOp.createListeners()
      posOp.inputs.data.setValue(enrichedData)
      posOp.inputs.name.setValue('position')
      posOp.inputs.source.setValue('expression')
      posOp.inputs.expression.setValue('[d.lng, d.lat, 0]')
      posOp.inputs.size.setValue(3)
      enrichedData = posOp.execute(posOp.data).data

      const radiusOp = new CreateAttributeOp('/test/radius')
      radiusOp.createListeners()
      radiusOp.inputs.data.setValue(enrichedData)
      radiusOp.inputs.name.setValue('radius')
      radiusOp.inputs.source.setValue('column')
      radiusOp.inputs.column.setValue('size')
      radiusOp.inputs.size.setValue(1)
      enrichedData = radiusOp.execute(radiusOp.data).data

      const colorOp = new CreateAttributeOp('/test/color')
      colorOp.createListeners()
      colorOp.inputs.data.setValue(enrichedData)
      colorOp.inputs.name.setValue('fillColor')
      colorOp.inputs.source.setValue('expression')
      colorOp.inputs.expression.setValue('[d.r, d.g, d.b, 255]')
      colorOp.inputs.type.setValue('uint8')
      colorOp.inputs.size.setValue(4)
      enrichedData = colorOp.execute(colorOp.data).data

      layerOp.inputs.data.setValue(enrichedData)
      const layerResult = layerOp.execute(layerOp.data)

      expect(layerResult.layer.getPosition).toHaveProperty('values')
      expect(layerResult.layer.getRadius).toHaveProperty('values')
      expect(layerResult.layer.getFillColor).toHaveProperty('values')

      expect(Array.from(layerResult.layer.getRadius.values)).toEqual([10, 20])
      expect(Array.from(layerResult.layer.getFillColor.values)).toEqual([
        255,
        0,
        0,
        255,
        0,
        255,
        0,
        255,
      ])
    })

    it('should use binary attributes with ArcLayerOp', () => {
      const data = [
        { startLng: -74.006, startLat: 40.7128, endLng: -0.1278, endLat: 51.5074, width: 5 },
        { startLng: 2.3522, startLat: 48.8566, endLng: 139.6917, endLat: 35.6895, width: 10 },
      ]

      let enrichedData = data

      const sourceOp = new CreateAttributeOp('/test/source')
      sourceOp.createListeners()
      sourceOp.inputs.data.setValue(enrichedData)
      sourceOp.inputs.name.setValue('sourcePosition')
      sourceOp.inputs.source.setValue('expression')
      sourceOp.inputs.expression.setValue('[d.startLng, d.startLat, 0]')
      sourceOp.inputs.size.setValue(3)
      enrichedData = sourceOp.execute(sourceOp.data).data

      const targetOp = new CreateAttributeOp('/test/target')
      targetOp.createListeners()
      targetOp.inputs.data.setValue(enrichedData)
      targetOp.inputs.name.setValue('targetPosition')
      targetOp.inputs.source.setValue('expression')
      targetOp.inputs.expression.setValue('[d.endLng, d.endLat, 0]')
      targetOp.inputs.size.setValue(3)
      enrichedData = targetOp.execute(targetOp.data).data

      const widthOp = new CreateAttributeOp('/test/width')
      widthOp.createListeners()
      widthOp.inputs.data.setValue(enrichedData)
      widthOp.inputs.name.setValue('width')
      widthOp.inputs.source.setValue('column')
      widthOp.inputs.column.setValue('width')
      widthOp.inputs.size.setValue(1)
      enrichedData = widthOp.execute(widthOp.data).data

      const layerOp = new ArcLayerOp('/test/layer')
      layerOp.createListeners()
      layerOp.inputs.data.setValue(enrichedData)

      const layerResult = layerOp.execute(layerOp.data)

      expect(layerResult.layer.getSourcePosition).toHaveProperty('values')
      expect(layerResult.layer.getTargetPosition).toHaveProperty('values')
      expect(layerResult.layer.getWidth).toHaveProperty('values')

      expect(Array.from(layerResult.layer.getWidth.values)).toEqual([5, 10])
    })

    it('should use binary attributes with IconLayerOp', async () => {
      const data = [
        { lng: -74.006, lat: 40.7128, size: 24, angle: 45 },
        { lng: 2.3522, lat: 48.8566, size: 32, angle: 90 },
      ]

      let enrichedData = data

      const posOp = new CreateAttributeOp('/test/pos')
      posOp.createListeners()
      posOp.inputs.data.setValue(enrichedData)
      posOp.inputs.name.setValue('position')
      posOp.inputs.source.setValue('expression')
      posOp.inputs.expression.setValue('[d.lng, d.lat, 0]')
      posOp.inputs.size.setValue(3)
      enrichedData = posOp.execute(posOp.data).data

      const sizeOp = new CreateAttributeOp('/test/size')
      sizeOp.createListeners()
      sizeOp.inputs.data.setValue(enrichedData)
      sizeOp.inputs.name.setValue('size')
      sizeOp.inputs.source.setValue('column')
      sizeOp.inputs.column.setValue('size')
      sizeOp.inputs.size.setValue(1)
      enrichedData = sizeOp.execute(sizeOp.data).data

      const angleOp = new CreateAttributeOp('/test/angle')
      angleOp.createListeners()
      angleOp.inputs.data.setValue(enrichedData)
      angleOp.inputs.name.setValue('angle')
      angleOp.inputs.source.setValue('column')
      angleOp.inputs.column.setValue('angle')
      angleOp.inputs.size.setValue(1)
      enrichedData = angleOp.execute(angleOp.data).data

      const layerOp = new IconLayerOp('/test/layer')
      layerOp.createListeners()
      layerOp.inputs.data.setValue(enrichedData)

      const layerResult = await layerOp.execute(layerOp.data)

      expect(layerResult.layer.getPosition).toHaveProperty('values')
      expect(layerResult.layer.getSize).toHaveProperty('values')
      expect(layerResult.layer.getAngle).toHaveProperty('values')

      expect(Array.from(layerResult.layer.getSize.values)).toEqual([24, 32])
      expect(Array.from(layerResult.layer.getAngle.values)).toEqual([45, 90])
    })
  })
})
