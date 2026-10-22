// The assistant's graph tools on the editor's document: what nodes there are, what a node
// reads and makes, and edits to the document. Edits apply at once, as one undo step per
// apply_modifications call, so a later call in the same run sees them.
//
// Nodes are named by id, by name, or by path (`/data-source`, `data-source`, `scatter1`):
// models carry names over from what list_nodes showed them, and the document's ids are
// opaque for nodes made in the editor.

import {
  type DocEdge,
  type DocNode,
  type EditorDoc,
  nameOf,
  nodePath,
  OPERATOR_INDEX,
  OPERATORS,
  type OpDef,
  type ParamDef,
  type ParamValue,
} from '@noodles.gl/planner'
import { z } from 'zod'
import {
  addNode,
  clearTrack,
  connect,
  removeEdges,
  removeKey,
  removeNodes,
  renameNode,
  setKey,
  setParam,
  validConnection,
} from '../editor/doc-ops'
import type { DocStore } from '../editor/doc-store'
import type { Engine } from '../runtime/engine'
import type { ToolResult } from './types'

/** Where the tools find the document, the engine, and the playhead. */
export interface DocToolContext {
  store: DocStore
  engine: () => Engine | undefined
  playhead?: {
    position(): number
    playing(): boolean
    seek(seconds: number): void
    play(): void
    pause(): void
  }
}

// Longest string parameter list_nodes reports in full; get_node_info returns it whole.
const PREVIEW_CHARS = 200

const preview = (params: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(params).map(([k, v]) => {
      const text = typeof v === 'string' ? v : JSON.stringify(v)
      return [k, text && text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : v]
    })
  )

