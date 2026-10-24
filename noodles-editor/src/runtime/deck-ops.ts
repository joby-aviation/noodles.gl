// Deck operators: what a deck draws that has no rows. Views, view states, widgets, layer
// extensions, and layers deck loads itself (an image, tiles, a 3D tileset), each a planner
// operator defined by its parameters and built by the engine on the main thread into the
// description deck takes: `{ type: 'OrbitView', id, ...props }`. They replace the Noodles
// operator classes of the same name, keeping their parameter names, so a document's values
// carry over as they are.

import { type OpDef, type ParamDef, type PortType, registerOperator } from '@noodles.gl/planner'
import * as d3 from 'd3'
import { toMaskTargetPosition } from '../noodles/extensions/mask-3d-extension'
import { applyStyleOverrides } from '../utils/map-style-utils'
import { registerValueOperators } from './value-ops'

export interface DeckOp {
  def: OpDef
  // The Noodles operator it replaces
  noodles: string
  // Parameters that take several edges, in order: a layer's extensions
  lists?: string[]
  build: (p: Record<string, unknown>, id: string) => unknown | Promise<unknown>
}

const label = (name: string) => name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())

type Extra = Partial<ParamDef>
const num = (name: string, value: number, extra: Extra = {}): ParamDef => ({
  name,
  label: label(name),
  kind: 'float',
  default: value,
  port: true,
  ...extra,
})
const toggle = (name: string, value: boolean): ParamDef => ({
  name,
  label: label(name),
  kind: 'toggle',
  default: value,
})
const menu = (name: string, value: string, options: string[]): ParamDef => ({
  name,
  label: label(name),
  kind: 'menu',
  default: value,
  options: options.map(o => ({ value: o, label: o })),
})
const text = (name: string, value: string): ParamDef => ({
  name,
  label: label(name),
  kind: 'string',
  default: value,
})
const url = (name: string, value = ''): ParamDef => ({
  name,
  label: label(name),
  kind: 'url',
  default: value,
})
const color = (name: string, value: string): ParamDef => ({
  name,
  label: label(name),
  kind: 'color',
  default: value,
})
// A value the Noodles field's own widget edits (a bounding box, a view state), and that another
// operator may supply
const field = (noodles: string, name: string, value: unknown, port = false): ParamDef => ({
  name,
  label: label(name),
  kind: 'field',
  default: value as ParamDef['default'],
  field: { op: noodles, input: name },
  ...(port ? { port: true, portType: 'value' as PortType } : {}),
})

const PLACEMENTS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

// #rrggbb or #rrggbbaa as deck's [r, g, b, a]
function rgba(hex: unknown): number[] | undefined {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return undefined
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16)
  return [n(1), n(3), n(5), hex.length === 9 ? n(7) : 255]
}

interface ExtensionValue {
  extension: { type: string; [k: string]: unknown }
  props: Record<string, unknown>
}

// A layer description: its extensions as POJOs (instantiated later, as Noodles did) with their
// props merged into the layer's own
function layerOf(type: string, id: string, p: Record<string, unknown>): Record<string, unknown> {
  const { extensions, ...props } = p
  const list = ((extensions as (ExtensionValue | null)[] | undefined) ?? []).filter(
    (e): e is ExtensionValue => !!e
  )
  const layer: Record<string, unknown> = { ...props, type, id }
  if (list.length) {
    layer.extensions = list.map(e => e.extension)
    for (const e of list) Object.assign(layer, e.props)
  }
  return layer
}

const layerBase = (noodles: string): ParamDef[] => [
  toggle('visible', true),
  num('opacity', 1, { min: 0, max: 1, step: 0.01 }),
  field(noodles, 'parameters', { depthTest: true }),
  field(noodles, 'extensions', [], true),
]

const viewBase = (noodles: string): ParamDef[] => [
  num('x', 0, { step: 0.1 }),
  num('y', 0, { step: 0.1 }),
  text('width', '100%'),
  text('height', '100%'),
  field(noodles, 'padding', { top: 0, right: 0, bottom: 0, left: 0 }),
  toggle('clear', false),
  color('clearColor', '#00000000'),
  field(noodles, 'parameters', {}),
]

