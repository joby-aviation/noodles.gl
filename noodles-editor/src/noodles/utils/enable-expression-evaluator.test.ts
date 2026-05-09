import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BooleanOp, type IOperator, NumberOp, type Operator, StringOp } from '../operators'
import {
  evaluateEnableExpression,
  type ExpressionDependency,
  getEnableExpressionDependencies,
  validateEnableExpression,
} from './enable-expression-evaluator'

describe('enable-expression-evaluator', () => {
  describe('evaluateEnableExpression', () => {
    let numberOp: NumberOp
    let booleanOp: BooleanOp
    let stringOp: StringOp
    let mockGetOp: (path: string, contextOpId?: string) => Operator<IOperator> | undefined

    beforeEach(() => {
      numberOp = new NumberOp('/num')
      numberOp.inputs.val.setValue(42)

      booleanOp = new BooleanOp('/bool')
      booleanOp.inputs.val.setValue(true)

      stringOp = new StringOp('/str')
      stringOp.inputs.val.setValue('advanced')

      mockGetOp = vi.fn((path: string) => {
        if (path === '/num') return numberOp
        if (path === '/bool') return booleanOp
        if (path === '/str') return stringOp
        return undefined
      })
    })

    it('returns enabled:true for empty expression', () => {
      expect(evaluateEnableExpression('', numberOp, mockGetOp)).toEqual({ enabled: true })
      expect(evaluateEnableExpression('   ', numberOp, mockGetOp)).toEqual({ enabled: true })
    })

    it('returns enabled:true for undefined expression', () => {
      expect(evaluateEnableExpression(undefined as unknown as string, numberOp, mockGetOp)).toEqual(
        {
          enabled: true,
        }
      )
    })

    it('evaluates simple par.fieldName expressions', () => {
      expect(evaluateEnableExpression('par.val > 40', numberOp, mockGetOp).enabled).toBe(true)
      expect(evaluateEnableExpression('par.val < 40', numberOp, mockGetOp).enabled).toBe(false)
      expect(evaluateEnableExpression('par.val === 42', numberOp, mockGetOp).enabled).toBe(true)
    })

    it('evaluates boolean field expressions', () => {
      expect(evaluateEnableExpression('par.val === true', booleanOp, mockGetOp).enabled).toBe(true)
      expect(evaluateEnableExpression('par.val', booleanOp, mockGetOp).enabled).toBe(true)
      expect(evaluateEnableExpression('!par.val', booleanOp, mockGetOp).enabled).toBe(false)
    })

    it('evaluates string comparison expressions', () => {
      expect(evaluateEnableExpression("par.val === 'advanced'", stringOp, mockGetOp).enabled).toBe(
        true
      )
      expect(evaluateEnableExpression("par.val !== 'simple'", stringOp, mockGetOp).enabled).toBe(
        true
      )
    })

    it('evaluates cross-operator expressions with op()', () => {
      expect(
        evaluateEnableExpression("op('/bool').par.val === true", numberOp, mockGetOp).enabled
      ).toBe(true)
      expect(
        evaluateEnableExpression("op('/num').par.val > 40", booleanOp, mockGetOp).enabled
      ).toBe(true)
      expect(
        evaluateEnableExpression("op('/str').par.val === 'advanced'", numberOp, mockGetOp).enabled
      ).toBe(true)
    })

    it('evaluates combined local and cross-operator expressions', () => {
      expect(
        evaluateEnableExpression(
          "par.val > 40 && op('/bool').par.val === true",
          numberOp,
          mockGetOp
        ).enabled
      ).toBe(true)
      expect(
        evaluateEnableExpression(
          "par.val < 40 || op('/bool').par.val === true",
          numberOp,
          mockGetOp
        ).enabled
      ).toBe(true)
    })

    it('returns enabled:true with error message on syntax error', () => {
      const result = evaluateEnableExpression('par.val ===', numberOp, mockGetOp)
      expect(result.enabled).toBe(true) // Fails open
      expect(result.error).toBeDefined()
      expect(result.error).toContain('Expression error')
    })

    it('handles missing operator in op() call with error', () => {
      const result = evaluateEnableExpression(
        "op('/nonexistent').par.val === true",
        numberOp,
        mockGetOp
      )
      expect(result.enabled).toBe(true) // Fails open
      expect(result.error).toBeDefined()
      expect(result.error).toContain("Operator '/nonexistent' not found")
    })

    it('handles complex mathematical expressions', () => {
      expect(evaluateEnableExpression('par.val * 2 > 80', numberOp, mockGetOp).enabled).toBe(true)
      expect(
        evaluateEnableExpression('Math.abs(par.val) === 42', numberOp, mockGetOp).enabled
      ).toBe(true)
    })

    it('handles ternary expressions', () => {
      expect(
        evaluateEnableExpression('par.val > 40 ? true : false', numberOp, mockGetOp).enabled
      ).toBe(true)
    })

    it('handles method calls on field values', () => {
      expect(
        evaluateEnableExpression("par.val.toUpperCase() === 'ADVANCED'", stringOp, mockGetOp)
          .enabled
      ).toBe(true)
    })

    it('handles array includes expressions', () => {
      stringOp.inputs.val.setValue('option1')
      expect(
        evaluateEnableExpression("['option1', 'option2'].includes(par.val)", stringOp, mockGetOp)
          .enabled
      ).toBe(true)
    })

    it('handles complex nested conditions', () => {
      expect(
        evaluateEnableExpression(
          "(par.val > 40 ? op('/bool').par.val : false) && op('/str').par.val.length > 0",
          numberOp,
          mockGetOp
        ).enabled
      ).toBe(true)
    })
  })

  describe('getEnableExpressionDependencies', () => {
    it('returns empty array for empty expression', () => {
      expect(getEnableExpressionDependencies('')).toEqual([])
      expect(getEnableExpressionDependencies('   ')).toEqual([])
    })

    it('extracts local par dependencies', () => {
      const deps = getEnableExpressionDependencies('par.mode')
      expect(deps).toHaveLength(1)
      expect(deps[0]).toMatchObject({
        type: 'local-par',
        field: 'mode',
        raw: 'par.mode',
      })
    })

    it('extracts multiple local par dependencies', () => {
      const deps = getEnableExpressionDependencies('par.mode === "advanced" && par.enabled')
      expect(deps).toHaveLength(2)
      expect(deps.map(d => d.field)).toContain('mode')
      expect(deps.map(d => d.field)).toContain('enabled')
    })

    it('extracts cross-operator par dependencies', () => {
      const deps = getEnableExpressionDependencies("op('/config').par.showAdvanced")
      expect(deps).toHaveLength(1)
      expect(deps[0]).toMatchObject({
        type: 'remote-par',
        field: 'showAdvanced',
        opPath: '/config',
        raw: "op('/config').par.showAdvanced",
      })
    })

    it('extracts cross-operator out dependencies', () => {
      const deps = getEnableExpressionDependencies("op('/source').out.data")
      expect(deps).toHaveLength(1)
      expect(deps[0]).toMatchObject({
        type: 'remote-out',
        field: 'data',
        opPath: '/source',
        raw: "op('/source').out.data",
      })
    })

    it('extracts mixed dependencies', () => {
      const deps = getEnableExpressionDependencies(
        "par.mode === 'advanced' && op('/config').par.enabled"
      )
      expect(deps).toHaveLength(2)
      const types = deps.map(d => d.type)
      expect(types).toContain('local-par')
      expect(types).toContain('remote-par')
    })

    it('removes duplicate dependencies', () => {
      const deps = getEnableExpressionDependencies('par.mode === par.mode')
      expect(deps).toHaveLength(1)
      expect(deps[0].field).toBe('mode')
    })

    it('handles double-quoted op paths', () => {
      const deps = getEnableExpressionDependencies('op("/config").par.value')
      expect(deps).toHaveLength(1)
      expect(deps[0].opPath).toBe('/config')
    })

    it('handles ternary operator with multiple dependencies', () => {
      const deps = getEnableExpressionDependencies('par.value ? par.a : par.b')
      expect(deps).toHaveLength(3)
      expect(deps.map(d => d.field)).toContain('value')
      expect(deps.map(d => d.field)).toContain('a')
      expect(deps.map(d => d.field)).toContain('b')
    })

    it('handles method calls on cross-operator fields', () => {
      const deps = getEnableExpressionDependencies("op('/x').par.field.toUpperCase() === 'TEST'")
      expect(deps).toHaveLength(1)
      expect(deps[0]).toMatchObject({
        type: 'remote-par',
        field: 'field',
        opPath: '/x',
      })
    })

    it('handles complex nested expressions', () => {
      const deps = getEnableExpressionDependencies(
        "(par.a || par.b) && (op('/c').par.d || op('/e').out.f)"
      )
      expect(deps).toHaveLength(4)
      const fields = deps.map(d => d.field)
      expect(fields).toContain('a')
      expect(fields).toContain('b')
      expect(fields).toContain('d')
      expect(fields).toContain('f')
    })

    it('handles string literals with par/op keywords', () => {
      const deps = getEnableExpressionDependencies('par.name === "op(\'/test\').par.value"')
      // Should only extract par.name, not the string content
      expect(deps).toHaveLength(1)
      expect(deps[0].field).toBe('name')
    })

    it('handles template literals', () => {
      // Note: Template literals are treated as strings by the tokenizer,
      // so interpolated expressions inside them are not extracted.
      // This is acceptable for the current use case.
      const deps = getEnableExpressionDependencies('`${par.name} - ${par.value}`')
      expect(deps).toHaveLength(0)
    })

    it('handles array expressions', () => {
      const deps = getEnableExpressionDependencies('[par.a, par.b, par.c].includes(true)')
      expect(deps).toHaveLength(3)
      expect(deps.map(d => d.field)).toContain('a')
      expect(deps.map(d => d.field)).toContain('b')
      expect(deps.map(d => d.field)).toContain('c')
    })

    it('handles object property access', () => {
      const deps = getEnableExpressionDependencies('par.config.nested.value')
      // Should only extract par.config (first-level access)
      expect(deps).toHaveLength(1)
      expect(deps[0].field).toBe('config')
    })

    it('does not extract par from op().par pattern', () => {
      const deps = getEnableExpressionDependencies("op('/test').par.value")
      // Should extract remote-par, not local-par
      expect(deps).toHaveLength(1)
      expect(deps[0].type).toBe('remote-par')
    })

    it('handles edge case: par at end of identifier', () => {
      // If someone names a variable "mypar", it shouldn't match
      const deps = getEnableExpressionDependencies('mypar.value === true')
      expect(deps).toHaveLength(0)
    })
  })

  describe('validateEnableExpression', () => {
    it('returns null for valid expressions', () => {
      expect(validateEnableExpression('par.value === true')).toBeNull()
      expect(validateEnableExpression("op('/test').par.mode === 'advanced'")).toBeNull()
      expect(validateEnableExpression('par.a && par.b || par.c')).toBeNull()
    })

    it('returns null for empty expressions', () => {
      expect(validateEnableExpression('')).toBeNull()
      expect(validateEnableExpression('   ')).toBeNull()
    })

    it('returns error for syntax errors', () => {
      expect(validateEnableExpression('par.value ===')).not.toBeNull()
      expect(validateEnableExpression('par.value &&')).not.toBeNull()
      expect(validateEnableExpression('(par.value')).not.toBeNull()
    })

    it('returns error for invalid JavaScript', () => {
      expect(validateEnableExpression('let x = 5')).not.toBeNull() // Statement, not expression
    })

    it('validates complex but valid expressions', () => {
      expect(
        validateEnableExpression("par.value ? op('/a').par.b : op('/c').out.d || (par.e && par.f)")
      ).toBeNull()
    })
  })

  describe('edge cases and security', () => {
    let numberOp: NumberOp
    let mockGetOp: (path: string, contextOpId?: string) => Operator<IOperator> | undefined

    beforeEach(() => {
      numberOp = new NumberOp('/num')
      numberOp.inputs.val.setValue(42)
      mockGetOp = vi.fn(() => numberOp)
    })

    it('limits expression complexity - deeply nested expressions should still work', () => {
      const expr = '((((par.val > 0))))'
      const result = evaluateEnableExpression(expr, numberOp, mockGetOp)
      expect(result.enabled).toBe(true)
    })

    it('handles expressions with side effects gracefully', () => {
      // This should not actually modify anything due to 'use strict' and sandboxing
      const result = evaluateEnableExpression('par.val, true', numberOp, mockGetOp)
      expect(result.enabled).toBe(true)
    })

    it('handles expressions that throw errors', () => {
      const result = evaluateEnableExpression('par.val.nonexistent.property', numberOp, mockGetOp)
      expect(result.enabled).toBe(true) // Fails open
      expect(result.error).toBeDefined()
    })

    it('handles very long expressions', () => {
      const longExpr = Array(100).fill('par.val > 0').join(' && ')
      const result = evaluateEnableExpression(longExpr, numberOp, mockGetOp)
      expect(result.enabled).toBe(true)
    })
  })
})
