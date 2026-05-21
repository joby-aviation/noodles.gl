import { useCallback, useRef } from 'react'
import { debugHistory, debugHistorySnapshot } from '../../utils/debug'
import type { IField } from '../fields'
import { getAllOps, getOpStore } from '../store'
import type { OpId } from './id-utils'

export type OperatorSnapshot = Record<string, Record<string, unknown>>

// Compares two field values: Object.is for primitives and arrays,
// shallow property comparison for plain objects (handles CompoundPropsField
// whose getter creates a new object each access).
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (
    typeof a === 'object' && a !== null && !Array.isArray(a) &&
    typeof b === 'object' && b !== null && !Array.isArray(b)
  ) {
    const aObj = a as Record<string, unknown>
    const bObj = b as Record<string, unknown>
    const aKeys = Object.keys(aObj)
    if (aKeys.length !== Object.keys(bObj).length) return false
    for (const key of aKeys) {
      if (!Object.is(aObj[key], bObj[key])) return false
    }
    return true
  }
  return false
}

type PropertyMutationCallback = (
  description: string,
  before: OperatorSnapshot,
  after: OperatorSnapshot
) => void

let _propertyMutationCallback: PropertyMutationCallback | undefined
let _lastCommittedBeforeState: OperatorSnapshot | null = null

export function registerPropertyMutationCallback(cb: PropertyMutationCallback | undefined) {
  _propertyMutationCallback = cb
}

// Captures all operator field values as a plain object snapshot.
// Skips connected fields (they receive values from upstream and can hold large datasets).
// Stores field.value directly (stable references) so Object.is comparisons work correctly.
export function captureOperatorInputs(): OperatorSnapshot {
  const ops = getAllOps()
  const state: OperatorSnapshot = {}
  for (const op of ops) {
    const inputs: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(op.inputs as Record<string, IField>)) {
      if ('subscriptions' in field && (field as { subscriptions: Map<unknown, unknown> }).subscriptions.size > 0) continue
      inputs[name] = field.value
    }
    state[op.id] = inputs
  }
  debugHistorySnapshot('Captured operator inputs for %d ops', ops.length)
  return state
}

// Compares two operator snapshots: same ops, same fields, same values.
export function snapshotsEqual(a: OperatorSnapshot, b: OperatorSnapshot): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const opId of aKeys) {
    const aInputs = a[opId]
    const bInputs = b[opId]
    if (!bInputs) return false
    const aFieldKeys = Object.keys(aInputs)
    const bFieldKeys = Object.keys(bInputs)
    if (aFieldKeys.length !== bFieldKeys.length) return false
    for (const fieldName of aFieldKeys) {
      if (!valuesEqual(aInputs[fieldName], bInputs[fieldName])) return false
    }
  }
  return true
}

// Restores operator field values from a snapshot.
// Only sets values that actually differ to avoid triggering unnecessary re-execution.
export function applyOperatorInputs(snapshot: OperatorSnapshot): void {
  const store = getOpStore()
  for (const [id, inputs] of Object.entries(snapshot)) {
    const op = store.getOp(id as OpId)
    if (!op) continue
    const opInputs = op.inputs as Record<string, IField>
    for (const [name, value] of Object.entries(inputs)) {
      const field = opInputs[name]
      if (field && !valuesEqual(field.value, value)) {
        field.setValue(value)
      }
    }
  }
}

// Records a property mutation to the undo/redo history. Captures the "after" state
// and calls the registered callback with both before and after. Skips if state is unchanged.
export function firePropertyMutation(description: string, before: OperatorSnapshot | null): void {
  if (!_propertyMutationCallback || before === null) return
  const after = captureOperatorInputs()
  if (snapshotsEqual(before, after)) return
  _lastCommittedBeforeState = before
  debugHistorySnapshot('Firing property mutation: %s', description)
  _propertyMutationCallback(description, before, after)
}

export function getLastCommittedBeforeState(): OperatorSnapshot | null {
  return _lastCommittedBeforeState
}

// React hook that provides captureStart/commitChange for use in field components.
// Call captureStart() at the beginning of a user interaction (focus, drag start).
// Call commitChange(description) when the interaction ends (blur, drag end, close).
export function usePropertyHistory() {
  const beforeRef = useRef<OperatorSnapshot | null>(null)

  const captureStart = useCallback(() => {
    beforeRef.current = captureOperatorInputs()
  }, [])

  const commitChange = useCallback((description: string) => {
    if (beforeRef.current) {
      firePropertyMutation(description, beforeRef.current)
      beforeRef.current = null
    }
  }, [])

  return { captureStart, commitChange }
}
