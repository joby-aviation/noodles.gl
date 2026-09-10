import type { CompiledQuery } from './types'

// Error attribution: maps SQL errors back to specific operators

export class OperatorError extends Error {
  constructor(
    message: string,
    public readonly operatorId: string,
    public readonly operatorType: string,
    public readonly originalError: Error
  ) {
    super(message)
    this.name = 'OperatorError'
  }
}

// Embed operator metadata as SQL comments for error attribution
export function addOperatorComment(operatorId: string, operatorType: string, sql: string): string {
  return `/* operator: ${operatorId} */\n/* type: ${operatorType} */\n${sql}`
}

// Extract line number from DuckDB error message
export function extractLineNumber(errorMessage: string): number | null {
  // DuckDB errors often include "LINE X:" or "at line X"
  const lineMatch = errorMessage.match(/(?:LINE|line)\s+(\d+)/i)
  if (lineMatch) {
    return Number.parseInt(lineMatch[1], 10)
  }
  return null
}

// Find operator at specific line in compiled SQL
export function findOperatorAtLine(sql: string, lineNumber: number): string | null {
  const lines = sql.split('\n')
  if (lineNumber < 1 || lineNumber > lines.length) return null

  // Walk backward from error line to find nearest operator comment
  for (let i = lineNumber - 1; i >= 0; i--) {
    const line = lines[i]
    const match = line.match(/\/\*\s*operator:\s*([^\s]+)\s*\*\//)
    if (match) {
      return match[1]
    }
  }

  return null
}

// Attribute a SQL error to a specific operator
export function attributeError(
  sqlError: Error,
  compiledQuery: CompiledQuery,
  getOperatorType?: (id: string) => string
): OperatorError {
  const lineNumber = extractLineNumber(sqlError.message)

  if (lineNumber !== null) {
    const operatorId = findOperatorAtLine(compiledQuery.sql, lineNumber)
    if (operatorId) {
      const operatorType = getOperatorType?.(operatorId) || compiledQuery.operatorAliases.get(operatorId) || 'unknown'
      return new OperatorError(
        `Error in operator '${operatorId}' (${operatorType}):\n${sqlError.message}`,
        operatorId,
        operatorType,
        sqlError
      )
    }
  }

  // Fallback: can't determine specific operator
  // Try to find operator from param slots or aliases
  const firstOp = compiledQuery.paramSlots[0]?.fieldPath.split('.')[0] ||
    Array.from(compiledQuery.operatorAliases.keys())[0] ||
    'unknown'

  return new OperatorError(
    `SQL compilation error (operator unclear):\n${sqlError.message}`,
    firstOp,
    'unknown',
    sqlError
  )
}

// Wrap an error with context about which operators were involved
export function enrichErrorContext(
  error: Error,
  compiledQuery: CompiledQuery,
  paramValues?: unknown[]
): Error {
  const operatorList = Array.from(compiledQuery.operatorAliases.keys()).join(', ')
  const context = `\nInvolved operators: ${operatorList}\nSQL:\n${compiledQuery.sql.slice(0, 500)}${compiledQuery.sql.length > 500 ? '...' : ''}`

  if (paramValues && paramValues.length > 0) {
    const paramStr = paramValues.map((v, i) => `$${i + 1}=${JSON.stringify(v)}`).join(', ')
    error.message += `\nParameters: ${paramStr}`
  }

  error.message += context
  return error
}
