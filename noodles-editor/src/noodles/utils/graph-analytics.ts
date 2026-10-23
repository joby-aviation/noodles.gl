// Analytics for nodes and edges added to the graph.
//
// Everything that adds nodes or edges through useReactFlow() (Add Node menu, map tools,
// file import, paste, the AI assistant) reaches the editor's onNodesChange/onEdgesChange as
// 'add' changes. Project loads and undo/redo set React Flow state directly and never get
// here, so they aren't counted. Manual connections are tracked in onConnect instead, since
// it also sets state directly.

import type { EdgeChange, NodeChange } from '@xyflow/react'
import { analytics } from '../../utils/analytics'

export function trackAddedNodes(changes: NodeChange[]) {
  for (const change of changes) {
    if (change.type === 'add') {
      analytics.track('node_added', { nodeType: change.item.type || 'unknown' })
    }
  }
}

export function trackAddedEdges(changes: EdgeChange[]) {
  const count = changes.filter(change => change.type === 'add').length
  if (count > 0) {
    analytics.track('edge_added', { count })
  }
}