/** A node by id, name or path; undefined unless exactly one matches. */
export function findNode(doc: EditorDoc, ref: unknown): DocNode | undefined {
  if (typeof ref !== 'string' || !ref.trim()) return undefined
  const raw = ref.trim()
  const exact = doc.nodes.find(n => n.id === raw)
  if (exact) return exact
  const bare = raw.replace(/^\.?\//, '')
  const matches = doc.nodes.filter(
    n =>
      n.id === `/${bare}` ||
      n.id.replace(/^\//, '') === bare ||
      nameOf(n) === bare ||
      nodePath(doc, n) === raw ||
      nodePath(doc, n) === `/${bare}`
  )
  return matches.length === 1 ? matches[0] : undefined
}

function notFound(doc: EditorDoc, ref: unknown): string {
  const names = doc.nodes.map(nameOf)
  if (names.length === 0) return `Node not found: ${String(ref)}. The document has no nodes yet.`
  const token = String(ref)
    .replace(/^\.?\//, '')
    .toLowerCase()
  const similar = token ? names.filter(n => n.toLowerCase().includes(token)) : []
  const list = (similar.length ? similar : names).slice(0, 12)
  return `Node not found: ${String(ref)}. ${similar.length ? 'Did you mean' : 'Nodes'}: ${list.join(', ')}.`
}

function operatorNotFound(op: string): string {
  const token = op
    .toLowerCase()
    .replace(/op$/, '')
    .replace(/layer$/, '')
  const similar = OPERATORS.filter(
    o => o.type.toLowerCase().includes(token) || o.label.toLowerCase().includes(token)
  )
    .slice(0, 8)
    .map(o => o.type)
  return `Unknown operator '${op}'.${similar.length ? ` Did you mean: ${similar.join(', ')}?` : ' Call list_operators to see them.'}`
}

const paramSummary = (def: ParamDef, value: unknown) => ({
  name: def.name,
  label: def.label,
  kind: def.kind,
  default: def.default,
  ...(value !== undefined ? { value } : {}),
  ...(def.options ? { options: def.options.map(o => o.value) } : {}),
  ...(def.min !== undefined ? { min: def.min } : {}),
  ...(def.max !== undefined ? { max: def.max } : {}),
  ...(def.port ? { wireable: true } : {}),
  ...(def.help ? { help: def.help } : {}),
})

export function operatorSchema(op: OpDef) {
  return {
    type: op.type,
    label: op.label,
    category: op.category,
    description: op.description,
    inputs: op.inputs.map(p => ({
      name: p.name,
      type: p.type,
      ...(p.multi ? { multi: true } : {}),
    })),
    outputs: op.outputs.map(p => ({ name: p.name, type: p.type })),
    params: op.params.map(d => paramSummary(d, undefined)),
  }
}

/** Errors the engine reported for a node: lowering, host and program. */
function nodeErrors(ctx: DocToolContext, nodeId: string): string[] {
  const e = ctx.engine()
  if (!e) return []
  const program = e.runtime.program()
  const ir = new Set(e.lowering()?.irNodes[nodeId] ?? [])
  return [
    ...(e.lowering()?.errors ?? []).filter(x => x.nodeId === nodeId).map(x => x.message),
    ...e
      .errors()
      .filter(x => x.nodeId === nodeId)
      .map(x => x.message),
    ...(program?.errors ?? [])
      .filter(x => x.nodeId === nodeId || ir.has(x.nodeId))
      .map(x => x.message),
  ]
}

// --- reading -----------------------------------------------------------------------

export function listNodes(ctx: DocToolContext): ToolResult {
  const { doc } = ctx.store.get()
  const nodes = doc.nodes.map(n => {
    const op = OPERATOR_INDEX.get(n.op)
    const errors = nodeErrors(ctx, n.id)
    return {
      id: n.id,
      name: nameOf(n),
      op: n.op,
      category: op?.category ?? 'unknown',
      params: preview(n.params),
      ...(n.flags?.bypass ? { bypassed: true } : {}),
      ...(errors.length ? { errors } : {}),
    }
  })
  const byCategory: Record<string, number> = {}
  for (const n of nodes) byCategory[n.category] = (byCategory[n.category] ?? 0) + 1
  return {
    success: true,
    data: {
      name: doc.name,
      nodes,
      edges: doc.edges.map(e => `${e.source}.${e.sourcePort} -> ${e.target}.${e.targetPort}`),
      totalCount: nodes.length,
      byCategory,
    },
  }
}

export function getNodeInfo(ctx: DocToolContext, params: { nodeId: string }): ToolResult {
  const { doc } = ctx.store.get()
  const node = findNode(doc, params.nodeId)
  if (!node) return { success: false, error: notFound(doc, params.nodeId) }
  const op = OPERATOR_INDEX.get(node.op)
  const layer = ctx
    .engine()
    ?.runtime.layers()
    .find(
      l => l.id === node.id || (ctx.engine()?.lowering()?.irNodes[node.id] ?? []).includes(l.id)
    )
  return {
    success: true,
    data: {
      id: node.id,
      name: nameOf(node),
      op: node.op,
      position: { x: node.x, y: node.y },
      ...(node.flags ? { flags: node.flags } : {}),
      description: op?.description,
      params: op ? op.params.map(d => paramSummary(d, node.params[d.name])) : node.params,
      inputs: op?.inputs.map(p => p.name) ?? [],
      outputs: op?.outputs.map(p => p.name) ?? [],
      connections: {
        incoming: doc.edges
          .filter(e => e.target === node.id)
          .map(e => ({ from: e.source, sourcePort: e.sourcePort, targetPort: e.targetPort })),
        outgoing: doc.edges
          .filter(e => e.source === node.id)
          .map(e => ({ to: e.target, sourcePort: e.sourcePort, targetPort: e.targetPort })),
      },
      keyframed: (doc.timeline?.tracks ?? [])
        .filter(t => t.target.startsWith(`${node.id}.`))
        .map(t => t.target.slice(node.id.length + 1)),
      ...(layer?.data ? { drawn: { rows: layer.data.rows, queryMs: layer.queryMs } } : {}),
      errors: nodeErrors(ctx, node.id),
    },
  }
}

export async function getNodeOutput(
  ctx: DocToolContext,
  params: { nodeId: string; maxRows?: number }
): Promise<ToolResult> {
  const { doc } = ctx.store.get()
  const node = findNode(doc, params.nodeId)
  if (!node) return { success: false, error: notFound(doc, params.nodeId) }
  const e = ctx.engine()
  if (!e) return { success: false, error: 'The engine has not started yet' }
  const maxRows = Math.min(Math.max(1, params.maxRows ?? 10), 100)
  const op = OPERATOR_INDEX.get(node.op)
  if (op?.category === 'host') {
    // A host operator's outputs are JS values: sample the arrays.
    const outputs: Record<string, unknown> = {}
    for (const port of op.outputs) {
      const v = e.hostOutput(node.id, port.name)
      outputs[port.name] = Array.isArray(v)
        ? { totalRows: v.length, sample: v.slice(0, maxRows) }
        : v && typeof v === 'object' && 'features' in v
          ? {
              totalRows: (v as { features: unknown[] }).features.length,
              sample: (v as { features: unknown[] }).features.slice(0, maxRows),
            }
          : v
    }
    return {
      success: true,
      data: { nodeId: node.id, op: node.op, outputs, errors: nodeErrors(ctx, node.id) },
    }
  }
  const lowered = e.lowering()
  const ir = lowered?.outputs[node.id]?.out ?? lowered?.irNodes[node.id]?.at(-1)
  if (!ir) {
    return {
      success: false,
      error: `${nameOf(node)} has no rows: ${nodeErrors(ctx, node.id).join('; ') || 'it lowers to nothing'}`,
    }
  }
  const rows = await e.runtime.preview(ir, maxRows)
  return {
    success: true,
    data: {
      nodeId: node.id,
      op: node.op,
      columns: rows.columns.map(c => c.name),
      totalRows: rows.total,
      sample: rows.rows,
      ...(rows.note ? { note: rows.note } : {}),
      errors: nodeErrors(ctx, node.id),
    },
  }
}

export function getCurrentProject(ctx: DocToolContext): ToolResult {
  const { doc } = ctx.store.get()
  return {
    success: true,
    data: {
      name: doc.name,
      nodeCount: doc.nodes.length,
      edgeCount: doc.edges.length,
      nodes: doc.nodes.map(n => ({
        id: n.id,
        name: nameOf(n),
        op: n.op,
        x: n.x,
        y: n.y,
        params: n.params,
      })),
      edges: doc.edges,
      keyframed: (doc.timeline?.tracks ?? []).map(t => t.target),
    },
  }
}

export function listOperators(params: { category?: string }): ToolResult {
  const ops = OPERATORS.filter(o => !params.category || o.category === params.category)
  return {
    success: true,
    data: {
      operators: ops.map(o => ({
        type: o.type,
        label: o.label,
        category: o.category,
        description: o.description,
      })),
      categories: [...new Set(OPERATORS.map(o => o.category))],
    },
  }
}

export function getOperatorSchema(params: { type: string }): ToolResult {
  const op = OPERATOR_INDEX.get(params.type)
  return op
    ? { success: true, data: operatorSchema(op) }
    : { success: false, error: operatorNotFound(params.type) }
}

// --- edits -------------------------------------------------------------------------

const Params = z.record(z.string(), z.unknown())

export const DocModificationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_node'),
    op: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    params: Params.optional(),
  }),
  z.object({
    type: z.literal('update_node'),
    id: z.string(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    bypass: z.boolean().optional(),
    params: Params.optional(),
  }),
  z.object({ type: z.literal('delete_node'), id: z.string() }),
  z.object({
    type: z.literal('add_edge'),
    source: z.string(),
    sourcePort: z.string().optional(),
    target: z.string(),
    targetPort: z.string().optional(),
  }),
  z.object({
    type: z.literal('delete_edge'),
    id: z.string().optional(),
    source: z.string().optional(),
    target: z.string().optional(),
    targetPort: z.string().optional(),
  }),
])

