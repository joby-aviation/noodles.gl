import { TableEditorOp, ViewerOp } from '../operators'
import { deleteOp, getOp, setOp } from '../store'
import { inferSchema } from '../table-schema'
import type { ReactFlowEdge, ReactFlowNode } from '../types'
import { normalizeMultiInputEdges } from './multi-input-utils'

// Converts a ViewerOp to a TableEditorOp, removing data connections and preserving position.
// Returns true if successful, false if the operator cannot be converted.
// Undo/redo is handled automatically by the React Flow node change tracking system.
export function convertViewerToTableEditor(
  operatorId: string,
  setNodes: (updater: (nodes: ReactFlowNode[]) => ReactFlowNode[]) => void,
  setEdges: (updater: (edges: ReactFlowEdge[]) => ReactFlowEdge[]) => void
): boolean {
  const op = getOp(operatorId)

  // Validate that this is actually a ViewerOp
  if (!op || !(op instanceof ViewerOp)) {
    console.error('Cannot convert: operator is not a ViewerOp')
    return false
  }

  // Get the data value from the ViewerOp
  const data = op.inputs.data.value

  // Validate that data is an array suitable for table editing
  if (!Array.isArray(data) || data.length === 0) {
    console.error('Cannot convert: data is not a non-empty array')
    return false
  }

  // Validate that the array contains plain objects
  if (typeof data[0] !== 'object' || data[0] === null || Array.isArray(data[0])) {
    console.error('Cannot convert: data does not contain plain objects')
    return false
  }

  // Infer schema from the data
  const schema = inferSchema(data)

  // Update the React Flow node type and save the inferred schema and data to node data
  // When transformGraph runs (triggered by node type change), it will:
  // 1. Delete the old ViewerOp operator
  // 2. Create a new TableEditorOp with the saved schema and data
  // 3. Undo will reverse this by changing type back to ViewerOp
  setNodes(nodes => {
    return nodes.map(node => {
      if (node.id === operatorId) {
        return {
          ...node,
          type: 'TableEditorOp',
          data: {
            ...node.data,
            inputs: {
              ...(node.data?.inputs || {}),
              schema,
              data,
            },
            locked: op.locked.value,
          },
        }
      }
      return node
    })
  })

  // Delete the old operator from the store so transformGraph will recreate it
  deleteOp(operatorId)

  // Create the new TableEditorOp with the inferred schema and data
  // transformGraph will be triggered by the node type change
  const tableEditorOp = new TableEditorOp(operatorId)
  tableEditorOp.containerId = op.containerId
  tableEditorOp.locked.next(op.locked.value)
  tableEditorOp.inputs.schema.setValue(schema)
  tableEditorOp.inputs.data.setValue(data)
  setOp(operatorId, tableEditorOp)

  // Remove any incoming edges to the data input.
  // The data has been copied into the TableEditorOp above, so it can be edited manually.
  // Normalize the remaining graph at this workflow boundary so replayed edge IDs are repaired.
  // Note: This creates a separate undo history entry from the node type change above,
  // so reverting the conversion requires two undo operations. React Flow's setEdges
  // automatically triggers onEdgesChange, which is intercepted by the undo system.
  setEdges(edges =>
    normalizeMultiInputEdges(
      edges.filter(edge => !(edge.target === operatorId && edge.targetHandle === 'par.data'))
    )
  )

  return true
}
