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

// Normalize expression to use d. prefix
// Converts "population * 50" → "d.population * 50"
// Leaves "d.population * 50" unchanged
// Only adds d. to bare identifiers (not Math.* or constants)
function normalizeToDotNotation(expression: string): string {
  // Already has d. prefix or is a constant/Math function
  if (expression.includes('d.') || expression.startsWith('Math.') || /^\d+\.?\d*$/.test(expression)) {
    return expression
  }

  // Replace bare word identifiers with d.identifier
  // Match identifiers but not inside Math. calls or numeric constants
  return expression.replace(/\b([a-zA-Z_]\w*)\b(?!\s*\()/g, 'd.$1')
}

// Transpile a single expression to SQL
export function expressionToSql(expression: string): SqlExpression {
  const trimmed = expression.trim()

  // Normalize to d. notation for consistent parsing
  const normalized = normalizeToDotNotation(trimmed)

  // Pattern 1: Simple column access "d.columnName"
  const simpleColumn = /^d\.(\w+)$/.exec(normalized)
  if (simpleColumn) {
    return {
      sql: simpleColumn[1],
      isTranslatable: true,
    }
  }

  // Pattern 2: Column with arithmetic "d.value * 100"
  const arithmetic = /^d\.(\w+)\s*([\+\-\*\/\%])\s*(\d+\.?\d*)$/.exec(normalized)
  if (arithmetic) {
    const [, col, op, num] = arithmetic
    return {
      sql: `(${col} ${op} ${num})`,
      isTranslatable: true,
    }
  }

  // Pattern 3: Two columns with arithmetic "d.x + d.y"
  const twoColumns = /^d\.(\w+)\s*([\+\-\*\/\%])\s*d\.(\w+)$/.exec(normalized)
  if (twoColumns) {
    const [, col1, op, col2] = twoColumns
    return {
      sql: `(${col1} ${op} ${col2})`,
      isTranslatable: true,
    }
  }

  // Pattern 4: Math.sqrt(d.column)
  const sqrt = /^Math\.sqrt\(d\.(\w+)\)$/.exec(normalized)
  if (sqrt) {
    return {
      sql: `SQRT(${sqrt[1]})`,
      isTranslatable: true,
    }
  }

  // Pattern 5: Math.abs(d.column)
  const abs = /^Math\.abs\(d\.(\w+)\)$/.exec(normalized)
  if (abs) {
    return {
      sql: `ABS(${abs[1]})`,
      isTranslatable: true,
    }
  }

  // Pattern 6: Math.floor/ceil/round(d.column)
  const mathFunc = /^Math\.(floor|ceil|round)\(d\.(\w+)\)$/.exec(normalized)
  if (mathFunc) {
    const [, func, col] = mathFunc
    return {
      sql: `${func.toUpperCase()}(${col})`,
      isTranslatable: true,
    }
  }

  // Pattern 7: Numeric constant
  if (/^\d+\.?\d*$/.test(normalized)) {
    return {
      sql: normalized,
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
