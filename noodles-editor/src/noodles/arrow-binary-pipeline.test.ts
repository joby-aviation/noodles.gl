import { describe, expect, it } from 'vitest'
import { tableFromArrays } from 'apache-arrow'
import { CreateAttributeOp } from './operators'
import { ScatterplotLayerOp } from './operators'

describe('Arrow Binary Pipeline - Zero-Copy End-to-End', () => {
  it('Arrow → CreateAttributeOp → Binary Attribute (zero-copy)', () => {
    // Create Arrow table with typed columns
    const arrowTable = tableFromArrays({
      lng: Float64Array.from([-74.0, -73.9, -74.1]),
      lat: Float64Array.from([40.7, 40.8, 40.6]),
      value: Float32Array.from([10, 20, 30]),
    })

    // CreateAttributeOp extracts position attribute (zero-copy)
    const createAttr = new CreateAttributeOp('/attr-1')
    createAttr.inputs.name.setValue('position')
    createAttr.inputs.expression.setValue('[d.lng, d.lat, 0]')
    createAttr.inputs.size.setValue(3)
    createAttr.inputs.type.setValue('float')
    createAttr.inputs.data.setValue(arrowTable)

    const result = createAttr.execute({
      data: arrowTable,
      name: 'position',
      expression: '[d.lng, d.lat, 0]',
      size: 3,
      type: 'float',
      outputType: 'number',
    })

    // Verify binary attribute created
    expect(result.data).toBeDefined()
    expect(result.data).toHaveProperty('attributes')
    expect(result.data.attributes).toHaveProperty('position')

    const posAttr = result.data.attributes.position
    expect(posAttr.values).toBeInstanceOf(Float32Array)
    expect(posAttr.values.length).toBe(9) // 3 rows × 3 components
    expect(posAttr.size).toBe(3)

    // Verify values are interleaved: [lng1, lat1, 0, lng2, lat2, 0, lng3, lat3, 0]
    expect(Array.from(posAttr.values)).toEqual([
      -74.0, 40.7, 0,
      -73.9, 40.8, 0,
      -74.1, 40.6, 0,
    ])
  })

  it('Single column extraction (ultra-fast path)', () => {
    const arrowTable = tableFromArrays({
      radius: Float32Array.from([5, 10, 15]),
    })

    const createAttr = new CreateAttributeOp('/attr-2')
    const result = createAttr.execute({
      data: arrowTable,
      name: 'radius',
      expression: 'd.radius',
      size: 1,
      type: 'float',
      outputType: 'number',
    })

    const radiusAttr = result.data.attributes.radius
    expect(radiusAttr.values).toBeInstanceOf(Float32Array)
    expect(Array.from(radiusAttr.values)).toEqual([5, 10, 15])
  })

  it('Layer consumes binary attribute via {attributeName}', () => {
    // Create attribute-enhanced data
    const arrowTable = tableFromArrays({
      lng: Float64Array.from([-74.0, -73.9]),
      lat: Float64Array.from([40.7, 40.8]),
    })

    const createAttr = new CreateAttributeOp('/attr-3')
    const attrData = createAttr.execute({
      data: arrowTable,
      name: 'position',
      expression: '[d.lng, d.lat, 0]',
      size: 3,
      type: 'float',
      outputType: 'number',
    })

    // Layer receives attribute reference
    const layer = new ScatterplotLayerOp('/layer-1')
    layer.inputs.data.setValue(attrData.data)
    layer.inputs.getPosition.setValue({ attributeName: 'position' })
    layer.inputs.getRadius.setValue(100)
    layer.inputs.getFillColor.setValue([255, 0, 0, 255])

    const layerProps = layer.execute({
      data: attrData.data,
      getPosition: { attributeName: 'position' },
      getRadius: 100,
      getFillColor: [255, 0, 0, 255],
      getLineColor: [0, 0, 0, 255],
      radiusUnits: 'pixels',
      radiusScale: 1,
      radiusMinPixels: 0,
      radiusMaxPixels: Number.MAX_SAFE_INTEGER,
      lineWidthUnits: 'pixels',
      lineWidthScale: 1,
      lineWidthMinPixels: 0,
      lineWidthMaxPixels: Number.MAX_SAFE_INTEGER,
      stroked: false,
      filled: true,
      billboard: false,
      antialiasing: true,
      pickable: true,
      visible: true,
      opacity: 1,
    })

    // Verify layer props include attribute reference
    expect(layerProps.data).toBe(attrData.data)
    expect(layerProps.getPosition).toEqual({ attributeName: 'position' })

    // deck.gl will receive binary Float32Array directly from attributes
    expect(attrData.data.attributes.position.values).toBeInstanceOf(Float32Array)
  })

  it('SQL-computed attributes (ultra-fast __attr_ columns)', () => {
    // Simulate SQL-computed attribute columns
    const arrowTable = tableFromArrays({
      id: Int32Array.from([1, 2, 3]),
      __attr_position_0: Float32Array.from([-74.0, -73.9, -74.1]), // lng
      __attr_position_1: Float32Array.from([40.7, 40.8, 40.6]),    // lat
      __attr_position_2: Float32Array.from([0, 0, 0]),             // z
    })

    const createAttr = new CreateAttributeOp('/attr-4')
    const result = createAttr.execute({
      data: arrowTable,
      name: 'position',
      expression: '[d.lng, d.lat, 0]', // Expression doesn't matter, SQL columns take priority
      size: 3,
      type: 'float',
      outputType: 'number',
    })

    // Verify SQL columns were used directly (interleaved)
    const posAttr = result.data.attributes.position
    expect(posAttr.values).toBeInstanceOf(Float32Array)
    expect(Array.from(posAttr.values)).toEqual([
      -74.0, 40.7, 0,
      -73.9, 40.8, 0,
      -74.1, 40.6, 0,
    ])
  })
})
