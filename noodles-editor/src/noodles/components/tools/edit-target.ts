// Which node the Draw tool can edit, and how its geometry is read and written. The Draw
// tool edits two kinds of node: a GeoEditor (a FeatureCollection kept as text) and a
// Point (one coordinate). A layer drawing either of them hands the edit to that node.

export type EditKind = 'geo-editor' | 'point'

export interface EditTarget {
  opId: string
  kind: EditKind
  // Set when the geometry input is driven by something else, which would overwrite a
  // saved edit: the reason, shown on the disabled button
  locked?: string
}

// The input that holds each kind's geometry
export const GEOMETRY_INPUT: Record<EditKind, string> = {
  'geo-editor': 'geojson',
  point: 'coordinates',
}

interface FieldLike {
  value: unknown
  setValue: (value: unknown) => void
  // Set while an expression drives the field
  expression?: string | null
}

export interface EditableOp {
  id: string
  constructor: unknown
  inputs: Record<string, unknown>
}

interface EdgeLike {
  source: string
  target: string
  targetHandle?: string | null
}

function displayName(op: EditableOp): string {
  return (op.constructor as { displayName?: string }).displayName ?? ''
}

function kindOf(op: EditableOp): EditKind | null {
  const name = displayName(op)
  if (name === 'GeoEditor') return 'geo-editor'
  if (name === 'Point') return 'point'
  return null
}

// A connection, an expression or keyframes would replace whatever the editor saves
function lockedReason(
  op: EditableOp,
  kind: EditKind,
  edges: EdgeLike[],
  isKeyframed: (opId: string, input: string) => boolean
): string | undefined {
  const input = GEOMETRY_INPUT[kind]
  if (edges.some(edge => edge.target === op.id && edge.targetHandle === `par.${input}`)) {
    return 'Its geometry comes from a connection'
  }
  if (field(op, input)?.expression) return 'Its geometry comes from an expression'
  if (isKeyframed(op.id, input)) return 'Its geometry is keyframed'
  return undefined
}

// The node itself when it holds editable geometry, else the GeoEditor or Point wired
// into a layer's Data input. `edges` should hold the graph's edges, since both the
// node's and its source's incoming edges are read.
export function resolveEditTarget(
  opId: string,
  getOp: (id: string) => EditableOp | undefined,
  edges: EdgeLike[],
  isKeyframed: (opId: string, input: string) => boolean = () => false
): EditTarget | null {
  const op = getOp(opId)
  if (!op) return null
  let target: EditableOp | undefined = op
  let kind = kindOf(op)
  if (!kind) {
    if (!displayName(op).endsWith('Layer')) return null
    const dataEdge = edges.find(edge => edge.target === opId && edge.targetHandle === 'par.data')
    target = dataEdge && getOp(dataEdge.source)
    kind = target ? kindOf(target) : null
  }
  if (!target || !kind) return null
  const locked = lockedReason(target, kind, edges, isKeyframed)
  return locked ? { opId: target.id, kind, locked } : { opId: target.id, kind }
}

function field(op: EditableOp, name: string): FieldLike | undefined {
  return op.inputs[name] as FieldLike | undefined
}

// Same parsing as GeoEditorOp.execute, so the editor shows what the node outputs
function parseGeoJson(text: unknown): GeoJSON.Feature[] {
  try {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text
    if (!parsed || typeof parsed !== 'object') return []
    if (parsed.type === 'FeatureCollection') return parsed.features ?? []
    if (parsed.type === 'Feature') return [parsed]
    if (parsed.type) return [{ type: 'Feature', geometry: parsed, properties: {} }]
    return []
  } catch {
    return []
  }
}

function pointCoordinates(value: unknown): GeoJSON.Position | null {
  if (Array.isArray(value) && value.length >= 2) return [Number(value[0]), Number(value[1])]
  if (value && typeof value === 'object' && 'lng' in value && 'lat' in value) {
    const { lng, lat } = value as { lng: number; lat: number }
    return [lng, lat]
  }
  return null
}

export function readTargetFeatures(op: EditableOp, kind: EditKind): GeoJSON.Feature[] {
  if (kind === 'geo-editor') return parseGeoJson(field(op, 'geojson')?.value)
  const coordinates = pointCoordinates(field(op, 'coordinates')?.value)
  if (!coordinates) return []
  return [{ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {} }]
}

// Returns false when there is nothing the node can hold, such as a Point with no point
export function writeTargetFeatures(
  op: EditableOp,
  kind: EditKind,
  features: GeoJSON.Feature[]
): boolean {
  if (field(op, GEOMETRY_INPUT[kind])?.expression) return false
  if (kind === 'geo-editor') {
    const target = field(op, 'geojson')
    if (!target) return false
    target.setValue(JSON.stringify({ type: 'FeatureCollection', features }, null, 2))
    return true
  }
  const point = features.find(feature => feature.geometry?.type === 'Point')
  const target = field(op, 'coordinates')
  if (!point || !target) return false
  const [lng, lat] = (point.geometry as GeoJSON.Point).coordinates
  target.setValue({ lng, lat })
  return true
}
