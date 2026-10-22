// Operator types, input names and edge handles in apply_modifications, checked
// against the operator registry before anything is queued.
//
// The editor takes an unknown type or handle without complaint: the node is
// created dead, the edge connects nothing, and the tool reports success. The
// benchmark's cloud ceiling lost two of its three build tasks this way — "File"
// for FileOp, "out.vis" for out.layer — and never found out. The registry is the
// same one get_operator_schema reads, so an error here names what the model
// should have asked for.

import type { OperatorRegistry, ProjectModification } from './types'

// How many names a "has no input" error lists
const FIELD_SUGGESTIONS = 15

type Side = 'inputs' | 'outputs'

export interface FieldCheckContext {
  registry: OperatorRegistry
  // Every node the batch may reference — the project, earlier calls this run, and
  // this batch's own add_node entries — mapped to its operator type
  types: Map<string, string>
  // Fields a live operator has beyond its class's, e.g. user-defined custom inputs
  liveFields: (nodeId: string, side: Side) => string[]
}

// "File", "file", "FileOp" and "fileop" all name FileOp. Resolves a name that
// matches exactly one operator by type or display name; returned unchanged
// otherwise, so the check below can report it.
export function resolveOperatorType(type: string, registry: OperatorRegistry): string {
  const operators = registry.operators
  if (operators[type]) return type
  if (operators[`${type}Op`]) return `${type}Op`
  const wanted = type.trim().toLowerCase()
  const matches = Object.values(operators).filter(
    op =>
      op.type.toLowerCase() === wanted ||
      op.type.toLowerCase() === `${wanted}op` ||
      op.name.toLowerCase() === wanted
  )
  return matches.length === 1 ? matches[0].type : type
}

// A bare field name on an edge ("data") is unambiguous about which side it is on
export function qualifyHandle(handle: unknown, side: 'source' | 'target'): unknown {
  if (typeof handle !== 'string' || !handle.trim() || handle.includes('.')) return handle
  return `${side === 'source' ? 'out' : 'par'}.${handle.trim()}`
}

// Empty when every type and field exists, otherwise the reasons
export function checkFields(mod: ProjectModification, context: FieldCheckContext): string[] {
  switch (mod.type) {
    case 'add_node': {
      const schema = context.registry.operators[mod.data.type]
      if (!schema) return [unknownType(mod.data.type, context.registry)]
      const declared = customInputNames(mod.data.data)
      return unknownInputs(mod.data.id, mod.data.type, inputsOf(mod.data.data), [
        ...fieldNames(context, mod.data.id, mod.data.type, 'inputs'),
        ...declared,
      ])
    }
    case 'update_node': {
      const type = context.types.get(mod.data.id)
      if (!type || !context.registry.operators[type]) return []
      const declared = customInputNames(mod.data.data)
      return unknownInputs(mod.data.id, type, inputsOf(mod.data.data), [
        ...fieldNames(context, mod.data.id, type, 'inputs'),
        ...declared,
      ])
    }
    case 'add_edge': {
      const { source, target, sourceHandle, targetHandle } = mod.data
      if (!sourceHandle || !targetHandle) {
        return [
          'add_edge needs sourceHandle (an output, e.g. "out.data") and targetHandle (an input, e.g. "par.data")',
        ]
      }
      return [
        handleProblem(context, source, sourceHandle, 'outputs'),
        handleProblem(context, target, targetHandle, 'inputs'),
      ].filter((problem): problem is string => problem !== null)
    }
    default:
      return []
  }
}

function unknownType(type: string, registry: OperatorRegistry): string {
  const wanted = type.toLowerCase().replace(/op$/, '')
  const similar = Object.values(registry.operators)
    .filter(op => op.type.toLowerCase().includes(wanted) || wanted.includes(op.name.toLowerCase()))
    .map(op => op.type)
    .slice(0, FIELD_SUGGESTIONS)
  const hint =
    similar.length > 0
      ? ` Did you mean: ${similar.join(', ')}?`
      : ' list_operators shows every type.'
  return `Unknown operator type ${type}.${hint} Types end in "Op", e.g. FileOp, ScatterplotLayerOp.`
}

