export type LayerCategory =
  | 'background'
  | 'land'
  | 'water'
  | 'roads'
  | 'buildings'
  | 'labels'
  | 'other'

export interface MaplibreLayer {
  id: string
  type: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

export interface MaplibreStyle {
  version: number
  layers: MaplibreLayer[]
  glyphs?: string
  [key: string]: unknown
}

export interface LayerOverride {
  layerId: string
  paintOverrides?: Record<string, unknown>
  layoutOverrides?: Record<string, unknown>
}

export interface StyleGlobalOverrides {
  glyphs?: string
  labelSizeScale?: number
  lineWidthScale?: number
}

export interface StyleConfiguratorData {
  layers: LayerOverride[]
  global: StyleGlobalOverrides
}

const LAYER_CATEGORY_PATTERNS: Array<[LayerCategory, RegExp]> = [
  ['background', /^background$/i],
  // labels checked before roads so "road-label" maps to labels, not roads
  ['labels', /label|text|name|place|poi|symbol/i],
  ['water', /water|ocean|river|lake|sea|bay/i],
  ['land', /land|grass|park|green|nature|terrain|hillshade/i],
  ['buildings', /building|structure|extrusion|3d/i],
  ['roads', /road|street|highway|motorway|tunnel|bridge|path|rail/i],
]

export function categorizeLayer(layerId: string): LayerCategory {
  for (const [category, pattern] of LAYER_CATEGORY_PATTERNS) {
    if (pattern.test(layerId)) return category
  }
  return 'other'
}

export const CATEGORY_ORDER: LayerCategory[] = [
  'background',
  'land',
  'water',
  'roads',
  'buildings',
  'labels',
  'other',
]

const EDITABLE_COLOR_PROPS: Partial<Record<string, string[]>> = {
  fill: ['fill-color', 'fill-outline-color'],
  line: ['line-color'],
  symbol: ['text-color', 'text-halo-color'],
  circle: ['circle-color', 'circle-stroke-color'],
  background: ['background-color'],
  'fill-extrusion': ['fill-extrusion-color'],
}

export function getEditableColorProps(layer: MaplibreLayer): string[] {
  return EDITABLE_COLOR_PROPS[layer.type] ?? []
}

export function applyStyleOverrides(
  styleObj: MaplibreStyle,
  overrides: StyleConfiguratorData
): MaplibreStyle {
  const layers = styleObj.layers ?? []

  const mergedLayers = layers.map(layer => {
    const layerOverride = overrides.layers?.find(o => o.layerId === layer.id)
    if (!layerOverride) return layer

    return {
      ...layer,
      paint: layerOverride.paintOverrides
        ? { ...(layer.paint ?? {}), ...layerOverride.paintOverrides }
        : layer.paint,
      layout: layerOverride.layoutOverrides
        ? { ...(layer.layout ?? {}), ...layerOverride.layoutOverrides }
        : layer.layout,
    }
  })

  let result: MaplibreStyle = { ...styleObj, layers: mergedLayers }

  if (overrides.global?.glyphs) {
    result = { ...result, glyphs: overrides.global.glyphs }
  }

  if (overrides.global?.labelSizeScale && overrides.global.labelSizeScale !== 1) {
    const scale = overrides.global.labelSizeScale
    result = {
      ...result,
      layers: result.layers.map(layer => {
        if (layer.type !== 'symbol') return layer
        const textSize = layer.layout?.['text-size']
        if (typeof textSize !== 'number') return layer
        return {
          ...layer,
          layout: { ...layer.layout, 'text-size': textSize * scale },
        }
      }),
    }
  }

  if (overrides.global?.lineWidthScale && overrides.global.lineWidthScale !== 1) {
    const scale = overrides.global.lineWidthScale
    result = {
      ...result,
      layers: result.layers.map(layer => {
        if (layer.type !== 'line') return layer
        const lineWidth = layer.paint?.['line-width']
        if (typeof lineWidth !== 'number') return layer
        return {
          ...layer,
          paint: { ...layer.paint, 'line-width': lineWidth * scale },
        }
      }),
    }
  }

  return result
}

// Groups layers by semantic category
export function groupLayersByCategory(
  layers: MaplibreLayer[]
): Record<LayerCategory, MaplibreLayer[]> {
  const result: Record<LayerCategory, MaplibreLayer[]> = {
    background: [],
    land: [],
    water: [],
    roads: [],
    buildings: [],
    labels: [],
    other: [],
  }
  for (const layer of layers) {
    result[categorizeLayer(layer.id)].push(layer)
  }
  return result
}
