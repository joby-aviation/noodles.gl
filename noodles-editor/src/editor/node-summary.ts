// One line on a node saying what it does, as Houdini and TouchDesigner show a node's key
// parameters on the node: the file it reads, the condition it keeps, the column it makes.

import type { DocNode, OpDef, ParamDef, ParamValue } from '@noodles.gl/planner'

const MAX = 48

const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s)

function num(v: unknown): string {
  return typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v)
}

/** A parameter's value as written on a node: an expression or a reference as itself. */
export function shownValue(v: ParamValue | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'object' && !Array.isArray(v)) {
    if ('expr' in v) return String(v.expr)
    if ('ref' in v) return `→ ${String(v.ref)}`
    return '{…}'
  }
  if (Array.isArray(v)) return `[${v.map(num).join(', ')}]`
  return num(v)
}

const firstLine = (text: unknown) =>
  String(Array.isArray(text) ? text.join('\n') : (text ?? ''))
    .split('\n')
    .map(l => l.trim())
    .find(l => l && !l.startsWith('//') && !l.startsWith('--')) ?? ''

const fileName = (url: unknown) =>
  String(url ?? '')
    .replace(/^@\//, '')
    .split(/[/?#]/)
    .filter(Boolean)
    .at(-1) ?? ''

export function summaryOf(node: DocNode, op: OpDef): string | undefined {
  const value = (name: string): ParamValue | undefined =>
    node.params[name] ?? op.params.find(p => p.name === name)?.default
  const v = (name: string) => shownValue(value(name))
  const text = (() => {
    switch (node.op) {
      case 'file':
      case 'geojson':
        return fileName(value('url'))
      case 'sql':
        return firstLine(value('query'))
      case 'code':
        return value('url') ? fileName(value('url')) : firstLine(value('code'))
      case 'wrangle':
        return firstLine(value('code'))
      case 'filter': {
        const mode = v('mode')
        if (mode === 'expression') return v('expression')
        if (mode === 'match') return `${v('column')} ${value('negate') ? '≠' : '='} '${v('text')}'`
        return `${v('column')} ${v('op')} ${v('value')}`
      }
      case 'attribute':
        return `${v('name')} = ${v('expression')}`
      case 'map-range':
        return `${v('input')}: ${v('inMin')}–${v('inMax')} → ${v('outMin')}–${v('outMax')}`
      case 'color-ramp':
        return `${v('input')} → ${v('ramp')}`
      case 'aggregate': {
        const by = v('groupBy')
        const aggs = firstLine(value('aggs'))
        return by ? `by ${by}: ${aggs}` : aggs
      }
      case 'sort':
        return `by ${v('by')} ${value('descending') ? '↓' : '↑'}`
      case 'limit':
        return `${v('count')} rows`
      case 'join':
        return `${v('how')} on ${v('leftKey')} = ${v('rightKey')}`
      case 'number':
        return v('value')
      case 'expression':
        return v('expression')
      case 'math':
        return `${v('a')} ${v('op')} ${v('b')}`
      case 'time':
        return `T × ${v('speed')}`
    }
    // A layer: what its first channel reads
    if (op.category === 'layer') {
      const channel = op.params.find(p => p.folder === 'Channels' && v(p.name))
      return channel ? `${channel.label.toLowerCase()} ← ${v(channel.name)}` : undefined
    }
    // Anything else: the first parameter set away from its default
    const set = op.params.find(
      (p: ParamDef) =>
        p.kind !== 'field' &&
        p.name in node.params &&
        JSON.stringify(node.params[p.name]) !== JSON.stringify(p.default)
    )
    return set ? `${set.label.toLowerCase()}: ${v(set.name)}` : undefined
  })()
  return text ? clip(text) : undefined
}
