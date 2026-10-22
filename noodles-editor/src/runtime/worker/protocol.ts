// Messages between the editor and the engine worker. The worker holds DuckDB, the memo and the
// planner runtime; the editor sends graphs and values and gets back what deck draws.

import type { Graph, LayerPlan, ProgramPlan, ResolvedProp } from '@noodles.gl/planner'
import type { LayerData } from '../execute'
import type { Preview, RuntimeCounters, UpdateReport } from '../program-runtime'

export type Values = Record<string, number | string>

export type Request =
  | { type: 'setGraph'; graph: Graph; values: Values }
  | { type: 'setValues'; values: Values }
  | { type: 'idle' }
  | { type: 'registerFile'; name: string; bytes: Uint8Array }
  | { type: 'query'; sql: string }
  | { type: 'relationRows'; relation: string }
  | { type: 'preview'; nodeId: string; limit: number }

/** A layer plan as the editor reads it: what to draw with, never how it was planned. */
export type LayerPlanView = Pick<LayerPlan, 'id' | 'kind' | 'relation' | 'hash' | 'nodes'> & {
  plan: Pick<LayerPlan['plan'], 'layer' | 'sql'>
}

export interface LayerView {
  id: string
  plan: LayerPlanView
  data?: LayerData
  props: Record<string, ResolvedProp>
  error?: string
  queryMs: number
  evalMs: number
}

/** The program without its layer plans, which stay in the worker. */
export type ProgramView = Omit<ProgramPlan, 'layers'>

export interface RuntimeUpdate {
  report?: UpdateReport
  /** Layers in draw order; `changed` holds the ones whose data or props are new. */
  order: string[]
  changed: LayerView[]
  program?: ProgramView
  view: Record<string, number>
  error?: string
  counters: RuntimeCounters
}

export type Message =
  | { type: 'result'; id: number; value?: unknown; error?: string }
  | { type: 'update'; update: RuntimeUpdate }

export type Envelope = Request & { id: number }

export type { Preview }
