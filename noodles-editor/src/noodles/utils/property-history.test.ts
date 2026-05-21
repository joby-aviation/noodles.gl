import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyOperatorInputs,
  captureOperatorInputs,
  firePropertyMutation,
  getLastCommittedBeforeState,
  registerPropertyMutationCallback,
} from './property-history'

// Mock the store module
vi.mock('../store', () => ({
  getAllOps: vi.fn(),
  getOpStore: vi.fn(),
}))

import { getAllOps, getOpStore } from '../store'

// Helper to create a mock field with serialize/setValue
function mockField(serializedValue: unknown) {
  return {
    serialize: vi.fn(() => serializedValue),
    setValue: vi.fn(),
  }
}

// Helper to create a mock operator with given fields
function mockOp(id: string, fields: Record<string, ReturnType<typeof mockField>>) {
  return { id, inputs: fields }
}

const mockedGetAllOps = vi.mocked(getAllOps)
const mockedGetOpStore = vi.mocked(getOpStore)

describe('captureOperatorInputs', () => {
  it('serializes all operator field values using serialize()', () => {
    const fieldA = mockField(42)
    const fieldB = mockField('hello')
    const op = mockOp('/my-op', { fieldA, fieldB })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()
    const parsed = JSON.parse(result)

    expect(parsed['/my-op']).toEqual({ fieldA: 42, fieldB: 'hello' })
    expect(fieldA.serialize).toHaveBeenCalled()
    expect(fieldB.serialize).toHaveBeenCalled()
  })

  it('captures all operators including nested fields', () => {
    const op1 = mockOp('/op1', { x: mockField(1) })
    const op2 = mockOp('/op2', { y: mockField(2) })
    mockedGetAllOps.mockReturnValue([op1 as never, op2 as never])

    const result = captureOperatorInputs()
    const parsed = JSON.parse(result)

    expect(parsed['/op1']).toEqual({ x: 1 })
    expect(parsed['/op2']).toEqual({ y: 2 })
  })

  it('returns empty object when no operators', () => {
    mockedGetAllOps.mockReturnValue([])

    const result = captureOperatorInputs()
    expect(JSON.parse(result)).toEqual({})
  })

  it('serializes null and complex values correctly', () => {
    const field = mockField({ nested: [1, 2, 3] })
    const op = mockOp('/op', { compound: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()
    const parsed = JSON.parse(result)
    expect(parsed['/op'].compound).toEqual({ nested: [1, 2, 3] })
  })
})

describe('applyOperatorInputs', () => {
  beforeEach(() => {
    // Set up getOpStore mock
    const store = {
      getOp: vi.fn(),
    }
    mockedGetOpStore.mockReturnValue(store as never)
  })

  it('restores field values by calling setValue for each field', () => {
    const field = mockField(0)
    const op = mockOp('/my-op', { value: field })

    const store = { getOp: vi.fn((id: string) => (id === '/my-op' ? op : undefined)) }
    mockedGetOpStore.mockReturnValue(store as never)

    const snapshot = JSON.stringify({ '/my-op': { value: 99 } })
    applyOperatorInputs(snapshot)

    expect(field.setValue).toHaveBeenCalledWith(99)
  })

  it('skips operators that no longer exist in the store', () => {
    const store = { getOp: vi.fn(() => undefined) }
    mockedGetOpStore.mockReturnValue(store as never)

    // Should not throw even though the op doesn't exist
    expect(() => {
      applyOperatorInputs(JSON.stringify({ '/missing-op': { x: 1 } }))
    }).not.toThrow()
  })

  it('skips fields that no longer exist on the operator', () => {
    const field = mockField(0)
    const op = mockOp('/op', { existingField: field })
    const store = { getOp: vi.fn(() => op) }
    mockedGetOpStore.mockReturnValue(store as never)

    // Snapshot has a field that doesn't exist on the op
    applyOperatorInputs(JSON.stringify({ '/op': { existingField: 5, ghostField: 99 } }))

    expect(field.setValue).toHaveBeenCalledWith(5)
    // No error thrown for ghostField
  })

  it('handles invalid JSON gracefully', () => {
    const store = { getOp: vi.fn() }
    mockedGetOpStore.mockReturnValue(store as never)

    expect(() => {
      applyOperatorInputs('not valid json {{{')
    }).not.toThrow()

    expect(store.getOp).not.toHaveBeenCalled()
  })

  it('restores multiple operators in a single snapshot', () => {
    const field1 = mockField(0)
    const field2 = mockField('')
    const op1 = mockOp('/op1', { x: field1 })
    const op2 = mockOp('/op2', { text: field2 })
    const store = {
      getOp: vi.fn((id: string) => {
        if (id === '/op1') return op1
        if (id === '/op2') return op2
        return undefined
      }),
    }
    mockedGetOpStore.mockReturnValue(store as never)

    applyOperatorInputs(JSON.stringify({ '/op1': { x: 42 }, '/op2': { text: 'hello' } }))

    expect(field1.setValue).toHaveBeenCalledWith(42)
    expect(field2.setValue).toHaveBeenCalledWith('hello')
  })
})

describe('registerPropertyMutationCallback and firePropertyMutation', () => {
  afterEach(() => {
    // Clean up callback registration after each test
    registerPropertyMutationCallback(undefined)
  })

  it('firePropertyMutation is a no-op when no callback is registered', () => {
    const field = mockField(10)
    const op = mockOp('/op', { x: field })
    mockedGetAllOps.mockReturnValue([op as never])

    // No throw, no callback
    expect(() => {
      firePropertyMutation('Change value', JSON.stringify({ '/op': { x: 5 } }))
    }).not.toThrow()
  })

  it('calls registered callback with description, before, and after state', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    // before: x=5, after: x=10
    const fieldBefore = mockField(5)
    const _op = mockOp('/op', { x: fieldBefore })
    const before = JSON.stringify({ '/op': { x: 5 } })

    // After capture: x=10
    mockedGetAllOps.mockReturnValue([
      { id: '/op', inputs: { x: { serialize: () => 10 } } } as never,
    ])

    firePropertyMutation('Change value', before)

    expect(callback).toHaveBeenCalledTimes(1)
    const [desc, beforeArg, afterArg] = callback.mock.calls[0]
    expect(desc).toBe('Change value')
    expect(beforeArg).toBe(before)
    const afterParsed = JSON.parse(afterArg)
    expect(afterParsed['/op'].x).toBe(10)
  })

  it('skips callback when before and after states are identical (no change)', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    const field = mockField(42)
    const op = mockOp('/op', { x: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const before = captureOperatorInputs()
    // before and after will be identical since the field hasn't changed
    firePropertyMutation('No change', before)

    expect(callback).not.toHaveBeenCalled()
  })

  it('can clear the callback by registering undefined', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)
    registerPropertyMutationCallback(undefined)

    const field = mockField(1)
    mockedGetAllOps.mockReturnValue([{ id: '/op', inputs: { x: field } } as never])

    firePropertyMutation('Test', JSON.stringify({ '/op': { x: 0 } }))
    expect(callback).not.toHaveBeenCalled()
  })

  it('replacing the callback uses the new one', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    registerPropertyMutationCallback(cb1)
    registerPropertyMutationCallback(cb2)

    // before: x=0, after: x=1
    mockedGetAllOps.mockReturnValue([{ id: '/op', inputs: { x: { serialize: () => 1 } } } as never])

    firePropertyMutation('Test', JSON.stringify({ '/op': { x: 0 } }))

    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it('saves the before state for crash recovery after a successful mutation', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    const before = JSON.stringify({ '/op': { x: 5 } })
    mockedGetAllOps.mockReturnValue([
      { id: '/op', inputs: { x: { serialize: () => 10 } } } as never,
    ])

    firePropertyMutation('Change value', before)

    expect(getLastCommittedBeforeState()).toBe(before)
  })

  it('does not update crash recovery state when before and after are identical', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    // Set a known before state via a successful mutation
    const firstBefore = JSON.stringify({ '/op': { x: 0 } })
    mockedGetAllOps.mockReturnValue([{ id: '/op', inputs: { x: { serialize: () => 1 } } } as never])
    firePropertyMutation('First change', firstBefore)
    const stateAfterFirst = getLastCommittedBeforeState()

    // Now fire a mutation where before === after (no actual change)
    const field = mockField(42)
    const op = mockOp('/op2', { x: field })
    mockedGetAllOps.mockReturnValue([op as never])
    const unchanged = captureOperatorInputs()
    firePropertyMutation('No change', unchanged)

    // Crash recovery state should not have changed
    expect(getLastCommittedBeforeState()).toBe(stateAfterFirst)
  })

  it('does not update crash recovery state when no callback is registered', () => {
    // Register then immediately unregister
    registerPropertyMutationCallback(vi.fn())
    const beforeFirst = JSON.stringify({ '/op': { x: 99 } })
    mockedGetAllOps.mockReturnValue([
      { id: '/op', inputs: { x: { serialize: () => 100 } } } as never,
    ])
    firePropertyMutation('Setup', beforeFirst)
    const stateAfterSetup = getLastCommittedBeforeState()

    // Unregister callback
    registerPropertyMutationCallback(undefined)

    // Fire another mutation — should be ignored
    firePropertyMutation('Ignored', JSON.stringify({ '/op': { x: 0 } }))

    expect(getLastCommittedBeforeState()).toBe(stateAfterSetup)
  })
})

