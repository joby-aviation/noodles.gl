// Detect CreateAttributeOp nodes that can have their attributes computed in SQL

import type { IOperator, Operator } from '../operators'
import {
  attributeColumnName,
  canTranspileToSql,
  expressionToSql,
  parseArrayExpression,
} from './expression-to-sql'

export interface AttributeSpec {
  operatorId: string
  attributeName: string
  expression: string
  type: 'float' | 'uint8'
  size: number
  sqlColumns: string[] // SQL expressions for each component
}

// Detect CreateAttributeOp nodes downstream of a SQL-compiled chain
export function detectDownstreamAttributes(
  compiledOpId: string,
  getOperator: (id: string) => Operator<IOperator> | undefined,
  getDownstreamIds: (opId: string) => string[]
): AttributeSpec[] {
  const attributes: AttributeSpec[] = []

  // Look for immediate downstream operators
  const downstreamIds = getDownstreamIds(compiledOpId)

  for (const downstreamId of downstreamIds) {
    const op = getOperator(downstreamId)
    if (!op) continue

    // Check if it's a CreateAttributeOp
    const opType = (op.constructor as { displayName?: string }).displayName
    if (opType !== 'Create Attribute') continue

    // Extract configuration
    const name = op.inputs.name?.value
    const expression = op.inputs.expression?.value
    const type = op.inputs.type?.value
    const size = op.inputs.size?.value

    if (
      typeof name !== 'string' ||
      typeof expression !== 'string' ||
      (type !== 'float' && type !== 'uint8') ||
      typeof size !== 'number'
    ) {
      continue
    }

    // Check if expression is SQL-translatable
    if (!canTranspileToSql(expression)) {
      continue
    }

    // Parse the expression to SQL
    const sqlColumns: string[] = []

    // Try array expression first
    const arrayResult = parseArrayExpression(expression)
    if (arrayResult.isTranslatable) {
      for (const col of arrayResult.columns) {
        sqlColumns.push(col.sql)
      }
    } else {
      // Single expression
      const result = expressionToSql(expression)
      if (result.isTranslatable) {
        sqlColumns.push(result.sql)
      }
    }

    if (sqlColumns.length > 0) {
      attributes.push({
        operatorId: downstreamId,
        attributeName: name,
        expression,
        type,
        size,
        sqlColumns,
      })
    }
  }

  return attributes
}

// Generate SQL SELECT clause with attribute columns
export function generateAttributeColumns(attributes: AttributeSpec[]): string[] {
  const columns: string[] = []

  for (const attr of attributes) {
    for (let i = 0; i < attr.sqlColumns.length; i++) {
      const sqlExpr = attr.sqlColumns[i]
      const columnName = attributeColumnName(attr.attributeName, i)

      // Cast to appropriate type
      const castType = attr.type === 'uint8' ? 'UTINYINT' : 'FLOAT'
      columns.push(`CAST(${sqlExpr} AS ${castType}) AS ${columnName}`)
    }
  }

  return columns
}

// Check if CreateAttributeOp should use SQL-computed attributes
export function hasSqlComputedAttributes(
  op: Operator<IOperator>,
  data: unknown
): { hasAttributes: boolean; attributeNames: Set<string> } {
  // Check if data has __attr_* columns
  const attributeNames = new Set<string>()

  if (data && typeof data === 'object' && 'schema' in data) {
    // Arrow table
    const table = data as { schema: { fields: Array<{ name: string }> } }
    for (const field of table.schema.fields) {
      if (field.name.startsWith('__attr_')) {
        // Extract attribute name from __attr_position_0 → position
        const match = /^__attr_(\w+)_\d+$/.exec(field.name)
        if (match) {
          attributeNames.add(match[1])
        }
      }
    }
  }

  return {
    hasAttributes: attributeNames.size > 0,
    attributeNames,
  }
}
