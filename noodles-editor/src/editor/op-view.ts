// `op()` on the document: a node found by path, its parameters from the document (a keyframed
// one at the playhead), its outputs from the engine. Code reads a host operator's outputs as
// they are; a planner node's rows arrive from DuckDB, so the first read of one returns
// undefined and starts the read.

import {
  type DocNode,
  type EditorDoc,
  evaluateTrack,
  nameOf,
  nodePath,
  OPERATOR_INDEX,
} from '@noodles.gl/planner'
import type { OpView } from '../noodles/op-resolver'
import type { Engine } from '../runtime/engine'
import { setParam } from './doc-ops'
import type { DocStore } from './doc-store'

/** A Noodles path (`/a/b`, `./x`, `../y`, `x`) from the node at `from`, absolute. */
function absolutePath(path: string, from: string | undefined): string {
  if (path.startsWith('/')) return path
  const parts = (from ?? '/').split('/').slice(0, -1)
  for (const seg of path.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/') || '/'
}

/** A node by path from a context node; by id or bare name as a last resort. */
export function findByPath(doc: EditorDoc, path: string, contextId?: string): DocNode | undefined {
  const context = contextId ? doc.nodes.find(n => n.id === contextId) : undefined
  const from = context
    ? context.id.startsWith('/')
      ? context.id
      : nodePath(doc, context)
    : undefined
  const target = absolutePath(path, from)
  return (
    doc.nodes.find(n => n.id === target) ??
    doc.nodes.find(n => nodePath(doc, n) === target) ??
    doc.nodes.find(n => n.id === path) ??
    doc.nodes.find(n => nameOf(n) === path.replace(/^\.?\//, ''))
  )
}

export function opView(
  store: DocStore,
  engine: () => Engine | undefined,
  path: string,
  contextId?: string
): OpView | undefined {
  const { doc } = store.get()
  const node = findByPath(doc, path, contextId)
  if (!node) return undefined
  const def = OPERATOR_INDEX.get(node.op)
  const id = node.id
  const paramValue = (name: string) => {
    const current = store.get()
    const track = current.doc.timeline?.tracks.find(t => t.target === `${id}.${name}`)
    if (track) return evaluateTrack(track, current.time)
    const n = current.doc.nodes.find(x => x.id === id)
    return n?.params[name] ?? def?.params.find(p => p.name === name)?.default
  }
  const names = () => [
    ...new Set([...(def?.params.map(p => p.name) ?? []), ...Object.keys(node.params)]),
  ]
  const par = new Proxy({} as Record<string, unknown>, {
    get: (_t, name) => (typeof name === 'string' ? paramValue(name) : undefined),
    set: (_t, name, value) => {
      if (typeof name !== 'string') return false
      // One undo step for a burst of assignments, as a run of code makes
      store.edit(d => setParam(d, id, name, value, store.get().time), `op-set:${id}`)
      return true
    },
    has: (_t, name) => typeof name === 'string' && names().includes(name),
    ownKeys: () => names(),
    getOwnPropertyDescriptor: (_t, name) =>
      typeof name === 'string' && names().includes(name)
        ? { enumerable: true, configurable: true, value: paramValue(name) }
        : undefined,
  })
  const outValue = (port: string) => {
    const e = engine()
    if (!e) return undefined
    if (def?.category === 'host') return e.hostOutput(id, port)
    return e.peekRows(id, port)
  }
  const ports = () => def?.outputs.map(p => p.name) ?? []
  const out = new Proxy({} as Record<string, unknown>, {
    get: (_t, port) => (typeof port === 'string' ? outValue(port) : undefined),
    has: (_t, port) => typeof port === 'string' && ports().includes(port),
    ownKeys: () => ports(),
    getOwnPropertyDescriptor: (_t, port) =>
      typeof port === 'string' && ports().includes(port)
        ? { enumerable: true, configurable: true, value: outValue(port) }
        : undefined,
  })
  return { id, par, out }
}
