/**
 * A compiled program's layers as deck.gl layers.
 *
 * One factory per layer kind, each fed deck's binary-attribute fast path: typed arrays the
 * program runtime produced, never a per-row accessor inside deck. Vertex layers (path, trips)
 * use deck's binary path format — flat vertex arrays plus `startIndices` — which is exactly
 * the row model the planner emits: one row per vertex, ordered by path id. A polygon layer is
 * the same with a ring id: `SolidPolygonLayer` gets the vertex array, polygon starts and the
 * triangle indices computed here (`triangulate`), so deck does no tessellation of its own.
 *
 * The one thing this module is careful about is identity. A layer's binary `data` object is
 * built once per `LayerData` and reused, so when only a prop changes — the trips layer's
 * `currentTime` on every frame of an animation, a keyframed camera — deck sees the same data
 * and re-uploads nothing. Rebuilding it per frame would turn a uniform write into a full
 * attribute upload and throw away the point of routing that parameter as `prop`.
 */

// From the deck.gl bundle the app itself imports, never the @deck.gl/* packages: Vite
// pre-bundles them apart, and an aggregation layer whose sublayer comes from the other copy
// draws nothing (its geometry buffers belong to a different luma.gl).
import { OBJLoader } from '@loaders.gl/obj'
import { PLYLoader } from '@loaders.gl/ply'
import { type LayerKind, RAMP_STOPS, type ResolvedProp, toUint8Color } from '@noodles.gl/planner'
import {
  ArcLayer,
  ColumnLayer,
  ContourLayer,
  GridCellLayer,
  GridLayer,
  HeatmapLayer,
  HexagonLayer,
  IconLayer,
  type Layer,
  LineLayer,
  PathLayer,
  PointCloudLayer,
  ScatterplotLayer,
  ScenegraphLayer,
  ScreenGridLayer,
  SimpleMeshLayer,
  SolidPolygonLayer,
  TextLayer,
  TripsLayer,
} from 'deck.gl'
import type { LayerData } from './execute'
import { triangulate } from './triangulate'

export interface ProgramLayerInput {
  id: string
  kind: LayerKind
  data?: LayerData
  /** Channel -> attribute, from the plan's resolved layer bindings. */
  bindings: { channel: string; attribute: string }[]
  props: Record<string, ResolvedProp>
}

export interface ProgramPaneMetrics {
  layers: number
  instances: number
  /** Binary data objects built on the last render; 0 when only props changed. */
  rebuilt: number
  buildMs: number
  /** Polygon triangles across the layers rebuilt on the last render, and earcut's time. */
  triangles: number
  triangulateMs: number
}

interface TextRow {
  position: number[]
  text: string
  color?: number[]
  size?: number
  angle?: number
}

type Binary = {
  length: number
  startIndices?: Uint32Array
  attributes: Record<string, unknown>
  // Text and icon layers: an object per row, as deck lays out glyphs and icons on the CPU
  texts?: TextRow[]
  /** Polygon layers: ring outlines as closed paths over the same vertex array. */
  outline?: { length: number; startIndices: Uint32Array; attributes: Record<string, unknown> }
  triangles?: number
  triangulateMs?: number
}

/**
 * Deck layers for a program's layers, with binary data built once per `LayerData`. A prop-only
 * change hands deck the same data object, so it re-uploads nothing.
 */
export class DeckLayerBuilder {
  private readonly built = new WeakMap<LayerData, Binary>()
  // `pickable`: deck picks the layers' features, for the editor's click-to-edit
  constructor(private readonly options: { pickable?: boolean } = {}) {}
  private metricsValue: ProgramPaneMetrics = {
    layers: 0,
    instances: 0,
    rebuilt: 0,
    buildMs: 0,
    triangles: 0,
    triangulateMs: 0,
  }

  metrics(): ProgramPaneMetrics {
    return this.metricsValue
  }

