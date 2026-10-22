// Project Templates and Common Patterns
//
// This file contains template configurations for common Noodles.gl project patterns.
// Used by the Project Generator Agent to create well-structured projects.

import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'

export interface ProjectTemplate {
  name: string
  description: string
  nodes: Partial<ReactFlowNode>[]
  edges: Partial<ReactFlowEdge>[]
}

// Basic visualization pipeline pattern:
// Data Source → Data Transform → Deck.gl Layer → DeckRenderer → Viewer
export const BASIC_VIZ_PATTERN: ProjectTemplate = {
  name: 'Basic Visualization',
  description: 'Standard data visualization pipeline with viewer output',
  nodes: [
    {
      id: '/data',
      type: 'FileOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          url: '@/data.csv',
          format: 'csv',
        },
      },
    },
    {
      id: '/layer',
      type: 'ScatterplotLayerOp',
      position: { x: 400, y: 100 },
      data: {
        inputs: {},
      },
    },
    {
      id: '/renderer',
      type: 'DeckRendererOp',
      position: { x: 700, y: 100 },
      data: {
        inputs: {},
      },
    },
    {
      id: '/basemap',
      type: 'MaplibreBasemapOp',
      position: { x: 700, y: 250 },
      data: {
        inputs: {
          style: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
        },
      },
    },
    {
      id: '/viewer',
      type: 'ViewerOp',
      position: { x: 1000, y: 100 },
      data: {
        inputs: {},
      },
    },
  ],
  edges: [
    {
      id: '/layer.out.layer->/renderer.par.layers',
      source: '/layer',
      target: '/renderer',
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    },
    {
      id: '/renderer.out.deckProps->/viewer.par.deckProps',
      source: '/renderer',
      target: '/viewer',
      sourceHandle: 'out.deckProps',
      targetHandle: 'par.deckProps',
    },
    {
      id: '/basemap.out.basemap->/viewer.par.basemap',
      source: '/basemap',
      target: '/viewer',
      sourceHandle: 'out.basemap',
      targetHandle: 'par.basemap',
    },
  ],
}

// Common node positioning utilities
export const LAYOUT = {
  // Standard horizontal spacing between nodes
  HORIZONTAL_GAP: 300,
  // Standard vertical spacing between nodes
  VERTICAL_GAP: 150,
  // Starting X position for first node
  START_X: 100,
  // Starting Y position for first node
  START_Y: 100,
}

// Common operator configurations by category
export const OPERATOR_CONFIGS = {
  dataSources: {
    FileOp: {
      type: 'FileOp',
      inputs: {
        url: '@/data.csv',
        format: 'csv',
      },
    },
    DuckDbOp: {
      type: 'DuckDbOp',
      inputs: {
        query: 'SELECT * FROM data.csv',
      },
    },
    NetworkOp: {
      type: 'NetworkOp',
      inputs: {
        url: 'https://example.com/data.json',
        method: 'GET',
      },
    },
  },
  transforms: {
    FilterOp: {
      type: 'FilterOp',
      inputs: {
        condition: 'd.value > 0',
      },
    },
    MapOp: {
      type: 'MapOp',
      inputs: {
        mapper: 'd => ({ ...d, processed: true })',
      },
    },
    SliceOp: {
      type: 'SliceOp',
      inputs: {
        start: 0,
        end: 100,
      },
    },
  },
  layers: {
    ScatterplotLayerOp: {
      type: 'ScatterplotLayerOp',
      inputs: {
        radiusMinPixels: 2,
        radiusMaxPixels: 100,
      },
    },
    PathLayerOp: {
      type: 'PathLayerOp',
      inputs: {
        widthMinPixels: 2,
      },
    },
    ArcLayerOp: {
      type: 'ArcLayerOp',
      inputs: {
        widthMinPixels: 2,
      },
    },
    HeatmapLayerOp: {
      type: 'HeatmapLayerOp',
      inputs: {
        radiusPixels: 30,
        intensity: 1,
      },
    },
    H3HexagonLayerOp: {
      type: 'H3HexagonLayerOp',
      inputs: {
        filled: true,
        extruded: false,
      },
    },
    GeoJsonLayerOp: {
      type: 'GeoJsonLayerOp',
      inputs: {
        filled: true,
        stroked: true,
        lineWidthMinPixels: 1,
      },
    },
  },
  viewers: {
    ViewerOp: {
      type: 'ViewerOp',
      inputs: {},
    },
  },
  rendering: {
    DeckRendererOp: {
      type: 'DeckRendererOp',
      inputs: {},
    },
    MaplibreBasemapOp: {
      type: 'MaplibreBasemapOp',
      inputs: {
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
      },
    },
  },
}

