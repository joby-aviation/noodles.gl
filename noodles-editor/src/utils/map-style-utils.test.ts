import { describe, expect, it } from 'vitest'
import {
  applyStyleOverrides,
  categorizeLayer,
  getEditableColorProps,
  groupLayersByCategory,
  type MaplibreLayer,
  type MaplibreStyle,
} from './map-style-utils'

describe('categorizeLayer', () => {
  it('categorizes background layer', () => {
    expect(categorizeLayer('background')).toBe('background')
  })

  it('categorizes water layers', () => {
    expect(categorizeLayer('water-fill')).toBe('water')
    expect(categorizeLayer('ocean-boundary')).toBe('water')
    expect(categorizeLayer('river-line')).toBe('water')
    expect(categorizeLayer('lake-polygon')).toBe('water')
  })

  it('categorizes land layers', () => {
    expect(categorizeLayer('landcover-grass')).toBe('land')
    expect(categorizeLayer('park-fill')).toBe('land')
    expect(categorizeLayer('hillshade')).toBe('land')
    expect(categorizeLayer('terrain-dem')).toBe('land')
  })

  it('categorizes building layers', () => {
    expect(categorizeLayer('building-fill')).toBe('buildings')
    expect(categorizeLayer('building-extrusion')).toBe('buildings')
    expect(categorizeLayer('structure-fill')).toBe('buildings')
  })

  it('categorizes road layers', () => {
    expect(categorizeLayer('road-primary')).toBe('roads')
    expect(categorizeLayer('street-minor')).toBe('roads')
    expect(categorizeLayer('highway-motorway')).toBe('roads')
    expect(categorizeLayer('tunnel-fill')).toBe('roads')
    expect(categorizeLayer('bridge-case')).toBe('roads')
  })

  it('categorizes label layers', () => {
    expect(categorizeLayer('place-label-city')).toBe('labels')
    expect(categorizeLayer('road-label')).toBe('labels')
    expect(categorizeLayer('poi-label')).toBe('labels')
    expect(categorizeLayer('country-name')).toBe('labels')
  })

  it('falls back to other for unmatched layers', () => {
    expect(categorizeLayer('some-unknown-layer')).toBe('other')
    expect(categorizeLayer('custom-effect')).toBe('other')
  })
})

describe('getEditableColorProps', () => {
  it('returns fill color props', () => {
    const layer: MaplibreLayer = { id: 'water', type: 'fill' }
    expect(getEditableColorProps(layer)).toEqual(['fill-color', 'fill-outline-color'])
  })

  it('returns line color props', () => {
    const layer: MaplibreLayer = { id: 'road', type: 'line' }
    expect(getEditableColorProps(layer)).toEqual(['line-color'])
  })

  it('returns symbol color props', () => {
    const layer: MaplibreLayer = { id: 'labels', type: 'symbol' }
    expect(getEditableColorProps(layer)).toEqual(['text-color', 'text-halo-color'])
  })

  it('returns empty array for raster layers', () => {
    const layer: MaplibreLayer = { id: 'satellite', type: 'raster' }
    expect(getEditableColorProps(layer)).toEqual([])
  })
})

