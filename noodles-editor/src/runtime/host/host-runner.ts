// Runs a document's host operators: Noodles operator classes executed on JS values.
//
// Host operators sit beside the planner, not inside it. Each runs in dependency order with its
// inputs resolved from the document: a literal parameter, another host operator's output, a
// planner layer (built by the engine), or a scalar slot from the scalar program. An operator
// whose inputs are identical to its last run returns its last output, as `_cachedOutput` did;
// one that read the timeline also re-runs when the time moves.

import type { DocEdge, DocNode, EditorDoc } from '@noodles.gl/planner'
import { OPERATOR_INDEX, outputKey, type RelShape } from '@noodles.gl/planner'
import { applySerializedFieldValue, type Field, ListField } from '../../noodles/fields'
import type { KeyType } from '../../noodles/keys-store'
import { type IOperator, type Operator, opTypes } from '../../noodles/operators'
import { keyValues } from '../../noodles/utils/key-dependencies'
import { readsTimeline } from '../../noodles/utils/timeline-dependencies'
import { getRenderSurfaceSize } from '../../render/render-surface-size'
import { DECK_OP_INDEX, type DeckOp } from '../deck-ops'
import { PENDING } from '../engine'
import { isHostOperator } from './host-ops'

export interface HostInputs {
  /** A planner node's output as a host value: a deck layer, for a planner layer. */
  planner(nodeId: string, port: string): unknown
  /** Scalar slots (`nodeId.param`, `nodeId.out`) from the scalar program. */
  slots: ReadonlyMap<string, unknown>
  /** Timeline seconds; time-dependent operators re-run when it changes. */
  time: number
  /**
   * One row of SQL over a planner node's rows (`select` is the column list, given the rows'
   * shape), for a deck operator that needs a statistic rather than the rows.
   */
  aggregate?(
    nodeId: string,
    port: string,
    select: (shape: RelShape) => string
  ): Promise<Record<string, unknown> | undefined> | typeof PENDING
}

export interface HostReport {
  ran: string[]
  reused: string[]
  /** Waiting for planner output that does not exist yet. */
  pending: string[]
  errors: { nodeId: string; message: string }[]
}

type OperatorClass = new (id: string, data?: unknown, locked?: boolean) => Operator<IOperator>

interface Entry {
  // A Noodles operator, or a deck operator built from its parameters
  op?: Operator<IOperator>
  deck?: DeckOp
  /** The values the last run read, compared by identity. */
  read?: unknown[]
  outputs?: Record<string, unknown>
  timed: boolean
}

export const isHostNode = (n: DocNode) =>
  DECK_OP_INDEX.has(n.op) || (n.op in opTypes && isHostOperator(n.op))

export interface HostRunnerOptions {
  /**
   * Post-process an operator's outputs before anything reads them, e.g. to turn a layer's
   * `@/` project asset into a URL deck can load.
   */
  resolveOutputs?: (
    nodeId: string,
    outputs: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
}

export class HostRunner {
  private readonly entries = new Map<string, Entry>()
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: HostRunnerOptions = {}) {}

  /** A host node's output, after the last run. */
  output(nodeId: string, port: string): unknown {
    return this.entries.get(nodeId)?.outputs?.[port]
  }

  operator(nodeId: string): Operator<IOperator> | undefined {
    return this.entries.get(nodeId)?.op
  }

  idle(): Promise<void> {
    return this.chain.then(() => undefined)
  }

  run(doc: EditorDoc, inputs: HostInputs): Promise<HostReport> {
    const next = this.chain.then(() => this.runNow(doc, inputs))
    this.chain = next.catch(() => undefined)
    return next
  }

