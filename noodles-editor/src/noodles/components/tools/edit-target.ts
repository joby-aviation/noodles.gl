// Which node the Draw tool can edit, and how its geometry is read and written. The Draw
// tool edits two kinds of node: a GeoEditor (a FeatureCollection kept as text) and a
// Point (one coordinate). A layer drawing either of them hands the edit to that node.

export type EditKind = 'geo-editor' | 'point'

export interface EditTarget {
  opId: string
  kind: EditKind
}

interface FieldLike {
  value: unknown
  setValue: (value: unknown) => void
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

// The node itself when it holds editable geometry, else the GeoEditor or Point wired
// into a layer's Data input
export function resolveEditTarget(
  opId: string,
  getOp: (id: string) => EditableOp | undefined,
  edges: EdgeLike[]
): EditTarget | null {
  const op = getOp(opId)
  if (!op) return null
  const kind = kindOf(op)
  if (kind) return { opId, kind }
  if (!displayName(op).endsWith('Layer')) return null
  const dataEdge = edges.find(edge => edge.target === opId && edge.targetHandle === 'par.data')
  const source = dataEdge && getOp(dataEdge.source)
  const sourceKind = source && kindOf(source)
  return source && sourceKind ? { opId: source.id, kind: sourceKind } : null
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