export type DocModification = z.infer<typeof DocModificationSchema>

/** `out.data` / `par.x` / `x`: an operator-graph handle as a document port. */
function portName(handle: string | undefined, side: 'source' | 'target'): string | undefined {
  if (!handle) return undefined
  if (side === 'target' && handle.startsWith('par.')) return `par:${handle.slice(4)}`
  return handle.replace(/^(out|par)\./, '')
}

/** Older and looser spellings: `{type, data: {...}}`, `nodeId`, `inputs`, `sourceHandle`. */
function normalize(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as Record<string, unknown>
  const data = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {}
  const merged: Record<string, unknown> = { ...data, ...r }
  delete merged.data
  if (merged.id === undefined && typeof merged.nodeId === 'string') merged.id = merged.nodeId
  if (merged.op === undefined && typeof merged.operator === 'string') merged.op = merged.operator
  const inputs = (data.inputs ?? r.inputs) as Record<string, unknown> | undefined
  if (inputs && typeof inputs === 'object')
    merged.params = { ...inputs, ...(merged.params as object) }
  delete merged.inputs
  if (merged.sourcePort === undefined && typeof merged.sourceHandle === 'string')
    merged.sourcePort = portName(merged.sourceHandle, 'source')
  if (merged.targetPort === undefined && typeof merged.targetHandle === 'string')
    merged.targetPort = portName(merged.targetHandle, 'target')
  const position = merged.position as { x?: number; y?: number } | undefined
  if (position) {
    merged.x ??= position.x
    merged.y ??= position.y
  }
  return merged
}

