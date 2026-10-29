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
import { connect, pathTo, portShape, setParam, validConnection } from './doc-ops'
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

// A node's input port as a link target: `deck<viewState`, which a value output is wired into
const asInput = (key: string) => {
  const at = key.indexOf('<')
  return at < 0 ? undefined : { nodeId: key.slice(0, at), port: key.slice(at + 1) }
}

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

// What `key` depends on, for finding loops: a parameter, what it references and the output
// wired into it; a value output, its node's parameters and whatever is wired into the node
function dependsOn(doc: EditorDoc, key: string): string[] {
  const out = asOutput(key)
  if (out) {
    const node = doc.nodes.find(n => n.id === out.nodeId)
    // Every parameter, set or not: one at its default can still be linked to read the output
    const params = new Set([
      ...(OPERATOR_INDEX.get(node?.op ?? '')?.params ?? []).map(p => p.name),
      ...Object.keys(node?.params ?? {}),
    ])
    return [
      ...[...params].map(p => `${out.nodeId}.${p}`),
      ...doc.edges.filter(e => e.target === out.nodeId).map(e => outputKey(e.source, e.sourcePort)),
    ]
  }
  const { nodeId, param } = split(doc, key)
  return [
    ...readsOf(doc, key),
    ...doc.edges
      .filter(e => e.target === nodeId && e.targetPort === `par:${param}`)
      .map(e => outputKey(e.source, e.sourcePort)),
  ]
}

// Whether `target` reading `source` would make a loop: `source` depends on `target`, directly
// or through references, expressions and wires
function loops(doc: EditorDoc, source: string, target: string): boolean {
  const seen = new Set<string>()
  const pending = [source]
  while (pending.length > 0) {
    const key = pending.pop() as string
    if (key === target) return true
    if (seen.has(key)) continue
    seen.add(key)
    pending.push(...dependsOn(doc, key))
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
  return (
    validConnection(doc, out.nodeId, out.port, nodeId, `par:${param}`) &&
    !loops(doc, source, target)
  )
}

// Whether parameter `target` may read `source`: another parameter, or a value output
export function canLink(doc: EditorDoc, source: string, target: string): boolean {
  if (source === target || asOutput(target)) return false
  const into = asInput(target)
  if (into) {
    const out = asOutput(source)
    return !!out && validConnection(doc, out.nodeId, out.port, into.nodeId, into.port)
  }
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
  const into = asInput(target)
  const from = asOutput(source)
  if (into && from) return !!connect(doc, from.nodeId, from.port, into.nodeId, into.port)
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

/**
 * What on `nodeId` `source` could drive: its parameters, and for a value output its input ports
 * too (a View State into a deck's view state). One the source's shape matches exactly is
 * `exact` and comes first: a camera onto a deck is its view state, not its map style.
 */
export function targetsOn(doc: EditorDoc, nodeId: string, source: string): Candidate[] {
  const node = doc.nodes.find(n => n.id === nodeId)
  const out = asOutput(source)
  if (!node) return []
  const shape = out && portShape(doc, out.nodeId, out.port, 'out')
  const params = paramsOf(doc, nodeId, key => canLink(doc, source, key)).map(c => ({
    ...c,
    exact: !!shape && c.def.portShape === shape,
  }))
  const inputs = out
    ? (OPERATOR_INDEX.get(node.op)?.inputs ?? [])
        .filter(p => canLink(doc, source, inputKey(nodeId, p.name)))
        .map(p => ({
          key: inputKey(nodeId, p.name),
          node,
          def: { ...outputDef(p.name), label: p.label ?? p.name },
          label: `${nodePath(doc, node)} › ${p.label ?? p.name}`,
          value: 'input',
          exact: !!shape && p.shape === shape,
        }))
    : []
  return [...inputs, ...params].sort((a, b) => Number(b.exact) - Number(a.exact))
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

// A node's input that a wire from a value output feeds: `deck<views`
const inputKey = (nodeId: string, port: string) => `${nodeId}<${port}`

function connection(doc: EditorDoc, key: string): Connection | undefined {
  const out = asOutput(key)
  const at = key.indexOf('<')
  const nodeId = out ? out.nodeId : at >= 0 ? key.slice(0, at) : split(doc, key).nodeId
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return undefined
  const label = out
    ? out.port
    : at >= 0
      ? (OPERATOR_INDEX.get(node.op)?.inputs.find(p => p.name === key.slice(at + 1))?.label ??
        key.slice(at + 1))
      : (paramDef(doc, key)?.label ?? split(doc, key).param)
  return { key, node, label: `${nameOf(node)} › ${label}` }
}

// What parameter or value output `key` reads, and what reads it: references and `ch()` calls
// between parameters, wires from value outputs to parameters and to nodes' inputs
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
    // A parameter it drives, or a node's input it feeds, such as a camera's view into the deck
    for (const e of doc.edges)
      if (e.source === out.nodeId && e.sourcePort === out.port)
        readBy.push(
          e.targetPort.startsWith('par:')
            ? `${e.target}.${e.targetPort.slice(4)}`
            : inputKey(e.target, e.targetPort)
        )
  }
  const resolve = (keys: string[]) =>
    [...new Set(keys)].map(k => connection(doc, k)).filter((c): c is Connection => c !== undefined)
  return { reads: resolve(reads), readBy: resolve(readBy) }
}
