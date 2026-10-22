// noodles.json (schema 18) -> the planner's EditorDoc.
//
// Noodles graphs pass JS rows between operators, and a layer's per-row values arrive as accessor
// functions built by AccessorOp, MapRange, ColorRamp and Math. The planner passes tables, and a
// layer reads attributes. So the conversion is mostly about accessors: every accessor-producing
// operator a layer reads becomes a row node (attribute, map-range, color-ramp) on the layer's
// data path, keeping its node id and position, and the layer's channel names the attribute it
// writes. Numbers on MapRange and ColorRamp stay parameters, so dragging one still rebinds
// instead of recompiling.
//
// This module is a frozen migration: it must not import operator classes, because those change
// and this conversion must not. Noodles' defaults are written out below for that reason, and
// because noodles.json stores only inputs that differ from them.

import {
  type DocEdge,
  type DocNode,
  type EditorDoc,
  type ParamValue,
  parseExpr,
} from '@noodles.gl/planner'

export interface NoodlesNode {
  id: string
  type: string
  position?: { x: number; y: number }
  parentId?: string
  data?: { inputs?: Record<string, unknown>; locked?: boolean }
}

export interface NoodlesEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface NoodlesProject {
  version: number
  nodes: NoodlesNode[]
  edges: NoodlesEdge[]
  viewport?: unknown
  timeline?: unknown
  name?: string
  editorSettings?: unknown
  apiKeys?: unknown
}

export interface Migrated {
  doc: EditorDoc
  /** Inputs and nodes that had no equivalent and were dropped, for the user to review. */
  warnings: string[]
}

export class MigrationError extends Error {}

// ---------------------------------------------------------------------------
// Noodles defaults (schema 18), for the inputs this conversion reads
// ---------------------------------------------------------------------------

const DEFAULTS: Record<string, Record<string, unknown>> = {
  ScatterplotLayerOp: {
    visible: true,
    opacity: 1,
    getFillColor: '#fff',
    getRadius: 20,
    radiusScale: 1,
    radiusUnits: 'pixels',
  },
  ArcLayerOp: {
    visible: true,
    opacity: 1,
    getSourceColor: '#fff',
    getTargetColor: '#fff',
    widthUnits: 'meters',
    getWidth: 1,
    getHeight: 1,
  },
  MapRangeOp: { val: 0, inMin: 0, inMax: 1, outMin: 0, outMax: 1 },
  ColorRampOp: { colorScheme: 'viridis', value: 0 },
  MathOp: { operator: 'add', a: 0, b: 0 },
  BlendingOp: { mode: 'normal' },
  ColorOp: { color: '#fff' },
  FileOp: { format: 'json' },
  MaplibreBasemapOp: {
    mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    projection: 'mercator',
    viewState: { latitude: 40.7128, longitude: -74.006, zoom: 12, pitch: 0, bearing: 0 },
  },
  OutOp: {
    display: 'fixed',
    width: 1920,
    height: 1080,
    lod: 2,
    scaleMode: 'fit',
    waitForData: true,
    codec: 'avc',
    bitrateMbps: 10,
    bitrateMode: 'constant',
    scaleControl: 0.3,
    framerate: 30,
    captureDelay: 50,
    rendersDirectory: 'renders',
  },
}

/**
 * Schema 18 operators with accessor inputs. Their per-row work becomes attribute nodes, and the
 * layers among them become planner layers; none of them runs as a host operator.
 */
const ACCESSOR_OPS = new Set(
  (
    'A5LayerOp ArcLayerOp BezierCurveOp BrushingExtensionOp CategoricalColorRampOp ' +
    'CollisionFilterExtensionOp ColorRampOp ColumnLayerOp CombineRGBAOp CombineXYOp CombineXYZOp ' +
    'ContourLayerOp DataFilterExtensionOp ExtentOp FillStyleExtensionOp GeoJsonLayerOp ' +
    'GeohashLayerOp GreatCircleLayerOp GridCellLayerOp GridLayerOp H3ClusterLayerOp ' +
    'H3HexagonLayerOp HSLOp HeatmapLayerOp HexagonLayerOp IconLayerOp LineLayerOp MVTLayerOp ' +
    'MapRangeOp MathOp PathLayerOp PathStyleExtensionOp PointCloudLayerOp PolygonLayerOp ' +
    'QuadkeyLayerOp RampOp S2LayerOp ScatterplotLayerOp ScenegraphLayerOp ScreenGridLayerOp ' +
    'SimpleMeshLayerOp SolidPolygonLayerOp SplitRGBAOp SplitXYOp SplitXYZOp SwitchOp ' +
    'TextLayerOp TimeSeriesOp TripsLayerOp AccessorOp'
  ).split(' ')
)

