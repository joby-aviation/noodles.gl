// The operator catalog as JSON, for the tools that check documents outside the editor
// (noodles-validate, noodles-mcp). operator-registry-snapshot.test.ts keeps
// noodles-validate/registry.json equal to it.

import type { OpDef, ParamDef, PortSpec } from '@noodles.gl/planner'
import { OPERATORS } from '@noodles.gl/planner'
import { OP_CATALOG } from '../runtime/migrate/op-catalog'
import { CONVERTED_SCHEMA } from '../runtime/migrate/to-editor-doc'

const port = (p: PortSpec) => ({
  type: p.type,
  ...(p.multi && { multi: true }),
  ...(p.optional && { optional: true }),
})

// A default that JSON can hold; a date's is a local time, so it differs by timezone
function stableDefault(p: ParamDef): unknown {
  const v = p.default
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return undefined
  try {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
  } catch {
    return undefined
  }
}

const param = (p: ParamDef) => {
  const fallback = stableDefault(p)
  return {
    kind: p.kind,
    ...(fallback !== undefined && { default: fallback }),
    ...(p.options && { options: p.options.map(o => o.value) }),
    ...(p.portType && { portType: p.portType }),
  }
}

const entry = (op: OpDef) => ({
  name: op.label,
  type: op.type,
  category: op.category,
  description: op.description,
  inputs: Object.fromEntries(op.inputs.map(p => [p.name, port(p)])),
  outputs: Object.fromEntries(op.outputs.map(p => [p.name, port(p)])),
  params: Object.fromEntries(op.params.map(p => [p.name, param(p)])),
})

// Every registered operator, sorted by type. Register the host operators first.
export function operatorRegistry() {
  const operators = Object.fromEntries(
    [...OPERATORS].sort((a, b) => a.type.localeCompare(b.type)).map(op => [op.type, entry(op)])
  )
  // The operator classes of older files and what they convert to, so a checker can say that
  // ScatterplotLayerOp is now scatter
  const formerly = Object.fromEntries(
    Object.entries(OP_CATALOG)
      .filter(([, plan]) => plan.ops?.length)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, plan]) => [type, plan.ops])
  )
  // Operator-graph files up to this schema version convert when they open
  return { documentVersion: 1, convertsFrom: CONVERTED_SCHEMA, operators, formerly }
}
