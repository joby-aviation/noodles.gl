import { TableEditorOp, ViewerOp } from '../operators'
import { deleteOp, getOp, setOp } from '../store'
import { inferSchema } from '../table-schema'
import type { ReactFlowEdge, ReactFlowNode } from '../types'
import { normalizeMultiInputEdges } from './multi-input-utils'

// Converts a ViewerOp to a TableEditorOp, preserving connections and position.
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

  // Update the React Flow node type and save the inferred schema to node data
  // When transformGraph runs (triggered by node type change), it will:
  // 1. Delete the old ViewerOp operator
  // 2. Create a new TableEditorOp with the saved schema
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

  // Create the new TableEditorOp with the inferred schema
  // transformGraph will be triggered by the node type change
  const tableEditorOp = new TableEditorOp(operatorId)
  tableEditorOp.containerId = op.containerId
  tableEditorOp.locked.next(op.locked.value)
  tableEditorOp.inputs.schema.setValue(schema)
  setOp(operatorId, tableEditorOp)

  // Edges don't need updating because:
  // 1. The node ID stays the same
  // 2. ViewerOp has a 'data' input, TableEditorOp also has a 'data' input
  // 3. The edge target handle 'par.data' is valid for both operators
  // However, we still normalize the edge array so React Flow is notified and any replayed
  // edge IDs are repaired at this workflow boundary.
  setEdges(edges => {
    const normalized = normalizeMultiInputEdges(edges)
    return normalized === edges ? [...edges] : normalized
  })

  return true
}
