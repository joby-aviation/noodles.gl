// The document as a layer stack, as Cavalry's scene tree or Kepler's layer list show it: what
// the deck draws, top layer first, each with the nodes that feed it nested under it. A node
// that feeds more than one layer is shared, and listed under each of them. Everything else is
// the scene (the deck and what feeds its other ports) or not drawn at all.
//
// A node depends on what is wired into it (a table, or a number driving a parameter through a
// `par:` edge) and on the parameters it references (`{ ref }` values and `ch()` in expressions).

import {
  type DocNode,
  type EditorDoc,
  isExpr,
  isRef,
  resolveRef,
  SUBNET_INPUT,
  SUBNET_OUTPUT,
} from '@noodles.gl/planner'
import { DOC_DECK } from './render-settings'

export interface StackLayer {
  id: string
  // Drawn: not bypassed
  visible: boolean
  // Every node it depends on, sources first
  upstream: string[]
}

export interface LayerStack {
  // What the deck draws, top first
  layers: StackLayer[]
  // Upstream nodes that feed more than one layer, with the layers they feed
  shared: Map<string, string[]>
  // The deck, then what feeds its other ports (views, effects, widgets, the basemap)
  scene: string[]
  // Root nodes that neither a layer nor the deck reads
  unused: string[]
}

// Nodes that carry no data of their own: notes, and the plumbing inside a subnet
const HIDDEN_OPS = new Set(['comment', SUBNET_INPUT, SUBNET_OUTPUT])

const CH = /\bch\(\s*(['"])(.*?)\1\s*\)/g

// The nodes whose parameters `node` references
function referenced(doc: EditorDoc, node: DocNode): string[] {
  const paths: string[] = []
  for (const value of Object.values(node.params)) {
    if (isRef(value)) paths.push(value.ref)
    else {
      const text = isExpr(value) ? value.expr : typeof value === 'string' ? value : ''
      for (const m of text.matchAll(CH)) paths.push(m[2])
    }
  }
  const ids: string[] = []
  for (const path of paths) {
    try {
      const key = resolveRef(doc, node, path)
      ids.push(key.slice(0, key.lastIndexOf('.')))
    } catch {
      // A reference to a node that is gone reads nothing
    }
  }
  return ids
}

// What each node reads directly, by id
export function dependencies(doc: EditorDoc): Map<string, string[]> {
  const deps = new Map<string, string[]>(doc.nodes.map(n => [n.id, []]))
  for (const e of doc.edges) deps.get(e.target)?.push(e.source)
  for (const n of doc.nodes) deps.get(n.id)?.push(...referenced(doc, n))
  for (const [id, list] of deps)
    deps.set(
      id,
      [...new Set(list)].filter(d => d !== id)
    )
  return deps
}

// Everything `id` depends on, sources first: each node after the nodes it reads
function upstreamOf(id: string, deps: Map<string, string[]>): string[] {
  const order: string[] = []
  const seen = new Set<string>([id])
  const visit = (n: string) => {
    for (const d of deps.get(n) ?? []) {
      if (seen.has(d)) continue
      seen.add(d)
      visit(d)
      order.push(d)
    }
  }
  visit(id)
  return order
}

// The edges into the deck's layers port, in draw order: the last is drawn on top
function layerEdges(doc: EditorDoc, deck: DocNode) {
  return doc.edges
    .filter(e => e.target === deck.id && e.targetPort === 'layers')
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
}

export function layerStack(doc: EditorDoc): LayerStack {
  const byId = new Map(doc.nodes.map(n => [n.id, n]))
  const shown = (id: string) => {
    const n = byId.get(id)
    return n !== undefined && !HIDDEN_OPS.has(n.op)
  }
  const deps = dependencies(doc)
  const deck = doc.nodes.find(n => n.op === DOC_DECK && n.parent === undefined)

  const layerIds = deck ? layerEdges(doc, deck).map(e => e.source) : []
  const layers = [...new Set(layerIds)]
    .filter(id => byId.has(id))
    .reverse()
    .map(id => ({
      id,
      visible: !byId.get(id)?.flags?.bypass,
      upstream: upstreamOf(id, deps).filter(shown),
    }))

  const usedBy = new Map<string, string[]>()
  for (const layer of layers) {
    for (const id of layer.upstream) usedBy.set(id, [...(usedBy.get(id) ?? []), layer.id])
  }
  const shared = new Map([...usedBy].filter(([, by]) => by.length > 1))

  // The deck's own inputs, other than the layers themselves and what feeds them
  const drawn = new Set([...layers.map(l => l.id), ...usedBy.keys()])
  const scene = deck
    ? [deck.id, ...upstreamOf(deck.id, deps).filter(id => !drawn.has(id) && shown(id))]
    : []

  const listed = new Set([...drawn, ...scene])
  const unused = doc.nodes
    .filter(n => n.parent === undefined && !listed.has(n.id) && shown(n.id))
    .map(n => n.id)

  return { layers, shared, scene, unused }
}

// Move a layer to `position` in the stack, counted from the top. The deck draws in edge-index
// order, so the stack's top is the highest index.
export function moveLayer(doc: EditorDoc, layerId: string, position: number): void {
  const deck = doc.nodes.find(n => n.op === DOC_DECK && n.parent === undefined)
  if (!deck) return
  const topFirst = layerEdges(doc, deck).reverse()
  const from = topFirst.findIndex(e => e.source === layerId)
  if (from < 0) return
  const [edge] = topFirst.splice(from, 1)
  topFirst.splice(Math.max(0, Math.min(position, topFirst.length)), 0, edge)
  topFirst.reverse().forEach((e, i) => {
    e.index = i
  })
}
