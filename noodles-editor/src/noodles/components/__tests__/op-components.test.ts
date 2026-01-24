// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { headerClass, typeCategory, typeDisplayName } from '../op-components'

describe('op-components utilities', () => {
  describe('typeDisplayName', () => {
    it('should remove Op suffix from operator names', () => {
      expect(typeDisplayName('NumberOp')).toBe('Number')
      expect(typeDisplayName('FileOp')).toBe('File')
      expect(typeDisplayName('DuckDbOp')).toBe('DuckDb')
    })

    it('should handle math pseudo-operators', () => {
      expect(typeDisplayName('AddOp')).toBe('Add')
      expect(typeDisplayName('MultiplyOp')).toBe('Multiply')
      expect(typeDisplayName('SubtractOp')).toBe('Subtract')
      expect(typeDisplayName('DivideOp')).toBe('Divide')
    })

    it('should handle ForLoop without Op suffix', () => {
      expect(typeDisplayName('ForLoop')).toBe('ForLoop')
    })

    it('should handle names without Op suffix', () => {
      expect(typeDisplayName('Container')).toBe('Container')
    })
  })

  describe('typeCategory', () => {
    it('should return correct category for regular operators', () => {
      expect(typeCategory('NumberOp')).toBe('Number')
      expect(typeCategory('FileOp')).toBe('Data')
      expect(typeCategory('DuckDbOp')).toBe('Code')
      expect(typeCategory('StringOp')).toBe('String')
      expect(typeCategory('BooleanOp')).toBe('Utility')
    })

    it('should return correct category for math pseudo-operators', () => {
      expect(typeCategory('AddOp')).toBe('Number')
      expect(typeCategory('MultiplyOp')).toBe('Number')
      expect(typeCategory('SubtractOp')).toBe('Number')
      expect(typeCategory('DivideOp')).toBe('Number')
      expect(typeCategory('ModuloOp')).toBe('Number')
      expect(typeCategory('SineOp')).toBe('Number')
      expect(typeCategory('CosineOp')).toBe('Number')
      expect(typeCategory('MinOp')).toBe('Number')
      expect(typeCategory('MaxOp')).toBe('Number')
      expect(typeCategory('RoundOp')).toBe('Number')
      expect(typeCategory('FloorOp')).toBe('Number')
      expect(typeCategory('CeilOp')).toBe('Number')
      expect(typeCategory('AbsOp')).toBe('Number')
    })

    it('should return correct category for layer operators', () => {
      expect(typeCategory('ScatterplotLayerOp')).toBe('Layer')
      expect(typeCategory('PathLayerOp')).toBe('Layer')
      expect(typeCategory('ArcLayerOp')).toBe('Layer')
    })

    it('should return correct category for extension operators', () => {
      expect(typeCategory('BrushingExtensionOp')).toBe('Extension')
      expect(typeCategory('DataFilterExtensionOp')).toBe('Extension')
    })

    it('should return correct category for view operators', () => {
      expect(typeCategory('MapViewOp')).toBe('View')
      expect(typeCategory('GlobeViewOp')).toBe('View')
    })

    it('should return correct category for color operators', () => {
      expect(typeCategory('ColorOp')).toBe('Color')
      expect(typeCategory('ColorRampOp')).toBe('Color')
      expect(typeCategory('HSLOp')).toBe('Color')
    })

    it('should return correct category for vector operators', () => {
      expect(typeCategory('CombineXYOp')).toBe('Vector')
      expect(typeCategory('SplitXYOp')).toBe('Vector')
    })

    it('should return correct category for grouping operators', () => {
      expect(typeCategory('ContainerOp')).toBe('Grouping')
      expect(typeCategory('ForLoopBeginOp')).toBe('Grouping')
    })

    it('should return correct category for geojson operators', () => {
      expect(typeCategory('GeoJsonOp')).toBe('Geojson')
      expect(typeCategory('PointOp')).toBe('Geojson')
    })

    it('should return Unknown for unrecognized types', () => {
      expect(typeCategory('NonExistentOp' as any)).toBe('Unknown')
    })
  })

  describe('headerClass', () => {
    it('should return correct class for layer category', () => {
      expect(headerClass('ScatterplotLayerOp')).toContain('headerLayer')
      expect(headerClass('ArcLayerOp')).toContain('headerLayer')
      expect(headerClass('PathLayerOp')).toContain('headerLayer')
    })

    it('should return correct class for code category', () => {
      expect(headerClass('CodeOp')).toContain('headerCode')
      expect(headerClass('AccessorOp')).toContain('headerCode')
      expect(headerClass('DuckDbOp')).toContain('headerCode')
    })

    it('should return correct class for number category including pseudo-operators', () => {
      expect(headerClass('NumberOp')).toContain('headerNumber')
      expect(headerClass('MathOp')).toContain('headerNumber')
      // Math pseudo-operators
      expect(headerClass('AddOp')).toContain('headerNumber')
      expect(headerClass('MultiplyOp')).toContain('headerNumber')
      expect(headerClass('SubtractOp')).toContain('headerNumber')
      expect(headerClass('DivideOp')).toContain('headerNumber')
      expect(headerClass('ModuloOp')).toContain('headerNumber')
      expect(headerClass('SineOp')).toContain('headerNumber')
      expect(headerClass('CosineOp')).toContain('headerNumber')
      expect(headerClass('MinOp')).toContain('headerNumber')
      expect(headerClass('MaxOp')).toContain('headerNumber')
      expect(headerClass('RoundOp')).toContain('headerNumber')
      expect(headerClass('FloorOp')).toContain('headerNumber')
      expect(headerClass('CeilOp')).toContain('headerNumber')
      expect(headerClass('AbsOp')).toContain('headerNumber')
    })

    it('should return correct class for data category', () => {
      expect(headerClass('FileOp')).toContain('headerData')
      expect(headerClass('FilterOp')).toContain('headerData')
    })

    it('should return correct class for extension category', () => {
      expect(headerClass('DataFilterExtensionOp')).toContain('headerExtension')
      expect(headerClass('BrushingExtensionOp')).toContain('headerExtension')
    })

    it('should return correct class for view category', () => {
      expect(headerClass('MapViewOp')).toContain('headerView')
      expect(headerClass('GlobeViewOp')).toContain('headerView')
    })

    it('should return correct class for color category', () => {
      expect(headerClass('ColorOp')).toContain('headerColor')
      expect(headerClass('ColorRampOp')).toContain('headerColor')
      expect(headerClass('HSLOp')).toContain('headerColor')
    })

    it('should return correct class for vector category', () => {
      expect(headerClass('CombineXYOp')).toContain('headerVector')
      expect(headerClass('SplitXYZOp')).toContain('headerVector')
    })

    it('should return correct class for geojson category', () => {
      expect(headerClass('GeoJsonOp')).toContain('headerGeojson')
      expect(headerClass('PointOp')).toContain('headerGeojson')
    })

    it('should return correct class for string category', () => {
      expect(headerClass('StringOp')).toContain('headerString')
    })

    it('should return correct class for utility category', () => {
      expect(headerClass('BooleanOp')).toContain('headerUtility')
      expect(headerClass('MouseOp')).toContain('headerUtility')
    })

    it('should return correct class for grouping category', () => {
      expect(headerClass('ContainerOp')).toContain('headerGrouping')
      expect(headerClass('ForLoopBeginOp')).toContain('headerGrouping')
    })

    it('should return correct class for widget category', () => {
      expect(headerClass('FpsWidgetOp')).toContain('headerWidget')
    })

    it('should return default headerData class for unknown operators', () => {
      expect(headerClass('UnknownOp' as any)).toContain('headerData')
      expect(headerClass('NonExistentOperator' as any)).toContain('headerData')
    })
  })
})
