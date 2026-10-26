// Linking one parameter to another by dragging, as Cavalry's attribute ports and After
// Effects' pick whip do. Every property row has an input port and an output port, and a node's
// value outputs (an Extent's min and max) have rows of their own. Drag an output onto a property
// to make that property read it, or an input onto an output to make the input read that; drop
// on a node to choose which of its properties fit. A parameter read by a parameter is a
// `{ ref }`, the same reference the right-click menu's "Reference a parameter…" makes; a value
// output read by a parameter is a `par:` wire, as the node graph draws it.

import {
  type DocNode,
  type EditorDoc,
  nameOf,
  nodePath,
  OPERATOR_INDEX,
  type ParamDef,
  type PortSpec,
  resolveRef,
} from '@noodles.gl/planner'
import { connect, pathTo, setParam, validConnection } from './doc-ops'
import { nodeOfKey, referencePaths } from './layer-stack'
import { type Candidate, referenceable, sameKind } from './ref-picker'

// What is being dragged toward a link: something to be read (a parameter's or a value
// output's output port), a parameter to read something (its input port), or a node from a list
export type LinkDrag =
  | { kind: 'source'; key: string }
  | { kind: 'target'; key: string }
  | { kind: 'node'; id: string }

// A value output's key: `extent>max`. A parameter's is `extent.input`.
export const outputKey = (nodeId: string, port: string) => `${nodeId}>${port}`

const asOutput = (key: string) => {
  const at = key.indexOf('>')
  return at < 0 ? undefined : { nodeId: key.slice(0, at), port: key.slice(at + 1) }
}

// A node's outputs a parameter can read over a wire: numbers and values, not rows or layers
export function valueOutputs(node: DocNode): PortSpec[] {
  return (OPERATOR_INDEX.get(node.op)?.outputs ?? []).filter(
    o => o.type === 'number' || o.type === 'value'
  )
}

// A parameter key's node and parameter. A host output's parameter is a dotted path of its own,
// so the node is found by id rather than at the last dot.
const split = (doc: Pick<EditorDoc, 'nodes'>, key: string) => {
  const nodeId = nodeOfKey(doc, key) ?? key.slice(0, key.lastIndexOf('.'))
  return { nodeId, param: key.slice(nodeId.length + 1) }
}

export function paramDef(doc: EditorDoc, key: string): ParamDef | undefined {
  const { nodeId, param } = split(doc, key)
  const node = doc.nodes.find(n => n.id === nodeId)
  return node && OPERATOR_INDEX.get(node.op)?.params.find(p => p.name === param)
}

// A parameter can be linked when it takes a reference and no wire drives it
export function linkable(doc: EditorDoc, node: DocNode, def: ParamDef): boolean {
  if (!referenceable(def)) return false
  return !doc.edges.some(e => e.target === node.id && e.targetPort === `par:${def.name}`)
}

// The parameters `key` reads: what its `{ ref }` names, or each `ch()` in its expression
function readsOf(doc: EditorDoc, key: string): string[] {
  const { nodeId, param } = split(doc, key)
  const node = doc.nodes.find(n => n.id === nodeId)
  const value = node?.params[param]
  if (!node || value === undefined) return []
  const keys: string[] = []
  for (const path of referencePaths(value)) {
    try {
      keys.push(resolveRef(doc, node, path))
    } catch {
      // A reference to a node that is gone reads nothing
    }
  }
  return keys
}

// Whether `target` reading `source` would make a loop: `source` reads `target`, directly or
// through other references and expressions
function loops(doc: EditorDoc, source: string, target: string): boolean {
  const seen = new Set<string>()
  const pending = [source]
  while (pending.length > 0) {
    const key = pending.pop() as string
    if (key === target) return true
    if (seen.has(key)) continue
    seen.add(key)
    pending.push(...readsOf(doc, key))
  }
  return false
}

// Kinds a wired number means something to; a planner parameter's `par:` handle takes a number
// whatever its kind
const NUMERIC = new Set(['float', 'int'])

// Whether parameter `target` may read value output `source` over a wire
function canWire(doc: EditorDoc, source: string, target: string): boolean {
  const out = asOutput(source)
  const def = paramDef(doc, target)
  if (!out || !def || (!def.portType && !NUMERIC.has(def.kind))) return false
  const { nodeId, param } = split(doc, target)
  return validConnection(doc, out.nodeId, out.port, nodeId, `par:${param}`)
}

