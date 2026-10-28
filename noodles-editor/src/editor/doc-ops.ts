// Document edits, as functions on a draft. The UI calls them inside `docStore().edit`, so each
// is one undo step and none of them touch React. Ported from d-d-d's editor.

import {
  canConnect,
  type DocEdge,
  type DocNode,
  type EditorDoc,
  isExpr,
  isRef,
  type Keyframe,
  nameOf,
  nodePath,
  OPERATOR_INDEX,
  type ParamValue,
  type PortType,
  resolveRef,
  setKeyframe,
} from '@noodles.gl/planner'
import { DECK_OP_INDEX } from '../runtime/deck-ops'

let counter = 0
export const newId = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

/** A name not yet used in the network, Houdini-style: `filter1`, `filter2`… */
export function uniqueName(doc: EditorDoc, parent: string | undefined, base: string): string {
  const taken = new Set(doc.nodes.filter(n => n.parent === parent).map(nameOf))
  const stem =
    base
      .replace(/Op$/, '')
      .replace(/\d+$/, '')
      .replace(/[^A-Za-z0-9_]/g, '_') || 'node'
  for (let i = 1; ; i++) if (!taken.has(`${stem}${i}`)) return `${stem}${i}`
}

/** A new node with every parameter at its default: defaults stay implicit in the document. */
export function addNode(
  doc: EditorDoc,
  op: string,
  x: number,
  y: number,
  parent?: string
): DocNode {
  if (!OPERATOR_INDEX.has(op)) throw new Error(`Unknown operator ${op}`)
  const node: DocNode = {
    id: newId('n'),
    op,
    name: uniqueName(doc, parent, op.replace(/-/g, '_')),
    ...(parent ? { parent } : {}),
    x,
    y,
    params: {},
  }
  doc.nodes.push(node)
  return node
}

export function portType(
  doc: EditorDoc,
  nodeId: string,
  port: string,
  side: 'in' | 'out'
): PortType | 'param' | undefined {
  const node = doc.nodes.find(n => n.id === nodeId)
  const def = node && OPERATOR_INDEX.get(node.op)
  if (!def) return undefined
  if (side === 'in' && port.startsWith('par:')) {
    // A host operator's parameter takes what its field does; a planner parameter, a number
    return def.params.find(p => p.name === port.slice(4))?.portType ?? 'param'
  }
  return (side === 'in' ? def.inputs : def.outputs).find(p => p.name === port)?.type
}

/** A deck operator's list parameter, which takes several wires in order: a Switch Value's values. */
export const isListParam = (op: string, param: string): boolean =>
  !!DECK_OP_INDEX.get(op)?.lists?.includes(param)

export function isMulti(doc: EditorDoc, nodeId: string, port: string): boolean {
  const node = doc.nodes.find(n => n.id === nodeId)
  if (node && port.startsWith('par:')) return isListParam(node.op, port.slice(4))
  return !!(node && OPERATOR_INDEX.get(node.op)?.inputs.find(p => p.name === port)?.multi)
}

export function validConnection(
  doc: EditorDoc,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string
): boolean {
  if (source === target) return false
  const from = portType(doc, source, sourcePort, 'out')
  const to = portType(doc, target, targetPort, 'in')
  if (!from || !to || !canConnect(from as PortType, to)) return false
  // No cycles.
  const downstream = new Set<string>([target])
  let grew = true
  while (grew) {
    grew = false
    for (const e of doc.edges) {
      if (downstream.has(e.source) && !downstream.has(e.target)) {
        downstream.add(e.target)
        grew = true
      }
    }
  }
  return !downstream.has(source)
}