  /** Deck layers per program layer id, so a caller can interleave them with other layers. */
  build(inputs: ProgramLayerInput[]): Map<string, Layer[]> {
    const started = performance.now()
    let rebuilt = 0
    let instances = 0
    let triangles = 0
    let triangulateMs = 0
    let count = 0
    const out = new Map<string, Layer[]>()
    for (const input of inputs) {
      if (!input.data || input.data.rows === 0) continue
      let binary = this.built.get(input.data)
      if (!binary) {
        binary = toBinary(input)
        this.built.set(input.data, binary)
        rebuilt++
        triangles += binary.triangles ?? 0
        triangulateMs += binary.triangulateMs ?? 0
      }
      instances += input.data.rows
      const layers = buildLayers(input, binary, this.options.pickable ?? false)
      count += layers.length
      out.set(input.id, layers)
    }
    this.metricsValue = {
      layers: count,
      instances,
      rebuilt,
      buildMs: performance.now() - started,
      triangles,
      triangulateMs,
    }
    return out
  }
}

// ---------------------------------------------------------------------------

const attr = (input: ProgramLayerInput, channel: string) => {
  const name = input.bindings.find(b => b.channel === channel)?.attribute
  return name ? input.data!.attributes.get(name) : undefined
}

/** Positions as `[lng, lat, metres]`: deck's position attributes are three-wide. */
function positions(a: { data: Float32Array; width: number }, rows: number): Float32Array {
  if (a.width === 3) return a.data
  const out = new Float32Array(rows * 3)
  for (let i = 0; i < rows; i++) {
    out[i * 3] = a.data[i * a.width]
    out[i * 3 + 1] = a.data[i * a.width + 1]
  }
  return out
}

function colors(
  a: { data: Float32Array; width: number } | undefined,
  rows: number,
  alpha = 255
): Uint8Array | undefined {
  return a ? toUint8Color(a.data, a.width, rows, alpha) : undefined
}