function unknownInputs(id: string, type: string, given: string[], known: string[]): string[] {
  const missing = given.filter(name => !known.includes(name))
  if (missing.length === 0) return []
  return missing.map(
    name => `${id} (${type}) has no input ${name}. ${suggest(name, known, 'Inputs')}`
  )
}

function handleProblem(
  context: FieldCheckContext,
  nodeId: string,
  handle: string,
  side: Side
): string | null {
  const type = context.types.get(nodeId)
  // An unknown node is checkTarget's to report, an unknown type add_node's
  if (!type || !context.registry.operators[type]) return null

  const prefix = side === 'outputs' ? 'out' : 'par'
  const role = side === 'outputs' ? 'sourceHandle' : 'targetHandle'
  const match = /^(par|out)\.(.+)$/.exec(handle)
  const known = fieldNames(context, nodeId, type, side)
  if (!match) {
    return `${role} ${handle} is malformed: ${side === 'outputs' ? 'outputs' : 'inputs'} are "${prefix}.<name>". ${suggest('', known, side === 'outputs' ? 'Outputs' : 'Inputs', nodeId, prefix)}`
  }
  if (match[1] !== prefix) {
    return `${role} ${handle} is on the wrong side: the ${side === 'outputs' ? 'source' : 'target'} of an edge is an ${side === 'outputs' ? 'output' : 'input'}, "${prefix}.<name>". ${suggest(match[2], known, side === 'outputs' ? 'Outputs' : 'Inputs', nodeId, prefix)}`
  }
  // The graph looks up everything after the prefix, so 'par.viewState.zoom' is a
  // field named 'viewState.zoom', not the viewState field
  if (known.includes(match[2])) return null
  return `${nodeId} (${type}) has no ${side === 'outputs' ? 'output' : 'input'} ${match[2]}. ${suggest(match[2], known, side === 'outputs' ? 'Outputs' : 'Inputs', nodeId, prefix)}`
}

function fieldNames(
  context: FieldCheckContext,
  nodeId: string,
  type: string,
  side: Side
): string[] {
  const fromClass = Object.keys(context.registry.operators[type]?.[side] ?? {})
  return [...new Set([...fromClass, ...context.liveFields(nodeId, side)])]
}

// Names containing the wrong one first ("color" -> getFillColor, getLineColor),
// otherwise the full list, so the next attempt is a pick rather than a guess
function suggest(
  name: string,
  known: string[],
  label: string,
  nodeId?: string,
  prefix?: string
): string {
  if (known.length === 0) return `It has no ${label.toLowerCase()}.`
  const wanted = name.toLowerCase()
  const similar = wanted
    ? known.filter(k => k.toLowerCase().includes(wanted) || wanted.includes(k.toLowerCase()))
    : []
  const list = (similar.length > 0 ? similar : known).slice(0, FIELD_SUGGESTIONS)
  const more = (similar.length > 0 ? similar : known).length - list.length
  const shown = prefix ? list.map(k => `${prefix}.${k}`) : list
  const where = nodeId ? ` on ${nodeId}` : ''
  return `${similar.length > 0 ? 'Did you mean' : `${label}${where}`}: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}.`
}

function inputsOf(data: Record<string, unknown> | undefined): string[] {
  const inputs = data?.inputs
  return typeof inputs === 'object' && inputs !== null && !Array.isArray(inputs)
    ? Object.keys(inputs)
    : []
}

// A node may declare its own inputs alongside the values for them
export function customInputNames(data: Record<string, unknown> | undefined): string[] {
  const custom = data?.customInputs
  if (!Array.isArray(custom)) return []
  return custom
    .map(def => (typeof def === 'object' && def !== null ? (def as { name?: unknown }).name : null))
    .filter((name): name is string => typeof name === 'string')
}
