import { type Field, supportsChannelPorts, type VectorField } from '../fields'
import type { IOperator, Operator } from '../operators'
import { parseHandleId } from './path-utils'

// A split vector's channel fields as plain Fields; empty while the input is one port
export function channelFields(field: VectorField): Record<string, Field> {
  return (field.channels?.fields ?? {}) as unknown as Record<string, Field>
}

export type ResolvedField = {
  // The field the handle points at: the input itself, or one of its channel fields
  field: Field
  // The operator input that owns `field`
  rootField: Field
  rootFieldName: string
  channelName?: string
}

// Resolve `center` or `center.lng` (an edge handle without its `par.`/`out.` prefix) to a
// field. A channel resolves only while its input is in channels mode; see VectorField.
export function resolveOperatorField(
  op: Operator<IOperator> | undefined,
  namespace: 'par' | 'out',
  fieldPath: string
): ResolvedField | undefined {
  if (!op || !fieldPath) return undefined
  const fields = (namespace === 'par' ? op.inputs : op.outputs) as Record<string, Field>
  const direct = fields[fieldPath]
  if (direct) return { field: direct, rootField: direct, rootFieldName: fieldPath }
  if (namespace !== 'par') return undefined

  const dot = fieldPath.lastIndexOf('.')
  if (dot <= 0) return undefined
  const rootFieldName = fieldPath.slice(0, dot)
  const channelName = fieldPath.slice(dot + 1)
  const rootField = fields[rootFieldName]
  if (!supportsChannelPorts(rootField)) return undefined
  const field = channelFields(rootField)[channelName]
  if (!field) return undefined
  return { field, rootField, rootFieldName, channelName }
}

export function resolveHandleField(
  op: Operator<IOperator> | undefined,
  handle: string | null | undefined
): ResolvedField | undefined {
  const info = handle ? parseHandleId(handle) : undefined
  return info ? resolveOperatorField(op, info.namespace, info.fieldName) : undefined
}

// Why an input handle doesn't match the input's port layout, e.g. `par.center` while
// `center` is split into channels. Undefined when the handle is usable, or isn't a
// vector input's handle at all.
export function portLayoutError(
  op: Operator<IOperator> | undefined,
  fieldPath: string
): string | undefined {
  if (!op) return undefined
  const fields = op.inputs as Record<string, Field>
  if (supportsChannelPorts(fields[fieldPath])) {
    if (op.getInputPortMode(fieldPath) !== 'channels') return undefined
    return `${fieldPath} is split into ${fields[fieldPath].channelKeys.map(k => `${fieldPath}.${k}`).join(', ')}. Connect a channel, or switch the input back to one port.`
  }
  const dot = fieldPath.lastIndexOf('.')
  if (dot <= 0) return undefined
  const rootFieldName = fieldPath.slice(0, dot)
  const channelName = fieldPath.slice(dot + 1)
  const rootField = fields[rootFieldName]
  if (!supportsChannelPorts(rootField) || !rootField.channelKeys.includes(channelName)) {
    return undefined
  }
  if (op.getInputPortMode(rootFieldName) === 'channels') return undefined
  return `${fieldPath} is a channel port, but ${rootFieldName} is one port. Switch ${rootFieldName} to channel ports first.`
}

// A `par` read path with a deprecated input name replaced (see Operator.inputAliases):
// `longitude` gives `center.lng` on a MapViewState. Only for reads by name in code and
// mustache references, never for edge handles.
export function inputAliasPath(op: Operator<IOperator> | undefined, fieldPath: string): string {
  if (!op) return fieldPath
  const aliases = (op.constructor as { inputAliases?: Readonly<Record<string, string>> })
    .inputAliases
  const [name, ...rest] = fieldPath.split('.')
  if (!aliases || !Object.hasOwn(aliases, name) || name in op.inputs) return fieldPath
  return [aliases[name], ...rest].join('.')
}

// The value at `center.lng` (a field name, then keys into its value)
export function readFieldPath(fields: Record<string, Field>, fieldPath: string): unknown {
  const [name, ...keys] = fieldPath.split('.')
  return keys.reduce<unknown>(
    (value, key) => (value as Record<string, unknown> | null | undefined)?.[key],
    fields[name]?.value
  )
}

// The input a handle belongs to: `center.lng` and `center` both give `center`
export function rootInputName(op: Operator<IOperator> | undefined, fieldPath: string): string {
  return resolveOperatorField(op, 'par', fieldPath)?.rootFieldName ?? fieldPath
}

// Every input field that can hold a connection: the inputs plus any open channel fields
export function inputFieldsWithChannels(op: Operator<IOperator>): Field[] {
  const result: Field[] = []
  for (const field of Object.values(op.inputs as Record<string, Field>)) {
    result.push(field)
    if (supportsChannelPorts(field) && field.channels) {
      result.push(...Object.values(channelFields(field)))
    }
  }
  return result
}

// Input fields keyed by handle path: `center`, and `center.lng`, `center.lat` while split
export function inputFieldEntries(op: Operator<IOperator>): [string, Field][] {
  const result: [string, Field][] = []
  for (const [name, field] of Object.entries(op.inputs as Record<string, Field>)) {
    result.push([name, field])
    if (supportsChannelPorts(field) && field.channels) {
      for (const [key, channel] of Object.entries(channelFields(field))) {
        result.push([`${name}.${key}`, channel])
      }
    }
  }
  return result
}

// The input ports an operator shows, keyed by handle path: a split input contributes its
// channels in place of the whole value
export function inputPortEntries(op: Operator<IOperator>): [string, Field][] {
  const result: [string, Field][] = []
  for (const [name, field] of Object.entries(op.inputs as Record<string, Field>)) {
    if (supportsChannelPorts(field) && field.channels) {
      for (const [key, channel] of Object.entries(channelFields(field))) {
        result.push([`${name}.${key}`, channel])
      }
    } else {
      result.push([name, field])
    }
  }
  return result
}