  private async runNow(doc: EditorDoc, inputs: HostInputs): Promise<HostReport> {
    const report: HostReport = { ran: [], reused: [], pending: [], errors: [] }
    const hosts = doc.nodes.filter(isHostNode)
    const isHost = new Set(hosts.map(n => n.id))
    for (const id of [...this.entries.keys()]) {
      if (!isHost.has(id)) this.drop(id)
    }

    const opOf = new Map(doc.nodes.map(n => [n.id, n.op]))
    const byOp = (id: string) => opOf.get(id)
    const keyed = new Set((doc.timeline?.tracks ?? []).map(t => t.target))
    const failed = new Set<string>()
    for (const node of order(hosts, doc.edges)) {
      const entry = this.entry(node)
      const into = (field: string) =>
        doc.edges
          .filter(e => e.target === node.id && e.targetPort === `par:${field}`)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      const edgeValue = (e: DocEdge) =>
        isHost.has(e.source)
          ? this.output(e.source, e.sourcePort)
          : (inputs.slots.get(
              outputKey(OPERATOR_INDEX.get(byOp(e.source) ?? ''), e.source, e.sourcePort)
            ) ?? inputs.planner(e.source, e.sourcePort))

      if (entry.deck) {
        await this.runDeck(node, entry, entry.deck, into, edgeValue, keyed, inputs, failed, report)
        continue
      }
      const op = entry.op as Operator<IOperator>
      const fields = Object.entries(op.inputs as Record<string, Field>)
      const upstreamFailed = fields.some(([name]) =>
        into(name).some(e => failed.has(e.source) && !report.pending.includes(e.source))
      )
      if (upstreamFailed) {
        failed.add(node.id)
        report.errors.push({ nodeId: node.id, message: 'skipped: an input failed' })
        continue
      }
      const read: unknown[] = await Promise.all(
        fields.map(async ([name, field]) => {
          const edges = into(name)
          if (edges.length === 0) {
            // A keyframed parameter is its track's value at the playhead.
            const key = `${node.id}.${name}`
            return keyed.has(key) ? inputs.slots.get(key) : node.params[name]
          }
          const values = await Promise.all(edges.map(edgeValue))
          return field instanceof ListField ? values : values[0]
        })
      )
      const waiting = (v: unknown) => v === PENDING || (Array.isArray(v) && v.includes(PENDING))
      const upstreamPending = fields.some(([name]) => into(name).some(e => failed.has(e.source)))
      if (read.some(waiting) || upstreamPending) {
        failed.add(node.id)
        report.pending.push(node.id)
        continue
      }
      if (entry.timed) read.push(inputs.time)
      // An operator fitting a camera to the render surface (BoundingBox) reruns when it resizes
      if ((op.constructor as { readsRenderSurface?: boolean }).readsRenderSurface) {
        const { width, height } = getRenderSurfaceSize()
        read.push(`${width}x${height}`)
      }
      // One that sends requests with an API key (Geocoder) reruns when that key changes
      const { usesKeys } = op.constructor as { usesKeys?: readonly KeyType[] }
      if (usesKeys?.length) read.push(...keyValues(usesKeys))
      if (entry.outputs && entry.read && sameValues(entry.read, read)) {
        report.reused.push(node.id)
        continue
      }

      try {
        fields.forEach(([name, field], i) => {
          if (into(name).length === 0) {
            if (read[i] !== undefined) applySerializedFieldValue(field, read[i])
          } else {
            field.setValue(read[i] as never)
          }
        })
        const props = Object.fromEntries(fields.map(([name, field]) => [name, field.value]))
        const result = (await op.execute(props as never)) as Record<string, unknown> | null
        if (result === null) throw new Error(`${node.op} returned no output`)
        for (const [name, value] of Object.entries(result ?? {})) {
          ;(op.outputs as Record<string, Field>)[name]?.next(value as never)
        }
        entry.outputs = this.options.resolveOutputs
          ? await this.options.resolveOutputs(node.id, result ?? {})
          : (result ?? {})
        entry.read = read
        entry.timed = readsTimeline(op.id) && codeReadsTime(node)
        report.ran.push(node.id)
      } catch (error) {
        failed.add(node.id)
        entry.outputs = undefined
        report.errors.push({ nodeId: node.id, message: (error as Error).message })
      }
    }
    return report
  }