// Whether parameter `target` may read `source`: another parameter, or a value output
export function canLink(doc: EditorDoc, source: string, target: string): boolean {
  if (source === target || asOutput(target)) return false
  if (asOutput(source)) return canWire(doc, source, target)
  const s = paramDef(doc, source)
  const t = paramDef(doc, target)
  const node = doc.nodes.find(n => n.id === split(doc, target).nodeId)
  if (!s || !t || !node || !sameKind(s, t) || !linkable(doc, node, t)) return false
  return !loops(doc, source, target)
}

// Make parameter `target` read `source`: a reference to a parameter, a wire from a value
// output. False when it can't.
export function linkParam(doc: EditorDoc, source: string, target: string): boolean {
  if (!canLink(doc, source, target)) return false
  const { nodeId, param } = split(doc, target)
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return false
  const out = asOutput(source)
  if (out) return !!connect(doc, out.nodeId, out.port, nodeId, `par:${param}`)
  setParam(doc, nodeId, param, { ref: pathTo(doc, node, source) })
  return true
}

// `node`'s parameters that pass `keep`, as picker entries
function paramsOf(doc: EditorDoc, nodeId: string, keep: (key: string) => boolean): Candidate[] {
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return []
  return (OPERATOR_INDEX.get(node.op)?.params ?? [])
    .filter(p => keep(`${nodeId}.${p.name}`))
    .map(p => ({
      key: `${nodeId}.${p.name}`,
      node,
      def: p,
      label: `${nodePath(doc, node)} › ${p.label}`,
    }))
}

// An output as a picker entry, shaped as a parameter so the picker can list it beside them
const outputDef = (port: string): ParamDef => ({
  name: port,
  label: port,
  kind: 'float',
  default: 0,
})

// The parameters on `nodeId` that `source` could drive
export function targetsOn(doc: EditorDoc, nodeId: string, source: string): Candidate[] {
  return paramsOf(doc, nodeId, key => canLink(doc, source, key))
}

// What on `nodeId` parameter `target` could read: its parameters, then its value outputs
export function sourcesOn(doc: EditorDoc, nodeId: string, target: string): Candidate[] {
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return []
  const outputs = valueOutputs(node)
    .map(o => outputKey(nodeId, o.name))
    .filter(key => canLink(doc, key, target))
    .map(key => {
      const port = key.slice(key.indexOf('>') + 1)
      return {
        key,
        node,
        def: outputDef(port),
        label: `${nodePath(doc, node)} › ${port}`,
        value: 'output',
      }
    })
  return [...paramsOf(doc, nodeId, key => canLink(doc, key, target)), ...outputs]
}

// One end of a connection, for listing beside a port
export interface Connection {
  key: string
  node: DocNode
  label: string
}

function connection(doc: EditorDoc, key: string): Connection | undefined {
  const out = asOutput(key)
  const { nodeId, param } = out ? { nodeId: out.nodeId, param: out.port } : split(doc, key)
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return undefined
  const label = out ? param : (paramDef(doc, key)?.label ?? param)
  return { key, node, label: `${nameOf(node)} › ${label}` }
}

// What parameter or value output `key` reads, and what reads it: references and `ch()` calls
// between parameters, wires from value outputs
export function connections(
  doc: EditorDoc,
  key: string
): { reads: Connection[]; readBy: Connection[] } {
  const out = asOutput(key)
  const reads: string[] = []
  const readBy: string[] = []
  if (!out) {
    reads.push(...readsOf(doc, key))
    const { nodeId, param } = split(doc, key)
    for (const e of doc.edges)
      if (e.target === nodeId && e.targetPort === `par:${param}`)
        reads.push(outputKey(e.source, e.sourcePort))
    for (const n of doc.nodes)
      for (const p of Object.keys(n.params)) {
        const other = `${n.id}.${p}`
        if (other !== key && readsOf(doc, other).includes(key)) readBy.push(other)
      }
  } else {
    for (const e of doc.edges)
      if (e.source === out.nodeId && e.sourcePort === out.port && e.targetPort.startsWith('par:'))
        readBy.push(`${e.target}.${e.targetPort.slice(4)}`)
  }
  const resolve = (keys: string[]) =>
    [...new Set(keys)].map(k => connection(doc, k)).filter((c): c is Connection => c !== undefined)
  return { reads: resolve(reads), readBy: resolve(readBy) }
}