// Basemap style URLs
export const BASEMAP_STYLES = {
  darkNoLabels: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  lightNoLabels: 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json',
  voyager: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  voyagerNoLabels: 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json',
}

// Common accessor patterns for Deck.gl layers
export const ACCESSOR_PATTERNS = {
  position: {
    latLng: '[d.longitude, d.latitude]',
    lngLat: '[d.lng, d.lat]',
    xy: '[d.x, d.y]',
  },
  color: {
    fixed: '[255, 0, 0, 255]',
    conditional: 'd.value > 100 ? [255, 0, 0] : [0, 255, 0]',
    scaled: '[d.value * 255, 0, 0]',
  },
  size: {
    fixed: '5',
    scaled: 'd.value * 10',
    conditional: 'd.value > 100 ? 10 : 5',
  },
}

// Helper: Generate a unique node ID
export function generateNodeId(type: string, existing: Set<string>): string {
  const baseName = type.replace(/Op$/, '').toLowerCase()
  let counter = 1
  let id = `/${baseName}`

  while (existing.has(id)) {
    counter++
    id = `/${baseName}-${counter}`
  }

  return id
}

// Helper: Calculate node position in a flow layout
export function calculatePosition(_index: number, column = 0, row = 0): { x: number; y: number } {
  return {
    x: LAYOUT.START_X + column * LAYOUT.HORIZONTAL_GAP,
    y: LAYOUT.START_Y + row * LAYOUT.VERTICAL_GAP,
  }
}

// Helper: Create an edge ID from source/target
export function createEdgeId(
  sourceId: string,
  sourceHandle: string,
  targetId: string,
  targetHandle: string
): string {
  return `${sourceId}.${sourceHandle}->${targetId}.${targetHandle}`
}

// Visualization type to layer mapping
export const VIZ_TYPE_TO_LAYER: Record<string, string> = {
  scatter: 'ScatterplotLayerOp',
  scatterplot: 'ScatterplotLayerOp',
  points: 'ScatterplotLayerOp',
  dots: 'ScatterplotLayerOp',
  heatmap: 'HeatmapLayerOp',
  heat: 'HeatmapLayerOp',
  density: 'HeatmapLayerOp',
  arc: 'ArcLayerOp',
  arcs: 'ArcLayerOp',
  connections: 'ArcLayerOp',
  routes: 'ArcLayerOp',
  path: 'PathLayerOp',
  paths: 'PathLayerOp',
  line: 'PathLayerOp',
  lines: 'PathLayerOp',
  hexagon: 'H3HexagonLayerOp',
  hexagons: 'H3HexagonLayerOp',
  h3: 'H3HexagonLayerOp',
  geojson: 'GeoJsonLayerOp',
  polygon: 'GeoJsonLayerOp',
  polygons: 'GeoJsonLayerOp',
  choropleth: 'GeoJsonLayerOp',
  column: 'ColumnLayerOp',
  columns: 'ColumnLayerOp',
  bars: 'ColumnLayerOp',
  '3d': 'ColumnLayerOp',
  icon: 'IconLayerOp',
  icons: 'IconLayerOp',
  markers: 'IconLayerOp',
  text: 'TextLayerOp',
  labels: 'TextLayerOp',
}

// Data format detection patterns
export const DATA_FORMAT_PATTERNS = {
  csv: /\.csv$/i,
  json: /\.json$/i,
  geojson: /\.geojson$/i,
  parquet: /\.parquet$/i,
}