const viewOp = (
  type: string,
  noodles: string,
  deckType: string,
  description: string,
  params: ParamDef[],
  viewState: Record<string, unknown>,
  build?: DeckOp['build']
): DeckOp => ({
  noodles,
  def: {
    type,
    label: deckType.replace(/View$/, ' View'),
    category: 'output',
    description,
    inputs: [],
    outputs: [{ name: 'view', type: 'value' }],
    params: [...viewBase(noodles), ...params, field(noodles, 'viewState', viewState, true)],
  },
  build: build ?? ((p, id) => ({ type: deckType, id, ...p })),
})

const widgetOp = (
  type: string,
  noodles: string,
  deckType: string,
  title: string,
  description: string,
  placement: string,
  params: ParamDef[] = []
): DeckOp => ({
  noodles,
  def: {
    type,
    label: title,
    category: 'output',
    description,
    inputs: [],
    outputs: [{ name: 'widget', type: 'value' }],
    params: [menu('placement', placement, PLACEMENTS), ...params, text('viewId', '')],
  },
  build: (p, id) => {
    const { viewId, ...rest } = p
    return { id, type: deckType, ...rest, ...(viewId ? { viewId } : {}) }
  },
})

const extensionOp = (
  type: string,
  noodles: string,
  title: string,
  description: string,
  params: ParamDef[],
  build: (p: Record<string, unknown>) => ExtensionValue
): DeckOp => ({
  noodles,
  def: {
    type,
    label: title,
    category: 'output',
    description,
    inputs: [],
    outputs: [{ name: 'extension', type: 'value' }],
    params,
  },
  build,
})

const layerOp = (
  type: string,
  noodles: string,
  title: string,
  description: string,
  params: ParamDef[],
  build: DeckOp['build']
): DeckOp => ({
  noodles,
  lists: ['extensions'],
  def: {
    type,
    label: title,
    category: 'layer',
    description,
    inputs: [],
    outputs: [{ name: 'layer', type: 'layer' }],
    params: [...params, ...layerBase(noodles)],
  },
  build,
})

// A Bbox field's value as deck's flat [west, south, east, north]
function flatBounds(b: unknown): number[] {
  if (Array.isArray(b) && b.length === 4 && b.every(v => typeof v === 'number')) return b
  const [sw, ne] = Array.isArray(b)
    ? b
    : [(b as { southwest?: unknown })?.southwest, (b as { northeast?: unknown })?.northeast]
  const point = (v: unknown): number[] =>
    Array.isArray(v) ? v : [(v as { lng: number }).lng, (v as { lat: number }).lat]
  if (!sw || !ne)
    throw new Error(`Bounds must be [[west, south], [east, north]], got ${JSON.stringify(b)}`)
  return [...point(sw), ...point(ne)]
}

const ramps = d3 as unknown as Record<string, ((t: number) => string) | undefined>

// Base styles by URL, fetched once: an override edit should not refetch the style
const styles = new Map<string, Promise<Record<string, unknown>>>()
function fetchStyle(url: string): Promise<Record<string, unknown>> {
  let style = styles.get(url)
  if (!style) {
    style = fetch(url).then(r => {
      if (!r.ok) throw new Error(`Failed to fetch map style: ${r.statusText}`)
      return r.json()
    })
    styles.set(url, style)
    style.catch(() => styles.delete(url))
  }
  return style
}