describe('applyStyleOverrides', () => {
  const baseStyle: MaplibreStyle = {
    version: 8,
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#1a1a1a' } },
      { id: 'water-fill', type: 'fill', paint: { 'fill-color': '#2a2a4a' } },
      {
        id: 'road-primary',
        type: 'line',
        paint: { 'line-color': '#555', 'line-width': 2 },
      },
      {
        id: 'place-label',
        type: 'symbol',
        layout: { 'text-font': ['Noto Sans'], 'text-size': 14 },
        paint: { 'text-color': '#ffffff' },
      },
    ],
  }

  it('applies paint overrides to specific layers', () => {
    const overrides = {
      layers: [{ layerId: 'water-fill', paintOverrides: { 'fill-color': '#1e3a5f' } }],
      global: {},
    }
    const result = applyStyleOverrides(baseStyle, overrides)
    const waterLayer = result.layers.find(l => l.id === 'water-fill')
    expect(waterLayer?.paint?.['fill-color']).toBe('#1e3a5f')
  })

  it('preserves non-overridden paint properties', () => {
    const overrides = {
      layers: [{ layerId: 'road-primary', paintOverrides: { 'line-color': '#ff0000' } }],
      global: {},
    }
    const result = applyStyleOverrides(baseStyle, overrides)
    const roadLayer = result.layers.find(l => l.id === 'road-primary')
    expect(roadLayer?.paint?.['line-color']).toBe('#ff0000')
    expect(roadLayer?.paint?.['line-width']).toBe(2)
  })

  it('applies layout visibility overrides', () => {
    const overrides = {
      layers: [{ layerId: 'place-label', layoutOverrides: { visibility: 'none' } }],
      global: {},
    }
    const result = applyStyleOverrides(baseStyle, overrides)
    const labelLayer = result.layers.find(l => l.id === 'place-label')
    expect(labelLayer?.layout?.visibility).toBe('none')
    expect(labelLayer?.layout?.['text-font']).toEqual(['Noto Sans'])
  })

  it('applies global glyphs override', () => {
    const overrides = {
      layers: [],
      global: { glyphs: 'https://custom.example.com/{fontstack}/{range}.pbf' },
    }
    const result = applyStyleOverrides(baseStyle, overrides)
    expect(result.glyphs).toBe('https://custom.example.com/{fontstack}/{range}.pbf')
  })

  it('applies label size scale to symbol layers', () => {
    const overrides = { layers: [], global: { labelSizeScale: 1.5 } }
    const result = applyStyleOverrides(baseStyle, overrides)
    const labelLayer = result.layers.find(l => l.id === 'place-label')
    expect(labelLayer?.layout?.['text-size']).toBe(21) // 14 * 1.5
  })

  it('skips label size scale for non-numeric text-size', () => {
    const styleWithExpression: MaplibreStyle = {
      version: 8,
      layers: [
        {
          id: 'place-label',
          type: 'symbol',
          layout: { 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 12, 16, 24] },
          paint: {},
        },
      ],
    }
    const overrides = { layers: [], global: { labelSizeScale: 2 } }
    const result = applyStyleOverrides(styleWithExpression, overrides)
    const labelLayer = result.layers.find(l => l.id === 'place-label')
    // Non-numeric text-size (expression) should not be scaled
    expect(labelLayer?.layout?.['text-size']).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      10,
      12,
      16,
      24,
    ])
  })

  it('does not modify original style object', () => {
    const overrides = {
      layers: [{ layerId: 'water-fill', paintOverrides: { 'fill-color': '#ff0000' } }],
      global: {},
    }
    applyStyleOverrides(baseStyle, overrides)
    // Original should be unchanged
    expect(baseStyle.layers[1].paint?.['fill-color']).toBe('#2a2a4a')
  })

  it('ignores overrides for non-existent layer IDs', () => {
    const overrides = {
      layers: [{ layerId: 'nonexistent-layer', paintOverrides: { 'fill-color': '#ff0000' } }],
      global: {},
    }
    // Should not throw
    const result = applyStyleOverrides(baseStyle, overrides)
    expect(result.layers).toHaveLength(baseStyle.layers.length)
  })
})

describe('groupLayersByCategory', () => {
  it('groups layers into correct categories', () => {
    const layers: MaplibreLayer[] = [
      { id: 'background', type: 'background' },
      { id: 'water-fill', type: 'fill' },
      { id: 'road-primary', type: 'line' },
      { id: 'building-fill', type: 'fill' },
      { id: 'place-label', type: 'symbol' },
      { id: 'custom-layer', type: 'fill' },
    ]
    const grouped = groupLayersByCategory(layers)
    expect(grouped.background).toHaveLength(1)
    expect(grouped.water).toHaveLength(1)
    expect(grouped.roads).toHaveLength(1)
    expect(grouped.buildings).toHaveLength(1)
    expect(grouped.labels).toHaveLength(1)
    expect(grouped.other).toHaveLength(1)
  })
})