/** Wire an output to an input: it replaces a single input's wire, and joins a multi one. */
export function connect(
  doc: EditorDoc,
  source: string,
  sourcePort: string,
  target: string,
  targetPort: string,
  // For a multi input, the slot the wire goes in: it lands last without one, and a wire
  // already in the port moves there
  at?: number
): DocEdge | undefined {
  if (!validConnection(doc, source, sourcePort, target, targetPort)) return undefined
  const multi = isMulti(doc, target, targetPort)
  if (!multi)
    doc.edges = doc.edges.filter(e => !(e.target === target && e.targetPort === targetPort))
  const same = doc.edges.find(
    e =>
      e.source === source &&
      e.sourcePort === sourcePort &&
      e.target === target &&
      e.targetPort === targetPort
  )
  if (same) {
    if (multi && at !== undefined) moveToSlot(doc, same, at)
    return same
  }
  const count = doc.edges.filter(e => e.target === target && e.targetPort === targetPort).length
  const edge: DocEdge = {
    id: newId('e'),
    source,
    sourcePort,
    target,
    targetPort,
    ...(multi ? { index: count } : {}),
  }
  doc.edges.push(edge)
  if (multi && at !== undefined) moveToSlot(doc, edge, at)
  return edge
}

// Puts a multi input's wire at boundary `at` between the slots the port shows (0 is before the
// first), renumbering the rest densely around it
function moveToSlot(doc: EditorDoc, edge: DocEdge, at: number): void {
  const wires = doc.edges
    .filter(e => e.target === edge.target && e.targetPort === edge.targetPort)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const from = wires.indexOf(edge)
  // Boundaries past the wire's own slot shift down one once it leaves it
  const to = Math.max(0, Math.min(wires.length - 1, at > from ? at - 1 : at))
  wires.splice(from, 1)
  wires.splice(to, 0, edge)
  wires.forEach((e, i) => {
    e.index = i
  })
}

/** Remove wires, renumbering what is left on each multi input so its order stays dense. */
export function removeEdges(doc: EditorDoc, ids: string[]): void {
  const drop = new Set(ids)
  const touched = new Set(
    doc.edges
      .filter(e => drop.has(e.id) && e.index !== undefined)
      .map(e => `${e.target}|${e.targetPort}`)
  )
  doc.edges = doc.edges.filter(e => !drop.has(e.id))
  for (const key of touched) {
    doc.edges
      .filter(e => `${e.target}|${e.targetPort}` === key)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .forEach((e, i) => {
        e.index = i
      })
  }
}

export function removeNodes(doc: EditorDoc, ids: string[]): void {
  const drop = new Set(ids)
  // Removing a subnet removes what is inside it.
  let grew = true
  while (grew) {
    grew = false
    for (const n of doc.nodes) {
      if (n.parent && drop.has(n.parent) && !drop.has(n.id)) {
        drop.add(n.id)
        grew = true
      }
    }
  }
  keepReadValues(doc, drop)
  doc.nodes = doc.nodes.filter(n => !drop.has(n.id))
  removeEdges(
    doc,
    doc.edges.filter(e => drop.has(e.source) || drop.has(e.target)).map(e => e.id)
  )
  if (doc.timeline) {
    doc.timeline.tracks = doc.timeline.tracks.filter(t => !drop.has(trackNode(t.target)))
  }
}

/**
 * A parameter referencing a node about to go keeps the value it read: a deck's pitch reading a
 * Number stays at that number, rather than pointing at nothing (which reads NaN). A value that
 * is itself a reference or an expression can't be carried over, so the parameter goes back to
 * its default.
 */
function keepReadValues(doc: EditorDoc, drop: Set<string>): void {
  for (const node of doc.nodes) {
    if (drop.has(node.id)) continue
    for (const [param, value] of Object.entries(node.params)) {
      if (!isRef(value)) continue
      let key: string
      try {
        key = resolveRef(doc, node, value.ref)
      } catch {
        continue
      }
      const source = doc.nodes.find(n => drop.has(n.id) && key.startsWith(`${n.id}.`))
      if (!source) continue
      const name = key.slice(source.id.length + 1)
      const read =
        source.params[name] ??
        OPERATOR_INDEX.get(source.op)?.params.find(p => p.name === name)?.default
      if (read === undefined || isRef(read) || isExpr(read)) delete node.params[param]
      else node.params[param] = read
    }
  }
}

