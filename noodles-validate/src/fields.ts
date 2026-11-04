// Operator types, input names and edge handles, checked against the registry.
//
// The editor takes an unknown type or handle without complaint: the node loads
// as an UnknownOperator, the edge connects nothing, and nothing says why the map
// is blank. Every message here names what should have been written instead, so
// the next attempt is a pick from a list rather than another guess.
//
// The editor's apply_modifications checks (src/ai-chat/modification-fields.ts)
// import these too, so an agent sees the same error whether it edits the file
// or the running app. Nothing here touches Node APIs, so the editor bundles it
// through the "noodles-validate/fields" export.

import type { OperatorInfo, Registry } from './types.ts'

// The editor's runtime registry has the operators but no schema version
export type OperatorLookup = Pick<Registry, 'operators'>

// How many names a "has no input" error lists
const FIELD_SUGGESTIONS = 15

export type Side = 'inputs' | 'outputs'

// Own properties only: a plain lookup finds "constructor" and "toString" on
// every object, so a node of type "constructor" would pass as an operator
export function getOperator(registry: OperatorLookup, type: string): OperatorInfo | undefined {
  return Object.hasOwn(registry.operators, type) ? registry.operators[type] : undefined
}

// "File", "file", "FileOp" and "fileop" all name FileOp. Resolves a name that
// matches exactly one operator by type or display name; returned unchanged
// otherwise.
export function resolveOperatorType(type: string, registry: OperatorLookup): string {
  const operators = registry.operators
  if (getOperator(registry, type)) return type
  if (getOperator(registry, `${type}Op`)) return `${type}Op`
  const wanted = type.trim().toLowerCase()
  const matches = Object.values(operators).filter(
    op =>
      op.type.toLowerCase() === wanted ||
      op.type.toLowerCase() === `${wanted}op` ||
      op.name.toLowerCase() === wanted
  )
  return matches.length === 1 ? matches[0].type : type
}

// allTypes says where the full list is: list_operators for an agent with tools
export function unknownType(
  type: string,
  registry: OperatorLookup,
  allTypes = 'registry.json in noodles-validate lists every type.'
): string {
  const resolved = resolveOperatorType(type, registry)
  if (resolved !== type) {
    return `Unknown operator type ${type}. Did you mean: ${resolved}? Types end in "Op", e.g. FileOp, ScatterplotLayerOp.`
  }
  const wanted = type.toLowerCase().replace(/op$/, '')
  const similar = Object.values(registry.operators)
    .filter(
      op =>
        op.type.toLowerCase().includes(wanted) ||
        wanted.includes(op.name.toLowerCase()) ||
        isTypo(wanted, op.name.toLowerCase())
    )
    .map(op => op.type)
    .slice(0, FIELD_SUGGESTIONS)
  const hint = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : ` ${allTypes}`
  return `Unknown operator type ${type}.${hint} Types end in "Op", e.g. FileOp, ScatterplotLayerOp.`
}

export function fieldNames(registry: OperatorLookup, type: string, side: Side): string[] {
  return Object.keys(getOperator(registry, type)?.[side] ?? {})
}

export function unknownInput(id: string, type: string, name: string, known: string[]): string {
  return `${id} (${type}) has no input ${name}. ${suggest(name, known, 'Inputs')}`
}

// A node's vector inputs that can split into number ports, and the ones that are split
// (data.inputPortModes, { center: 'channels' })
export interface PortLayout {
  channels: Record<string, string[]>
  modes: Record<string, unknown>
}

// The registry's channel-capable inputs of an operator type
export function inputChannels(registry: OperatorLookup, type: string): Record<string, string[]> {
  const inputs = getOperator(registry, type)?.inputs ?? {}
  return Object.fromEntries(
    Object.entries(inputs).flatMap(([name, field]) =>
      field.channels ? [[name, field.channels]] : []
    )
  )
}

// data.inputPortModes: { "<vector input>": "channels" } for each input split into one
// number port per component. The editor ignores entries it can't use, so an edge to a
// channel of a misspelled input would connect nothing.
export function portModeProblems(
  id: string,
  modes: unknown,
  channels: Record<string, string[]>
): string[] {
  if (modes === undefined) return []
  if (typeof modes !== 'object' || modes === null || Array.isArray(modes)) {
    return [
      `${id} data.inputPortModes is not an object of input names to "channels" or "whole", e.g. {"center": "channels"}.`,
    ]
  }
  const vectors = Object.keys(channels)
  const which =
    vectors.length > 0 ? `Inputs that can: ${vectors.join(', ')}.` : 'It has no inputs that can.'
  return Object.entries(modes).flatMap(([name, mode]) => {
    if (!Object.hasOwn(channels, name)) {
      return [`${id} data.inputPortModes.${name}: ${name} can't split into channel ports. ${which}`]
    }
    if (mode !== 'channels' && mode !== 'whole') {
      return [
        `${id} data.inputPortModes.${name} is ${JSON.stringify(mode)}. Use "channels" to split it into ${channels[name].join(', ')}, or "whole" for one port.`,
      ]
    }
    return []
  })
}

