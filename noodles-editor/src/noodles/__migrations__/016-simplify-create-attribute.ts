// Migration to simplify CreateAttributeOp by removing source and column inputs.
// The operator now always evaluates expressions, so column='value' becomes expression='d.value'.

import type { NoodlesProjectJSON } from '../utils/serialization'

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const createAttrNodes = project.nodes.filter(n => n.type === 'CreateAttributeOp')
  if (createAttrNodes.length === 0) return project

  const updatedNodes = project.nodes.map(node => {
    if (node.type !== 'CreateAttributeOp') return node

    const inputs = (node.data?.inputs as Record<string, unknown>) ?? {}
    const source = inputs.source as string | undefined
    const column = inputs.column as string | undefined
    const expression = inputs.expression as string | undefined

    let newExpression = expression || 'd.value'

    // Convert column mode to expression
    if (source === 'column' && column) {
      // Handle nested column access: 'coords.x' -> 'd.coords.x'
      newExpression = `d.${column}`
    }

    // Remove obsolete fields
    const { source: _, column: __, ...restInputs } = inputs

    return {
      ...node,
      data: {
        ...node.data,
        inputs: {
          ...restInputs,
          expression: newExpression,
        },
      },
    }
  })

  return { ...project, nodes: updatedNodes }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  // Downgrade: try to detect simple column references and split them back
  const createAttrNodes = project.nodes.filter(n => n.type === 'CreateAttributeOp')
  if (createAttrNodes.length === 0) return project

  const updatedNodes = project.nodes.map(node => {
    if (node.type !== 'CreateAttributeOp') return node

    const inputs = (node.data?.inputs as Record<string, unknown>) ?? {}
    const expression = inputs.expression as string | undefined

    let source = 'expression'
    let column = ''

    // Detect simple column references: 'd.columnName' or 'd.path.to.prop'
    if (expression) {
      const simpleColumnMatch = expression.match(/^d\.([a-zA-Z_][\w.]*)$/)
      if (simpleColumnMatch) {
        source = 'column'
        column = simpleColumnMatch[1]
      }
    }

    return {
      ...node,
      data: {
        ...node.data,
        inputs: {
          ...inputs,
          source,
          column,
        },
      },
    }
  })

  return { ...project, nodes: updatedNodes }
}
