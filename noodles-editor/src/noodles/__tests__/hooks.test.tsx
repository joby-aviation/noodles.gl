// Tests for custom React hooks
// Tests useSlice, useOp, and integration with the Noodles context
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NumberOp } from '../operators'
import { NoodlesProvider, opMap, useOp, useSlice } from '../store'

describe('Noodles Hooks', () => {
  afterEach(() => {
    opMap.clear()
  })

  describe('useSlice', () => {
    it('reads values from the Noodles context', () => {
      // Add an operator to the map
      const op = new NumberOp('/test-num', {})
      opMap.set('/test-num', op)

      const { result } = renderHook(() => useSlice(state => state.ops), {
        wrapper: NoodlesProvider,
      })

      expect(result.current.get('/test-num')).toBe(op)
    })

    it('can read nesting context', () => {
      const { result } = renderHook(() => useSlice(state => state.nesting), {
        wrapper: NoodlesProvider,
      })

      expect(result.current.currentContainerId).toBe('/')
    })

    it('can update nesting context', () => {
      const { result } = renderHook(() => useSlice(state => state.nesting), {
        wrapper: NoodlesProvider,
      })

      act(() => {
        result.current.setCurrentContainerId('/container1')
      })
      expect(result.current.currentContainerId).toBe('/container1')
    })

    it('can read sheet objects', () => {
      const { result } = renderHook(() => useSlice(state => state.sheetObjects), {
        wrapper: NoodlesProvider,
      })

      expect(result.current.get('/nonexistent')).toBeUndefined()
    })
  })

  describe('useOp', () => {
    it('returns an operator when it exists', () => {
      const op = new NumberOp('/test-num', {})
      opMap.set('/test-num', op)

      const { result } = renderHook(() => useOp('/test-num'), {
        wrapper: NoodlesProvider,
      })

      expect(result.current).toBe(op)
      expect(result.current).toBeInstanceOf(NumberOp)
    })

    it('throws an error when operator does not exist', () => {
      // Use a try-catch in the hook to capture the error
      const TestHook = () => {
        try {
          return useOp('/nonexistent')
        } catch (error) {
          return { error }
        }
      }

      const { result } = renderHook(() => TestHook(), {
        wrapper: NoodlesProvider,
      })

      expect(result.current).toHaveProperty('error')
      expect((result.current as { error: Error }).error.message).toBe(
        'Operator with id /nonexistent not found'
      )
    })

    it('returns the correct operator when multiple exist', () => {
      const op1 = new NumberOp('/num1', {})
      const op2 = new NumberOp('/num2', {})
      opMap.set('/num1', op1)
      opMap.set('/num2', op2)

      const { result: result1 } = renderHook(() => useOp('/num1'), {
        wrapper: NoodlesProvider,
      })
      const { result: result2 } = renderHook(() => useOp('/num2'), {
        wrapper: NoodlesProvider,
      })

      expect(result1.current).toBe(op1)
      expect(result2.current).toBe(op2)
      expect(result1.current).not.toBe(result2.current)
    })
  })

  describe('Hook integration with operators', () => {
    it('can access operator properties through hooks', () => {
      const op = new NumberOp('/test-num', { val: 42 })
      opMap.set('/test-num', op)

      const { result } = renderHook(() => useOp('/test-num'), {
        wrapper: NoodlesProvider,
      })

      expect(result.current.inputs.val.value).toBe(42)
    })

    it('reflects operator updates', () => {
      const op = new NumberOp('/test-num', { val: 10 })
      opMap.set('/test-num', op)

      const { result } = renderHook(() => useOp('/test-num'), {
        wrapper: NoodlesProvider,
      })

      expect(result.current.inputs.val.value).toBe(10)

      // Update the operator
      act(() => {
        op.inputs.val.setValue(20)
      })

      expect(result.current.inputs.val.value).toBe(20)
    })
  })
})
