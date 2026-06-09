import { describe, expect, it } from 'vitest'
import type { CompiledQuery } from './types'
import {
  addOperatorComment,
  attributeError,
  extractLineNumber,
  findOperatorAtLine,
  OperatorError,
} from './error-attribution'

describe('Error Attribution', () => {
  describe('addOperatorComment', () => {
    it('embeds operator ID and type as SQL comments', () => {
      const sql = 'SELECT * FROM upstream'
      const commented = addOperatorComment('/filter-1', 'FilterOp', sql)

      expect(commented).toContain('/* operator: /filter-1 */')
      expect(commented).toContain('/* type: FilterOp */')
      expect(commented).toContain('SELECT * FROM upstream')
    })
  })

  describe('extractLineNumber', () => {
    it('extracts line number from DuckDB error message', () => {
      const error = 'Error at LINE 5: invalid syntax'
      expect(extractLineNumber(error)).toBe(5)
    })

    it('handles lowercase "line"', () => {
      const error = 'Syntax error at line 12'
      expect(extractLineNumber(error)).toBe(12)
    })

    it('returns null when no line number found', () => {
      const error = 'Generic error message'
      expect(extractLineNumber(error)).toBeNull()
    })
  })

  describe('findOperatorAtLine', () => {
    it('finds operator ID from nearest preceding comment', () => {
      const sql = `
WITH
  /* operator: /source */
  /* type: FileOp */
  cte_1 AS (SELECT * FROM file.csv),
  /* operator: /filter */
  /* type: FilterOp */
  cte_2 AS (SELECT * FROM cte_1 WHERE age > 30)
SELECT * FROM cte_2
      `.trim()

      // Line 7 is in the filter CTE
      const opId = findOperatorAtLine(sql, 7)
      expect(opId).toBe('/filter')
    })

    it('returns null when line number out of range', () => {
      const sql = 'SELECT * FROM table'
      expect(findOperatorAtLine(sql, 100)).toBeNull()
    })

    it('returns null when no operator comment found', () => {
      const sql = 'SELECT * FROM table\nWHERE x = 1'
      expect(findOperatorAtLine(sql, 2)).toBeNull()
    })
  })

  describe('attributeError', () => {
    it('creates OperatorError with extracted operator ID', () => {
      const sql = `
WITH
  /* operator: /source */
  /* type: FileOp */
  cte_1 AS (SELECT * FROM file.csv),
  /* operator: /filter */
  /* type: FilterOp */
  cte_2 AS (SELECT * FROM cte_1 WHERE invalid_column > 30)
SELECT * FROM cte_2
      `.trim()

      const compiled: CompiledQuery = {
        sql,
        paramSlots: [],
        operatorAliases: new Map([
          ['/source', 'cte_1'],
          ['/filter', 'cte_2'],
        ]),
      }

      const originalError = new Error('Error at LINE 7: Column "invalid_column" not found')
      const opError = attributeError(originalError, compiled)

      expect(opError).toBeInstanceOf(OperatorError)
      expect(opError.operatorId).toBe('/filter')
      expect(opError.message).toContain('/filter')
      expect(opError.originalError).toBe(originalError)
    })

    it('falls back to first operator when line number cannot be extracted', () => {
      const compiled: CompiledQuery = {
        sql: 'SELECT * FROM table',
        paramSlots: [{ index: 1, fieldPath: '/op1.value', type: 'string' }],
        operatorAliases: new Map([['/op1', 'cte_1']]),
      }

      const originalError = new Error('Generic error without line number')
      const opError = attributeError(originalError, compiled)

      expect(opError).toBeInstanceOf(OperatorError)
      expect(opError.operatorId).toBe('/op1')
    })
  })
})
