import { useCallback, useRef } from 'react'
import { debugHistory, debugHistorySnapshot } from '../../utils/debug'
import type { IField } from '../fields'
import { getAllOps, getOpStore } from '../store'
import type { OpId } from './id-utils'

type PropertyMutationCallback = (description: string, before: string, after: string) => void

let _propertyMutationCallback: PropertyMutationCallback | undefined
let _lastCommittedBeforeState: string | null = null

export function registerPropertyMutationCallback(cb: PropertyMutationCallback | undefined) {
  _propertyMutationCallback = cb
}

// Serializes all operator field values using each field's serialize() method.
// This mirrors captureTimelineState() in timeline-store.ts.
// Skips connected fields (they receive values from upstream and can hold large datasets).
export function captureOperatorInputs(): string | null {
  const ops = getAllOps()
  const state: Record<string, Record<string, unknown>> = {}
  for (const op of ops) {
    const inputs: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(op.inputs as Record<string, IField>)) {
      if ('subscriptions' in field && (field as { subscriptions: Map<unknown, unknown> }).subscriptions.size > 0) continue
      inputs[name] = field.serialize()
    }
    state[op.id] = inputs
  }
  debugHistorySnapshot('Captured operator inputs for %d ops', ops.length)
  try {
    return JSON.stringify(state)
  } catch {
    debugHistory('State too large to serialize for property history')
    return null
  }
}

// Restores operator field values from a snapshot.
// Connected fields will be immediately overwritten by their upstream sources,
// so restoring them here is harmless and keeps the restore logic simple.
export function applyOperatorInputs(snapshot: string): void {
  let data: Record<string, Record<string, unknown>>
  try {
    data = JSON.parse(snapshot)
  } catch {
    debugHistory('Failed to parse operator inputs snapshot')
    return
  }
  const store = getOpStore()
  for (const [id, inputs] of Object.entries(data)) {
    const op = store.getOp(id as OpId)
    if (!op) continue
    const opInputs = op.inputs as Record<string, IField>
    for (const [name, value] of Object.entries(inputs)) {
      const field = opInputs[name]
      if (field) {
        field.setValue(value)
      }
    }
  }
}

// Records a property mutation to the undo/redo history. Captures the "after" state
// and calls the registered callback with both before and after. Skips if state is unchanged.
// Mirrors fireTimelineMutation() in timeline-store.ts.
export function firePropertyMutation(description: string, before: string | null): void {
  if (!_propertyMutationCallback || before === null) return
  const after = captureOperatorInputs()
  if (after === null || before === after) return
  _lastCommittedBeforeState = before
  debugHistorySnapshot('Firing property mutation: %s', description)
  _propertyMutationCallback(description, before, after)
}

export function getLastCommittedBeforeState(): string | null {
  return _lastCommittedBeforeState
}

// React hook that provides captureStart/commitChange for use in field components.
// Call captureStart() at the beginning of a user interaction (focus, drag start).
// Call commitChange(description) when the interaction ends (blur, drag end, close).
export function usePropertyHistory() {
  const beforeRef = useRef<string | null>(null)

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
