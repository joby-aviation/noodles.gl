// The document as a layer stack, as Cavalry's scene tree or Kepler's layer list show it: what
// the deck draws, top layer first, each with the nodes that feed it nested under it. A node
// that feeds more than one layer is shared, and listed under each of them. Everything else is
// the scene (the deck and what feeds its other ports) or not drawn at all.
//
// A node depends on what is wired into it (a table, or a number driving a parameter through a
// `par:` edge) and on the parameters it references (`{ ref }` values and `ch()` in expressions).
// Wires are followed through subnets' ports, so nodes collapsed into a subnet stay listed under
// the layers they feed, each after the subnets that hold it.

import {
  type DocNode,
  type EditorDoc,
  flattenSubnets,
  isExpr,
  isRef,
  type ParamValue,
  resolveRef,
  SUBNET,
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

// The node a resolved reference key (`nodeId.param`) names. A host output's parameter is a
// path with dots of its own (`out.location.lat`), so the node is the longest id the key starts
// with, not whatever comes before the last dot.
export function nodeOfKey(doc: Pick<EditorDoc, 'nodes'>, key: string): string | undefined {
  let best: string | undefined
  for (const n of doc.nodes) {
    if (key.startsWith(`${n.id}.`) && (!best || n.id.length > best.length)) best = n.id
  }
  return best
}

// The parameter paths a value reads: a `{ ref }`'s, or each `ch()` in an expression
export function referencePaths(value: ParamValue): string[] {
  if (isRef(value)) return [value.ref]
  const text = isExpr(value) ? value.expr : typeof value === 'string' ? value : ''
  return [...text.matchAll(CH)].map(m => m[2])
}

// The nodes whose parameters `node` references
function referenced(doc: EditorDoc, node: DocNode): string[] {
  const paths = Object.values(node.params).flatMap(referencePaths)
  const ids: string[] = []
  for (const path of paths) {
    try {
      const id = nodeOfKey(doc, resolveRef(doc, node, path))
      if (id) ids.push(id)
    } catch {
      // A reference to a node that is gone reads nothing
    }
  }
  return ids
}

// What each node reads directly, by id
export function dependencies(doc: EditorDoc): Map<string, string[]> {
  const deps = new Map<string, string[]>(doc.nodes.map(n => [n.id, []]))
  // Flattening rewires each edge across a subnet's boundary to the real node on the other side
  for (const e of flattenSubnets(doc).edges) deps.get(e.target)?.push(e.source)
  for (const n of doc.nodes) {
    deps.get(n.id)?.push(...referenced(doc, n))
    if (n.op !== SUBNET) continue
    // A subnet reads what feeds its outputs from inside, and a child it promotes a
    // parameter of reads the subnet's value
    for (const out of doc.nodes.filter(c => c.parent === n.id && c.op === SUBNET_OUTPUT)) {
      for (const e of doc.edges) if (e.target === out.id) deps.get(n.id)?.push(e.source)
    }
    for (const p of n.promoted ?? []) deps.get(p.node)?.push(n.id)
  }
  for (const [id, list] of deps)
    deps.set(
      id,
      [...new Set(list)].filter(d => d !== id)
    )
  return deps
}

// `ids` with the subnets that hold each node listed before it, outermost first, except `self`
function withSubnets(ids: string[], byId: Map<string, DocNode>, self: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([self])
  const add = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  for (const id of ids) {
    const chain: string[] = []
    for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) chain.unshift(p)
    chain.forEach(add)
    add(id)
  }
  return out
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
      upstream: withSubnets(upstreamOf(id, deps), byId, id).filter(shown),
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
