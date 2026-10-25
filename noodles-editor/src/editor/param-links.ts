// Linking one parameter to another by dragging, as Cavalry's attribute ports do. Every
// property row has a port: drag it onto another property to make that one read it, or onto a
// node to choose which of the node's properties should. Drag a node onto a property to choose
// which of the node's properties it reads. A link is a `{ ref }`, the same reference the
// right-click menu's "Reference a parameter…" makes, so it shows and breaks the same way.

import {
  type DocNode,
  type EditorDoc,
  nodePath,
  OPERATOR_INDEX,
  type ParamDef,
  resolveRef,
} from '@noodles.gl/planner'
import { pathTo, setParam } from './doc-ops'
import { nodeOfKey, referencePaths } from './layer-stack'
import { type Candidate, referenceable, sameKind } from './ref-picker'

// What is being dragged toward a link: a parameter's port, or a node from a list
export type LinkDrag = { kind: 'param'; key: string } | { kind: 'node'; id: string }

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
function reads(doc: EditorDoc, key: string): string[] {
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
    pending.push(...reads(doc, key))
  }
  return false
}

// Whether parameter `target` may read parameter `source`
export function canLink(doc: EditorDoc, source: string, target: string): boolean {
  if (source === target) return false
  const s = paramDef(doc, source)
  const t = paramDef(doc, target)
  const node = doc.nodes.find(n => n.id === split(doc, target).nodeId)
  if (!s || !t || !node || !sameKind(s, t) || !linkable(doc, node, t)) return false
  return !loops(doc, source, target)
}

// Make parameter `target` read parameter `source`. False when it can't.
export function linkParam(doc: EditorDoc, source: string, target: string): boolean {
  if (!canLink(doc, source, target)) return false
  const { nodeId, param } = split(doc, target)
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return false
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

// The parameters on `nodeId` that parameter `source` could drive
export function targetsOn(doc: EditorDoc, nodeId: string, source: string): Candidate[] {
  return paramsOf(doc, nodeId, key => canLink(doc, source, key))
}

// The parameters on `nodeId` that parameter `target` could read
export function sourcesOn(doc: EditorDoc, nodeId: string, target: string): Candidate[] {
  return paramsOf(doc, nodeId, key => canLink(doc, key, target))
}
