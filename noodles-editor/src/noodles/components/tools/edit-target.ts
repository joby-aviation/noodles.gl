// Which node the Draw tool can edit, and how its geometry is read and written. The Draw
// tool edits two kinds of node: a `features` node (GeoJSON kept as text) and a `point`
// (a longitude and a latitude). A layer drawing either of them hands the edit to that node.

import {
  type DocNode,
  type EditorDoc,
  isExpr,
  isRef,
  nameOf,
  OPERATOR_INDEX,
} from '@noodles.gl/planner'
import { setParam } from '../../../editor/doc-ops'

export type EditKind = 'features' | 'point'

export interface EditTarget {
  nodeId: string
  kind: EditKind
  // Set when something else drives the geometry, which would overwrite a saved edit: the
  // reason, shown on the disabled button
  locked?: string
}

// The parameters that hold each kind's geometry
export const GEOMETRY_PARAMS: Record<EditKind, string[]> = {
  features: ['geojson'],
  point: ['lng', 'lat'],
}

const KINDS: Record<string, EditKind | undefined> = { features: 'features', point: 'point' }

// A layer reaches its shapes through a few table steps (an attribute, a filter): it edits
// the features or point at the head of that chain
const MAX_HOPS = 8

function param(node: DocNode, name: string): unknown {
  return (
    node.params[name] ?? OPERATOR_INDEX.get(node.op)?.params.find(p => p.name === name)?.default
  )
}

// The features in the node's text, or null when the text is WKT rather than GeoJSON
function parseGeoJson(text: unknown): GeoJSON.Feature[] | null {
  if (typeof text !== 'string') return []
  if (text.trim() && !text.trim().startsWith('{')) return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return []
    if (parsed.type === 'FeatureCollection') return parsed.features ?? []
    if (parsed.type === 'Feature') return [parsed]
    if (parsed.type) return [{ type: 'Feature', geometry: parsed, properties: {} }]
    return []
  } catch {
    return []
  }
}

// A wire, an expression, a reference or keyframes would replace whatever the editor saves
function lockedReason(doc: EditorDoc, node: DocNode, kind: EditKind): string | undefined {
  for (const name of GEOMETRY_PARAMS[kind]) {
    if (doc.edges.some(e => e.target === node.id && e.targetPort === `par:${name}`))
      return 'Its geometry comes from a connection'
    const value = node.params[name]
    if (isExpr(value)) return 'Its geometry comes from an expression'
    if (isRef(value)) return 'Its geometry comes from a reference'
    if (doc.timeline?.tracks.some(t => t.target === `${node.id}.${name}`))
      return 'Its geometry is keyframed'
  }
  // The features node also reads WKT, which a save would replace with GeoJSON
  if (kind === 'features' && parseGeoJson(param(node, 'geojson')) === null)
    return 'Its geometry is written as WKT'
  return undefined
}

function isLayer(node: DocNode): boolean {
  return !!OPERATOR_INDEX.get(node.op)?.outputs.some(p => p.type === 'layer')
}

// The node itself when it holds editable geometry, else the features or point a layer draws
export function resolveEditTarget(doc: EditorDoc, nodeId: string): EditTarget | null {
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return null
  let target: DocNode | undefined = node
  let kind = KINDS[node.op]
  if (!kind) {
    if (!isLayer(node)) return null
    target = node
    for (let hop = 0; hop < MAX_HOPS && target && !kind; hop++) {
      const from: DocNode = target
      const wire = doc.edges.find(e => e.target === from.id && e.targetPort === 'in')
      target = wire && doc.nodes.find(n => n.id === wire.source)
      kind = target ? KINDS[target.op] : undefined
    }
  }
  if (!target || !kind) return null
  const locked = lockedReason(doc, target, kind)
  return locked ? { nodeId: target.id, kind, locked } : { nodeId: target.id, kind }
}

export function targetLabel(doc: EditorDoc, target: EditTarget): string {
  const node = doc.nodes.find(n => n.id === target.nodeId)
  return node ? nameOf(node) : target.nodeId
}

export function readTargetFeatures(doc: EditorDoc, target: EditTarget): GeoJSON.Feature[] {
  const node = doc.nodes.find(n => n.id === target.nodeId)
  if (!node) return []
  if (target.kind === 'features') return parseGeoJson(param(node, 'geojson')) ?? []
  const lng = Number(param(node, 'lng'))
  const lat = Number(param(node, 'lat'))
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return []
  return [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }]
}

// Writes the shapes into the node, on a draft inside `docStore().edit`. False when there is
// nothing the node can hold, such as a point with no point, or something else drives it.
export function writeTargetFeatures(
  doc: EditorDoc,
  target: EditTarget,
  features: GeoJSON.Feature[]
): boolean {
  const node = doc.nodes.find(n => n.id === target.nodeId)
  if (!node || lockedReason(doc, node, target.kind)) return false
  if (target.kind === 'features') {
    setParam(
      doc,
      node.id,
      'geojson',
      JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
    )
    return true
  }
  const point = features.find(feature => feature.geometry?.type === 'Point')
  if (!point) return false
  const [lng, lat] = (point.geometry as GeoJSON.Point).coordinates
  setParam(doc, node.id, 'lng', lng)
  setParam(doc, node.id, 'lat', lat)
  return true
}