/** A parameter value as the document holds it: a color as `[r, g, b]`, a number as a number. */
function paramValue(def: ParamDef | undefined, value: unknown): ParamValue | undefined {
  if (value === null) return undefined
  if (!def) return value as ParamValue
  if (def.kind === 'color' && typeof value === 'string' && value.startsWith('#')) {
    const h = value.slice(1)
    const full = h.length === 3 ? [...h].map(c => c + c).join('') : h
    return [0, 2, 4].map(i => Number.parseInt(full.slice(i, i + 2), 16))
  }
  if (
    (def.kind === 'float' || def.kind === 'int') &&
    typeof value === 'string' &&
    value.trim() !== '' &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value)
  }
  return value as ParamValue
}

function checkParams(op: OpDef, params: Record<string, unknown> | undefined): string[] {
  const known = new Set(op.params.map(p => p.name))
  return Object.keys(params ?? {})
    .filter(k => !known.has(k))
    .map(k => `${op.type} has no parameter '${k}'. Its parameters: ${[...known].join(', ')}`)
}

function defaultSourcePort(doc: EditorDoc, nodeId: string): string | undefined {
  const node = doc.nodes.find(n => n.id === nodeId)
  return node && OPERATOR_INDEX.get(node.op)?.outputs[0]?.name
}

function defaultTargetPort(doc: EditorDoc, nodeId: string): string | undefined {
  const node = doc.nodes.find(n => n.id === nodeId)
  const op = node && OPERATOR_INDEX.get(node.op)
  return op?.inputs.find(p => p.type === 'table')?.name ?? op?.inputs[0]?.name
}

/** Apply one modification to a draft; a message when it cannot be. */
function applyOne(
  doc: EditorDoc,
  mod: DocModification,
  added: Map<string, string>
): string | undefined {
  const node = (ref: string) => {
    const id = added.get(ref)
    return id ? doc.nodes.find(n => n.id === id) : findNode(doc, ref)
  }
  switch (mod.type) {
    case 'add_node': {
      const op = OPERATOR_INDEX.get(mod.op)
      if (!op) return operatorNotFound(mod.op)
      const bad = checkParams(op, mod.params)
      if (bad.length) return bad.join('; ')
      const created = addNode(doc, mod.op, mod.x ?? 0, mod.y ?? 0)
      if (mod.id && !doc.nodes.some(n => n.id === mod.id)) created.id = mod.id
      if (mod.name) {
        const taken = doc.nodes.some(
          n => n !== created && n.parent === created.parent && nameOf(n) === mod.name
        )
        if (taken) return `A node named '${mod.name}' already exists`
        created.name = mod.name
      }
      for (const [k, v] of Object.entries(mod.params ?? {})) {
        const value = paramValue(
          op.params.find(p => p.name === k),
          v
        )
        if (value !== undefined) created.params[k] = value
      }
      for (const ref of [mod.id, mod.name, created.name, created.id])
        if (ref) added.set(ref, created.id)
      return undefined
    }
    case 'update_node': {
      const n = node(mod.id)
      if (!n) return notFound(doc, mod.id)
      const op = OPERATOR_INDEX.get(n.op)
      if (op) {
        const bad = checkParams(op, mod.params)
        if (bad.length) return bad.join('; ')
      }
      for (const [k, v] of Object.entries(mod.params ?? {})) {
        setParam(
          doc,
          n.id,
          k,
          paramValue(
            op?.params.find(p => p.name === k),
            v
          )
        )
        // An explicit value replaces keyframes: the assistant said what the value is.
        if (v !== null) clearTrack(doc, `${n.id}.${k}`)
      }
      if (mod.x !== undefined) n.x = mod.x
      if (mod.y !== undefined) n.y = mod.y
      if (mod.bypass !== undefined) n.flags = { ...n.flags, bypass: mod.bypass }
      if (mod.name && mod.name !== nameOf(n) && !renameNode(doc, n.id, mod.name)) {
        return `A node named '${mod.name}' already exists`
      }
      return undefined
    }
    case 'delete_node': {
      const n = node(mod.id)
      if (!n) return notFound(doc, mod.id)
      removeNodes(doc, [n.id])
      return undefined
    }
    case 'add_edge': {
      const s = node(mod.source)
      const t = node(mod.target)
      if (!s) return notFound(doc, mod.source)
      if (!t) return notFound(doc, mod.target)
      const sourcePort = mod.sourcePort ?? defaultSourcePort(doc, s.id)
      const targetPort = mod.targetPort ?? defaultTargetPort(doc, t.id)
      if (!sourcePort || !targetPort)
        return `${nameOf(s)} -> ${nameOf(t)}: name the ports to connect`
      if (!validConnection(doc, s.id, sourcePort, t.id, targetPort)) {
        const ins = OPERATOR_INDEX.get(t.op)?.inputs.map(p => p.name) ?? []
        const outs = OPERATOR_INDEX.get(s.op)?.outputs.map(p => p.name) ?? []
        return `Cannot connect ${nameOf(s)}.${sourcePort} to ${nameOf(t)}.${targetPort}: the types do not match, a port does not exist, or it would make a cycle. ${nameOf(s)} outputs: ${outs.join(', ')}; ${nameOf(t)} inputs: ${ins.join(', ')}, or par:<parameter>`
      }
      connect(doc, s.id, sourcePort, t.id, targetPort)
      return undefined
    }
    case 'delete_edge': {
      let ids: string[] = []
      if (mod.id) ids = doc.edges.filter(e => e.id === mod.id).map(e => e.id)
      else {
        const s = mod.source ? node(mod.source) : undefined
        const t = mod.target ? node(mod.target) : undefined
        ids = doc.edges
          .filter(
            (e: DocEdge) =>
              (!s || e.source === s.id) &&
              (!t || e.target === t.id) &&
              (!mod.targetPort || e.targetPort === portName(mod.targetPort, 'target'))
          )
          .map(e => e.id)
      }
      if (ids.length === 0) {
        const t = mod.target ? node(mod.target) : undefined
        const into = t ? doc.edges.filter(e => e.target === t.id) : []
        const describe = (e: DocEdge) =>
          `${nameOf(doc.nodes.find(n => n.id === e.source) as DocNode)}.${e.sourcePort} -> ${e.targetPort}`
        return into.length
          ? `No such wire. Wires into ${nameOf(t as DocNode)}: ${into.map(describe).join(', ')}`
          : 'No such wire'
      }
      removeEdges(doc, ids)
      return undefined
    }
  }
}

