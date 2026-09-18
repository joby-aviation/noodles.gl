import type { Edge, Node } from '@xyflow/react'

export interface GraphHistorySnapshot {
  nodes: Node[]
  edges: Edge[]
  operatorState?: string
}

type GraphMutationCallback = (
  description: string,
  before: GraphHistorySnapshot,
  after: GraphHistorySnapshot
) => void

let callback: GraphMutationCallback | undefined

export function registerGraphMutationCallback(next: GraphMutationCallback | undefined) {
  callback = next
}

export function fireGraphMutation(
  description: string,
  before: GraphHistorySnapshot,
  after: GraphHistorySnapshot
) {
  callback?.(description, before, after)
}
