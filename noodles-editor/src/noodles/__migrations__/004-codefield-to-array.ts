import type { NoodlesProjectJSON } from '../utils/serialization'

const handles = {
  CodeOp: 'code',
  DuckDbOp: 'query',
  JSONOp: 'text',
}

// Transform all edges that point to a CodeOp node's 'references' handle to instead point to the 'code' handle.
// This migration is needed because we removed the 'references' field and now use the 'code' field for references.
export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, ...rest } = project

  const newNodes = nodes.map(node => {
    if (node.type && node.type in handles) {
      const handle = handles[node.type]
      return {
        ...node,
        data: {
          ...node.data,
          inputs: {
            ...node.data.inputs,
            [handle]: node.data.inputs[handle].split('\n'),
          },
        },
      }
    }
    return node
  })

  return { ...rest, nodes: newNodes }
}

// Revert the migration by transforming edges back from 'code' to 'references' handle for CodeOp nodes.
// Note: This is a lossy migration since we can't distinguish between actual code connections
// and reference connections in the down migration, but since we don't really connect any fields
// to the code field, it's not a big deal.
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, ...rest } = project

  const newNodes = nodes.map(node => {
    if (node.type && node.type in handles) {
      const handle = handles[node.type]
      return {
        ...node,
        data: {
          ...node.data,
          inputs: {
            ...node.data.inputs,
            [handle]: node.data.inputs[handle].join('\n'),
          },
        },
      }
    }

    return node
  })

  return { ...rest, nodes: newNodes }
}
