import { describe, expect, it } from 'vitest'
import type { AttributeEnhancedData } from './fields'
import { ArcLayerOp, CreateAttributeOp, ScatterplotLayerOp } from './operators'

/**
 * Test suite for layer attribute reference handling
 *
 * Tests the critical path where CreateAttributeOp creates binary attributes
 * and layer operators (ScatterplotLayerOp, ArcLayerOp) consume them via
 * attribute references in the {attributeName: "..."} format.
 *
 * This area has had multiple regressions, so these tests are comprehensive.
 */

function makeTestData(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    pickup_longitude: -74 + i * 0.01,
    pickup_latitude: 40 + i * 0.01,
    dropoff_longitude: -73 + i * 0.01,
    dropoff_latitude: 41 + i * 0.01,
  }))
}

describe('Layer attribute references', () => {
  describe('CreateAttributeOp -> ScatterplotLayerOp', () => {
    it('creates position attribute and layer consumes it via {attributeName: "..."}', () => {
      // Step 1: CreateAttributeOp creates a position attribute
      const createAttr = new CreateAttributeOp('/create-pos')
      const inputData = makeTestData(100)
      const attrOutput = createAttr.execute({
        data: inputData,
        name: 'sourcePosition',
        expression: '[d.pickup_longitude, d.pickup_latitude, 0]',
        size: 3,
        type: 'float',
      })

      // Verify attribute was created
      expect(attrOutput.data).toBeDefined()
      const attrData = attrOutput.data as AttributeEnhancedData
      expect(attrData.data).toHaveLength(100)
      expect(attrData.attributes).toBeDefined()
      expect(attrData.attributes?.sourcePosition).toBeDefined()
      expect(attrData.attributes?.sourcePosition.size).toBe(3)
      expect(attrData.attributes?.sourcePosition.values).toBeInstanceOf(Float32Array)

      // Step 2: ScatterplotLayerOp consumes it via {attributeName: "sourcePosition"}
      const layer = new ScatterplotLayerOp('/layer')
      const layerOutput = layer.execute({
        data: attrData,
        visible: true,
        opacity: 1,
        stroked: false,
        billboard: false,
        getPosition: { attributeName: 'sourcePosition' } as any,
        getFillColor: [255, 0, 0, 255],
        getLineColor: [255, 255, 255, 255],
        getRadius: 10,
        getLineWidth: 0,
        radiusScale: 1,
        radiusUnits: 'pixels',
        parameters: {},
        extensions: [],
      })

      // Verify layer props
      expect(layerOutput.layer).toBeDefined()
      expect(layerOutput.layer.type).toBe('ScatterplotLayer')
      expect(layerOutput.layer.data).toBeDefined()
      expect((layerOutput.layer.data as any).length).toBe(100)

      // Verify attribute was renamed to 'position' and is in data.attributes
      const layerData = layerOutput.layer.data as any
      expect(layerData.attributes).toBeDefined()
      expect(layerData.attributes.getPosition).toBeDefined()
      expect(layerData.attributes.getPosition.value).toBeInstanceOf(Float32Array)
      expect(layerData.attributes.getPosition.size).toBe(3)

      // Verify no getPosition prop (should be removed since it's an attribute reference)
      expect(layerOutput.layer.getPosition).toBeUndefined()
    })

    it('handles filled: true property for visible circles', () => {
      const createAttr = new CreateAttributeOp('/create-pos')
      const attrOutput = createAttr.execute({
        data: makeTestData(10),
        name: 'position',
        expression: '[d.pickup_longitude, d.pickup_latitude, 0]',
        size: 3,
        type: 'float',
      })

      const layer = new ScatterplotLayerOp('/layer')
      const layerOutput = layer.execute({
        data: attrOutput.data as AttributeEnhancedData,
        visible: true,
        opacity: 0.8,
        stroked: true,
        billboard: false,
        getPosition: { attributeName: 'position' } as any,
        getFillColor: [255, 0, 0, 255],
        getLineColor: [255, 255, 255, 255],
        getRadius: 10,
        getLineWidth: 1,
        radiusScale: 1,
        radiusUnits: 'pixels',
        parameters: {},
        extensions: [],
      })

      expect(layerOutput.layer.visible).toBe(true)
      expect(layerOutput.layer.opacity).toBe(0.8)
    })

    it('works with default position when no attribute reference provided', () => {
      const data: AttributeEnhancedData = {
        data: makeTestData(10),
        attributes: {},
      }

      const layer = new ScatterplotLayerOp('/layer')
      const layerOutput = layer.execute({
        data,
        visible: true,
        opacity: 1,
        stroked: false,
        billboard: false,
        getPosition: [0, 0, 0] as any, // Default static position
        getFillColor: [255, 0, 0, 255],
        getLineColor: [255, 255, 255, 255],
        getRadius: 10,
        getLineWidth: 0,
        radiusScale: 1,
        radiusUnits: 'pixels',
        parameters: {},
        extensions: [],
      })

      expect(layerOutput.layer.data).toBeDefined()
      // Static arrays are defensive-removed; layer falls back to default
      expect(layerOutput.layer.getPosition).toBeUndefined()
    })
  })

  describe('CreateAttributeOp -> ArcLayerOp', () => {
    it('creates source and target position attributes and arc layer consumes them', () => {
      // Create source position
      const createSource = new CreateAttributeOp('/create-source')
      const inputData = makeTestData(50)
      const sourceOutput = createSource.execute({
        data: inputData,
        name: 'sourcePosition',
        expression: '[d.pickup_longitude, d.pickup_latitude, 0]',
        size: 3,
        type: 'float',
      })

      // Create target position (chained from source)
      const createTarget = new CreateAttributeOp('/create-target')
      const targetOutput = createTarget.execute({
        data: sourceOutput.data,
        name: 'targetPosition',
        expression: '[d.dropoff_longitude, d.dropoff_latitude, 0]',
        size: 3,
        type: 'float',
      })

      // Verify both attributes exist
      const finalData = targetOutput.data as AttributeEnhancedData
      expect(finalData.attributes?.sourcePosition).toBeDefined()
      expect(finalData.attributes?.targetPosition).toBeDefined()

      // Arc layer consumes both
      const layer = new ArcLayerOp('/arc')
      const layerOutput = layer.execute({
        data: finalData,
        visible: true,
        opacity: 1,
        getSourcePosition: { attributeName: 'sourcePosition' } as any,
        getTargetPosition: { attributeName: 'targetPosition' } as any,
        getSourceColor: [255, 0, 255, 255],
        getTargetColor: [0, 255, 255, 255],
        widthUnits: 'meters',
        getWidth: 4,
        getHeight: 1,
        getTilt: 0,
        parameters: {},
        extensions: [],
      })

      expect(layerOutput.layer).toBeDefined()
      expect(layerOutput.layer.type).toBe('ArcLayer')

      const layerData = layerOutput.layer.data as any
      expect(layerData.length).toBe(50)
      expect(layerData.attributes).toBeDefined()
      expect(layerData.attributes.getSourcePosition).toBeDefined()
      expect(layerData.attributes.getTargetPosition).toBeDefined()

      // Verify attributes have correct size
      expect(layerData.attributes.getSourcePosition.size).toBe(3)
      expect(layerData.attributes.getTargetPosition.size).toBe(3)

      // Verify position props were removed (attribute references)
      expect(layerOutput.layer.getSourcePosition).toBeUndefined()
      expect(layerOutput.layer.getTargetPosition).toBeUndefined()
    })

    it('handles ColorOp connections to color accessors', () => {
      const createSource = new CreateAttributeOp('/create-source')
      const sourceOutput = createSource.execute({
        data: makeTestData(10),
        name: 'sourcePosition',
        expression: '[d.pickup_longitude, d.pickup_latitude, 0]',
        size: 3,
        type: 'float',
      })

      const createTarget = new CreateAttributeOp('/create-target')
      const targetOutput = createTarget.execute({
        data: sourceOutput.data,
        name: 'targetPosition',
        expression: '[d.dropoff_longitude, d.dropoff_latitude, 0]',
        size: 3,
        type: 'float',
      })

      const layer = new ArcLayerOp('/arc')
      const layerOutput = layer.execute({
        data: targetOutput.data as AttributeEnhancedData,
        visible: true,
        opacity: 1,
        getSourcePosition: { attributeName: 'sourcePosition' } as any,
        getTargetPosition: { attributeName: 'targetPosition' } as any,
        // Uniform colors (from ColorOp)
        getSourceColor: [141, 18, 175, 255], // #8d12af
        getTargetColor: [16, 91, 137, 255], // #105b89
        widthUnits: 'meters',
        getWidth: 4,
        getHeight: 1,
        getTilt: 0,
        parameters: {},
        extensions: [],
      })

      // Verify uniform colors are preserved
      expect(layerOutput.layer.getSourceColor).toEqual([141, 18, 175, 255])
      expect(layerOutput.layer.getTargetColor).toEqual([16, 91, 137, 255])
    })
  })

  describe('Attribute chaining', () => {
    it('chains multiple CreateAttributeOps and preserves all attributes', () => {
      const data = makeTestData(20)

      // Create first attribute
      const op1 = new CreateAttributeOp('/attr1')
      const out1 = op1.execute({
        data,
        name: 'sourcePosition',
        expression: '[d.pickup_longitude, d.pickup_latitude, 0]',
        size: 3,
        type: 'float',
      })

      // Create second attribute
      const op2 = new CreateAttributeOp('/attr2')
      const out2 = op2.execute({
        data: out1.data,
        name: 'targetPosition',
        expression: '[d.dropoff_longitude, d.dropoff_latitude, 0]',
        size: 3,
        type: 'float',
      })

      // Create third attribute
      const op3 = new CreateAttributeOp('/attr3')
      const out3 = op3.execute({
        data: out2.data,
        name: 'radius',
        expression: 'd.pickup_longitude * 10',
        size: 1,
        type: 'float',
      })

      const finalData = out3.data as AttributeEnhancedData
      expect(Object.keys(finalData.attributes || {})).toHaveLength(3)
      expect(finalData.attributes?.sourcePosition).toBeDefined()
      expect(finalData.attributes?.targetPosition).toBeDefined()
      expect(finalData.attributes?.radius).toBeDefined()
    })
  })

  describe('Error cases', () => {
    it('handles missing attribute reference gracefully', () => {
      const layer = new ScatterplotLayerOp('/layer')
      const data: AttributeEnhancedData = {
        data: makeTestData(5),
        attributes: {
          // No 'position' attribute
        },
      }

      const layerOutput = layer.execute({
        data,
        visible: true,
        opacity: 1,
        stroked: false,
        billboard: false,
        getPosition: { attributeName: 'position' } as any, // References non-existent attribute
        getFillColor: [255, 0, 0, 255],
        getLineColor: [255, 255, 255, 255],
        getRadius: 10,
        getLineWidth: 0,
        radiusScale: 1,
        radiusUnits: 'pixels',
        parameters: {},
        extensions: [],
      })

      // Should still produce a layer (with fallback to default position)
      expect(layerOutput.layer).toBeDefined()
      expect(layerOutput.layer.type).toBe('ScatterplotLayer')
    })

    it('handles malformed attribute reference object', () => {
      const createAttr = new CreateAttributeOp('/create-pos')
      const attrOutput = createAttr.execute({
        data: makeTestData(5),
        name: 'position',
        expression: '[d.pickup_longitude, d.pickup_latitude, 0]',
        size: 3,
        type: 'float',
      })

      const layer = new ScatterplotLayerOp('/layer')
      const layerOutput = layer.execute({
        data: attrOutput.data as AttributeEnhancedData,
        visible: true,
        opacity: 1,
        stroked: false,
        billboard: false,
        getPosition: { wrongKey: 'position' } as any, // Wrong shape
        getFillColor: [255, 0, 0, 255],
        getLineColor: [255, 255, 255, 255],
        getRadius: 10,
        getLineWidth: 0,
        radiusScale: 1,
        radiusUnits: 'pixels',
        parameters: {},
        extensions: [],
      })

      expect(layerOutput.layer).toBeDefined()
    })

    it('handles empty data with attributes', () => {
      const createAttr = new CreateAttributeOp('/create-pos')
      const attrOutput = createAttr.execute({
        data: [],
        name: 'position',
        expression: '[d.pickup_longitude, d.pickup_latitude, 0]',
        size: 3,
        type: 'float',
      })

      const layer = new ScatterplotLayerOp('/layer')
      const layerOutput = layer.execute({
        data: attrOutput.data as AttributeEnhancedData,
        visible: true,
        opacity: 1,
        stroked: false,
        billboard: false,
        getPosition: { attributeName: 'position' } as any,
        getFillColor: [255, 0, 0, 255],
        getLineColor: [255, 255, 255, 255],
        getRadius: 10,
        getLineWidth: 0,
        radiusScale: 1,
        radiusUnits: 'pixels',
        parameters: {},
        extensions: [],
      })

      expect(layerOutput.layer).toBeDefined()
      expect((layerOutput.layer.data as any).length).toBe(0)
    })
  })

  describe('Regression tests', () => {
    it('NYC Taxis example: sourcePosition/targetPosition attribute flow', () => {
      // Simulates the exact flow from NYC Taxis example
      const rawData = makeTestData(100)

      // /source-position CreateAttributeOp
      const sourceOp = new CreateAttributeOp('/source-position')
      const sourceData = sourceOp.execute({
        data: rawData,
        name: 'sourcePosition',
        expression: '[d.pickup_longitude, d.pickup_latitude, 0]',
        size: 3,
        type: 'float',
      })

      // /target-position CreateAttributeOp (chained)
      const targetOp = new CreateAttributeOp('/target-position')
      const targetData = targetOp.execute({
        data: sourceData.data,
        name: 'targetPosition',
        expression: '[d.dropoff_longitude, d.dropoff_latitude, 0]',
        size: 3,
        type: 'float',
      })

      const finalData = targetData.data as AttributeEnhancedData

      // /pickup-layer ScatterplotLayerOp
      const pickupLayer = new ScatterplotLayerOp('/pickup-layer')
      const pickupOutput = pickupLayer.execute({
        data: finalData,
        visible: true,
        opacity: 0.8,
        stroked: true,
        billboard: false,
        getPosition: { attributeName: 'sourcePosition' } as any,
        getFillColor: [141, 18, 175, 255],
        getLineColor: [255, 255, 255, 255],
        getRadius: 10,
        getLineWidth: 1,
        radiusScale: 1,
        radiusUnits: 'pixels',
        parameters: {},
        extensions: [],
      })

      // /dropoff-layer ScatterplotLayerOp
      const dropoffLayer = new ScatterplotLayerOp('/dropoff-layer')
      const dropoffOutput = dropoffLayer.execute({
        data: finalData,
        visible: true,
        opacity: 0.8,
        stroked: true,
        billboard: false,
        getPosition: { attributeName: 'targetPosition' } as any,
        getFillColor: [16, 91, 137, 255],
        getLineColor: [255, 255, 255, 255],
        getRadius: 10,
        getLineWidth: 1,
        radiusScale: 1,
        radiusUnits: 'pixels',
        parameters: {},
        extensions: [],
      })

      // /arc-layer ArcLayerOp
      const arcLayer = new ArcLayerOp('/arc-layer')
      const arcOutput = arcLayer.execute({
        data: finalData,
        visible: true,
        opacity: 1,
        getSourcePosition: { attributeName: 'sourcePosition' } as any,
        getTargetPosition: { attributeName: 'targetPosition' } as any,
        getSourceColor: [141, 18, 175, 255],
        getTargetColor: [16, 91, 137, 255],
        widthUnits: 'meters',
        getWidth: 4,
        getHeight: 1,
        getTilt: 0,
        parameters: {},
        extensions: [],
      })

      // Verify all layers have data and attributes
      expect(pickupOutput.layer.data).toBeDefined()
      expect((pickupOutput.layer.data as any).length).toBe(100)
      expect((pickupOutput.layer.data as any).attributes.getPosition).toBeDefined()

      expect(dropoffOutput.layer.data).toBeDefined()
      expect((dropoffOutput.layer.data as any).length).toBe(100)
      expect((dropoffOutput.layer.data as any).attributes.getPosition).toBeDefined()

      expect(arcOutput.layer.data).toBeDefined()
      expect((arcOutput.layer.data as any).length).toBe(100)
      expect((arcOutput.layer.data as any).attributes.getSourcePosition).toBeDefined()
      expect((arcOutput.layer.data as any).attributes.getTargetPosition).toBeDefined()
    })
  })
})
