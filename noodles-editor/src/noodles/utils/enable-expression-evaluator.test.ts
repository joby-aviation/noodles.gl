import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BooleanOp, type IOperator, NumberOp, type Operator, StringOp } from '../operators'
import {
  evaluateEnableExpression,
  getEnableExpressionDependencies,
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

    it('returns true for empty expression', () => {
      expect(evaluateEnableExpression('', numberOp, mockGetOp)).toBe(true)
      expect(evaluateEnableExpression('   ', numberOp, mockGetOp)).toBe(true)
    })

    it('returns true for undefined expression', () => {
      expect(evaluateEnableExpression(undefined as unknown as string, numberOp, mockGetOp)).toBe(
        true
      )
    })

    it('evaluates simple par.fieldName expressions', () => {
      expect(evaluateEnableExpression('par.val > 40', numberOp, mockGetOp)).toBe(true)
      expect(evaluateEnableExpression('par.val < 40', numberOp, mockGetOp)).toBe(false)
      expect(evaluateEnableExpression('par.val === 42', numberOp, mockGetOp)).toBe(true)
    })

    it('evaluates boolean field expressions', () => {
      expect(evaluateEnableExpression('par.val === true', booleanOp, mockGetOp)).toBe(true)
      expect(evaluateEnableExpression('par.val', booleanOp, mockGetOp)).toBe(true)
      expect(evaluateEnableExpression('!par.val', booleanOp, mockGetOp)).toBe(false)
    })

    it('evaluates string comparison expressions', () => {
      expect(evaluateEnableExpression("par.val === 'advanced'", stringOp, mockGetOp)).toBe(true)
      expect(evaluateEnableExpression("par.val !== 'simple'", stringOp, mockGetOp)).toBe(true)
    })

    it('evaluates cross-operator expressions with op()', () => {
      expect(evaluateEnableExpression("op('/bool').par.val === true", numberOp, mockGetOp)).toBe(
        true
      )
      expect(evaluateEnableExpression("op('/num').par.val > 40", booleanOp, mockGetOp)).toBe(true)
      expect(
        evaluateEnableExpression("op('/str').par.val === 'advanced'", numberOp, mockGetOp)
      ).toBe(true)
    })

    it('evaluates combined local and cross-operator expressions', () => {
      expect(
        evaluateEnableExpression(
          "par.val > 40 && op('/bool').par.val === true",
          numberOp,
          mockGetOp
        )
      ).toBe(true)
      expect(
        evaluateEnableExpression(
          "par.val < 40 || op('/bool').par.val === true",
          numberOp,
          mockGetOp
        )
      ).toBe(true)
    })

    it('returns true on error (defaults to showing field)', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // Invalid syntax
      expect(evaluateEnableExpression('par.val ===', numberOp, mockGetOp)).toBe(true)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('handles missing operator in op() call gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // Reference to non-existent operator - should return empty object
      expect(
        evaluateEnableExpression("op('/nonexistent').par.val === true", numberOp, mockGetOp)
      ).toBe(false)
      consoleSpy.mockRestore()
    })

    it('handles complex mathematical expressions', () => {
      expect(evaluateEnableExpression('par.val * 2 > 80', numberOp, mockGetOp)).toBe(true)
      expect(evaluateEnableExpression('Math.abs(par.val) === 42', numberOp, mockGetOp)).toBe(true)
    })

    it('handles ternary expressions', () => {
      expect(evaluateEnableExpression('par.val > 40 ? true : false', numberOp, mockGetOp)).toBe(
        true
      )
    })
  })

  describe('getEnableExpressionDependencies', () => {
    it('returns empty array for empty expression', () => {
      expect(getEnableExpressionDependencies('')).toEqual([])
      expect(getEnableExpressionDependencies('   ')).toEqual([])
    })

    it('extracts local par dependencies', () => {
      expect(getEnableExpressionDependencies('par.mode')).toEqual(['par.mode'])
      expect(getEnableExpressionDependencies('par.showAdvanced === true')).toEqual([
        'par.showAdvanced',
      ])
    })

    it('extracts multiple local par dependencies', () => {
      const deps = getEnableExpressionDependencies('par.mode === "advanced" && par.enabled')
      expect(deps).toContain('par.mode')
      expect(deps).toContain('par.enabled')
    })

    it('extracts cross-operator par dependencies', () => {
      const deps = getEnableExpressionDependencies("op('/config').par.showAdvanced")
      expect(deps).toEqual(['/config.par.showAdvanced'])
    })

    it('extracts cross-operator out dependencies', () => {
      const deps = getEnableExpressionDependencies("op('/source').out.data")
      expect(deps).toEqual(['/source.out.data'])
    })

    it('extracts mixed dependencies', () => {
      const deps = getEnableExpressionDependencies(
        "par.mode === 'advanced' && op('/config').par.enabled"
      )
      expect(deps).toContain('par.mode')
      expect(deps).toContain('/config.par.enabled')
    })

    it('removes duplicate dependencies', () => {
      const deps = getEnableExpressionDependencies('par.mode === par.mode')
      expect(deps).toEqual(['par.mode'])
    })

    it('handles double-quoted op paths', () => {
      const deps = getEnableExpressionDependencies('op("/config").par.value')
      expect(deps).toEqual(['/config.par.value'])
    })
  })
})
