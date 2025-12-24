// Tests for custom React hooks and store utilities
// Tests getOp, useNestingStore, and integration with the Noodles context
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NumberOp } from '../operators'
import { clearOps, getOp, getSheetObject, setOp, useNestingStore } from '../store'

describe('Noodles Hooks', () => {
  afterEach(() => {
    clearOps()
  })

  describe('Zustand store', () => {
    it('reads operators from the store', () => {
      // Add an operator to the map
      const op = new NumberOp('/test-num', {})
      setOp('/test-num', op)

      expect(getOp('/test-num')).toBe(op)
    })

    it('can read nesting context', () => {
      const { result } = renderHook(() => useNestingStore(state => state.currentContainerId))

      expect(result.current).toBe('/')
    })

    it('can update nesting context', () => {
      const { result } = renderHook(() => useNestingStore())

      act(() => {
        result.current.setCurrentContainerId('/container1')
      })
      expect(result.current.currentContainerId).toBe('/container1')
    })

    it('can read sheet objects', () => {
      expect(getSheetObject('/nonexistent')).toBeUndefined()
    })
  })

  describe('getOp', () => {
    it('returns an operator when it exists', () => {
      const op = new NumberOp('/test-num', {})
      setOp('/test-num', op)

      const result = getOp('/test-num')

      expect(result).toBe(op)
      expect(result).toBeInstanceOf(NumberOp)
    })

    it('returns undefined when operator does not exist', () => {
      const result = getOp('/nonexistent')

      expect(result).toBeUndefined()
    })

    it('returns the correct operator when multiple exist', () => {
      const op1 = new NumberOp('/num1', {})
      const op2 = new NumberOp('/num2', {})
      setOp('/num1', op1)
      setOp('/num2', op2)

      const result1 = getOp('/num1')
      const result2 = getOp('/num2')

      expect(result1).toBe(op1)
      expect(result2).toBe(op2)
      expect(result1).not.toBe(result2)
    })
  })

  describe('Store integration with operators', () => {
    it('can access operator properties through getOp', () => {
      const op = new NumberOp('/test-num', { val: 42 })
      setOp('/test-num', op)

      const result = getOp('/test-num')

      expect(result?.inputs.val.value).toBe(42)
    })

    it('reflects operator updates', () => {
      const op = new NumberOp('/test-num', { val: 10 })
      setOp('/test-num', op)

      const result = getOp('/test-num')
      expect(result?.inputs.val.value).toBe(10)

      // Update the operator
      act(() => {
        op.inputs.val.setValue(20)
      })

      // getOp returns the same operator reference, so updates are reflected
      expect(result?.inputs.val.value).toBe(20)
      expect(getOp('/test-num')?.inputs.val.value).toBe(20)
    })
  })
})
