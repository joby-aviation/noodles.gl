// Operator types, parameter names and ports, checked against the registry.
//
// The editor takes an unknown operator, parameter or port without much complaint: the node
// draws nothing, the parameter is ignored, the wire carries nothing, and nothing says why the
// map is blank. Every message here names what should have been written instead, so the next
// attempt is a pick from a list rather than another guess. Nothing here touches Node APIs.

import type { OperatorInfo, Registry } from './types.ts'

export type OperatorLookup = Pick<Registry, 'operators' | 'formerly'>

// How many names a "has no parameter" error lists
const SUGGESTIONS = 15

export type Side = 'inputs' | 'outputs'

// Own properties only: a plain lookup finds "constructor" and "toString" on every object, so a
// node of op "constructor" would pass as an operator
export function getOperator(registry: OperatorLookup, type: string): OperatorInfo | undefined {
  return Object.hasOwn(registry.operators, type) ? registry.operators[type] : undefined
}

// "scatter", "Scatter Layer" and "SCATTER" all name scatter. Resolves a name that matches
// exactly one operator by type or display name; returned unchanged otherwise.
export function resolveOperatorType(type: string, registry: OperatorLookup): string {
  if (getOperator(registry, type)) return type
  const wanted = type.trim().toLowerCase()
  const ops = Object.values(registry.operators)
  const byType = ops.filter(op => op.type.toLowerCase() === wanted)
  if (byType.length === 1) return byType[0].type
  const byName = ops.filter(op => op.name.toLowerCase() === wanted)
  return byName.length === 1 ? byName[0].type : type
}

// allTypes says where the full list is: list_operators for an agent with tools
export function unknownType(
  type: string,
  registry: OperatorLookup,
  allTypes = 'registry.json in noodles-validate lists every operator.'
): string {
  const resolved = resolveOperatorType(type, registry)
  if (resolved !== type) return `Unknown operator ${type}. Did you mean: ${resolved}?`
  // An operator class from an older file: say what it is now
  const former = registry.formerly && Object.hasOwn(registry.formerly, type)
  if (former) {
    const now = registry.formerly?.[type] ?? []
    return `Unknown operator ${type}: that is an operator class from older files. In a document it is ${now.join(' or ')}.`
  }
  const wanted = type.toLowerCase().replace(/op$/, '')
  const similar = Object.values(registry.operators)
    .filter(
      op =>
        op.type.includes(wanted) ||
        (op.type.length > 3 && wanted.includes(op.type)) ||
        isTypo(wanted, op.type)
    )
    .map(op => op.type)
    .slice(0, SUGGESTIONS)
  const hint = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : ` ${allTypes}`
  return `Unknown operator ${type}.${hint}`
}

export function portNames(registry: OperatorLookup, type: string, side: Side): string[] {
  return Object.keys(getOperator(registry, type)?.[side] ?? {})
}

export function paramNames(registry: OperatorLookup, type: string): string[] {
  return Object.keys(getOperator(registry, type)?.params ?? {})
}

export function unknownParam(label: string, type: string, name: string, known: string[]): string {
  return `${label} (${type}) has no parameter ${name}. ${suggest(name, known, 'Parameters')}`
}

// Null when the port is one the operator has, on the right side of the edge. An input is a
// port name or `par:<parameter>`.
export function portProblem(
  label: string,
  type: string,
  port: string,
  side: Side,
  ports: string[],
  params: string[]
): string | null {
  if (side === 'outputs') {
    if (ports.includes(port)) return null
    if (port.startsWith('par:') || port.startsWith('out.')) {
      return `sourcePort ${port} is not an output. ${suggest(port.replace(/^(par:|out\.)/, ''), ports, 'Outputs', label)}`
    }
    return `${label} (${type}) has no output ${port}. ${suggest(port, ports, 'Outputs', label)}`
  }
  if (port.startsWith('par:')) {
    const name = port.slice(4)
    if (params.includes(name)) return null
    return `${label} (${type}) has no parameter ${name} for ${port}. ${suggest(name, params, 'Parameters', label, 'par:')}`
  }
  if (ports.includes(port)) return null
  // An old handle (par.data, par.layers) or a parameter without its prefix
  const bare = port.replace(/^(par|out)\./, '')
  if (ports.includes(bare)) return `targetPort ${port} is an old handle; write ${bare}.`
  if (params.includes(bare)) return `targetPort ${port}: a parameter's port is par:${bare}.`
  return `${label} (${type}) has no input ${port}. ${suggest(bare, ports, 'Inputs', label)}`
}

// Names containing the wrong one, or one typo away from it, first ("color" -> fillColor,
// lineColor); otherwise the full list
export function suggest(
  name: string,
  known: string[],
  label: string,
  nodeLabel?: string,
  prefix = ''
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
  const list = pool.slice(0, SUGGESTIONS)
  const more = pool.length - list.length
  const where = nodeLabel ? ` on ${nodeLabel}` : ''
  return `${similar.length > 0 ? 'Did you mean' : `${label}${where}`}: ${list.map(k => `${prefix}${k}`).join(', ')}${more > 0 ? ` (+${more} more)` : ''}.`
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
