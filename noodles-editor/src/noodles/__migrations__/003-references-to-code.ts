import { edgeId } from '../utils/id-utils'
import type { NoodlesProjectJSON } from '../utils/serialization'

// Transform all edges that point to a CodeOp node's 'references' handle to instead point to the 'code' handle.
// This migration is needed because we removed the 'references' field and now use the 'code' field for references.
export async function up(project: NoodlesProjectJSON) {
  const { nodes, edges, ...rest } = project

  // Find all CodeOp nodes
  const codeOpNodes = nodes.filter(node => node.type === 'CodeOp' || node.type === 'DuckDbOp')
  if (!codeOpNodes.length) {
    return project
  }

  const codeOpIds = new Set(codeOpNodes.map(node => node.id))
  const newEdges = edges
    .map(edge => {
      // Only transform edges that point to CodeOp nodes and use the 'references' handle
      if (codeOpIds.has(edge.target) && edge.targetHandle === 'references') {
        const nodeType = codeOpNodes.find(node => node.id === edge.target)?.type
        const targetHandle =
          nodeType === 'CodeOp' ? 'code' : nodeType === 'DuckDbOp' ? 'query' : undefined
        if (!targetHandle) {
          console.warn(`Unknown node type: ${nodeType} for edge ${edge.id}`)
          return edge
        }

        const newEdge = {
          ...edge,
          targetHandle,
          type: 'ReferenceEdge', // Add the new edge type for dotted lines
        }
        return {
          ...newEdge,
          id: edgeId(newEdge),
        }
      }
      return edge
    })
    .reduce((acc: Edge[], edge: Edge) => {
      if (acc.find(e => e.id === edge.id)) {
        console.warn(`Duplicate edge id: ${edge.id}`)
      } else {
        acc.push(edge)
      }
      return acc
    }, [])

  const newNodes = nodes.map(node => {
    if (node.type === 'CodeOp' || node.type === 'DuckDbOp') {
      return {
        ...node,
        data: {
          ...node.data,
          inputs: {
            ...node.data.inputs,
            references: undefined,
          },
        },
      }
    }
    return node
  })

  return { ...rest, nodes: newNodes, edges: newEdges }
}

// Revert the migration by transforming edges back from 'code' to 'references' handle for CodeOp nodes.
// Note: This is a lossy migration since we can't distinguish between actual code connections
// and reference connections in the down migration, but since we don't really connect any fields
// to the code field, it's not a big deal.
export async function down(project: NoodlesProjectJSON) {
  const { nodes, edges, ...rest } = project

  // Find all CodeOp nodes
  const codeOpNodes = nodes.filter(node => node.type === 'CodeOp' || node.type === 'DuckDbOp')
  if (!codeOpNodes.length) {
    return project
  }

  const codeOpIds = new Set(codeOpNodes.map(node => node.id))
  const newEdges = edges.map(edge => {
    // Only transform edges that point to CodeOp nodes and use the 'code' handle
    if (codeOpIds.has(edge.target) && edge.type === 'ReferenceEdge') {
      const newEdge = {
        ...edge,
        targetHandle: 'references',
        type: undefined, // Remove the ReferenceEdge type
      }
      return {
        ...newEdge,
        id: edgeId(newEdge),
      }
    }
    return edge
  })

  return { ...rest, nodes, edges: newEdges }
}
