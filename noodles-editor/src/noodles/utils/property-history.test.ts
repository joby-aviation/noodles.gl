import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type OperatorSnapshot,
  applyOperatorInputs,
  captureOperatorInputs,
  firePropertyMutation,
  getLastCommittedBeforeState,
  registerPropertyMutationCallback,
  snapshotsEqual,
} from './property-history'

// Mock the store module
vi.mock('../store', () => ({
  getAllOps: vi.fn(),
  getOpStore: vi.fn(),
}))

import { getAllOps, getOpStore } from '../store'

// Helper to create a mock field with value/setValue
function mockField(fieldValue: unknown) {
  return {
    value: fieldValue,
    serialize: vi.fn(() => fieldValue),
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
  it('captures all operator field values using field.value', () => {
    const fieldA = mockField(42)
    const fieldB = mockField('hello')
    const op = mockOp('/my-op', { fieldA, fieldB })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()

    expect(result['/my-op']).toEqual({ fieldA: 42, fieldB: 'hello' })
  })

  it('captures all operators including nested fields', () => {
    const op1 = mockOp('/op1', { x: mockField(1) })
    const op2 = mockOp('/op2', { y: mockField(2) })
    mockedGetAllOps.mockReturnValue([op1 as never, op2 as never])

    const result = captureOperatorInputs()

    expect(result['/op1']).toEqual({ x: 1 })
    expect(result['/op2']).toEqual({ y: 2 })
  })

  it('returns empty object when no operators', () => {
    mockedGetAllOps.mockReturnValue([])

    const result = captureOperatorInputs()
    expect(result).toEqual({})
  })

  it('captures complex values correctly', () => {
    const field = mockField({ nested: [1, 2, 3] })
    const op = mockOp('/op', { compound: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()
    expect(result['/op'].compound).toEqual({ nested: [1, 2, 3] })
  })
})

describe('applyOperatorInputs', () => {
  it('restores field values by calling setValue for each field', () => {
    const field = mockField(0)
    const op = mockOp('/my-op', { value: field })

    const store = { getOp: vi.fn((id: string) => (id === '/my-op' ? op : undefined)) }
    mockedGetOpStore.mockReturnValue(store as never)

    applyOperatorInputs({ '/my-op': { value: 99 } })

    expect(field.setValue).toHaveBeenCalledWith(99)
  })

  it('skips operators that no longer exist in the store', () => {
    const store = { getOp: vi.fn(() => undefined) }
    mockedGetOpStore.mockReturnValue(store as never)

    expect(() => {
      applyOperatorInputs({ '/missing-op': { x: 1 } })
    }).not.toThrow()
  })

  it('skips fields that no longer exist on the operator', () => {
    const field = mockField(0)
    const op = mockOp('/op', { existingField: field })
    const store = { getOp: vi.fn(() => op) }
    mockedGetOpStore.mockReturnValue(store as never)

    applyOperatorInputs({ '/op': { existingField: 5, ghostField: 99 } })

    expect(field.setValue).toHaveBeenCalledWith(5)
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

    applyOperatorInputs({ '/op1': { x: 42 }, '/op2': { text: 'hello' } })

    expect(field1.setValue).toHaveBeenCalledWith(42)
    expect(field2.setValue).toHaveBeenCalledWith('hello')
  })
})

describe('snapshotsEqual', () => {
  it('returns true for identical snapshots', () => {
    const a: OperatorSnapshot = { '/op': { x: 1, y: 'hello' } }
    const b: OperatorSnapshot = { '/op': { x: 1, y: 'hello' } }
    expect(snapshotsEqual(a, b)).toBe(true)
  })

  it('returns false when field values differ', () => {
    const a: OperatorSnapshot = { '/op': { x: 1 } }
    const b: OperatorSnapshot = { '/op': { x: 2 } }
    expect(snapshotsEqual(a, b)).toBe(false)
  })

  it('returns false when operators differ', () => {
    const a: OperatorSnapshot = { '/op1': { x: 1 } }
    const b: OperatorSnapshot = { '/op2': { x: 1 } }
    expect(snapshotsEqual(a, b)).toBe(false)
  })

  it('returns false when field count differs', () => {
    const a: OperatorSnapshot = { '/op': { x: 1 } }
    const b: OperatorSnapshot = { '/op': { x: 1, y: 2 } }
    expect(snapshotsEqual(a, b)).toBe(false)
  })

  it('returns false when operator count differs', () => {
    const a: OperatorSnapshot = { '/op1': { x: 1 } }
    const b: OperatorSnapshot = { '/op1': { x: 1 }, '/op2': { y: 2 } }
    expect(snapshotsEqual(a, b)).toBe(false)
  })

  it('uses Object.is for value comparison (same reference = equal)', () => {
    const arr = [1, 2, 3]
    const a: OperatorSnapshot = { '/op': { data: arr } }
    const b: OperatorSnapshot = { '/op': { data: arr } }
    expect(snapshotsEqual(a, b)).toBe(true)
  })

  it('arrays with different references are not equal', () => {
    const a: OperatorSnapshot = { '/op': { data: [1, 2, 3] } }
    const b: OperatorSnapshot = { '/op': { data: [1, 2, 3] } }
    expect(snapshotsEqual(a, b)).toBe(false)
  })

  it('plain objects with same properties are equal (CompoundPropsField)', () => {
    const a: OperatorSnapshot = { '/op': { viewState: { lat: 40, lng: -73, zoom: 13 } } }
    const b: OperatorSnapshot = { '/op': { viewState: { lat: 40, lng: -73, zoom: 13 } } }
    expect(snapshotsEqual(a, b)).toBe(true)
  })

  it('plain objects with different properties are not equal', () => {
    const a: OperatorSnapshot = { '/op': { viewState: { lat: 40, lng: -73, zoom: 13 } } }
    const b: OperatorSnapshot = { '/op': { viewState: { lat: 41, lng: -73, zoom: 13 } } }
    expect(snapshotsEqual(a, b)).toBe(false)
  })

  it('returns true for two empty snapshots', () => {
    expect(snapshotsEqual({}, {})).toBe(true)
  })
})

describe('registerPropertyMutationCallback and firePropertyMutation', () => {
  afterEach(() => {
    registerPropertyMutationCallback(undefined)
  })

  it('firePropertyMutation is a no-op when no callback is registered', () => {
    const field = mockField(10)
    const op = mockOp('/op', { x: field })
    mockedGetAllOps.mockReturnValue([op as never])

    expect(() => {
      firePropertyMutation('Change value', { '/op': { x: 5 } })
    }).not.toThrow()
  })

  it('calls registered callback with description, before, and after snapshots', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    mockedGetAllOps.mockReturnValue([
      { id: '/op', inputs: { x: { value: 10, serialize: () => 10 } } } as never,
    ])

    const before: OperatorSnapshot = { '/op': { x: 5 } }
    firePropertyMutation('Change value', before)

    expect(callback).toHaveBeenCalledTimes(1)
    const [desc, beforeArg, afterArg] = callback.mock.calls[0]
    expect(desc).toBe('Change value')
    expect(beforeArg).toBe(before)
    expect(afterArg['/op'].x).toBe(10)
  })

  it('skips callback when before and after states are identical (no change)', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    const field = mockField(42)
    const op = mockOp('/op', { x: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const before = captureOperatorInputs()
    firePropertyMutation('No change', before)

    expect(callback).not.toHaveBeenCalled()
  })

  it('can clear the callback by registering undefined', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)
    registerPropertyMutationCallback(undefined)

    const field = mockField(1)
    mockedGetAllOps.mockReturnValue([{ id: '/op', inputs: { x: field } } as never])

    firePropertyMutation('Test', { '/op': { x: 0 } })
    expect(callback).not.toHaveBeenCalled()
  })

  it('replacing the callback uses the new one', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    registerPropertyMutationCallback(cb1)
    registerPropertyMutationCallback(cb2)

    mockedGetAllOps.mockReturnValue([{ id: '/op', inputs: { x: { value: 1, serialize: () => 1 } } } as never])

    firePropertyMutation('Test', { '/op': { x: 0 } })

    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it('saves the before state for crash recovery after a successful mutation', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    const before: OperatorSnapshot = { '/op': { x: 5 } }
    mockedGetAllOps.mockReturnValue([
      { id: '/op', inputs: { x: { value: 10, serialize: () => 10 } } } as never,
    ])

    firePropertyMutation('Change value', before)

    expect(getLastCommittedBeforeState()).toBe(before)
  })

  it('does not update crash recovery state when before and after are identical', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    const firstBefore: OperatorSnapshot = { '/op': { x: 0 } }
    mockedGetAllOps.mockReturnValue([{ id: '/op', inputs: { x: { value: 1, serialize: () => 1 } } } as never])
    firePropertyMutation('First change', firstBefore)
    const stateAfterFirst = getLastCommittedBeforeState()

    // Now fire a mutation where before === after (no actual change)
    const field = mockField(42)
    const op = mockOp('/op2', { x: field })
    mockedGetAllOps.mockReturnValue([op as never])
    const unchanged = captureOperatorInputs()
    firePropertyMutation('No change', unchanged)

    expect(getLastCommittedBeforeState()).toBe(stateAfterFirst)
  })

  it('does not update crash recovery state when no callback is registered', () => {
    registerPropertyMutationCallback(vi.fn())
    const beforeFirst: OperatorSnapshot = { '/op': { x: 99 } }
    mockedGetAllOps.mockReturnValue([
      { id: '/op', inputs: { x: { value: 100, serialize: () => 100 } } } as never,
    ])
    firePropertyMutation('Setup', beforeFirst)
    const stateAfterSetup = getLastCommittedBeforeState()

    registerPropertyMutationCallback(undefined)

    firePropertyMutation('Ignored', { '/op': { x: 0 } })

    expect(getLastCommittedBeforeState()).toBe(stateAfterSetup)
  })
})