export const DECK_OPS: DeckOp[] = [
  // --- views ---------------------------------------------------------------------------
  viewOp(
    'map-view',
    'MapViewOp',
    'MapView',
    'A deck.gl map view.',
    [
      toggle('orthographic', false),
      num('fovy', 40, { min: 0.1, max: 179.9, step: 0.1 }),
      toggle('repeat', false),
      num('altitude', 1.5, { step: 0.1 }),
      num('nearZMultiplier', 0.1, { min: 0, step: 0.1 }),
      num('farZMultiplier', 1.01, { min: 0, step: 0.1 }),
    ],
    { latitude: 40.7128, longitude: -74.006, zoom: 12, bearing: 0, pitch: 0, position: [0, 0, 0] },
    (p, id) => ({
      type: 'MapView',
      id,
      ...p,
      viewState: { ...(p.viewState as object), maxPitch: 90 },
    })
  ),
  viewOp(
    'globe-view',
    'GlobeViewOp',
    'GlobeView',
    'A deck.gl globe view.',
    [
      num('altitude', 1.5, { step: 0.1 }),
      num('nearZMultiplier', 0.1, { min: 0, step: 0.1 }),
      num('farZMultiplier', 1.01, { min: 0, step: 0.1 }),
    ],
    { latitude: 40.7128, longitude: -74.006, zoom: 12 }
  ),
  viewOp(
    'orbit-view',
    'OrbitViewOp',
    'OrbitView',
    'A deck.gl orbit view.',
    [
      toggle('orthographic', false),
      menu('orbitAxis', 'Z', ['X', 'Y', 'Z']),
      num('near', 0.1, { min: 0, step: 0.1 }),
      num('far', 100000, { min: 0, step: 0.1 }),
      num('fovy', 40, { min: 0.1, max: 179.9, step: 0.1 }),
    ],
    { target: [0, 0, 0], rotationOrbit: 0, rotationX: 0, zoom: 1 }
  ),
  viewOp(
    'orthographic-view',
    'OrthographicViewOp',
    'OrthographicView',
    'A deck.gl orthographic view.',
    [
      num('near', 0.1, { min: 0, step: 0.1 }),
      num('far', 100000, { min: 0, step: 0.1 }),
      toggle('flipY', false),
    ],
    { target: [0, 0, 0], zoom: 0 }
  ),
  viewOp(
    'first-person-view',
    'FirstPersonViewOp',
    'FirstPersonView',
    'A deck.gl first person view.',
    [
      toggle('orthographic', false),
      num('near', 0.1, { min: 0, step: 0.1 }),
      num('far', 100000, { min: 0, step: 0.1 }),
      num('fovy', 40, { min: 0.1, max: 179.9, step: 0.1 }),
    ],
    { latitude: 40.7128, longitude: -74.006, position: [0, 0, 0], bearing: 0, pitch: 0 }
  ),
  {
    noodles: 'MapViewStateOp',
    def: {
      type: 'view-state',
      label: 'View State',
      category: 'output',
      description:
        'A camera: longitude, latitude, zoom, pitch and bearing, which numbers can drive.',
      inputs: [],
      outputs: [{ name: 'viewState', type: 'value' }],
      params: [
        num('longitude', -74.006, { min: -180, max: 180, step: 0.001 }),
        num('latitude', 40.7128, { min: -90, max: 90, step: 0.001 }),
        num('zoom', 12, { min: 0, max: 24, step: 0.1 }),
        num('pitch', 0, { min: 0, max: 85, step: 0.1 }),
        num('bearing', 0, { step: 0.1 }),
      ],
    },
    build: p => ({
      longitude: p.longitude,
      latitude: p.latitude,
      zoom: p.zoom,
      pitch: p.pitch,
      bearing: p.bearing,
    }),
  },

  // --- widgets -------------------------------------------------------------------------
  widgetOp(
    'compass-widget',
    'CompassWidgetOp',
    'CompassWidget',
    'Compass Widget',
    'Compass and bearing reset widget',
    'top-right'
  ),
  widgetOp(
    'fps-widget',
    'FpsWidgetOp',
    '_StatsWidget',
    'FPS Widget',
    'Display frames per second (FPS) and rendering stats widget',
    'top-left'
  ),
  widgetOp(
    'fullscreen-widget',
    'FullscreenWidgetOp',
    'FullscreenWidget',
    'Fullscreen Widget',
    'Enter/exit fullscreen widget',
    'top-right'
  ),
  widgetOp(
    'scale-widget',
    'ScaleWidgetOp',
    '_ScaleWidget',
    'Scale Widget',
    'Display a map distance scale widget',
    'bottom-left',
    [text('label', 'Scale')]
  ),
  widgetOp(
    'screenshot-widget',
    'ScreenshotWidgetOp',
    'ScreenshotWidget',
    'Screenshot Widget',
    'Download current frame as PNG widget',
    'top-right'
  ),
  widgetOp(
    'zoom-widget',
    'ZoomWidgetOp',
    'ZoomWidget',
    'Zoom Widget',
    'Zoom in/out buttons widget',
    'top-right',
    [num('zoomStep', 1, { min: 0, step: 0.1 })]
  ),
  {
    noodles: 'BitmapOverlayWidgetOp',
    def: {
      type: 'bitmap-overlay-widget',
      label: 'Bitmap Overlay',
      category: 'output',
      description: 'Display a bitmap image as a screen-space overlay',
      inputs: [],
      outputs: [{ name: 'widget', type: 'value' }],
      params: [
        url('image'),
        menu('placement', 'top-right', [...PLACEMENTS, 'fill']),
        num('width', 200, { min: 1, max: 2000, step: 1 }),
        num('height', 200, { min: 1, max: 2000, step: 1 }),
        num('opacity', 1, { min: 0, max: 1, step: 0.01 }),
        num('scale', 1, { min: 0.25, max: 4, step: 0.25 }),
        num('offsetX', 0, { min: -2000, max: 2000, step: 1 }),
        num('offsetY', 0, { min: -2000, max: 2000, step: 1 }),
        text('viewId', ''),
      ],
    },
    // A `@/` image is resolved to a URL with the layers' project assets
    build: (p, id) => {
      const { viewId, ...rest } = p
      return { id, type: 'BitmapOverlay', ...rest, ...(viewId ? { viewId } : {}) }
    },
  },
  {
    noodles: 'LegendWidgetOp',
    def: {
      type: 'legend-widget',
      label: 'Legend Widget',
      category: 'output',
      description: 'Display a color scale legend overlay on the visualization',
      inputs: [],
      outputs: [{ name: 'widget', type: 'value' }],
      params: [
        text('colorScheme', 'viridis'),
        text('label', ''),
        num('minValue', 0, { step: 0.1 }),
        num('maxValue', 1, { step: 0.1 }),
        menu('placement', 'bottom-right', PLACEMENTS),
        num('steps', 12, { min: 2, max: 32, step: 1 }),
        num('scale', 1, { min: 0.25, max: 4, step: 0.25 }),
      ],
    },
    build: (p, id) => {
      // A d3 scheme by name, as ColorRamp's colorScheme names them: viridis is interpolateViridis
      const scheme = String(p.colorScheme ?? 'viridis')
      const interpolate = ramps[`interpolate${scheme[0]?.toUpperCase()}${scheme.slice(1)}`]
      if (!interpolate) throw new Error(`Unknown color scheme '${scheme}'`)
      const steps = Math.max(2, Math.round(Number(p.steps) || 12))
      const { colorScheme: _, steps: __, ...rest } = p
      return {
        id,
        type: 'LegendWidget',
        ...rest,
        colorStops: Array.from({ length: steps }, (_, i) => interpolate(i / (steps - 1))),
      }
    },
  },

  // --- extensions ----------------------------------------------------------------------
  extensionOp(
    'brightness-contrast',
    'BrightnessContrastExtensionOp',
    'Brightness / Contrast',
    'Adjust brightness and contrast of a layer',
    [
      num('brightness', 0, { min: -1, max: 1, step: 0.01 }),
      num('contrast', 0, { min: -1, max: 1, step: 0.01 }),
    ],
    p => ({ extension: { type: 'BrightnessContrastExtension' }, props: { brightnessContrast: p } })
  ),
  extensionOp(
    'hue-saturation',
    'HueSaturationExtensionOp',
    'Hue / Saturation',
    'Adjust hue and saturation of a layer',
    [
      num('hue', 0, { min: -1, max: 1, step: 0.01 }),
      num('saturation', 0, { min: -1, max: 1, step: 0.01 }),
    ],
    p => ({ extension: { type: 'HueSaturationExtension' }, props: { hueSaturation: p } })
  ),
  extensionOp(
    'vibrance',
    'VibranceExtensionOp',
    'Vibrance',
    'Adjust vibrance of a layer',
    [num('amount', 0, { min: -1, max: 1, step: 0.01 })],
    p => ({ extension: { type: 'VibranceExtension' }, props: { vibrance: p } })
  ),
  extensionOp(
    'clip-extension',
    'ClipExtensionOp',
    'Clip Extension',
    'Clip layers by a rectangular bounds',
    [toggle('clipByInstance', false), field('ClipExtensionOp', 'clipBounds', [0, 0, 1, 1])],
    p => ({
      extension: { type: 'ClipExtension', clipByInstance: p.clipByInstance },
      props: { clipBounds: p.clipBounds },
    })
  ),
  extensionOp(
    'mask-extension',
    'MaskExtensionOp',
    'Mask Extension',
    'Show/hide layer objects by a geofence',
    [text('maskId', ''), toggle('maskByInstance', false)],
    p => ({ extension: { type: 'MaskExtension' }, props: p })
  ),
  extensionOp(
    'mask-3d-extension',
    'Mask3DExtensionOp',
    'Mask 3D Extension',
    'Show only a sphere around a lng/lat/alt (meters) of a Tile3DLayer, fading to white at the edge',
    [
      // Downtown Los Angeles
      field('Mask3DExtensionOp', 'targetPosition', [-118.2637, 34.0171, 0]),
      num('innerRadius', 1000, { min: 0, step: 1 }),
      num('fadeRange', 7, { min: 0, step: 0.1 }),
    ],
    p => {
      // The shader takes an Earth-centered position, not lng/lat/alt
      const [lng, lat, alt = 0] = (p.targetPosition as number[] | undefined) ?? [0, 0, 0]
      return {
        extension: { type: 'Mask3DExtension' },
        props: { ...p, targetPosition: toMaskTargetPosition(lng, lat, alt) },
      }
    }
  ),
  extensionOp(
    'terrain-extension',
    'TerrainExtensionOp',
    'Terrain Extension',
    'Render a terrain layer on the map',
    [menu('terrainDrawMode', 'offset', ['offset', 'drape'])],
    p => ({ extension: { type: 'TerrainExtension' }, props: p })
  ),

  // Extensions with per-row values in deck take constants here; a per-row value is a
  // migration error, and a DataFilterExtension is a filter on the rows
  extensionOp(
    'path-style',
    'PathStyleExtensionOp',
    'Path Style',
    'Dashed and offset paths',
    [
      toggle('dash', true),
      toggle('highPrecisionDash', false),
      toggle('offset', false),
      menu('dashMode', 'segment', ['segment', 'path']),
      toggle('dashJustified', false),
      menu('dashUnits', 'widths', ['widths', 'pixels', 'meters', 'common']),
      field('PathStyleExtensionOp', 'getDashArray', [4, 4]),
      num('getOffset', 0, { min: -10000, max: 10000, step: 0.1 }),
      toggle('dashGapPickable', false),
    ],
    ({ dash, highPrecisionDash, offset, dashMode, ...props }) => ({
      extension: {
        type: 'PathStyleExtension',
        dash,
        dashMode: highPrecisionDash ? 'path' : dashMode,
        offset,
      },
      props,
    })
  ),
  extensionOp(
    'collision-filter',
    'CollisionFilterExtensionOp',
    'Collision Filter',
    'Hide overlapping objects, keeping the higher priority one',
    [
      toggle('collisionEnabled', true),
      text('collisionGroup', 'default'),
      num('getCollisionPriority', 0),
    ],
    p => ({ extension: { type: 'CollisionFilterExtension' }, props: p })
  ),
  extensionOp(
    'fill-style',
    'FillStyleExtensionOp',
    'Fill Style',
    'Fill polygons with a pattern from an atlas',
    [
      toggle('fillPatternEnabled', true),
      toggle('proceduralPattern', false),
      toggle('fillPatternMask', true),
      menu('fillPatternSizeUnits', 'meters', ['pixels', 'meters', 'common']),
      text('fillPatternAtlas', ''),
      field('FillStyleExtensionOp', 'fillPatternMapping', null),
      text('getFillPattern', ''),
      num('getFillPatternScale', 1),
      field('FillStyleExtensionOp', 'getFillPatternOffset', [0, 0]),
      color('getFillPatternBackgroundColor', '#00000000'),
    ],
    ({ fillPatternEnabled, proceduralPattern, getFillPatternBackgroundColor, ...props }) => ({
      extension: { type: 'FillStyleExtension', pattern: fillPatternEnabled, proceduralPattern },
      props: { ...props, getFillPatternBackgroundColor: rgba(getFillPatternBackgroundColor) },
    })
  ),
  extensionOp(
    'brushing',
    'BrushingExtensionOp',
    'Brushing',
    'Show only objects near the pointer',
    [
      num('brushingRadius', 100, { min: 0, max: 100000 }),
      toggle('brushingEnabled', true),
      menu('brushingTarget', 'source', ['source', 'target', 'source_target', 'custom']),
      field('BrushingExtensionOp', 'getBrushingTarget', [0, 0]),
    ],
    p => ({ extension: { type: 'BrushingExtension' }, props: p })
  ),

  // --- layers deck loads itself --------------------------------------------------------
  layerOp(
    'bitmap',
    'BitmapLayerOp',
    'Bitmap Layer',
    'Render a raster image at specified boundaries',
    [
      url('image'),
      field(
        'BitmapLayerOp',
        'bounds',
        [
          [-122.5, 37.7],
          [-122.3, 37.9],
        ],
        true
      ),
      num('desaturate', 0, { min: 0, max: 1, step: 0.01 }),
      color('transparentColor', ''),
      color('tintColor', ''),
    ],
    (p, id) => {
      const { bounds, transparentColor, tintColor, ...rest } = p
      // Deck's own array defaults stand when a color is unset: null crashes BitmapLayer.draw
      return {
        ...layerOf('BitmapLayer', id, rest),
        bounds: flatBounds(bounds),
        ...(rgba(transparentColor) ? { transparentColor: rgba(transparentColor) } : {}),
        ...(rgba(tintColor) ? { tintColor: rgba(tintColor) } : {}),
      }
    }
  ),
  layerOp(
    'mvt',
    'MVTLayerOp',
    'MVT Layer',
    'Render Mapbox Vector Tiles (MVT)',
    [
      text('data', 'https://example.com/tiles/{z}/{x}/{y}.mvt'),
      num('minZoom', 0, { min: 0, max: 24, step: 0.1 }),
      num('maxZoom', 24, { min: 0, max: 24, step: 0.1 }),
      toggle('filled', true),
      toggle('stroked', false),
      toggle('lineAntialiasing', false),
      num('lineWidthMinPixels', 1, { min: 0, step: 0.1 }),
      color('getFillColor', '#000000ff'),
      color('getLineColor', '#000000ff'),
      num('getLineWidth', 1, { min: 0, step: 0.1 }),
      num('getPointRadius', 1, { step: 0.1 }),
      menu('pointRadiusUnits', 'pixels', ['pixels', 'meters']),
      toggle('autoLabels', false),
    ],
    (p, id) =>
      layerOf('MVTLayer', id, {
        ...p,
        getFillColor: rgba(p.getFillColor),
        getLineColor: rgba(p.getLineColor),
      })
  ),
  layerOp(
    'raster-tiles',
    'RasterTileLayerOp',
    'Raster Tile Layer',
    'Render a raster tile layer on the map',
    [
      text(
        'data',
        'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'
      ),
      num('minZoom', 0, { min: 0, max: 24, step: 0.1 }),
      num('maxZoom', 24, { min: 0, max: 24, step: 0.1 }),
      num('tileSize', 256, { min: 1, step: 0.1 }),
    ],
    (p, id) => layerOf('RasterTileLayer', id, p)
  ),
  layerOp(
    'terrain',
    'TerrainLayerOp',
    'Terrain Layer',
    'Render a terrain mesh from heightmap tiles',
    [
      text('elevationData', 'https://example.com/elevation/{z}/{x}/{y}.png'),
      text('texture', ''),
      num('meshMaxError', 4, { min: 0, step: 0.1 }),
      field('TerrainLayerOp', 'elevationDecoder', {
        rScaler: 1,
        gScaler: 0,
        bScaler: 0,
        offset: 0,
      }),
      field('TerrainLayerOp', 'bounds', null, true),
      color('color', '#ffffffff'),
      toggle('wireframe', false),
    ],
    (p, id) => {
      const { bounds, color: tint, texture, ...rest } = p
      return {
        ...layerOf('TerrainLayer', id, rest),
        color: rgba(tint),
        ...(texture ? { texture } : {}),
        ...(bounds ? { bounds: flatBounds(bounds) } : {}),
      }
    }
  ),
  layerOp(
    'tile-3d',
    'Tile3DLayerOp',
    'Tile 3D Layer',
    'Render 3D tiles on the map (Google, Cesium, or a custom tileset URL)',
    [
      menu('provider', 'Google', ['Cesium', 'Generic', 'Google']),
      text('tilesetUrl', ''),
      menu('operation', 'terrain+draw', ['terrain+draw', 'draw', 'terrain']),
      toggle('wireframe', false),
      toggle('flatLighting', true),
      toggle('throttleRequests', false),
      num('pointSize', 1, { min: 0, step: 0.1 }),
      num('maxLodMetricValue', 2, { min: 0, step: 0.1 }),
      num('maxScreenSpaceError', 50, { min: 0, step: 0.1 }),
      num('maxMemoryUsage', 2024, { min: 0, step: 0.1 }),
    ],
    async (p, id) => {
      const {
        flatLighting,
        provider,
        tilesetUrl,
        throttleRequests,
        maxMemoryUsage,
        maxScreenSpaceError,
        ...rest
      } = p
      // The page's API keys: loaded here so the migrator can read this table without them
      const { getKeysStore } = await import('../noodles/keys-store')
      const { getKey } = getKeysStore()
      const googleKey = getKey('googleMaps')
      const cesiumToken = getKey('cesium')
      if (provider === 'Google' && !googleKey) {
        throw new Error(
          'Tile3DLayer: Google Maps API key is not set (add it in Settings > API Keys)'
        )
      }
      if (provider === 'Cesium' && !cesiumToken) {
        throw new Error(
          'Tile3DLayer: Cesium Ion access token is not set (add it in Settings > API Keys)'
        )
      }
      const fallback =
        provider === 'Cesium'
          ? 'https://assets.ion.cesium.com/242005/tileset.json'
          : 'https://tile.googleapis.com/v1/3dtiles/root.json'
      const { CesiumIonLoader, Tiles3DLoader } = await import('@loaders.gl/3d-tiles')
      return {
        ...layerOf('Tile3DLayer', id, rest),
        data: tilesetUrl || fallback,
        loader: provider === 'Cesium' ? CesiumIonLoader : Tiles3DLoader,
        loadOptions:
          provider === 'Google'
            ? { fetch: { headers: { 'X-GOOG-API-KEY': googleKey } } }
            : provider === 'Cesium'
              ? { tileset: { throttleRequests }, 'cesium-ion': { accessToken: cesiumToken } }
              : null,
        onTilesetLoad: (tileset: {
          maximumMemoryUsage: number
          setProps(p: Record<string, unknown>): void
        }) => {
          tileset.maximumMemoryUsage = Number(maxMemoryUsage)
          tileset.setProps({
            throttleRequests,
            maximumScreenSpaceError: maxScreenSpaceError,
            maximumMemoryUsage: maxMemoryUsage,
          })
        },
        _subLayerProps: flatLighting ? { scenegraph: { _lighting: 'flat' } } : undefined,
      }
    }
  ),

  // --- basemap style -------------------------------------------------------------------
  {
    noodles: 'MapStyleConfiguratorOp',
    def: {
      type: 'map-style',
      label: 'Map Style',
      category: 'output',
      description:
        "A basemap style with your changes: layers hidden or recolored, from the style editor. Wire it into the deck's map style.",
      inputs: [],
      outputs: [{ name: 'mapStyle', type: 'value' }],
      params: [
        url(
          'baseStyle',
          'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'
        ),
        field('MapStyleConfiguratorOp', 'overrides', { layers: [], global: {} }),
      ],
    },
    build: async p => {
      const base = p.baseStyle
      if (!base) return ''
      const style =
        typeof base === 'string' ? await fetchStyle(base) : (base as Record<string, unknown>)
      const overrides = (p.overrides ?? { layers: [], global: {} }) as never
      return applyStyleOverrides(style as never, overrides)
    },
  },

  // --- basemap sources -----------------------------------------------------------------
  {
    noodles: 'PMTilesOp',
    def: {
      type: 'pmtiles',
      label: 'PMTiles',
      category: 'output',
      description: 'Load a PMTiles archive as a MapLibre vector or raster source',
      inputs: [],
      outputs: [{ name: 'sourceConfig', type: 'value' }],
      params: [
        url('url'),
        text('sourceLayer', ''),
        num('minZoom', 0, { min: 0, max: 22, step: 0.1 }),
        num('maxZoom', 14, { min: 0, max: 22, step: 0.1 }),
      ],
    },
    build: p =>
      p.url
        ? {
            type: 'vector',
            url: `pmtiles://${p.url}`,
            minzoom: p.minZoom,
            maxzoom: p.maxZoom,
            ...(p.sourceLayer ? { sourceLayer: p.sourceLayer } : {}),
          }
        : null,
  },
  {
    noodles: 'XYZTileOp',
    def: {
      type: 'xyz-tiles',
      label: 'XYZ Tiles',
      category: 'output',
      description: 'Configure a raster XYZ tile source from a URL template ({z}/{x}/{y})',
      inputs: [],
      outputs: [{ name: 'sourceConfig', type: 'value' }],
      params: [
        text('url', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
        text('subdomains', 'abc'),
        num('tileSize', 256, { min: 64, max: 1024, step: 64 }),
        num('minZoom', 0, { min: 0, max: 22, step: 0.1 }),
        num('maxZoom', 19, { min: 0, max: 22, step: 0.1 }),
        text('attribution', ''),
      ],
    },
    build: p => {
      const template = String(p.url ?? '')
      if (!template) return null
      const subdomains = String(p.subdomains ?? '')
      return {
        type: 'raster',
        tiles: subdomains ? [...subdomains].map(s => template.replace('{s}', s)) : [template],
        tileSize: p.tileSize,
        minzoom: p.minZoom,
        maxzoom: p.maxZoom,
        ...(p.attribution ? { attribution: p.attribution } : {}),
      }
    },
  },
]

export const DECK_OP_INDEX = new Map(DECK_OPS.map(o => [o.def.type, o]))
// The deck operator replacing a Noodles operator class
export const DECK_OP_FOR = new Map(DECK_OPS.map(o => [o.noodles, o]))

let registered = false

// Register every deck operator, and the curve operators, with the planner's catalog. Idempotent.
export function registerDeckOperators(): void {
  if (registered) return
  registered = true
  for (const op of DECK_OPS) registerOperator(op.def)
  registerValueOperators()
}