  // A deck operator: its parameters, resolved like a host operator's inputs, built into the
  // description deck takes. Rebuilt only when a value it read changed.
  private async runDeck(
    node: DocNode,
    entry: Entry,
    deck: DeckOp,
    into: (field: string) => DocEdge[],
    edgeValue: (e: DocEdge) => unknown,
    keyed: Set<string>,
    inputs: HostInputs,
    failed: Set<string>,
    report: HostReport
  ): Promise<void> {
    const params = deck.def.params
    if (params.some(p => into(p.name).some(e => failed.has(e.source)))) {
      failed.add(node.id)
      report.pending.push(node.id)
      return
    }
    const plain = (name: string) => node.params[name] ?? params.find(p => p.name === name)?.default
    const read: unknown[] = await Promise.all(
      params.map(p => {
        const edges = into(p.name)
        if (deck.aggregate?.param === p.name) {
          const e = edges[0]
          if (!e || !inputs.aggregate) return undefined
          const values = Object.fromEntries(params.map(q => [q.name, plain(q.name)]))
          return inputs.aggregate(e.source, e.sourcePort, shape =>
            deck.aggregate!.select(values, shape)
          )
        }
        if (edges.length === 0) {
          const key = `${node.id}.${p.name}`
          return keyed.has(key) ? inputs.slots.get(key) : plain(p.name)
        }
        const values = edges.map(edgeValue)
        return deck.lists?.includes(p.name) ? values : values[0]
      })
    )
    const surface = getRenderSurfaceSize()
    if (deck.surface) read.push(`${surface.width}x${surface.height}`)
    if (deck.usesKeys) read.push(...keyValues(deck.usesKeys))
    if (read.some(v => v === PENDING || (Array.isArray(v) && v.includes(PENDING)))) {
      failed.add(node.id)
      report.pending.push(node.id)
      return
    }
    if (entry.outputs && entry.read && sameValues(entry.read, read)) {
      report.reused.push(node.id)
      return
    }
    try {
      const values = Object.fromEntries(params.map((p, i) => [p.name, read[i]]))
      const built = await deck.build(values, node.id, { surface })
      const result = deck.ports
        ? (built as Record<string, unknown>)
        : { [deck.def.outputs[0].name]: built }
      entry.outputs = this.options.resolveOutputs
        ? await this.options.resolveOutputs(node.id, result)
        : result
      entry.read = read
      report.ran.push(node.id)
    } catch (error) {
      failed.add(node.id)
      entry.outputs = undefined
      report.errors.push({ nodeId: node.id, message: (error as Error).message })
    }
  }

  private entry(node: DocNode): Entry {
    const existing = this.entries.get(node.id)
    const deck = DECK_OP_INDEX.get(node.op)
    if (deck) {
      if (existing?.deck === deck) return existing
      if (existing) this.drop(node.id)
      const entry: Entry = { deck, timed: false }
      this.entries.set(node.id, entry)
      return entry
    }
    if (
      existing?.op &&
      existing.op.constructor === (opTypes as unknown as Record<string, unknown>)[node.op]
    ) {
      return existing
    }
    if (existing) this.drop(node.id)
    const Class = (opTypes as unknown as Record<string, OperatorClass>)[node.op]
    const entry: Entry = { op: new Class(node.id, undefined, false), timed: false }
    this.entries.set(node.id, entry)
    return entry
  }

  private drop(id: string) {
    const op = this.entries.get(id)?.op as { dispose?: () => void } | undefined
    op?.dispose?.()
    this.entries.delete(id)
  }
}

// What a code operator's text can read the timeline through: the time values it is passed, or
// `op()`, whose target might be timed.
const TIMELINE_NAMES = /\b(sequenceTime|frame|totalFrames|sequence|op)\b/

/**
 * Whether an operator reads the time. A code operator subscribes to the timeline whatever its
 * code says, and re-running one every frame re-hands its rows to DuckDB, so its code decides.
 */
function codeReadsTime(node: DocNode): boolean {
  const code = node.params.code ?? node.params.expression
  if (code === undefined) return true
  return TIMELINE_NAMES.test(Array.isArray(code) ? code.join('\n') : String(code))
}

/** Host nodes in dependency order. A cycle runs in declaration order rather than hanging. */
function order(nodes: DocNode[], edges: DocEdge[]): DocNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const out: DocNode[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (n: DocNode) => {
    if (state.get(n.id)) return
    state.set(n.id, 'visiting')
    for (const e of edges) {
      const dep = e.target === n.id ? byId.get(e.source) : undefined
      if (dep && state.get(dep.id) !== 'visiting') visit(dep)
    }
    state.set(n.id, 'done')
    out.push(n)
  }
  for (const n of nodes) visit(n)
  return out
}

function sameValues(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    // A list input is a fresh array of the same upstream values every run: compare its items,
    // never its contents as text (an item may be a 65 MB GeoJSON object).
    if (Array.isArray(x) && Array.isArray(y)) {
      if (sameValues(x, y)) continue
      return false
    }
    // Literal parameters come from a document that is a fresh copy after every edit.
    if (
      x &&
      y &&
      typeof x === 'object' &&
      typeof y === 'object' &&
      !Array.isArray(x) &&
      !Array.isArray(y)
    ) {
      if (JSON.stringify(x) === JSON.stringify(y)) continue
    }
    return false
  }
  return true
}
