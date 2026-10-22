// The worker side of the engine: a ProgramRuntime over DuckDB, answering the editor's requests
// and telling it what changed. A layer's arrays are transferred, not copied, so a frame's data
// moves to the main thread at no cost; the worker never reads a layer's data again once sent.

import type { ProgramPlan } from '@noodles.gl/planner'
import type { LayerData } from '../execute'
import { ProgramRuntime, type RuntimeOptions } from '../program-runtime'
import type { BlockingSql } from './blocking-sql'
import type { Envelope, LayerView, Message, ProgramView, RuntimeUpdate } from './protocol'

export interface Port {
  postMessage(message: Message, transfer?: Transferable[]): void
}

/** The buffers in a layer's data, for transfer. */
function buffers(data: LayerData | undefined): ArrayBuffer[] {
  if (!data) return []
  const out = new Set<ArrayBuffer>()
  for (const a of data.attributes.values()) out.add(a.data.buffer as ArrayBuffer)
  if (data.starts) out.add(data.starts.buffer as ArrayBuffer)
  if (data.rings) out.add(data.rings.buffer as ArrayBuffer)
  return [...out]
}

const programView = (p: ProgramPlan | undefined): ProgramView | undefined => {
  if (!p) return undefined
  const { layers: _layers, ...rest } = p
  return rest
}

export class EngineHost {
  readonly runtime: ProgramRuntime
  private readonly sent = new Map<string, { data?: LayerData; props: unknown }>()

  constructor(
    private readonly sql: BlockingSql,
    private readonly port: Port,
    options: RuntimeOptions = {}
  ) {
    this.runtime = new ProgramRuntime(sql, options)
    this.runtime.onUpdate(report => this.publish(report))
  }

  async handle(message: Envelope): Promise<void> {
    try {
      const value = await this.answer(message)
      this.port.postMessage({ type: 'result', id: message.id, value })
    } catch (error) {
      this.port.postMessage({
        type: 'result',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async answer(message: Envelope): Promise<unknown> {
    switch (message.type) {
      case 'setGraph': {
        const report = await this.runtime.setGraph(message.graph, message.values)
        this.publish()
        return report
      }
      case 'setValues': {
        // A prop-only change reports nothing, but the view and props still moved
        const report = await this.runtime.setValues(message.values)
        this.publish()
        return report
      }
      case 'idle':
        await this.runtime.idle()
        // Whatever settled is on its way before the editor hears it settled
        this.publish()
        return undefined
      case 'registerFile':
        this.sql.registerFile(message.name, message.bytes)
        return undefined
      case 'query':
        return this.runtime.query(message.sql)
      case 'relationRows':
        return this.runtime.relationRows(message.relation)
      case 'preview':
        return this.runtime.preview(message.nodeId, message.limit)
    }
  }

  /** Send the layers whose data or props changed since last time, and the program. */
  publish(report?: RuntimeUpdate['report']): void {
    const layers = this.runtime.layers()
    const changed: LayerView[] = []
    const transfer: ArrayBuffer[] = []
    for (const l of layers) {
      const last = this.sent.get(l.id)
      if (last && last.data === l.data && last.props === l.props) continue
      this.sent.set(l.id, { data: l.data, props: l.props })
      const p = l.plan
      changed.push({
        id: l.id,
        plan: {
          id: p.id,
          kind: p.kind,
          relation: p.relation,
          hash: p.hash,
          nodes: p.nodes,
          plan: { layer: p.plan.layer, sql: p.plan.sql },
        },
        data: last?.data === l.data ? undefined : l.data,
        props: l.props,
        error: l.error,
        queryMs: l.queryMs,
        evalMs: l.evalMs,
      })
      if (last?.data !== l.data) transfer.push(...buffers(l.data))
    }
    for (const id of [...this.sent.keys()]) {
      if (!layers.some(l => l.id === id)) this.sent.delete(id)
    }
    const update: RuntimeUpdate = {
      report,
      order: layers.map(l => l.id),
      changed,
      program: programView(this.runtime.program()),
      view: this.runtime.view(),
      error: this.runtime.error(),
      counters: { ...this.runtime.counters },
    }
    this.port.postMessage({ type: 'update', update }, transfer)
  }
}