// An edge to `center` while it's split into channels, or to `center.lng` while it isn't.
// Matches the editor's portLayoutError (src/noodles/utils/field-resolution.ts).
export function portLayoutProblem(fieldPath: string, ports: PortLayout): string | null {
  const split = (name: string) => ports.modes[name] === 'channels'
  if (Object.hasOwn(ports.channels, fieldPath)) {
    if (!split(fieldPath)) return null
    const names = ports.channels[fieldPath].map(key => `${fieldPath}.${key}`)
    return `${fieldPath} is split into ${names.join(', ')}. Connect a channel, or switch the input back to one port.`
  }
  const dot = fieldPath.lastIndexOf('.')
  const root = fieldPath.slice(0, dot)
  if (dot < 0 || !Object.hasOwn(ports.channels, root)) return null
  if (!ports.channels[root].includes(fieldPath.slice(dot + 1)) || split(root)) return null
  return `${fieldPath} is a channel port, but ${root} is one port. Switch ${root} to channel ports first.`
}

// Null when the handle names a real field on the right side of the edge. With ports,
// a target may also be a channel of a split vector input, e.g. par.center.lng.
export function handleProblem(
  nodeId: string,
  type: string,
  handle: string,
  side: Side,
  known: string[],
  ports?: PortLayout
): string | null {
  const prefix = side === 'outputs' ? 'out' : 'par'
  const role = side === 'outputs' ? 'sourceHandle' : 'targetHandle'
  const label = side === 'outputs' ? 'Outputs' : 'Inputs'
  const match = /^(par|out)\.(.+)$/.exec(handle)
  if (!match) {
    return `${role} ${handle} is malformed: ${side} are "${prefix}.<name>". ${suggest(handle, known, label, nodeId, prefix)}`
  }
  if (match[1] !== prefix) {
    return `${role} ${handle} is on the wrong side: the ${side === 'outputs' ? 'source' : 'target'} of an edge is an ${side === 'outputs' ? 'output' : 'input'}, "${prefix}.<name>". ${suggest(match[2], known, label, nodeId, prefix)}`
  }
  // The graph looks up everything after the prefix, so 'par.viewState.zoom' is a
  // field named 'viewState.zoom', not the viewState field. A split vector input is the
  // exception: its channels are fields of their own.
  const layout = side === 'inputs' && ports ? portLayoutProblem(match[2], ports) : null
  if (layout) return `${nodeId} (${type}): ${layout}`
  if (known.includes(match[2])) return null
  const dot = match[2].lastIndexOf('.')
  const root = match[2].slice(0, dot)
  if (
    side === 'inputs' &&
    ports &&
    dot > 0 &&
    ports.channels[root]?.includes(match[2].slice(dot + 1))
  ) {
    return null
  }
  return `${nodeId} (${type}) has no ${side === 'outputs' ? 'output' : 'input'} ${match[2]}. ${suggest(match[2], known, label, nodeId, prefix)}`
}

// Names containing the wrong one, or one typo away from it, first ("color" ->
// getFillColor, getLineColor); otherwise the full list
export function suggest(
  name: string,
  known: string[],
  label: string,
  nodeId?: string,
  prefix?: string
): string {
  if (known.length === 0) return `It has no ${label.toLowerCase()}.`
  const wanted = name.toLowerCase()
  const similar = wanted
    ? known.filter(k => {
        const candidate = k.toLowerCase()
        return candidate.includes(wanted) || wanted.includes(candidate) || isTypo(wanted, candidate)
      })
    : []
  const pool = similar.length > 0 ? similar : known
  const list = pool.slice(0, FIELD_SUGGESTIONS)
  const more = pool.length - list.length
  const shown = prefix ? list.map(k => `${prefix}.${k}`) : list
  const where = nodeId ? ` on ${nodeId}` : ''
  return `${similar.length > 0 ? 'Did you mean' : `${label}${where}`}: ${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}.`
}

// Within two edits, for names long enough that two edits isn't most of the word
export function isTypo(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 2) return false
  return editDistance(a, b) <= 2
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[b.length]
}