function toBinary(input: ProgramLayerInput): Binary {
  const d = input.data!
  const n = d.rows
  const at: Record<string, unknown> = {}
  const put = (
    deckName: string,
    value: Float32Array | Uint8Array | undefined,
    size: number,
    normalized = false
  ) => {
    if (value) at[deckName] = { value, size, ...(normalized ? { normalized: true } : {}) }
  }
  const pos = (channel: string) => {
    const a = attr(input, channel)
    return a ? positions(a, n) : undefined
  }
  const scalar = (channel: string) => attr(input, channel)?.data

  switch (input.kind) {
    case 'scatter':
      put('getPosition', pos('position'), 3)
      put('getFillColor', colors(attr(input, 'color'), n), 4, true)
      put('getRadius', scalar('radius'), 1)
      return { length: n, attributes: at }
    case 'arc':
      put('getSourcePosition', pos('sourcePosition'), 3)
      put('getTargetPosition', pos('targetPosition'), 3)
      put('getSourceColor', colors(attr(input, 'sourceColor'), n), 4, true)
      put('getTargetColor', colors(attr(input, 'targetColor'), n), 4, true)
      put('getWidth', scalar('width'), 1)
      return { length: n, attributes: at }
    case 'column':
      put('getPosition', pos('position'), 3)
      put('getElevation', scalar('elevation'), 1)
      put('getFillColor', colors(attr(input, 'color'), n), 4, true)
      return { length: n, attributes: at }
    case 'path':
    case 'trips': {
      const starts = d.starts ?? new Uint32Array([0])
      put('getPath', pos('position'), 3)
      put('getColor', colors(attr(input, 'color'), n), 4, true)
      if (input.kind === 'path') put('getWidth', scalar('width'), 1)
      else put('getTimestamps', scalar('timestamp'), 1)
      return { length: starts.length, startIndices: starts, attributes: at }
    }
    case 'polygon': {
      const starts = d.starts ?? new Uint32Array([0])
      const rings = d.rings ?? starts
      const p = pos('position')
      put('getPolygon', p, 3)
      put('getFillColor', colors(attr(input, 'color'), n), 4, true)
      put('getElevation', scalar('elevation'), 1)
      const lineColor = colors(attr(input, 'lineColor'), n)
      const tri = p ? triangulate(p, 3, n, starts, rings) : undefined
      if (tri) at.indices = tri.indices
      return {
        length: starts.length,
        startIndices: starts,
        attributes: at,
        // The same vertex array, cut at every ring instead of every polygon.
        outline: p
          ? {
              length: rings.length,
              startIndices: rings,
              attributes: {
                getPath: { value: p, size: 3 },
                ...(lineColor ? { getColor: { value: lineColor, size: 4, normalized: true } } : {}),
              },
            }
          : undefined,
        triangles: tri ? tri.indices.length / 3 : 0,
        triangulateMs: tri?.ms ?? 0,
      }
    }
    case 'heatmap':
      put('getPosition', pos('position'), 3)
      put('getWeight', scalar('weight'), 1)
      return { length: n, attributes: at }
    case 'hexagon':
    case 'grid':
      put('getPosition', pos('position'), 3)
      put('getColorWeight', scalar('colorWeight'), 1)
      put('getElevationWeight', scalar('elevationWeight'), 1)
      return { length: n, attributes: at }
    case 'mesh':
    case 'scenegraph': {
      put('getPosition', pos('position'), 3)
      put('getColor', colors(attr(input, 'color'), n), 4, true)
      // deck derives each instance's model matrix from per-object accessors and never reads
      // binary orientation or scale, so the matrix itself is the binary attribute.
      const transform = ['orientation', 'scale', 'translation'].map(c => attr(input, c))
      if (transform.some(Boolean)) {
        const [orientation, scale, translation] = transform.map(a =>
          a ? positions(a, n) : undefined
        )
        at.instanceModelMatrix = {
          value: modelMatrices(n, orientation, scale, translation),
          size: 12,
        }
      }
      return { length: n, attributes: at }
    }
    case 'line':
      put('getSourcePosition', pos('sourcePosition'), 3)
      put('getTargetPosition', pos('targetPosition'), 3)
      put('getColor', colors(attr(input, 'color'), n), 4, true)
      put('getWidth', scalar('width'), 1)
      return { length: n, attributes: at }
    case 'point-cloud':
      put('getPosition', pos('position'), 3)
      put('getNormal', pos('normal'), 3)
      put('getColor', colors(attr(input, 'color'), n), 4, true)
      return { length: n, attributes: at }
    case 'screen-grid':
    case 'contour':
      put('getPosition', pos('position'), 3)
      put('getWeight', scalar('weight'), 1)
      return { length: n, attributes: at }
    case 'text':
    case 'icon': {
      // Text and icons have no binary path worth taking at label counts: deck lays out glyphs
      // and icons per row on the CPU regardless. Capped, because thousands are unreadable.
      const p = attr(input, 'position')
      const stringName = input.bindings.find(b => b.channel === input.kind)?.attribute
      const strings = stringName ? (d.strings.get(stringName) ?? []) : []
      const count = Math.min(n, 5000)
      const color = colors(attr(input, 'color'), n)
      const size = scalar('size')
      const angle = scalar('angle')
      const texts = Array.from(
        { length: count },
        (_, i): TextRow => ({
          position: p
            ? [
                p.data[i * p.width],
                p.data[i * p.width + 1],
                p.width > 2 ? p.data[i * p.width + 2] : 0,
              ]
            : [0, 0, 0],
          text: strings[i] ?? '',
          ...(color ? { color: Array.from(color.subarray(i * 4, i * 4 + 4)) } : {}),
          ...(size ? { size: size[i] } : {}),
          ...(angle ? { angle: angle[i] } : {}),
        })
      )
      return { length: count, attributes: {}, texts }
    }
  }
}

const num = (v: ResolvedProp | undefined, fallback: number): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}
const rgb = (
  v: ResolvedProp | undefined,
  fallback: [number, number, number]
): [number, number, number, number] => {
  if (Array.isArray(v) && v.length >= 3)
    return [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2]), 255]
  return [...fallback, 255]
}

/**
 * The deck layers for one program layer, built fresh: what the pane draws, without the pane's
 * identity cache or a map. Exported so a test can render them on a bare `Deck`.
 */
export function programLayers(input: ProgramLayerInput): Layer[] {
  return buildLayers(input, toBinary(input))
}

