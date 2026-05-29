import type { ReactFlowEdge, ReactFlowNode } from '../types'
import { TableEditorOp, ViewerOp } from '../operators'
import { getOp, setOp } from '../store'
import { inferSchema } from '../table-schema'
import { captureOperatorInputs, firePropertyMutation } from './property-history'

// Converts a ViewerOp to a TableEditorOp, preserving connections and position.
// Returns true if successful, false if the operator cannot be converted.
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

  // Capture state for undo/redo
  const before = captureOperatorInputs()

  // Infer schema from the data
  const schema = inferSchema(data)

  // Create new TableEditorOp with the same ID
  const tableEditorOp = new TableEditorOp(operatorId)

  // Copy properties from the old operator
  tableEditorOp.containerId = op.containerId
  tableEditorOp.locked.next(op.locked.value)

  // Set the data and schema inputs
  tableEditorOp.inputs.data.setValue(data)
  tableEditorOp.inputs.schema.setValue(schema)

  // Replace the operator in the store
  setOp(operatorId, tableEditorOp)

  // Update the React Flow node type
  setNodes(nodes =>
    nodes.map(node => {
      if (node.id === operatorId) {
        return {
          ...node,
          type: 'TableEditorOp',
        }
      }
      return node
    })
  )

  // Edges don't need updating because:
  // 1. The node ID stays the same
  // 2. ViewerOp has a 'data' input, TableEditorOp also has a 'data' input
  // 3. The edge target handle 'par.data' is valid for both operators
  // However, we still call setEdges to ensure React Flow is notified
  setEdges(edges => [...edges])

  // Record change for undo/redo
  if (before !== null) {
    firePropertyMutation('Convert to Table Editor', before)
  }

  return true
}