/**
 * Apply a batch of modifications as one undo step. Nothing applies unless all of them do,
 * so a failed batch can be fixed and sent again whole.
 */
export function applyModifications(
  ctx: DocToolContext,
  params: { modifications: unknown[] }
): ToolResult {
  const list = params.modifications
  if (!Array.isArray(list) || list.length === 0) {
    return { success: false, error: 'modifications must be a non-empty array' }
  }
  const draft = structuredClone(ctx.store.get().doc)
  const added = new Map<string, string>()
  const errors: string[] = []
  // Nodes first, so an edge may name a node the same batch adds wherever it sits.
  const ordered = list
    .map((raw, index) => ({ raw: normalize(raw), index }))
    .sort((a, b) => Number(isEdge(a.raw)) - Number(isEdge(b.raw)))
  for (const { raw, index } of ordered) {
    const parsed = DocModificationSchema.safeParse(raw)
    const label = `modifications[${index}]`
    if (!parsed.success) {
      errors.push(
        `${label}: ${parsed.error.issues.map(i => `${i.path.join('.') || 'type'}: ${i.message}`).join('; ')}`
      )
      continue
    }
    const problem = applyOne(draft, parsed.data, added)
    if (problem) errors.push(`${label} (${parsed.data.type}): ${problem}`)
  }
  if (errors.length) {
    return {
      success: false,
      error: `Nothing was applied. Fix these and send the whole batch again:\n${errors.join('\n')}`,
    }
  }
  ctx.store.edit(() => draft)
  return {
    success: true,
    data: {
      applied: list.length,
      added: Object.fromEntries(
        [...new Set(added.values())].map(id => [
          nameOf(draft.nodes.find(n => n.id === id) as DocNode),
          id,
        ])
      ),
      message: `Applied ${list.length} modification(s). Call get_node_info or get_node_output to check the result.`,
    },
  }
}

