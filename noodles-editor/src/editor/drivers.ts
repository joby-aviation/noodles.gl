// The Drive with menu on a property, as Cavalry's Add Behaviour and Add Utility: make a node
// that drives the property, wired into it beside its node and starting from the property's
// value, so nothing jumps. A number takes a Number, Time, Math or Expression; a deck's map
// style takes a Map Style node, which carries the style and its changes over.

import { type DocNode, type EditorDoc, OPERATOR_INDEX, type ParamDef } from '@noodles.gl/planner'
import { compoundsOf } from './compound-params'
import { addNode, connect, setParam } from './doc-ops'
import { splitOutStyle } from './map-style-ops'

export interface Driver {
  op: string
  label: string
}

const NUMBERS: Driver[] = [
  { op: 'number', label: 'Number' },
  { op: 'time', label: 'Time' },
  { op: 'math', label: 'Math' },
  { op: 'expression', label: 'Expression' },
]

const styleGroupOf = (node: DocNode, def: ParamDef) => {
  const op = OPERATOR_INDEX.get(node.op)
  const style = op && compoundsOf(op).style
  return style?.url === def.name ? style : undefined
}

const isWired = (doc: EditorDoc, node: DocNode, def: ParamDef) =>
  doc.edges.some(e => e.target === node.id && e.targetPort === `par:${def.name}`)

/** What can drive a property: none once a wire drives it. */
export function driversFor(doc: EditorDoc, node: DocNode, def: ParamDef): Driver[] {
  if (isWired(doc, node, def)) return []
  if (styleGroupOf(node, def)) return [{ op: 'map-style', label: 'Map Style' }]
  if (def.kind === 'float' || def.kind === 'int') return NUMBERS
  return []
}

/**
 * Make `driver` drive `def` on `node`, starting from `current`, the value the property has now.
 * Returns the new node's id.
 */
export function driveWith(
  doc: EditorDoc,
  node: DocNode,
  def: ParamDef,
  driver: Driver,
  current: unknown
): string | undefined {
  const style = styleGroupOf(node, def)
  if (style) return splitOutStyle(doc, node.id, style)
  const made = addNode(doc, driver.op, node.x - 320, node.y, node.parent)
  const value = Number(current)
  if (Number.isFinite(value)) {
    // A Number is the value; Math multiplies it by 1, and Expression adds 0 × sin(T) to it
    if (driver.op === 'number') made.params.value = value
    if (driver.op === 'math' || driver.op === 'expression') made.params.a = value
  }
  const port = OPERATOR_INDEX.get(driver.op)?.outputs[0]?.name ?? 'out'
  if (!connect(doc, made.id, port, node.id, `par:${def.name}`)) {
    doc.nodes = doc.nodes.filter(n => n.id !== made.id)
    return undefined
  }
  return made.id
}

/** Take the wire off a property, leaving the value it had. */
export function disconnectInput(doc: EditorDoc, node: DocNode, def: ParamDef, current: unknown) {
  doc.edges = doc.edges.filter(e => !(e.target === node.id && e.targetPort === `par:${def.name}`))
  if ((def.kind === 'float' || def.kind === 'int') && Number.isFinite(Number(current)))
    setParam(doc, node.id, def.name, Number(current))
}
