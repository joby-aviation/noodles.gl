// Linking one parameter to another by dragging, as Cavalry's attribute ports do. Every
// property row has a port: drag it onto another property to make that one read it, or onto a
// node to choose which of the node's properties should. Drag a node onto a property to choose
// which of the node's properties it reads. A link is a `{ ref }`, the same reference the
// right-click menu's "Reference a parameter…" makes, so it shows and breaks the same way.

import {
  type DocNode,
  type EditorDoc,
  isRef,
  nodePath,
  OPERATOR_INDEX,
  type ParamDef,
  resolveRef,
} from '@noodles.gl/planner'
import { pathTo, setParam } from './doc-ops'
import { type Candidate, candidates, referenceable, sameKind } from './ref-picker'

// What is being dragged toward a link: a parameter's port, or a node from a list
export type LinkDrag = { kind: 'param'; key: string } | { kind: 'node'; id: string }

const split = (key: string) => {
  const dot = key.lastIndexOf('.')
  return { nodeId: key.slice(0, dot), param: key.slice(dot + 1) }
}

export function paramDef(doc: EditorDoc, key: string): ParamDef | undefined {
  const { nodeId, param } = split(key)
  const node = doc.nodes.find(n => n.id === nodeId)
  return node && OPERATOR_INDEX.get(node.op)?.params.find(p => p.name === param)
}

// A parameter can be linked when it takes a reference and no wire drives it
export function linkable(doc: EditorDoc, node: DocNode, def: ParamDef): boolean {
  if (!referenceable(def)) return false
  return !doc.edges.some(e => e.target === node.id && e.targetPort === `par:${def.name}`)
}

// Whether `target` reading `source` would make a reference loop: `source` reads `target`,
// directly or through other references
function loops(doc: EditorDoc, source: string, target: string): boolean {
  const seen = new Set<string>()
  let key: string | undefined = source
  while (key && !seen.has(key)) {
    if (key === target) return true
    seen.add(key)
    const { nodeId, param } = split(key)
    const node = doc.nodes.find(n => n.id === nodeId)
    const value = node?.params[param]
    if (!node || !isRef(value)) return false
    try {
      key = resolveRef(doc, node, value.ref)
    } catch {
      return false
    }
  }
  return false
}

// Whether parameter `target` may read parameter `source`
export function canLink(doc: EditorDoc, source: string, target: string): boolean {
  if (source === target) return false
  const s = paramDef(doc, source)
  const t = paramDef(doc, target)
  const node = doc.nodes.find(n => n.id === split(target).nodeId)
  if (!s || !t || !node || !sameKind(s, t) || !linkable(doc, node, t)) return false
  return !loops(doc, source, target)
}

// Make parameter `target` read parameter `source`. False when it can't.
export function linkParam(doc: EditorDoc, source: string, target: string): boolean {
  if (!canLink(doc, source, target)) return false
  const { nodeId, param } = split(target)
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return false
  setParam(doc, nodeId, param, { ref: pathTo(doc, node, source) })
  return true
}

// The parameters on `nodeId` that parameter `source` could drive
export function targetsOn(doc: EditorDoc, nodeId: string, source: string): Candidate[] {
  const node = doc.nodes.find(n => n.id === nodeId)
  if (!node) return []
  return (OPERATOR_INDEX.get(node.op)?.params ?? [])
    .filter(p => canLink(doc, source, `${nodeId}.${p.name}`))
    .map(p => ({
      key: `${nodeId}.${p.name}`,
      node,
      def: p,
      label: `${nodePath(doc, node)} › ${p.label}`,
    }))
}

// The parameters on `nodeId` that parameter `target` could read
export function sourcesOn(doc: EditorDoc, nodeId: string, target: string): Candidate[] {
  const { nodeId: targetId } = split(target)
  const node = doc.nodes.find(n => n.id === targetId)
  const def = paramDef(doc, target)
  if (!node || !def) return []
  return candidates(doc, node, def).filter(c => c.node.id === nodeId && canLink(doc, c.key, target))
}