const isEdge = (raw: unknown) => {
  const t = (raw as { type?: unknown })?.type
  return t === 'add_edge' || t === 'delete_edge'
}

// --- timeline ----------------------------------------------------------------------

/** `nodeId.param` from a target, a trackId, or a node and parameter named apart. */
function trackTarget(
  doc: EditorDoc,
  params: { target?: string; trackId?: string; nodeId?: string; param?: string }
): string | undefined {
  if (params.nodeId && params.param) {
    const n = findNode(doc, params.nodeId)
    return n ? `${n.id}.${params.param}` : undefined
  }
  const raw = params.target ?? params.trackId
  if (!raw) return undefined
  // `node / param`, as the timeline panel shows a track, or `node.param`
  const [ref, param] = raw.includes(' / ')
    ? raw.split(' / ')
    : [raw.slice(0, raw.lastIndexOf('.')), raw.slice(raw.lastIndexOf('.') + 1)]
  const n = findNode(doc, ref)
  return n && param ? `${n.id}.${param.replace(/^par\./, '')}` : undefined
}

export function getTimeline(ctx: DocToolContext): ToolResult {
  const { doc } = ctx.store.get()
  return {
    success: true,
    data: {
      length: doc.timeline?.length ?? 10,
      fps: doc.timeline?.fps ?? 30,
      position: ctx.playhead?.position() ?? ctx.store.get().time,
      playing: ctx.playhead?.playing() ?? false,
      tracks: (doc.timeline?.tracks ?? []).map(t => ({
        target: t.target,
        keyframes: t.keyframes.map(k => ({
          id: k.id,
          time: k.time,
          value: k.value,
          interpolation: k.interpolation,
        })),
      })),
    },
  }
}

export function setKeyframe(
  ctx: DocToolContext,
  params: {
    target?: string
    trackId?: string
    nodeId?: string
    param?: string
    time?: number
    position?: number
    value: unknown
    interpolation?: 'bezier' | 'linear' | 'hold'
  }
): ToolResult {
  const { doc } = ctx.store.get()
  const target = trackTarget(doc, params)
  if (!target)
    return {
      success: false,
      error: `No parameter for '${params.target ?? params.trackId ?? params.nodeId}'. Use target: 'node.param', e.g. '${doc.nodes[0] ? nameOf(doc.nodes[0]) : 'scatter1'}.opacity'`,
    }
  const time = params.time ?? params.position ?? ctx.store.get().time
  const value = Number(params.value)
  if (!Number.isFinite(value))
    return { success: false, error: 'Only numbers are keyframed; value must be a number' }
  ctx.store.edit(d => {
    setKey(d, target, time, value)
    if (params.interpolation) {
      const track = d.timeline?.tracks.find(t => t.target === target)
      const key = track?.keyframes.find(k => Math.abs(k.time - time) < 1e-3)
      if (key) key.interpolation = params.interpolation
    }
  })
  return { success: true, data: { target, time, value } }
}

export function deleteKeyframe(
  ctx: DocToolContext,
  params: { target?: string; trackId?: string; keyframeId?: string; time?: number }
): ToolResult {
  const { doc } = ctx.store.get()
  const target = trackTarget(doc, params)
  const track = doc.timeline?.tracks.find(t => t.target === target)
  if (!target || !track)
    return { success: false, error: `No keyframed parameter '${params.target ?? params.trackId}'` }
  const key = track.keyframes.find(
    k =>
      k.id === params.keyframeId ||
      (params.time !== undefined && Math.abs(k.time - params.time) < 1e-3)
  )
  if (!key)
    return {
      success: false,
      error: `No keyframe ${params.keyframeId ?? `at ${params.time}`} on ${target}`,
    }
  ctx.store.edit(d => removeKey(d, target, key.time))
  return { success: true, data: { deleted: key.id, target } }
}

export function setPlaybackPosition(
  ctx: DocToolContext,
  params: { position: number; play?: boolean }
): ToolResult {
  const { doc } = ctx.store.get()
  const length = doc.timeline?.length ?? 10
  const clamped = Math.max(0, Math.min(params.position, length))
  if (ctx.playhead) {
    ctx.playhead.seek(clamped)
    if (params.play === true) ctx.playhead.play()
    else if (params.play === false) ctx.playhead.pause()
  } else {
    ctx.store.set({ time: clamped })
  }
  return { success: true, data: { position: clamped, playing: ctx.playhead?.playing() ?? false } }
}
