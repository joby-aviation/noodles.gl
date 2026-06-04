// Expression to SQL transpiler for CreateAttributeOp
// Converts simple JavaScript expressions to SQL for attribute generation

export interface SqlExpression {
  sql: string
  isTranslatable: boolean
}

export interface MultiColumnResult {
  columns: SqlExpression[]
  isTranslatable: boolean
}

// Transpile a single expression to SQL
export function expressionToSql(expression: string): SqlExpression {
  const trimmed = expression.trim()

  // Pattern 1: Simple column access "d.columnName"
  const simpleColumn = /^d\.(\w+)$/.exec(trimmed)
  if (simpleColumn) {
    return {
      sql: simpleColumn[1],
      isTranslatable: true,
    }
  }

  // Pattern 2: Column with arithmetic "d.value * 100"
  const arithmetic = /^d\.(\w+)\s*([\+\-\*\/\%])\s*(\d+\.?\d*)$/.exec(trimmed)
  if (arithmetic) {
    const [, col, op, num] = arithmetic
    return {
      sql: `(${col} ${op} ${num})`,
      isTranslatable: true,
    }
  }

  // Pattern 3: Two columns with arithmetic "d.x + d.y"
  const twoColumns = /^d\.(\w+)\s*([\+\-\*\/\%])\s*d\.(\w+)$/.exec(trimmed)
  if (twoColumns) {
    const [, col1, op, col2] = twoColumns
    return {
      sql: `(${col1} ${op} ${col2})`,
      isTranslatable: true,
    }
  }

  // Pattern 4: Math.sqrt(d.column)
  const sqrt = /^Math\.sqrt\(d\.(\w+)\)$/.exec(trimmed)
  if (sqrt) {
    return {
      sql: `SQRT(${sqrt[1]})`,
      isTranslatable: true,
    }
  }

  // Pattern 5: Math.abs(d.column)
  const abs = /^Math\.abs\(d\.(\w+)\)$/.exec(trimmed)
  if (abs) {
    return {
      sql: `ABS(${abs[1]})`,
      isTranslatable: true,
    }
  }

  // Pattern 6: Math.floor/ceil/round(d.column)
  const mathFunc = /^Math\.(floor|ceil|round)\(d\.(\w+)\)$/.exec(trimmed)
  if (mathFunc) {
    const [, func, col] = mathFunc
    return {
      sql: `${func.toUpperCase()}(${col})`,
      isTranslatable: true,
    }
  }

  // Pattern 7: Numeric constant
  if (/^\d+\.?\d*$/.test(trimmed)) {
    return {
      sql: trimmed,
      isTranslatable: true,
    }
  }

  // Not translatable - fall back to JS
  return {
    sql: '',
    isTranslatable: false,
  }
}

// Parse array constructor "[d.col1, d.col2, constant]"
export function parseArrayExpression(expression: string): MultiColumnResult {
  const trimmed = expression.trim()

  // Must be array syntax
  const arrayMatch = /^\[([^\]]+)\]$/.exec(trimmed)
  if (!arrayMatch) {
    return {
      columns: [],
      isTranslatable: false,
    }
  }

  // Split by comma (simple split, doesn't handle nested arrays)
  const parts = arrayMatch[1].split(',').map(s => s.trim())
  const results: SqlExpression[] = []

  for (const part of parts) {
    const result = expressionToSql(part)
    if (!result.isTranslatable) {
      // If any part is not translatable, entire expression isn't
      return {
        columns: [],
        isTranslatable: false,
      }
    }
    results.push(result)
  }

  return {
    columns: results,
    isTranslatable: true,
  }
}

// Generate SQL column alias for attribute
export function attributeColumnName(attrName: string, index: number): string {
  return `__attr_${attrName}_${index}`
}

// Check if an expression is SQL-translatable
export function canTranspileToSql(expression: string): boolean {
  const trimmed = expression.trim()

  // Try single expression
  if (expressionToSql(trimmed).isTranslatable) {
    return true
  }

  // Try array expression
  if (parseArrayExpression(trimmed).isTranslatable) {
    return true
  }

  return false
}