/** A layer kind's deck layers: one, or for a stroked polygon a fill and its ring outlines. */
function buildLayers(input: ProgramLayerInput, binary: Binary, pickable = false): Layer[] {
  if (input.kind !== 'polygon') {
    const layer = buildLayer(input, binary, pickable)
    return layer ? [layer] : []
  }
  const p = input.props
  const fill = buildLayer(input, binary, pickable)
  const layers = fill ? [fill] : []
  if (p.stroked === true && binary.outline) {
    const perRowColor = 'getColor' in binary.outline.attributes
    layers.push(
      new PathLayer({
        id: `${input.id}:outline`,
        opacity: num(p.opacity, 1),
        pickable,
        parameters: BLEND_PARAMETERS[String(p.blend)] ?? {},
        data: binary.outline as never,
        _pathType: 'loop',
        widthUnits: p.lineWidthUnits === 'meters' ? 'meters' : 'pixels',
        widthScale: num(p.lineWidthScale, 1),
        widthMinPixels: num(p.lineWidthMinPixels, 1),
        getWidth: 1,
        ...(perRowColor
          ? {}
          : {
              getColor: rgb(p.lineColor, [255, 255, 255]),
              updateTriggers: { getColor: String(p.lineColor) },
            }),
      } as never)
    )
  }
  return layers
}

/** luma.gl blend parameters for a layer's `blend` prop, matching Noodles' Blending presets. */
const BLEND_PARAMETERS: Record<string, Record<string, unknown>> = {
  normal: {},
  additive: {
    blend: true,
    blendColorSrcFactor: 'src-alpha',
    blendColorDstFactor: 'dst-alpha',
    blendColorOperation: 'add',
  },
  subtractive: {
    blend: true,
    blendColorSrcFactor: 'one',
    blendColorDstFactor: 'one-minus-dst-color',
    blendAlphaSrcFactor: 'src-alpha',
    blendAlphaDstFactor: 'dst-alpha',
    blendColorOperation: 'reverse-subtract',
    blendAlphaOperation: 'add',
  },
}

const RADIANS = Math.PI / 180

/**
 * deck's mesh instance matrix, 12 floats per row: a 3x3 rotation-and-scale from pitch, yaw and
 * roll in degrees, then the translation. The formula is deck's `calculateTransformMatrix`.
 */
function modelMatrices(
  n: number,
  orientation: Float32Array | undefined,
  scale: Float32Array | undefined,
  translation: Float32Array | undefined
): Float32Array {
  const out = new Float32Array(n * 12)
  for (let i = 0; i < n; i++) {
    const pitch = (orientation?.[i * 3] ?? 0) * RADIANS
    const yaw = (orientation?.[i * 3 + 1] ?? 0) * RADIANS
    const roll = (orientation?.[i * 3 + 2] ?? 0) * RADIANS
    const [scx, scy, scz] = scale ? [scale[i * 3], scale[i * 3 + 1], scale[i * 3 + 2]] : [1, 1, 1]
    const sr = Math.sin(roll)
    const sp = Math.sin(pitch)
    const sw = Math.sin(yaw)
    const cr = Math.cos(roll)
    const cp = Math.cos(pitch)
    const cw = Math.cos(yaw)
    const m = out.subarray(i * 12, i * 12 + 12)
    m[0] = scx * cw * cp
    m[1] = scx * sw * cp
    m[2] = scx * -sp
    m[3] = scy * (-sw * cr + cw * sp * sr)
    m[4] = scy * (cw * cr + sw * sp * sr)
    m[5] = scy * cp * sr
    m[6] = scz * (sw * sr + cw * sp * cr)
    m[7] = scz * (-cw * sr + sw * sp * cr)
    m[8] = scz * cp * cr
    if (translation) m.set(translation.subarray(i * 3, i * 3 + 3), 9)
  }
  return out
}