/** Deck inputs that pass host values through to deck and MapLibre. */
/** Layers and sources the planner draws and reads itself. */
const PLANNER_LAYERS = new Set(['ScatterplotLayerOp', 'ArcLayerOp'])
const PLANNER_SOURCES = new Set(['FileOp', 'DuckDbOp'])

const DECK_VALUE_PORTS = ['views', 'effects', 'widgets', 'viewState', 'maplibreLayers']

/** Inputs every layer has that the planner handles itself, or that change nothing drawn. */
const LAYER_IGNORED = new Set(['data', 'parameters', 'extensions', 'updateTriggers'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const segment = (id: string) => id.slice(id.lastIndexOf('/') + 1)

/** An attribute name from a node path: `/position-accessor` -> `position_accessor`. */
const attributeName = (id: string) =>
  segment(id)
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1')

const handleField = (handle: string | null | undefined) =>
  (handle ?? '').replace(/^(par|out)\./, '')

/** `#rrggbb` or `#rrggbbaa` -> [r, g, b] and alpha 0–255. */
function parseHex(value: unknown): { rgb: [number, number, number]; alpha: number } | undefined {
  if (typeof value !== 'string') return undefined
  let hex = value.replace(/^#/, '')
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('')
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return undefined
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16)
  return { rgb: [n(0), n(2), n(4)], alpha: hex.length === 8 ? n(6) : 255 }
}

const num = (v: unknown, fallback: number) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}

/** A number as expression text: always with a decimal point, so the planner reads a float. */
const lit = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x))

/**
 * A Noodles accessor expression in the planner's expression language, or undefined when it
 * uses something the planner can't express (row index, the whole dataset, `op()`, strings,
 * method calls). Per-row JS is `d.column`; the planner reads the column by name.
 */