describe('captureOperatorInputs skips connected fields', () => {
  it('excludes fields that have active subscriptions (connected inputs)', () => {
    const connectedField = {
      serialize: vi.fn(() => Array.from({ length: 50000 }, (_, i) => ({ id: i }))),
      setValue: vi.fn(),
      subscriptions: new Map([['edge-1', {}]]),
    }
    const localField = mockField(20)
    const op = mockOp('/scatter', { data: connectedField, getRadius: localField })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()
    const parsed = JSON.parse(result)

    expect(parsed['/scatter'].getRadius).toBe(20)
    expect(parsed['/scatter'].data).toBeUndefined()
    expect(connectedField.serialize).not.toHaveBeenCalled()
  })

  it('includes fields with empty subscriptions (no connections)', () => {
    const field = {
      serialize: vi.fn(() => 'test-value'),
      setValue: vi.fn(),
      subscriptions: new Map(),
    }
    const op = mockOp('/op', { name: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()
    const parsed = JSON.parse(result)

    expect(parsed['/op'].name).toBe('test-value')
  })

  it('includes fields without subscriptions property (legacy/interface fields)', () => {
    const field = mockField('hello')
    const op = mockOp('/op', { text: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()
    const parsed = JSON.parse(result)

    expect(parsed['/op'].text).toBe('hello')
  })
})

describe('captureOperatorInputs performance', () => {
  it('completes in under 50ms even with many operators and large connected data', () => {
    const ops = Array.from({ length: 50 }, (_, i) => {
      const connectedDataField = {
        serialize: vi.fn(() => Array.from({ length: 100000 }, () => ({ x: 1, y: 2 }))),
        setValue: vi.fn(),
        subscriptions: new Map([['edge', {}]]),
      }
      const localField = mockField(i)
      return mockOp(`/op-${i}`, { data: connectedDataField, value: localField })
    })
    mockedGetAllOps.mockReturnValue(ops as never[])

    const start = performance.now()
    const result = captureOperatorInputs()
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(50)
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed)).toHaveLength(50)
    expect(parsed['/op-0'].value).toBe(0)
    expect(parsed['/op-0'].data).toBeUndefined()
  })

  it('does not call serialize() on connected fields', () => {
    const expensiveSerialize = vi.fn(() => {
      throw new Error('Should not be called')
    })
    const connectedField = {
      serialize: expensiveSerialize,
      setValue: vi.fn(),
      subscriptions: new Map([['edge-1', {}]]),
    }
    const op = mockOp('/op', { bigData: connectedField, radius: mockField(5) })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()
    const parsed = JSON.parse(result)

    expect(expensiveSerialize).not.toHaveBeenCalled()
    expect(parsed['/op'].radius).toBe(5)
  })

  it('returns empty JSON object when stringify would throw', () => {
    const circular: any = {}
    circular.self = circular
    const field = {
      serialize: vi.fn(() => circular),
      setValue: vi.fn(),
      subscriptions: new Map(),
    }
    const op = mockOp('/op', { bad: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()
    expect(result).toBe('{}')
  })
})

describe('captureOperatorInputs + applyOperatorInputs round-trip', () => {
  it('restores field values to their captured state', () => {
    const field = mockField(42)
    const op = mockOp('/op', { value: field })
    mockedGetAllOps.mockReturnValue([op as never])

    // Capture initial state
    const snapshot = captureOperatorInputs()

    // Simulate field changing
    field.serialize.mockReturnValue(99)

    // Restore from snapshot
    const store = { getOp: vi.fn(() => op) }
    mockedGetOpStore.mockReturnValue(store as never)
    applyOperatorInputs(snapshot)

    // setValue should be called with the original value (42)
    expect(field.setValue).toHaveBeenCalledWith(42)
  })
})