/** The node a track drives: `nodeId.param` with an id that may itself hold dots. */
const trackNode = (target: string) => target.slice(0, target.lastIndexOf('.'))

export function moveNodes(
  doc: EditorDoc,
  positions: Record<string, { x: number; y: number }>
): void {
  for (const n of doc.nodes) {
    const p = positions[n.id]
    if (p) {
      n.x = p.x
      n.y = p.y
    }
  }
}

/** Put a node with one table input and output onto a wire. */
export function insertOnEdge(doc: EditorDoc, edgeId: string, op: string): DocNode | undefined {
  const edge = doc.edges.find(e => e.id === edgeId)
  const def = OPERATOR_INDEX.get(op)
  if (!edge || !def) return undefined
  const input = def.inputs.find(p => p.type === 'table')
  const output = def.outputs.find(p => p.type === 'table')
  const a = doc.nodes.find(n => n.id === edge.source)
  const b = doc.nodes.find(n => n.id === edge.target)
  if (!input || !output || !a || !b) return undefined
  const node = addNode(doc, op, (a.x + b.x) / 2, (a.y + b.y) / 2 + 40, a.parent)
  doc.edges = doc.edges.filter(e => e.id !== edgeId)
  doc.edges.push(
    {
      id: newId('e'),
      source: edge.source,
      sourcePort: edge.sourcePort,
      target: node.id,
      targetPort: input.name,
    },
    {
      id: newId('e'),
      source: node.id,
      sourcePort: output.name,
      target: edge.target,
      targetPort: edge.targetPort,
      ...(edge.index !== undefined ? { index: edge.index } : {}),
    }
  )
  return node
}

/**
 * Set a parameter. A keyframed number sets a key at the playhead instead, as the timeline's
 * value would otherwise overwrite it on the next frame.
 */
export function setParam(
  doc: EditorDoc,
  nodeId: string,
  param: string,
  value: ParamValue | undefined,
  time?: number
): void {
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return
  const target = `${nodeId}.${param}`
  const track = doc.timeline?.tracks.find(t => t.target === target)
  if (track && time !== undefined && typeof value === 'number') {
    setKey(doc, target, time, value)
    return
  }
  if (value === undefined) delete node.params[param]
  else node.params[param] = value
}

/** A path from `from` to parameter key `nodeId.param`: relative within a network, else absolute. */
export function pathTo(doc: EditorDoc, from: DocNode, key: string): string {
  const dot = key.lastIndexOf('.')
  const [id, param] = [key.slice(0, dot), key.slice(dot + 1)]
  const target = doc.nodes.find(n => n.id === id)
  if (!target) return `#${key}`
  if (target.id === from.id) return param
  if (target.parent === from.parent) return `${nameOf(target)}/${param}`
  return `${nodePath(doc, target)}/${param}`
}