export function translateAccessor(js: string): string | undefined {
  let text = js.trim().replace(/;$/, '')
  if (/^return\s/.test(text)) text = text.slice(7)
  // Anything beyond column reads and Math is a host expression.
  if (/\bop\(|\bdata\b|\bi\b|=>|`|\.\w+\(/.test(text.replace(/\bMath\.\w+\(/g, '')))
    return undefined
  text = text
    .replace(/\bd\.([A-Za-z_]\w*)/g, '$1')
    .replace(/\bMath\.PI\b/g, String(Math.PI))
    .replace(/\bMath\.E\b/g, String(Math.E))
    .replace(/\bMath\.log\(/g, 'ln(')
    .replace(/\bMath\.(\w+)\(/g, '$1(')
    .replace(/===/g, '==')
    .replace(/!==/g, '!=')
  if (/\bd\b/.test(text)) return undefined
  try {
    parseExpr(text)
  } catch {
    return undefined
  }
  return text
}

const MATH: Record<string, (a: string, b: string) => string> = {
  add: (a, b) => `(${a} + ${b})`,
  subtract: (a, b) => `(${a} - ${b})`,
  multiply: (a, b) => `(${a} * ${b})`,
  divide: (a, b) => `(${a} / ${b})`,
  modulo: (a, b) => `(${a} % ${b})`,
  power: (a, b) => `pow(${a}, ${b})`,
  min: (a, b) => `min(${a}, ${b})`,
  max: (a, b) => `max(${a}, ${b})`,
  sine: a => `sin(${a})`,
  cosine: a => `cos(${a})`,
  tan: a => `tan(${a})`,
  log: a => `ln(${a})`,
  sqrt: a => `sqrt(${a})`,
  round: a => `round(${a})`,
  floor: a => `floor(${a})`,
  ceil: a => `ceil(${a})`,
  abs: a => `abs(${a})`,
  rad: a => `(${a} * ${lit(Math.PI / 180)})`,
  deg: a => `(${a} * ${lit(180 / Math.PI)})`,
}

const MATH_JS: Record<string, (a: number, b: number) => number> = {
  add: (a, b) => a + b,
  subtract: (a, b) => a - b,
  multiply: (a, b) => a * b,
  divide: (a, b) => a / b,
  modulo: (a, b) => a % b,
  power: (a, b) => a ** b,
  min: Math.min,
  max: Math.max,
  sine: Math.sin,
  cosine: Math.cos,
  tan: Math.tan,
  log: Math.log,
  sqrt: Math.sqrt,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  rad: a => (a * Math.PI) / 180,
  deg: a => (a * 180) / Math.PI,
}

// ---------------------------------------------------------------------------
// Values a layer input can resolve to
// ---------------------------------------------------------------------------

type Value =
  /** A per-row value: an attribute written by a row node, or an expression over columns. */
  | { kind: 'row'; expr: string }
  | { kind: 'const'; value: unknown }
  /** A shared ColorOp, referenced by its planner node's name. */
  | { kind: 'color'; node: string }

interface RowNode {
  node: DocNode
  /** Attributes it reads, so the chain can be ordered. */
  reads: Set<string>
  attribute: string
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

export function toEditorDoc(project: NoodlesProject): Migrated {
  if (project.version !== 18) {
    throw new MigrationError(
      `Expected a schema 18 project; migrate it first (got ${project.version})`
    )
  }
  const warnings: string[] = []
  const byId = new Map(project.nodes.map(n => [n.id, n]))
  const inputs = (n: NoodlesNode) => ({ ...DEFAULTS[n.type], ...(n.data?.inputs ?? {}) })
  const incoming = (target: string, field: string) =>
    project.edges.filter(e => e.target === target && handleField(e.targetHandle) === field)
  const incomingOne = (target: string, field: string) => incoming(target, field)[0]
  const position = (n: NoodlesNode) => ({ x: n.position?.x ?? 0, y: n.position?.y ?? 0 })

  if (project.nodes.some(n => n.parentId || n.type === 'ContainerOp')) {
    throw new MigrationError('Containers are not converted yet')
  }

  const nodes: DocNode[] = []
  const edges: DocEdge[] = []
  const used = new Set<string>()
  let edgeCount = 0
  const edge = (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
    index?: number
  ) =>
    edges.push({
      id: `e${edgeCount++}`,
      source,
      sourcePort,
      target,
      targetPort,
      ...(index !== undefined ? { index } : {}),
    })

  // --- output: DeckRenderer + Out + MaplibreBasemap -> one deck node ----------------------
  const deckOp = project.nodes.find(n => n.type === 'DeckRendererOp')
  if (!deckOp) throw new MigrationError('No DeckRenderer to convert')
  const outOp = project.nodes.find(n => n.type === 'OutOp')
  const basemapEdge = incomingOne(deckOp.id, 'basemap')
  const basemap = basemapEdge ? byId.get(basemapEdge.source) : undefined
  if (basemap && basemap.type !== 'MaplibreBasemapOp') {
    throw new MigrationError(
      `Basemap ${basemap.id} is a ${basemap.type}; only MaplibreBasemap converts`
    )
  }
  used.add(deckOp.id)
  if (outOp) used.add(outOp.id)
  if (basemap) used.add(basemap.id)
  const deckParams: Record<string, ParamValue> = {}
  if (basemap) {
    const b = inputs(basemap)
    const view = {
      ...(DEFAULTS.MaplibreBasemapOp.viewState as object),
      ...(b.viewState as object),
    } as Record<string, number>
    deckParams.mapStyle = String(b.mapStyle)
    deckParams.projection = String(b.projection)
    for (const k of ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'])
      deckParams[k] = num(view[k], 0)
    for (const k of Object.keys(basemap.data?.inputs ?? {})) {
      if (!['mapStyle', 'projection', 'viewState'].includes(k))
        warnings.push(`${basemap.id}: dropped '${k}'`)
    }
  } else {
    deckParams.basemap = 'none'
  }
  if (outOp) {
    const o = inputs(outOp)
    for (const k of Object.keys(DEFAULTS.OutOp)) deckParams[k] = o[k] as ParamValue
  }
  for (const k of Object.keys(deckOp.data?.inputs ?? {}))
    warnings.push(`${deckOp.id}: dropped '${k}'`)
  nodes.push({
    id: deckOp.id,
    op: 'deck',
    name: segment(deckOp.id),
    ...position(deckOp),
    params: deckParams,
  })

  // --- data sources --------------------------------------------------------------------
  const sources = new Map<string, string>()
  const source = (id: string): string => {
    const cached = sources.get(id)
    if (cached) return cached
    const n = byId.get(id)
    if (!n) throw new MigrationError(`Missing node ${id}`)
    const i = inputs(n)
    if (n.type === 'FileOp' && i.format === 'csv' && typeof i.url === 'string') {
      nodes.push({
        id,
        op: 'file',
        name: segment(id),
        ...position(n),
        params: { url: i.url, format: 'csv' },
      })
    } else if (n.type === 'DuckDbOp' && typeof i.query === 'string' && !i.query.includes('{{')) {
      nodes.push({ id, op: 'sql', name: segment(id), ...position(n), params: { query: i.query } })
    } else {
      throw new MigrationError(`${id} (${n.type}) is not a CSV file or a plain DuckDB query yet`)
    }
    used.add(id)
    sources.set(id, id)
    return id
  }

  // --- accessors -> row nodes, grouped by the data source they read ---------------------
  const chains = new Map<string, Map<string, RowNode>>()
  const chainOf = (src: string) => {
    const existing = chains.get(src)
    if (existing) return existing
    const created = new Map<string, RowNode>()
    chains.set(src, created)
    return created
  }

  const colorNodes = new Set<string>()

  /** What a layer input (or an accessor op's input) is: a literal, or wired from an op. */
  const resolve = (src: string, nodeId: string, field: string, literal: unknown): Value => {
    const e = incomingOne(nodeId, field)
    if (!e) return { kind: 'const', value: literal }
    return resolveOutput(src, e.source)
  }

  const resolveOutput = (src: string, id: string): Value => {
    const n = byId.get(id)
    if (!n) throw new MigrationError(`Missing node ${id}`)
    const chain = chainOf(src)
    const existing = chain.get(id)
    if (existing) return { kind: 'row', expr: existing.attribute }
    const i = inputs(n)
    const attribute = attributeName(id)
    const add = (op: string, params: Record<string, ParamValue>, reads: string[]) => {
      if ([...chains.values()].some(c => c !== chain && c.has(id))) {
        throw new MigrationError(`${id} is read by layers on two different data sources`)
      }
      chain.set(id, {
        node: { id, op, name: segment(id), ...position(n), params },
        reads: new Set(reads),
        attribute,
      })
      used.add(id)
      return { kind: 'row' as const, expr: attribute }
    }
    const rowReads = (...vs: Value[]) => vs.flatMap(v => (v.kind === 'row' ? [v.expr] : []))
    const exprOf = (v: Value, what: string): string => {
      if (v.kind === 'row') return v.expr
      if (v.kind === 'const' && typeof v.value === 'number') return lit(v.value)
      throw new MigrationError(`${id}: ${what} is not a number`)
    }

    switch (n.type) {
      case 'AccessorOp': {
        const expr = translateAccessor(String(i.expression ?? ''))
        if (!expr)
          throw new MigrationError(`${id}: '${i.expression}' needs JS the planner can't express`)
        return add('attribute', { name: attribute, expression: expr }, [])
      }
      case 'MapRangeOp': {
        const val = resolve(src, id, 'val', i.val)
        if (val.kind === 'const') {
          const [a, b, c, d] = ['inMin', 'inMax', 'outMin', 'outMax'].map(k => num(i[k], 0))
          return { kind: 'const', value: c + ((d - c) * (num(val.value, 0) - a)) / (b - a) }
        }
        return add(
          'map-range',
          {
            input: exprOf(val, 'val'),
            name: attribute,
            kind: 'linear',
            inMin: num(i.inMin, 0),
            inMax: num(i.inMax, 1),
            outMin: num(i.outMin, 0),
            outMax: num(i.outMax, 1),
            // d3's scaleLinear, which MapRange used, does not clamp.
            clamp: false,
          },
          rowReads(val)
        )
      }
      case 'ColorRampOp': {
        const value = resolve(src, id, 'value', i.value)
        if (value.kind !== 'row')
          throw new MigrationError(`${id}: a constant ColorRamp is not converted yet`)
        return add(
          'color-ramp',
          { input: value.expr, ramp: String(i.colorScheme), min: 0, max: 1, name: attribute },
          rowReads(value)
        )
      }
      case 'MathOp': {
        const op = String(i.operator)
        const a = resolve(src, id, 'a', i.a)
        const b = resolve(src, id, 'b', i.b)
        if (!MATH[op]) throw new MigrationError(`${id}: Math '${op}' is not converted`)
        if (a.kind === 'const' && b.kind === 'const') {
          return { kind: 'const', value: MATH_JS[op](num(a.value, 0), num(b.value, 0)) }
        }
        return add(
          'attribute',
          { name: attribute, expression: MATH[op](exprOf(a, 'a'), exprOf(b, 'b')) },
          rowReads(a, b)
        )
      }
      case 'ColorOp': {
        if (!colorNodes.has(id)) {
          const c = parseHex(i.color)
          if (!c) throw new MigrationError(`${id}: color '${i.color}' is not a hex color`)
          if (c.alpha !== 255) warnings.push(`${id}: dropped alpha ${c.alpha} from ${i.color}`)
          nodes.push({
            id,
            op: 'color',
            name: segment(id),
            ...position(n),
            params: { color: c.rgb },
          })
          colorNodes.add(id)
          used.add(id)
        }
        return { kind: 'color', node: segment(id) }
      }
      default:
        throw new MigrationError(`${id}: ${n.type} feeding a layer is not converted yet`)
    }
  }

  /** A color input as a planner color channel and a constant color param. */
  const colorInput = (
    v: Value,
    owner: string,
    field: string
  ): { channel?: string; color?: ParamValue } => {
    if (v.kind === 'row') return { channel: v.expr }
    if (v.kind === 'color') return { color: { ref: `${v.node}/color` } }
    if (Array.isArray(v.value)) return { color: (v.value as number[]).slice(0, 3) }
    const c = parseHex(v.value)
    if (!c) throw new MigrationError(`${owner}: ${field} '${v.value}' is not a color`)
    if (c.alpha !== 255) warnings.push(`${owner}: dropped alpha ${c.alpha} from ${field}`)
    return { color: c.rgb }
  }

  // Accessors for colors return 0–255 in Noodles and 0–1 in the planner.
  const colorChannel = (v: Value) => {
    if (v.kind !== 'row') return v
    const writer = [...chains.values()]
      .flatMap(c => [...c.values()])
      .find(r => r.attribute === v.expr)
    return writer?.node.op === 'attribute'
      ? { kind: 'row' as const, expr: `(${v.expr}) / 255.0` }
      : v
  }

  const blendOf = (layer: NoodlesNode): string => {
    const e = incomingOne(layer.id, 'parameters')
    if (!e) return 'normal'
    const b = byId.get(e.source)
    if (b?.type !== 'BlendingOp')
      throw new MigrationError(`${layer.id}: parameters from ${b?.type} are not converted`)
    used.add(b.id)
    const mode = String(inputs(b).mode)
    if (mode === 'custom') {
      warnings.push(`${b.id}: custom blending is not converted; using normal`)
      return 'normal'
    }
    return mode
  }

  const dropUnmapped = (layer: NoodlesNode, mapped: string[]) => {
    for (const k of Object.keys(layer.data?.inputs ?? {})) {
      if (!mapped.includes(k) && !LAYER_IGNORED.has(k)) warnings.push(`${layer.id}: dropped '${k}'`)
    }
  }

  // --- host operators: their own inputs as parameters, wired by `par:` handles -----------
  const hostNodes = new Set<string>()
  const hostNode = (id: string): void => {
    if (hostNodes.has(id)) return
    const n = byId.get(id)
    if (!n) throw new MigrationError(`Missing node ${id}`)
    if (ACCESSOR_OPS.has(n.type)) {
      throw new MigrationError(`${id}: ${n.type} takes per-row accessors; it is not converted yet`)
    }
    if (n.type === 'ContainerOp' || n.type.startsWith('ForLoop')) {
      throw new MigrationError(`${id}: ${n.type} is not converted yet`)
    }
    hostNodes.add(id)
    used.add(id)
    nodes.push({
      id,
      op: n.type,
      name: segment(id),
      ...position(n),
      params: { ...(n.data?.inputs ?? {}) } as Record<string, ParamValue>,
    })
    for (const e of project.edges.filter(x => x.target === id)) {
      const field = handleField(e.targetHandle)
      const src = byId.get(e.source)
      if (!src) continue
      if (src.type === 'NumberOp') {
        numberNode(src)
        edge(src.id, 'out', id, `par:${field}`)
        continue
      }
      if (PLANNER_SOURCES.has(src.type)) {
        throw new MigrationError(
          `${id}: reading ${src.type} rows from a host operator is not converted yet`
        )
      }
      hostNode(src.id)
      edge(src.id, handleField(e.sourceHandle), id, `par:${field}`)
    }
  }
  const numberNode = (n: NoodlesNode) => {
    if (used.has(n.id)) return
    used.add(n.id)
    nodes.push({
      id: n.id,
      op: 'number',
      name: segment(n.id),
      ...position(n),
      params: { value: num(inputs(n).val, 0) },
    })
  }

  // --- layers, in the deck's order -------------------------------------------------------
  const layerEdges = incoming(deckOp.id, 'layers')
  const layerSource = new Map<string, string>()
  layerEdges.forEach((le, index) => {
    const layer = byId.get(le.source)
    if (!layer) throw new MigrationError(`Missing layer ${le.source}`)
    if (!PLANNER_LAYERS.has(layer.type)) {
      hostNode(layer.id)
      edge(layer.id, handleField(le.sourceHandle), deckOp.id, 'layers', index)
      return
    }
    const dataEdge = incomingOne(layer.id, 'data')
    if (!dataEdge) throw new MigrationError(`${layer.id} has no data`)
    const src = source(dataEdge.source)
    layerSource.set(layer.id, src)
    const i = inputs(layer)
    const v = (field: string) => resolve(src, layer.id, field, i[field])
    const params: Record<string, ParamValue> = {
      opacity: num(i.opacity, 1),
      blend: blendOf(layer),
    }
    if (i.visible === false) warnings.push(`${layer.id}: hidden layer converted as visible`)

    switch (layer.type) {
      case 'ScatterplotLayerOp': {
        const pos = v('getPosition')
        if (pos.kind !== 'row')
          throw new MigrationError(`${layer.id}: a constant position is not converted`)
        params.position = pos.expr
        const fill = colorInput(colorChannel(v('getFillColor')), layer.id, 'getFillColor')
        if (fill.channel) params.color = fill.channel
        else params.color = ''
        if (fill.color) params.fillColor = fill.color
        const radius = v('getRadius')
        const scale = num(i.radiusScale, 1)
        if (radius.kind === 'row') {
          params.radius = radius.expr
          params.radiusScale = scale
        } else if (radius.kind === 'const') {
          // A constant radius is deck's default radius of 1, scaled.
          params.radius = ''
          params.radiusScale = num(radius.value, 20) * scale
        } else {
          throw new MigrationError(`${layer.id}: getRadius from a color is not a radius`)
        }
        params.radiusUnits = String(i.radiusUnits)
        nodes.push({
          id: layer.id,
          op: 'scatter',
          name: segment(layer.id),
          ...position(layer),
          params,
        })
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getPosition',
          'getFillColor',
          'getRadius',
          'radiusScale',
          'radiusUnits',
        ])
        break
      }
      case 'ArcLayerOp': {
        const s = v('getSourcePosition')
        const t = v('getTargetPosition')
        if (s.kind !== 'row' || t.kind !== 'row') {
          throw new MigrationError(`${layer.id}: a constant arc endpoint is not converted`)
        }
        params.source = s.expr
        params.target = t.expr
        const from = colorInput(colorChannel(v('getSourceColor')), layer.id, 'getSourceColor')
        const to = colorInput(colorChannel(v('getTargetColor')), layer.id, 'getTargetColor')
        params.sourceColor = from.channel ?? ''
        params.targetColor = to.channel ?? ''
        if (from.color) params.fromColor = from.color
        if (to.color) params.toColor = to.color
        const width = v('getWidth')
        if (width.kind === 'row') {
          params.width = width.expr
          params.widthScale = 1
        } else if (width.kind === 'const') {
          params.width = ''
          params.widthScale = num(width.value, 1)
        } else {
          throw new MigrationError(`${layer.id}: getWidth from a color is not a width`)
        }
        params.widthUnits = String(i.widthUnits)
        const height = v('getHeight')
        if (height.kind !== 'const')
          throw new MigrationError(`${layer.id}: a per-row arc height is not converted`)
        params.height = num(height.value, 1)
        nodes.push({ id: layer.id, op: 'arc', name: segment(layer.id), ...position(layer), params })
        dropUnmapped(layer, [
          'opacity',
          'visible',
          'getSourcePosition',
          'getTargetPosition',
          'getSourceColor',
          'getTargetColor',
          'getWidth',
          'widthUnits',
          'getHeight',
        ])
        break
      }
      default:
        throw new MigrationError(`${layer.id}: ${layer.type} is not converted yet`)
    }
    used.add(layer.id)
    edge(layer.id, 'out', deckOp.id, 'layers', index)
  })

  for (const port of DECK_VALUE_PORTS) {
    incoming(deckOp.id, port).forEach((e, index) => {
      hostNode(e.source)
      edge(e.source, handleField(e.sourceHandle), deckOp.id, port, index)
    })
  }

  // --- chains: source -> row nodes in dependency order -> layers ----------------------------
  for (const [src, chain] of chains) {
    const rows = [...chain.values()]
    const byAttr = new Map(rows.map(r => [r.attribute, r]))
    const ordered: RowNode[] = []
    const seen = new Set<RowNode>()
    const visit = (r: RowNode) => {
      if (seen.has(r)) return
      seen.add(r)
      for (const a of r.reads) {
        const dep = byAttr.get(a)
        if (dep) visit(dep)
      }
      ordered.push(r)
    }
    for (const r of rows) visit(r)
    let head = src
    for (const r of ordered) {
      nodes.push(r.node)
      edge(head, 'out', r.node.id, 'in')
      head = r.node.id
    }
    for (const [layer, from] of layerSource) if (from === src) edge(head, 'out', layer, 'in')
  }
  for (const [layer, src] of layerSource) {
    if (!chains.has(src)) edge(src, 'out', layer, 'in')
  }

  for (const n of project.nodes) {
    if (!used.has(n.id)) warnings.push(`${n.id}: dropped ${n.type}; nothing drawn reads it`)
  }
  if (hasTracks(project.timeline)) warnings.push('timeline keyframes are not converted yet')

  return {
    doc: {
      version: 1,
      name: project.name ?? 'Untitled',
      nodes,
      edges,
      meta: {
        noodlesVersion: project.version,
        ...(project.viewport ? { viewport: project.viewport } : {}),
        ...(project.editorSettings ? { editorSettings: project.editorSettings } : {}),
        ...(project.apiKeys ? { apiKeys: project.apiKeys } : {}),
      },
    },
    warnings,
  }
}

function hasTracks(timeline: unknown): boolean {
  const sheets = (
    timeline as { sheetsById?: Record<string, { sequence?: { tracksByObject?: object } }> }
  )?.sheetsById
  return Object.values(sheets ?? {}).some(
    s => Object.keys(s.sequence?.tracksByObject ?? {}).length > 0
  )
}
