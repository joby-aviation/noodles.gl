// Noodles operators the planner can't express, registered as planner operators that the host
// runs. A host operator has no `lower`, so lowering skips it; its inputs are parameters with
// `par:` handles, as Noodles' `par.x` handles are, and its outputs are typed by field.
//
// Host operators carry no per-row values. An operator with an accessor input (a layer's
// getPosition, MapRange's val) is never a host operator: its per-row work belongs to attribute
// and wrangle nodes, and its layer to a planner layer fed binary attributes.

import { type OpDef, type ParamDef, type PortType, registerOperator } from '@noodles.gl/planner'
import {
  DataField,
  type Field,
  GeoJsonField,
  LayerField,
  ListField,
  NumberField,
} from '../../noodles/fields'
import { type IOperator, type Operator, opTypes } from '../../noodles/operators'

/** Noodles operators the conversion replaces with planner operators. */
export const PLANNER_REPLACED = new Set([
  'DuckDbOp',
  'ScatterplotLayerOp',
  'ArcLayerOp',
  'MapRangeOp',
  'ColorRampOp',
  'MathOp',
  'ColorOp',
  'BlendingOp',
  'NumberOp',
  'DeckRendererOp',
  'OutOp',
  'MaplibreBasemapOp',
])

/** Operators that exist only to make per-row functions. Their work moves to row nodes. */
const ACCESSOR_ONLY = new Set(['AccessorOp'])

/** What a field's value is, for ports. */
function portTypeOf(field: Field): PortType {
  const inner = field instanceof ListField ? (field as ListField<Field>).field : field
  if (inner instanceof LayerField) return 'layer'
  if (inner instanceof NumberField) return 'number'
  // Rows and GeoJSON reach planner nodes as tables (the engine hands them to DuckDB)
  if (inner instanceof DataField || inner instanceof GeoJsonField) return 'table'
  return 'value'
}

type OperatorClass = new (id: string, data?: unknown, locked?: boolean) => Operator<IOperator>

const eligible = new Map<string, boolean>()

/** Whether a Noodles operator can run as a host operator: no accessor inputs, not replaced. */
export function isHostOperator(type: string, instance?: Operator<IOperator>): boolean {
  if (PLANNER_REPLACED.has(type) || ACCESSOR_ONLY.has(type)) return false
  const known = eligible.get(type)
  if (known !== undefined) return known
  const op = instance ?? sample(type)
  const ok = !!op && !Object.values(op.inputs as Record<string, Field>).some(f => f.accessor)
  eligible.set(type, ok)
  if (op && !instance) (op as { dispose?: () => void }).dispose?.()
  return ok
}

function sample(type: string): Operator<IOperator> | undefined {
  const Class = (opTypes as unknown as Record<string, OperatorClass>)[type]
  if (!Class) return undefined
  try {
    return new Class('/__host-sample', undefined, false)
  } catch {
    return undefined
  }
}

/** The planner operator for a Noodles operator class. */
export function hostOpDef(type: string, instance: Operator<IOperator>): OpDef {
  const Class = instance.constructor as typeof Operator & {
    displayName?: string
    description?: string
  }
  const params: ParamDef[] = Object.entries(instance.inputs as Record<string, Field>).map(
    ([name, field]) => ({
      name,
      label: name,
      kind: 'field',
      default: field.serialize() as ParamDef['default'],
      port: true,
      // An input takes rows from a table or any value, as the field always did
      portType: portTypeOf(field) === 'table' ? 'value' : portTypeOf(field),
      // The parameter pane builds its widget from a fresh instance of this field.
      field: { op: type, input: name },
    })
  )
  return {
    type,
    label: Class.displayName ?? type.replace(/Op$/, ''),
    category: 'host',
    description: Class.description ?? '',
    inputs: [],
    outputs: Object.entries(instance.outputs as Record<string, Field>).map(([name, field]) => ({
      name,
      type: portTypeOf(field),
      multi: field instanceof ListField,
    })),
    params,
  }
}

let registered: string[] | undefined

/** Register every eligible Noodles operator with the planner's catalog. Idempotent. */
export function registerHostOperators(): string[] {
  if (registered) return registered
  registered = []
  for (const type of Object.keys(opTypes)) {
    if (PLANNER_REPLACED.has(type) || ACCESSOR_ONLY.has(type)) continue
    const instance = sample(type)
    if (!instance || !isHostOperator(type, instance)) continue
    registerOperator(hostOpDef(type, instance))
    registered.push(type)
    ;(instance as { dispose?: () => void }).dispose?.()
  }
  return registered
}