describe('captureOperatorInputs skips connected fields', () => {
  it('excludes fields that have active subscriptions (connected inputs)', () => {
    const bigData = Array.from({ length: 50000 }, (_, i) => ({ id: i }))
    const connectedField = {
      value: bigData,
      serialize: vi.fn(() => bigData),
      setValue: vi.fn(),
      subscriptions: new Map([['edge-1', {}]]),
    }
    const localField = mockField(20)
    const op = mockOp('/scatter', { data: connectedField, getRadius: localField })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()

    expect(result['/scatter'].getRadius).toBe(20)
    expect(result['/scatter'].data).toBeUndefined()
  })

  it('includes fields with empty subscriptions (no connections)', () => {
    const field = {
      value: 'test-value',
      serialize: vi.fn(() => 'test-value'),
      setValue: vi.fn(),
      subscriptions: new Map(),
    }
    const op = mockOp('/op', { name: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()

    expect(result['/op'].name).toBe('test-value')
  })

  it('includes fields without subscriptions property (legacy/interface fields)', () => {
    const field = mockField('hello')
    const op = mockOp('/op', { text: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()

    expect(result['/op'].text).toBe('hello')
  })
})

describe('captureOperatorInputs performance', () => {
  it('completes in under 50ms even with many operators and large connected data', () => {
    const bigData = Array.from({ length: 100000 }, () => ({ x: 1, y: 2 }))
    const ops = Array.from({ length: 50 }, (_, i) => {
      const connectedDataField = {
        value: bigData,
        serialize: vi.fn(() => bigData),
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
    expect(Object.keys(result)).toHaveLength(50)
    expect(result['/op-0'].value).toBe(0)
    expect(result['/op-0'].data).toBeUndefined()
  })

  it('skips connected fields entirely', () => {
    const connectedField = {
      value: 'should not appear',
      serialize: vi.fn(),
      setValue: vi.fn(),
      subscriptions: new Map([['edge-1', {}]]),
    }
    const op = mockOp('/op', { bigData: connectedField, radius: mockField(5) })
    mockedGetAllOps.mockReturnValue([op as never])

    const result = captureOperatorInputs()

    expect(result['/op'].bigData).toBeUndefined()
    expect(result['/op'].radius).toBe(5)
  })

  it('firePropertyMutation skips recording when before is null', () => {
    const callback = vi.fn()
    registerPropertyMutationCallback(callback)

    mockedGetAllOps.mockReturnValue([
      { id: '/op', inputs: { x: { value: 10, serialize: () => 10, subscriptions: new Map() } } } as never,
    ])

    firePropertyMutation('Change value', null)
    expect(callback).not.toHaveBeenCalled()
  })
})

describe('captureOperatorInputs + applyOperatorInputs round-trip', () => {
  it('restores field values to their captured state', () => {
    const field = mockField(42)
    const op = mockOp('/op', { value: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const snapshot = captureOperatorInputs()

    // Simulate field value changing
    field.value = 99

    const store = { getOp: vi.fn(() => op) }
    mockedGetOpStore.mockReturnValue(store as never)
    applyOperatorInputs(snapshot)

    expect(field.setValue).toHaveBeenCalledWith(42)
  })

  it('skips setValue when field value has not changed', () => {
    const field = mockField(42)
    const op = mockOp('/op', { value: field })
    mockedGetAllOps.mockReturnValue([op as never])

    const snapshot = captureOperatorInputs()

    // Field value is still 42 — same as snapshot
    const store = { getOp: vi.fn(() => op) }
    mockedGetOpStore.mockReturnValue(store as never)
    applyOperatorInputs(snapshot)

    expect(field.setValue).not.toHaveBeenCalled()
  })
})
