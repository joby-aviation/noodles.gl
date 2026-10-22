// The editor's side of the engine worker: the runtime's interface, answered by messages.
// Layers keep their identity until the worker says they changed, so the deck adapter's cache
// (keyed by a layer's data) re-uploads nothing a value edit did not touch.

import type { Graph } from '@noodles.gl/planner'
import type { Preview, RuntimeCounters, UpdateReport } from '../program-runtime'
import type { Envelope, LayerView, Message, ProgramView, Request, Values } from './protocol'

export interface WorkerPort {
  postMessage(message: Envelope, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<Message>) => void): void
}

type Listener = (report: UpdateReport) => void

export class RuntimeProxy {
  counters: RuntimeCounters = { compiles: 0, requeries: 0, evaluations: 0, propUpdates: 0 }
  private next = 0
  private readonly pending = new Map<
    number,
    { resolve(v: unknown): void; reject(e: Error): void }
  >()
  private readonly listeners = new Set<Listener>()
  private readonly states = new Map<string, LayerView>()
  private order: string[] = []
  private programView?: ProgramView
  private viewState: Record<string, number> = {}
  private compileError?: string

  constructor(private readonly port: WorkerPort) {
    port.addEventListener('message', event => this.receive(event.data))
  }

  private request<T>(message: Request, transfer?: Transferable[]): Promise<T> {
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: v => resolve(v as T), reject })
      this.port.postMessage({ ...message, id }, transfer)
    })
  }

  private receive(message: Message): void {
    if (message.type === 'result') {
      const waiting = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error !== undefined) waiting?.reject(new Error(message.error))
      else waiting?.resolve(message.value)
      return
    }
    const { update } = message
    for (const layer of update.changed) {
      const before = this.states.get(layer.id)
      // A layer sent without data kept its data; only its props moved
      this.states.set(layer.id, { ...layer, data: layer.data ?? before?.data })
    }
    for (const id of [...this.states.keys()]) if (!update.order.includes(id)) this.states.delete(id)
    this.order = update.order
    this.programView = update.program
    this.viewState = update.view
    this.compileError = update.error
    this.counters = update.counters
    if (update.report) for (const l of this.listeners) l(update.report)
  }

  onUpdate(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setGraph(graph: Graph, values: Values): Promise<UpdateReport> {
    return this.request({ type: 'setGraph', graph, values })
  }

  setValues(values: Values): Promise<UpdateReport | undefined> {
    return this.request({ type: 'setValues', values })
  }

  idle(): Promise<void> {
    return this.request({ type: 'idle' })
  }

  layers(): LayerView[] {
    return this.order.map(id => this.states.get(id)).filter((s): s is LayerView => !!s)
  }

  program(): ProgramView | undefined {
    return this.programView
  }

  view(): Record<string, number> {
    return this.viewState
  }

  error(): string | undefined {
    return this.compileError
  }

  preview(nodeId: string, limit = 100): Promise<Preview> {
    return this.request({ type: 'preview', nodeId, limit })
  }

  query(sql: string): Promise<Record<string, unknown>[]> {
    return this.request({ type: 'query', sql })
  }

  registerFile(name: string, bytes: Uint8Array): Promise<void> {
    // A copy: the caller may keep reading its bytes
    const copy = bytes.slice()
    return this.request({ type: 'registerFile', name, bytes: copy }, [copy.buffer])
  }
}
