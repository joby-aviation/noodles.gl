import { beforeEach, describe, expect, it } from 'vitest'
import type { IOperator, Operator } from '../operators'
import { getOp, opMap } from '../store'

// Mock operator for testing
const mockOperator = {
  id: '/test',
  inputs: {},
  outputs: {},
  par: {},
  out: {},
  createInputs: () => ({}),
  createOutputs: () => ({}),
  execute: () => null,
  subs: [],
  locked: { value: false },
  executionState: { value: { status: 'idle' as const } },
}

describe('getOp with path resolution', () => {
  beforeEach(() => {
    opMap.clear()
  })

  describe('absolute paths', () => {
    it('resolves absolute paths directly', () => {
      opMap.set('/operator', mockOperator as Operator<IOperator>)

      expect(getOp('/operator')).toBe(mockOperator)
      expect(getOp('/nonexistent')).toBeUndefined()
    })

    it('ignores context for absolute paths', () => {
      opMap.set('/target', mockOperator as Operator<IOperator>)

      expect(getOp('/target', '/some/context')).toBe(mockOperator)
    })
  })

  describe('relative paths with context', () => {
    beforeEach(() => {
      // Set up a hierarchy of operators
      opMap.set('/container/operator1', {
        ...mockOperator,
        id: '/container/operator1',
      } as Operator<IOperator>)
      opMap.set('/container/operator2', {
        ...mockOperator,
        id: '/container/operator2',
      } as Operator<IOperator>)
      opMap.set('/container/sub/operator3', {
        ...mockOperator,
        id: '/container/sub/operator3',
      } as Operator<IOperator>)
      opMap.set('/other/operator4', {
        ...mockOperator,
        id: '/other/operator4',
      } as Operator<IOperator>)
    })

    it('resolves same-container references', () => {
      const result = getOp('./operator2', '/container/operator1')
      expect(result?.id).toBe('/container/operator2')
    })

    it('resolves same-container references without prefix', () => {
      const result = getOp('operator2', '/container/operator1')
      expect(result?.id).toBe('/container/operator2')
    })

    it('resolves parent-container references', () => {
      // Add an operator at the root level for this test
      opMap.set('/operator4', { ...mockOperator, id: '/operator4' } as Operator<IOperator>)

      const result = getOp('../operator4', '/container/operator1')
      expect(result?.id).toBe('/operator4')
    })

    it('resolves nested references', () => {
      const result = getOp('./sub/operator3', '/container/operator1')
      expect(result?.id).toBe('/container/sub/operator3')
    })

    it('returns undefined for unresolvable paths', () => {
      expect(getOp('./nonexistent', '/container/operator1')).toBeUndefined()
      expect(getOp('../nonexistent', '/container/operator1')).toBeUndefined()
    })

    it('resolves paths that go above root', () => {
      expect(getOp('../operator', '/operator1')).toBeUndefined() // Still undefined because operator doesn't exist
    })
  })

  describe('no context provided', () => {
    it('treats relative paths as absolute', () => {
      opMap.set('/operator', mockOperator as Operator<IOperator>)

      // Without context, relative paths are treated as absolute
      expect(getOp('/operator')).toBe(mockOperator)
      expect(getOp('./operator')).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('handles empty path', () => {
      expect(getOp('', '/context')).toBeUndefined()
    })

    it('handles invalid context', () => {
      expect(getOp('./target', '')).toBeUndefined()
    })
  })
})
