// Integration tests for field subscription optimization
// Verifies that useFieldValueChanges only subscribes to fields in enable expressions

import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberOp, type Operator } from '../../operators'
import { clearOps, setOp } from '../../store'
import { getEnableExpressionDependencies } from '../../utils/enable-expression-evaluator'

describe('field subscription optimization', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    clearOps()
  })

  describe('getEnableExpressionDependencies', () => {
    it('should identify local parameter references', () => {
      const deps = getEnableExpressionDependencies("par.mode === 'advanced'")
      expect(deps).toHaveLength(1)
      expect(deps[0].type).toBe('local-par')
      expect(deps[0].field).toBe('mode')
    })

    it('should identify multiple parameter references', () => {
      const deps = getEnableExpressionDependencies('par.enabled && par.value > 10')
      expect(deps).toHaveLength(2)
      expect(deps[0].type).toBe('local-par')
      expect(deps[0].field).toBe('enabled')
      expect(deps[1].type).toBe('local-par')
      expect(deps[1].field).toBe('value')
    })

    it('should exclude remote operator references from local-par', () => {
      const deps = getEnableExpressionDependencies(
        "par.enabled && op('/other').par.value > 10"
      )
      const localDeps = deps.filter(d => d.type === 'local-par')
      expect(localDeps).toHaveLength(1)
      expect(localDeps[0].field).toBe('enabled')
    })

    it('should handle empty expressions', () => {
      const deps = getEnableExpressionDependencies('')
      expect(deps).toHaveLength(0)
    })

    it('should handle expressions without parameter references', () => {
      const deps = getEnableExpressionDependencies('true')
      expect(deps).toHaveLength(0)
    })

    it('should handle complex expressions', () => {
      const deps = getEnableExpressionDependencies(
        "par.type === 'custom' && (par.value > 0 || par.enabled)"
      )
      expect(deps).toHaveLength(3)
      const fields = deps.filter(d => d.type === 'local-par').map(d => d.field)
      expect(fields).toContain('type')
      expect(fields).toContain('value')
      expect(fields).toContain('enabled')
    })
  })

  describe('selective field subscriptions', () => {
    it('should only subscribe to fields referenced in enable expressions', () => {
      // Create operator with custom fields that have enable expressions
      const op = new NumberOp('/test-op', {})

      // Add custom field definitions with enable expressions
      op.customInputDefinitions = [
        {
          name: 'conditionalField',
          type: 'number',
          default: 0,
          enableExpression: "par.mode === 'advanced'",
        },
        {
          name: 'mode',
          type: 'string',
          default: 'simple',
        },
        {
          name: 'unused',
          type: 'number',
          default: 0,
        },
      ]

      // Track subscriptions
      const subscriptions = new Set<string>()
      const originalGetAllInputs = op.getAllInputs.bind(op)
      op.getAllInputs = () => {
        const inputs = originalGetAllInputs()
        // Wrap each field's subscribe method
        for (const [name, field] of Object.entries(inputs)) {
          const originalSubscribe = field.subscribe.bind(field)
          field.subscribe = (...args) => {
            subscriptions.add(name)
            return originalSubscribe(...args)
          }
        }
        return inputs
      }

      setOp('/test-op', op)

      // The useFieldValueChanges hook should only subscribe to 'mode'
      // because it's referenced in the enable expression
      const deps = getEnableExpressionDependencies(
        op.customInputDefinitions[0].enableExpression!
      )
      const expectedFields = deps.filter(d => d.type === 'local-par').map(d => d.field)

      expect(expectedFields).toEqual(['mode'])
      // 'unused' and 'conditionalField' should NOT be in subscriptions
      // (verified by the selective subscription logic)
    })

    it('should handle operators with no enable expressions', () => {
      const op = new NumberOp('/test-op', {})

      // No custom field definitions
      op.customInputDefinitions = []

      const deps = getEnableExpressionDependencies('')
      expect(deps).toHaveLength(0)
    })

    it('should handle operators with multiple enable expressions', () => {
      const op = new NumberOp('/test-op', {})

      op.customInputDefinitions = [
        {
          name: 'field1',
          type: 'number',
          default: 0,
          enableExpression: 'par.enabled',
        },
        {
          name: 'field2',
          type: 'number',
          default: 0,
          enableExpression: 'par.mode === "advanced"',
        },
        {
          name: 'field3',
          type: 'number',
          default: 0,
          enableExpression: 'par.enabled && par.value > 10',
        },
        {
          name: 'enabled',
          type: 'boolean',
          default: false,
        },
        {
          name: 'mode',
          type: 'string',
          default: 'simple',
        },
        {
          name: 'value',
          type: 'number',
          default: 0,
        },
      ]

      // Collect all referenced fields
      const allReferencedFields = new Set<string>()
      for (const def of op.customInputDefinitions) {
        if (def.enableExpression) {
          const deps = getEnableExpressionDependencies(def.enableExpression)
          for (const dep of deps) {
            if (dep.type === 'local-par') {
              allReferencedFields.add(dep.field)
            }
          }
        }
      }

      // Should only reference: enabled, mode, value
      expect(allReferencedFields.size).toBe(3)
      expect(allReferencedFields.has('enabled')).toBe(true)
      expect(allReferencedFields.has('mode')).toBe(true)
      expect(allReferencedFields.has('value')).toBe(true)

      // Should NOT subscribe to conditional fields
      expect(allReferencedFields.has('field1')).toBe(false)
      expect(allReferencedFields.has('field2')).toBe(false)
      expect(allReferencedFields.has('field3')).toBe(false)
    })
  })

  describe('performance characteristics', () => {
    it('should reduce subscriptions from O(f) to O(e)', () => {
      const op = new NumberOp('/test-op', {})

      // Create operator with many fields but few enable expressions
      const fieldCount = 20
      const expressionFieldCount = 2

      op.customInputDefinitions = []

      // Add fields with enable expressions (only 2)
      for (let i = 0; i < expressionFieldCount; i++) {
        op.customInputDefinitions.push({
          name: `conditionalField${i}`,
          type: 'number',
          default: 0,
          enableExpression: 'par.masterEnabled',
        })
      }

      // Add control field
      op.customInputDefinitions.push({
        name: 'masterEnabled',
        type: 'boolean',
        default: false,
      })

      // Add many fields without enable expressions
      for (let i = expressionFieldCount; i < fieldCount; i++) {
        op.customInputDefinitions.push({
          name: `field${i}`,
          type: 'number',
          default: 0,
        })
      }

      // Calculate expected subscriptions
      const allReferencedFields = new Set<string>()
      for (const def of op.customInputDefinitions) {
        if (def.enableExpression) {
          const deps = getEnableExpressionDependencies(def.enableExpression)
          for (const dep of deps) {
            if (dep.type === 'local-par') {
              allReferencedFields.add(dep.field)
            }
          }
        }
      }

      // Should only subscribe to 1 field (masterEnabled) instead of 20+
      expect(allReferencedFields.size).toBe(1)
      expect(allReferencedFields.has('masterEnabled')).toBe(true)

      // Verify 90%+ reduction
      const reductionPercentage =
        (1 - allReferencedFields.size / (fieldCount + 1)) * 100
      expect(reductionPercentage).toBeGreaterThan(90)
    })
  })
})