/** Six colors from a ramp, for an aggregation layer's color range; deck's default when unset. */
function colorRange(name: ResolvedProp | undefined): { colorRange?: number[][] } {
  const stops = typeof name === 'string' && name ? RAMP_STOPS[name] : undefined
  if (!stops) return {}
  return {
    colorRange: Array.from({ length: 6 }, (_, i) => {
      const t = (i / 5) * (stops.length - 1)
      const lo = Math.min(Math.floor(t), stops.length - 2)
      const f = t - lo
      return [0, 1, 2].map(c =>
        Math.round((stops[lo][c] + (stops[lo + 1][c] - stops[lo][c]) * f) * 255)
      )
    }),
  }
}

const widthUnits = (v: ResolvedProp | undefined) =>
  v === 'meters' || v === 'common' ? v : 'pixels'

function buildLayer(
  input: ProgramLayerInput,
  binary: Binary,
  pickable: boolean
): Layer | undefined {
  const p = input.props
  const has = (deckName: string) => deckName in binary.attributes
  const opacity = num(p.opacity, 1)
  const parameters = BLEND_PARAMETERS[String(p.blend)] ?? {}
  // The kind is part of the id: deck keeps a layer's state by id, so a node whose layer kind
  // changes (scatter to column, say) must start fresh rather than inherit the old layer's state.
  const common = { id: `${input.id}:${input.kind}`, opacity, pickable, parameters }
  // A constant color is an accessor too; its trigger is its value, so deck re-reads it only
  // when the color actually changes.
  const constant = (deckName: string, value: [number, number, number, number]) =>
    has(deckName) ? {} : { [deckName]: value, updateTriggers: { [deckName]: value.join(',') } }

  switch (input.kind) {
    case 'scatter':
      return new ScatterplotLayer({
        ...common,
        data: binary as never,
        radiusScale: num(p.radiusScale, 1),
        radiusUnits: p.radiusUnits === 'meters' ? 'meters' : 'pixels',
        radiusMinPixels: 0.5,
        getRadius: has('getRadius') ? undefined : 1,
        ...constant('getFillColor', rgb(p.fillColor, [255, 140, 0])),
      } as never)
    case 'arc':
      return new ArcLayer({
        ...common,
        data: binary as never,
        widthScale: num(p.widthScale, 1),
        widthUnits: widthUnits(p.widthUnits),
        getWidth: has('getWidth') ? undefined : 1,
        getHeight: num(p.height, 1),
        greatCircle: p.greatCircle === true,
        ...constant('getSourceColor', rgb(p.sourceColor, [0, 180, 255])),
        ...constant('getTargetColor', rgb(p.targetColor, [255, 60, 120])),
      } as never)
    case 'column':
      // A cell size makes square cells of that size: deck's GridCellLayer
      if (p.cellSize !== undefined) {
        return new GridCellLayer({
          ...common,
          data: binary as never,
          cellSize: num(p.cellSize, 1000),
          coverage: num(p.coverage, 1),
          elevationScale: num(p.elevationScale, 1),
          extruded: p.extruded !== false,
          getElevation: has('getElevation') ? undefined : 1,
          ...constant('getFillColor', rgb(p.fillColor, [255, 170, 60])),
        } as never)
      }
      return new ColumnLayer({
        ...common,
        data: binary as never,
        radius: num(p.radius, 100),
        elevationScale: num(p.elevationScale, 1),
        extruded: true,
        diskResolution: 12,
        getElevation: has('getElevation') ? undefined : 1,
        ...constant('getFillColor', rgb(p.fillColor, [255, 170, 60])),
      } as never)
    case 'path':
      return new PathLayer({
        ...common,
        data: binary as never,
        _pathType: 'open',
        widthScale: num(p.widthScale, 1),
        widthMinPixels: num(p.widthMinPixels, 1),
        widthUnits: widthUnits(p.widthUnits),
        getWidth: has('getWidth') ? undefined : 1,
        jointRounded: true,
        capRounded: true,
        ...constant('getColor', rgb(p.color, [120, 200, 255])),
      } as never)
    case 'trips':
      return new TripsLayer({
        ...common,
        data: binary as never,
        _pathType: 'open',
        // The times are offsets from the layer's origin (`LayerData.timeOrigin`), so the clock is too
        currentTime: num(p.currentTime, 0) - (input.data?.timeOrigin ?? 0),
        trailLength: num(p.trailLength, 180),
        fadeTrail: p.fadeTrail !== false,
        widthMinPixels: num(p.widthMinPixels, 2),
        widthScale: num(p.widthScale, 1),
        widthUnits: widthUnits(p.widthUnits ?? 'meters'),
        jointRounded: true,
        capRounded: true,
        ...constant('getColor', rgb(p.color, [253, 128, 93])),
      } as never)
    case 'polygon':
      return new SolidPolygonLayer({
        ...common,
        data: binary as never,
        // The rows are already rings in order and `indices` is the triangulation, so deck must
        // neither re-wind nor re-tessellate them.
        _normalize: false,
        filled: p.filled !== false,
        extruded: p.extruded === true,
        elevationScale: num(p.elevationScale, 1),
        getElevation: has('getElevation') ? undefined : 1,
        ...constant('getFillColor', rgb(p.fillColor, [80, 160, 220])),
      } as never)
    case 'heatmap':
      return new HeatmapLayer({
        ...common,
        data: binary as never,
        radiusPixels: num(p.radiusPixels, 30),
        intensity: num(p.intensity, 1),
        threshold: num(p.threshold, 0.05),
        aggregation: p.aggregation === 'MEAN' ? 'MEAN' : 'SUM',
        getWeight: has('getWeight') ? undefined : num(p.weight, 1),
        ...colorRange(p.colorRange),
      } as never)
    case 'hexagon':
    case 'grid': {
      const LayerClass = input.kind === 'hexagon' ? HexagonLayer : GridLayer
      return new LayerClass({
        ...common,
        data: binary as never,
        ...(input.kind === 'hexagon'
          ? { radius: num(p.radius, 1000) }
          : { cellSize: num(p.cellSize, 1000) }),
        colorAggregation: String(p.colorAggregation ?? 'SUM'),
        elevationAggregation: String(p.elevationAggregation ?? 'SUM'),
        upperPercentile: num(p.upperPercentile, 100),
        lowerPercentile: num(p.lowerPercentile, 0),
        extruded: p.extruded === true,
        elevationScale: num(p.elevationScale, 1),
        // deck's GPU aggregator bins nothing from binary float32 attributes (its domain stays
        // empty); the CPU aggregator reads them directly.
        gpuAggregation: false,
        getColorWeight: has('getColorWeight') ? undefined : 1,
        getElevationWeight: has('getElevationWeight') ? undefined : 1,
        ...colorRange(p.colorRange),
      } as never)
    }
    case 'mesh':
    case 'scenegraph': {
      const model = String(p.model ?? '')
      const placement = {
        ...common,
        data: binary as never,
        sizeScale: num(p.sizeScale, 1),
        ...constant('getColor', rgb(p.color, [255, 255, 255])),
        // Constants, so deck's own matrix update stays constant; per-row transforms arrive
        // as the binary instanceModelMatrix instead.
        getOrientation: [0, 0, 0],
        getScale: [1, 1, 1],
        getTranslation: [0, 0, 0],
      }
      if (input.kind === 'scenegraph') {
        return new ScenegraphLayer({
          ...placement,
          scenegraph: model,
          sizeMinPixels: num(p.sizeMinPixels, 0),
          sizeMaxPixels: num(p.sizeMaxPixels, 100),
        } as never)
      }
      return new SimpleMeshLayer({
        ...placement,
        mesh: model,
        wireframe: p.wireframe === true,
        loaders: [/\.ply(\?|$)/i.test(model) ? PLYLoader : OBJLoader],
      } as never)
    }
    case 'text': {
      const size = num(p.size, 12)
      const color = rgb(p.color, [230, 230, 230])
      const outline = num(p.outlineWidth, 2)
      return new TextLayer({
        ...common,
        data: binary.texts ?? [],
        getPosition: (d: TextRow) => d.position,
        getText: (d: TextRow) => d.text,
        // A per-row size multiplies Size, as a per-row radius multiplies a radius scale
        getSize: (d: TextRow) => (d.size ?? 1) * size,
        getColor: (d: TextRow) => d.color ?? color,
        getAngle: (d: TextRow) => d.angle ?? num(p.angle, 0),
        getPixelOffset: [num(p.offsetX, 0), num(p.offsetY, 0)],
        getTextAnchor: String(p.anchor ?? 'middle'),
        getAlignmentBaseline: String(p.baseline ?? 'center'),
        sizeUnits: widthUnits(p.sizeUnits),
        billboard: p.billboard !== false,
        updateTriggers: {
          getColor: String(p.color),
          getSize: String(p.size),
          getAngle: String(p.angle),
          getPixelOffset: `${p.offsetX},${p.offsetY}`,
        },
        fontFamily: String(p.fontFamily ?? 'ui-monospace, SF Mono, Menlo, monospace'),
        fontWeight: num(p.fontWeight, 400),
        outlineWidth: outline,
        outlineColor: [...rgb(p.outlineColor, [8, 9, 13]).slice(0, 3), 220],
        background: p.background === true,
        getBackgroundColor: rgb(p.backgroundColor, [255, 255, 255]),
        fontSettings: { sdf: outline > 0 },
      } as never)
    }
    case 'icon': {
      const mapping = String(p.iconMapping ?? '{}').trim()
      const color = rgb(p.color, [0, 0, 0])
      return new IconLayer({
        ...common,
        data: binary.texts ?? [],
        iconAtlas: String(p.iconAtlas ?? ''),
        // Inline JSON, or a URL deck fetches
        iconMapping: mapping.startsWith('{') ? JSON.parse(mapping) : mapping,
        getPosition: (d: TextRow) => d.position,
        getIcon: (d: TextRow) => d.text,
        getSize: (d: TextRow) => d.size ?? 1,
        getColor: (d: TextRow) => d.color ?? color,
        getAngle: (d: TextRow) => d.angle ?? 0,
        getPixelOffset: [num(p.offsetX, 0), num(p.offsetY, 0)],
        sizeScale: num(p.sizeScale, 1),
        sizeUnits: widthUnits(p.sizeUnits),
        sizeMinPixels: num(p.sizeMinPixels, 0),
        billboard: p.billboard !== false,
        updateTriggers: { getColor: String(p.color) },
      } as never)
    }
    case 'line':
      return new LineLayer({
        ...common,
        data: binary as never,
        widthScale: num(p.widthScale, 1),
        widthUnits: widthUnits(p.widthUnits),
        widthMinPixels: num(p.widthMinPixels, 0),
        getWidth: has('getWidth') ? undefined : 1,
        ...constant('getColor', rgb(p.color, [255, 255, 255])),
      } as never)
    case 'point-cloud':
      return new PointCloudLayer({
        ...common,
        data: binary as never,
        pointSize: num(p.pointSize, 10),
        sizeUnits: widthUnits(p.sizeUnits),
        getNormal: has('getNormal') ? undefined : [0, 0, 1],
        ...constant('getColor', rgb(p.color, [0, 0, 0])),
      } as never)
    case 'screen-grid':
      return new ScreenGridLayer({
        ...common,
        data: binary as never,
        cellSizePixels: num(p.cellSizePixels, 100),
        cellMarginPixels: num(p.cellMarginPixels, 2),
        aggregation: String(p.aggregation ?? 'SUM'),
        // As for the grid and hexagon layers, the CPU aggregator reads binary attributes
        gpuAggregation: false,
        getWeight: has('getWeight') ? undefined : 1,
        ...colorRange(p.colorRange),
      } as never)
    case 'contour': {
      let contours: unknown = []
      try {
        contours = JSON.parse(String(p.contours ?? '[]'))
      } catch {
        // Contours that do not parse draw nothing
      }
      return new ContourLayer({
        ...common,
        data: binary as never,
        cellSize: num(p.cellSize, 1000),
        aggregation: String(p.aggregation ?? 'SUM'),
        contours,
        zOffset: num(p.zOffset, 0.005),
        gpuAggregation: false,
        getWeight: has('getWeight') ? undefined : 1,
      } as never)
    }
  }
}
