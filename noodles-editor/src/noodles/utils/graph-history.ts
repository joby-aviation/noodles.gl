// Records a batch of graph edits made outside React Flow's change handlers as one
// undo entry. The AI assistant's accepted proposals are the case: they go through
// setNodes / setEdges, which the undo hook's onNodesChange interception never sees.
//
// Same shape as property-history and lock-history: UndoRedoHandler registers the
// recorder, so callers need no React context. The recorder takes its own
// snapshots, so they cover the whole graph (graphRef) and not only the container
// on screen.

type GraphMutationRecorder = (description: string, mutate: () => void) => void

let recorder: GraphMutationRecorder | undefined

export function registerGraphMutationRecorder(next: GraphMutationRecorder | undefined) {
  recorder = next
}

// Runs mutate and, when an undo stack is listening, records what it changed
// (nodes, edges and field values) as one entry
export function recordGraphMutation(description: string, mutate: () => void) {
  if (recorder) recorder(description, mutate)
  else mutate()
}
