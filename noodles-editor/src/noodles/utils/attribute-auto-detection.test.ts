import { tableFromArrays } from 'apache-arrow'
import { beforeEach, describe, expect, it } from 'vitest'
import { NumberField } from '../fields'
import { ScatterplotLayerOp } from '../operators'
import {
  autoFillLayerAccessors,
  extractSchemaFromData,
  findBestColumnMatch,
} from './attribute-auto-detection'

describe('Attribute Auto-Detection', () => {
  describe('extractSchemaFromData', () => {
    it('should extract columns from Arrow table', () => {
      const table = tableFromArrays({
        lat: [40.7, 34.0],
        lng: [-74.0, -118.2],
        value: [100, 200],
      })

      const columns = extractSchemaFromData(table)

      expect(columns).toEqual(['lat', 'lng', 'value'])
    })

    it('should extract columns from plain object array', () => {
      const data = [
        { lat: 40.7, lng: -74.0, radius: 50 },
        { lat: 34.0, lng: -118.2, radius: 100 },
      ]

      const columns = extractSchemaFromData(data)

      expect(columns).toContain('lat')
      expect(columns).toContain('lng')
      expect(columns).toContain('radius')
    })

    it('should extract columns from attribute-enhanced data', () => {
      const data = {
        data: [
          { lat: 40.7, lng: -74.0 },
          { lat: 34.0, lng: -118.2 },
        ],
        attributes: {
          position: { values: new Float32Array([1, 2, 3]), size: 3 },
        },
      }

      const columns = extractSchemaFromData(data)

      expect(columns).toContain('lat')
      expect(columns).toContain('lng')
    })

    it('should return empty array for empty data', () => {
      expect(extractSchemaFromData([])).toEqual([])
      expect(extractSchemaFromData(null)).toEqual([])
      expect(extractSchemaFromData(undefined)).toEqual([])
    })
  })

  describe('findBestColumnMatch', () => {
    it('should match exact column name (case-insensitive)', () => {
      const columns = ['Position', 'Value', 'Name']

      const match = findBestColumnMatch('position', columns)

      expect(match).toBe('Position')
    })

    it('should match Houdini Cd attribute to color', () => {
      const columns = ['x', 'y', 'Cd', 'value']

      const match = findBestColumnMatch('fillColor', columns)

      expect(match).toBe('Cd')
    })

    it('should match latitude to lat', () => {
      const columns = ['latitude', 'longitude', 'value']

      const match = findBestColumnMatch('lat', columns)

      expect(match).toBe('latitude')
    })

    it('should match radius to size', () => {
      const columns = ['x', 'y', 'size']

      const match = findBestColumnMatch('radius', columns)

      expect(match).toBe('size')
    })

    it('should return null for no match', () => {
      const columns = ['foo', 'bar', 'baz']

      const match = findBestColumnMatch('position', columns)

      expect(match).toBeNull()
    })

    it('should be case-insensitive', () => {
      const columns = ['LATITUDE', 'LONGITUDE']

      expect(findBestColumnMatch('lat', columns)).toBe('LATITUDE')
      expect(findBestColumnMatch('lng', columns)).toBe('LONGITUDE')
    })
  })

  describe('autoFillLayerAccessors', () => {
    let layerOp: ScatterplotLayerOp

    beforeEach(() => {
      layerOp = new ScatterplotLayerOp('/test/layer')
      layerOp.createListeners()
    })

    it('should auto-fill position from lat/lng columns', () => {
      const data = [
        { lat: 40.7, lng: -74.0, value: 100 },
        { lat: 34.0, lng: -118.2, value: 200 },
      ]

      autoFillLayerAccessors(layerOp, data)

      const positionValue = layerOp.inputs.getPosition.value
      expect(positionValue).toHaveProperty('expression')
      expect(positionValue.expression).toBe('[d.lng, d.lat, 0]')
    })

    it('should auto-fill position from latitude/longitude columns', () => {
      const data = [
        { latitude: 40.7, longitude: -74.0 },
        { latitude: 34.0, longitude: -118.2 },
      ]

      autoFillLayerAccessors(layerOp, data)

      const positionValue = layerOp.inputs.getPosition.value
      expect(positionValue).toHaveProperty('expression')
      expect(positionValue.expression).toBe('[d.longitude, d.latitude, 0]')
    })

    it('should auto-fill radius from exact column match', () => {
      const data = [
        { lat: 40.7, lng: -74.0, radius: 50 },
        { lat: 34.0, lng: -118.2, radius: 100 },
      ]

      autoFillLayerAccessors(layerOp, data)

      const radiusValue = layerOp.inputs.getRadius.value
      expect(radiusValue).toHaveProperty('attributeName')
      expect(radiusValue.attributeName).toBe('radius')
    })

    it('should auto-fill radius from size column (fuzzy match)', () => {
      const data = [
        { lat: 40.7, lng: -74.0, size: 50 },
        { lat: 34.0, lng: -118.2, size: 100 },
      ]

      autoFillLayerAccessors(layerOp, data)

      const radiusValue = layerOp.inputs.getRadius.value
      expect(radiusValue).toHaveProperty('attributeName')
      expect(radiusValue.attributeName).toBe('size')
    })

    it('should auto-fill fillColor from Cd column (Houdini convention)', () => {
      const data = [
        { lat: 40.7, lng: -74.0, Cd: [255, 0, 0] },
        { lat: 34.0, lng: -118.2, Cd: [0, 255, 0] },
      ]

      autoFillLayerAccessors(layerOp, data)

      const colorValue = layerOp.inputs.getFillColor.value
      expect(colorValue).toHaveProperty('attributeName')
      expect(colorValue.attributeName).toBe('Cd')
    })

    it('should not overwrite manually set values', () => {
      const data = [
        { lat: 40.7, lng: -74.0, radius: 50 },
        { lat: 34.0, lng: -118.2, radius: 100 },
      ]

      // Manually set radius
      layerOp.inputs.getRadius.setValue(100)

      autoFillLayerAccessors(layerOp, data)

      // Should preserve manual value
      expect(layerOp.inputs.getRadius.value).toBe(100)
    })

    it('should work with Arrow table data', () => {
      const table = tableFromArrays({
        lat: [40.7, 34.0],
        lng: [-74.0, -118.2],
        size: [50, 100],
      })

      autoFillLayerAccessors(layerOp, table)

      const positionValue = layerOp.inputs.getPosition.value
      expect(positionValue).toHaveProperty('expression')
      expect(positionValue.expression).toBe('[d.lng, d.lat, 0]')

      const radiusValue = layerOp.inputs.getRadius.value
      expect(radiusValue).toHaveProperty('attributeName')
      expect(radiusValue.attributeName).toBe('size')
    })

    it('should work with attribute-enhanced data format', () => {
      const data = {
        data: [
          { lat: 40.7, lng: -74.0, radius: 50 },
          { lat: 34.0, lng: -118.2, radius: 100 },
        ],
        attributes: {},
      }

      autoFillLayerAccessors(layerOp, data)

      const positionValue = layerOp.inputs.getPosition.value
      expect(positionValue).toHaveProperty('expression')

      const radiusValue = layerOp.inputs.getRadius.value
      expect(radiusValue).toHaveProperty('attributeName')
      expect(radiusValue.attributeName).toBe('radius')
    })

    it('should not fill fields without defaultAttribute', () => {
      // Create a custom operator with a field that has no defaultAttribute
      const data = [{ someValue: 42 }]

      class TestOp extends ScatterplotLayerOp {
        override createInputs() {
          return {
            ...super.createInputs(),
            customField: new NumberField(0), // No defaultAttribute
          }
        }
      }

      const testOp = new TestOp('/test/op')
      testOp.createListeners()

      autoFillLayerAccessors(testOp, data)

      // customField should not be auto-filled
      expect(testOp.inputs.customField.value).toBe(0)
    })

    it('should handle data with no matching columns', () => {
      const data = [
        { foo: 1, bar: 2, baz: 3 },
        { foo: 4, bar: 5, baz: 6 },
      ]

      autoFillLayerAccessors(layerOp, data)

      // Fields should remain at default values
      expect(layerOp.inputs.getPosition.value).toEqual(layerOp.inputs.getPosition.defaultValue)
      expect(layerOp.inputs.getRadius.value).toEqual(layerOp.inputs.getRadius.defaultValue)
    })

    it('should be case-insensitive when matching column names', () => {
      const data = [
        { LAT: 40.7, LNG: -74.0, RADIUS: 50 },
        { LAT: 34.0, LNG: -118.2, RADIUS: 100 },
      ]

      autoFillLayerAccessors(layerOp, data)

      const positionValue = layerOp.inputs.getPosition.value
      expect(positionValue).toHaveProperty('expression')
      expect(positionValue.expression).toBe('[d.LNG, d.LAT, 0]')

      const radiusValue = layerOp.inputs.getRadius.value
      expect(radiusValue).toHaveProperty('attributeName')
      expect(radiusValue.attributeName).toBe('RADIUS')
    })
  })
})