const CH = /\bch\(\s*(['"])(.*?)\1\s*\)/g

/**
 * Keep references pointing at the same parameters after nodes were renamed or moved between
 * networks: each path is resolved against `before`, then rewritten from where its node is now.
 */
export function rebaseReferences(before: EditorDoc, after: EditorDoc): void {
  const old = new Map(before.nodes.map(n => [n.id, n]))
  const rewrite = (node: DocNode, path: string): string => {
    const was = old.get(node.id)
    if (!was || path.startsWith('#')) return path
    try {
      return pathTo(after, node, resolveRef(before, was, path))
    } catch {
      return path
    }
  }
  const rewriteCh = (node: DocNode, text: string) =>
    text.replace(CH, (_m, q, p) => `ch(${q}${rewrite(node, p)}${q})`)
  for (const node of after.nodes) {
    for (const [name, value] of Object.entries(node.params)) {
      if (isRef(value)) node.params[name] = { ref: rewrite(node, value.ref) }
      else if (isExpr(value)) node.params[name] = { expr: rewriteCh(node, value.expr) }
      else if (typeof value === 'string' && value.includes('ch('))
        node.params[name] = rewriteCh(node, value)
    }
  }
}

/** Rename a node, keeping every reference to it working. False when the name is taken. */
export function renameNode(doc: EditorDoc, id: string, name: string): boolean {
  const node = doc.nodes.find(n => n.id === id)
  if (!node) return false
  if (doc.nodes.some(n => n.id !== id && n.parent === node.parent && nameOf(n) === name))
    return false
  const before = structuredClone(doc)
  node.name = name
  rebaseReferences(before, doc)
  return true
}

// --- keyframes ---------------------------------------------------------------

export function ensureTimeline(doc: EditorDoc): NonNullable<EditorDoc['timeline']> {
  doc.timeline ??= { length: 10, fps: 30, tracks: [] }
  return doc.timeline
}

// A number eases to the next key; text, which cannot be blended, holds until it
export function setKey(doc: EditorDoc, target: string, time: number, value: number | string): void {
  const tl = ensureTimeline(doc)
  const track = tl.tracks.find(t => t.target === target) ?? { target, keyframes: [] }
  const existing = track.keyframes.find(k => Math.abs(k.time - time) < 1e-3)
  const key: Keyframe = existing
    ? { ...existing, value }
    : typeof value === 'string'
      ? { id: newId('k'), time, value, interpolation: 'hold' }
      : {
          id: newId('k'),
          time,
          value,
          interpolation: 'bezier',
          handles: { left: [0.42, 0], right: [0.58, 1] },
        }
  tl.tracks = [...tl.tracks.filter(t => t.target !== target), setKeyframe(track, key)]
}

export function removeKey(doc: EditorDoc, target: string, time: number): void {
  const tl = doc.timeline
  if (!tl) return
  tl.tracks = tl.tracks
    .map(t =>
      t.target === target
        ? { ...t, keyframes: t.keyframes.filter(k => Math.abs(k.time - time) >= 1e-3) }
        : t
    )
    .filter(t => t.keyframes.length > 0)
}

export function clearTrack(doc: EditorDoc, target: string): void {
  if (doc.timeline) doc.timeline.tracks = doc.timeline.tracks.filter(t => t.target !== target)
}

// --- copy and paste ------------------------------------------------------------

/** What a copy holds: nodes and the wires between them. */
export interface Clip {
  nodes: DocNode[]
  edges: DocEdge[]
}

export function copyNodes(doc: EditorDoc, ids: string[]): Clip {
  const take = new Set(ids)
  return structuredClone({
    nodes: doc.nodes.filter(n => take.has(n.id)),
    edges: doc.edges.filter(e => take.has(e.source) && take.has(e.target)),
  })
}

/** Paste a copy as new nodes, offset from the originals, renamed where a name is taken. */
export function pasteNodes(
  doc: EditorDoc,
  clip: Clip,
  parent: string | undefined,
  offset = { x: 40, y: 40 }
): string[] {
  const ids = new Map<string, string>()
  for (const n of clip.nodes) {
    const id = newId('n')
    ids.set(n.id, id)
    const name = nameOf(n)
    const taken = doc.nodes.some(m => m.parent === parent && nameOf(m) === name)
    const { parent: _was, ...rest } = structuredClone(n)
    doc.nodes.push({
      ...rest,
      id,
      name: taken ? uniqueName(doc, parent, name) : name,
      ...(parent ? { parent } : {}),
      x: n.x + offset.x,
      y: n.y + offset.y,
    })
  }
  for (const e of clip.edges) {
    doc.edges.push({
      ...e,
      id: newId('e'),
      source: ids.get(e.source) as string,
      target: ids.get(e.target) as string,
    })
  }
  return [...ids.values()]
}

/**
 * Move nodes into a new subnet in their network, Houdini's Collapse: up to two distinct things
 * wired in become the subnet's inputs (through subnet-input nodes inside), and the first thing
 * wired out becomes its output. Parameter wires and references cross the boundary as they are.
 * `id` and `name` name the subnet, as a migrated container keeps its own.
 */
export function collapseToSubnet(
  doc: EditorDoc,
  ids: string[],
  { id, name }: { id?: string; name?: string } = {}
): DocNode | undefined {
  const inside = new Set(ids)
  const members = doc.nodes.filter(n => inside.has(n.id))
  if (members.length === 0) return undefined
  const parent = members[0].parent
  const cx = members.reduce((s, n) => s + n.x, 0) / members.length
  const cy = members.reduce((s, n) => s + n.y, 0) / members.length
  const entering = doc.edges.filter(
    e => !inside.has(e.source) && inside.has(e.target) && !e.targetPort.startsWith('par:')
  )
  const leaving = doc.edges.filter(e => inside.has(e.source) && !inside.has(e.target))
  const into = [...new Map(entering.map(e => [`${e.source}:${e.sourcePort}`, e])).values()]
  if (into.length > 2)
    throw new Error('A subnet takes at most two inputs; select fewer entry points')
  const sub = addNode(doc, 'subnet', cx, cy, parent)
  if (id) sub.id = id
  if (name) sub.name = name
  const minX = Math.min(...members.map(n => n.x))
  const maxX = Math.max(...members.map(n => n.x))
  // Endpoints are copied before any edge is rewired: `into` holds the same objects as
  // `entering`, and rewiring first would point the outer edge at the subnet's own input node
  const sources = into.map(e => ({ source: e.source, port: e.sourcePort }))
  sources.forEach(({ source, port }, i) => {
    const inNode = addNode(doc, 'subnet-input', minX - 240, cy + i * 120, sub.id)
    inNode.params.index = i
    for (const x of entering.filter(x => x.source === source && x.sourcePort === port)) {
      x.source = inNode.id
      x.sourcePort = 'out'
    }
    doc.edges.push({
      id: newId('e'),
      source,
      sourcePort: port,
      target: sub.id,
      targetPort: `in${i}`,
    })
  })
  const firstOut = leaving[0] && { source: leaving[0].source, port: leaving[0].sourcePort }
  if (firstOut) {
    const outNode = addNode(doc, 'subnet-output', maxX + 240, cy, sub.id)
    doc.edges.push({
      id: newId('e'),
      source: firstOut.source,
      sourcePort: firstOut.port,
      target: outNode.id,
      targetPort: 'in',
    })
    for (const x of leaving.filter(
      x => x.source === firstOut.source && x.sourcePort === firstOut.port
    )) {
      x.source = sub.id
      x.sourcePort = 'out0'
    }
  }
  const before = structuredClone(doc)
  for (const n of members) n.parent = sub.id
  rebaseReferences(before, doc)
  return sub
}

/** Expose a child's parameter on its subnet, which then drives it. */
export function promote(doc: EditorDoc, nodeId: string, param: string, value: ParamValue): void {
  const node = doc.nodes.find(n => n.id === nodeId)
  const sub = node?.parent ? doc.nodes.find(n => n.id === node.parent) : undefined
  if (!node || !sub) return
  const def = OPERATOR_INDEX.get(node.op)?.params.find(p => p.name === param)
  const name = `${nameOf(node)}_${param}`
  sub.promoted = [
    ...(sub.promoted ?? []).filter(p => p.name !== name),
    { name, label: `${nameOf(node)} ${def?.label ?? param}`, node: nodeId, param },
  ]
  sub.params[name] = value
}

export function unpromote(doc: EditorDoc, subId: string, name: string): void {
  const sub = doc.nodes.find(n => n.id === subId)
  if (!sub) return
  sub.promoted = (sub.promoted ?? []).filter(p => p.name !== name)
  delete sub.params[name]
}
