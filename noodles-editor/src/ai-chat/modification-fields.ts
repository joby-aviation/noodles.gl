// Operator types, input names and edge handles in apply_modifications, checked
// against the operator registry before anything is queued.
//
// The editor takes an unknown type or handle without complaint: the node is
// created dead, the edge connects nothing, and the tool reports success. The
// benchmark's cloud ceiling lost two of its three build tasks this way — "File"
// for FileOp, "out.vis" for out.layer — and never found out. The registry is the
// same one get_operator_schema reads, so an error here names what the model
// should have asked for.
//
// The checks and their wording come from noodles-validate, which validates
// noodles.json files the same way, so an agent sees one set of messages.

import {
  handleProblem as describeHandleProblem,
  getOperator,
  resolveOperatorType,
  type Side,
  unknownInput,
  unknownType,
} from 'noodles-validate/fields'
import type { OperatorRegistry, ProjectModification } from './types'

export { resolveOperatorType }

const ALL_TYPES = 'list_operators shows every type.'

export interface FieldCheckContext {
  registry: OperatorRegistry
  // Every node the batch may reference — the project, earlier calls this run, and
  // this batch's own add_node entries — mapped to its operator type
  types: Map<string, string>
  // Fields a live operator has beyond its class's, e.g. user-defined custom inputs
  liveFields: (nodeId: string, side: Side) => string[]
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
      if (!getOperator(context.registry, mod.data.type)) {
        return [unknownType(mod.data.type, context.registry, ALL_TYPES)]
      }
      const declared = customInputNames(mod.data.data)
      return unknownInputs(mod.data.id, mod.data.type, inputsOf(mod.data.data), [
        ...fieldNames(context, mod.data.id, mod.data.type, 'inputs'),
        ...declared,
      ])
    }
    case 'update_node': {
      const type = context.types.get(mod.data.id)
      if (!type || !getOperator(context.registry, type)) return []
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

function unknownInputs(id: string, type: string, given: string[], known: string[]): string[] {
  return given
    .filter(name => !known.includes(name))
    .map(name => unknownInput(id, type, name, known))
}

function handleProblem(
  context: FieldCheckContext,
  nodeId: string,
  handle: string,
  side: Side
): string | null {
  const type = context.types.get(nodeId)
  // An unknown node is checkTarget's to report, an unknown type add_node's
  if (!type || !getOperator(context.registry, type)) return null
  return describeHandleProblem(nodeId, type, handle, side, fieldNames(context, nodeId, type, side))
}

function fieldNames(
  context: FieldCheckContext,
  nodeId: string,
  type: string,
  side: Side
): string[] {
  const fromClass = Object.keys(getOperator(context.registry, type)?.[side] ?? {})
  return [...new Set([...fromClass, ...context.liveFields(nodeId, side)])]
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
