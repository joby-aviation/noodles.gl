import { useCallback, useRef } from 'react'
import { debugHistory, debugHistorySnapshot } from '../../utils/debug'
import {
  applyNodeUIMetadata,
  applySerializedFieldValue,
  captureNodeUIMetadata,
  type Field,
  type IField,
  type NodeUIMetadata,
} from '../fields'
import { dismissStarterHint, getAllOps, getOpStore } from '../store'
import { trackFieldEdit, useFieldEditScope } from './field-edit-analytics'
import type { OpId } from './id-utils'

type PropertyMutationCallback = (description: string, before: string, after: string) => void

let _propertyMutationCallback: PropertyMutationCallback | undefined
let _lastCommittedBeforeState: string | null = null
export const UI_STATE_KEY = '$ui'

export function registerPropertyMutationCallback(cb: PropertyMutationCallback | undefined) {
  _propertyMutationCallback = cb
}

// Serializes all operator field values using each field's serialize() method.
// This mirrors captureTimelineState() in timeline-store.ts.
// Skips connected fields (they receive values from upstream and can hold large datasets).
export function captureOperatorInputs(): string | null {
  const ops = getAllOps()
  const state: Record<string, Record<string, unknown>> = {}
  const uiState: Record<string, NodeUIMetadata> = {}
  for (const op of ops) {
    const inputs: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(op.inputs as Record<string, IField>)) {
      // Expression-driven fields serialize their (small) expression source, so include
      // them even when reference connections have populated `subscriptions`
      const isDriven =
        'expression' in field && (field as { expression: string | null }).expression !== null
      if (
        !isDriven &&
        'subscriptions' in field &&
        (field as { subscriptions: Map<unknown, unknown> }).subscriptions.size > 0
      )
        continue
      inputs[name] = field.serialize()
    }
    state[op.id] = inputs
    const ui = captureNodeUIMetadata(op.inputs)
    if (ui) uiState[op.id] = ui
  }
  if (Object.keys(uiState).length > 0) state[UI_STATE_KEY] = uiState
  debugHistorySnapshot('Captured operator inputs for %d ops', ops.length)
  try {
    return JSON.stringify(state)
  } catch {
    debugHistory('Failed to serialize state for property history')
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
  const uiState = data[UI_STATE_KEY] as Record<string, NodeUIMetadata> | undefined
  for (const [id, inputs] of Object.entries(data)) {
    if (id === UI_STATE_KEY) continue
    const op = store.getOp(id as OpId)
    if (!op) continue
    const opInputs = op.inputs as Record<string, IField>
    for (const [name, value] of Object.entries(inputs)) {
      const field = opInputs[name]
      if (field) {
        // Routes { $expr } payloads to setExpression, plain values to setValue
        applySerializedFieldValue(field as Field, value)
      }
    }
    applyNodeUIMetadata(op.inputs, uiState?.[id])
  }
}

// Records a property mutation to the undo/redo history. Captures the "after" state
// and calls the registered callback with both before and after. Skips if state is unchanged.
// Returns whether a mutation was recorded. Mirrors fireTimelineMutation() in timeline-store.ts.
export function firePropertyMutation(description: string, before: string | null): boolean {
  if (before === null) return false
  const after = captureOperatorInputs()
  if (after === null || before === after) return false
  // Covers edits that never fire a DOM input event, such as dragging a number field
  dismissStarterHint()
  if (!_propertyMutationCallback) return false
  _lastCommittedBeforeState = before
  debugHistorySnapshot('Firing property mutation: %s', description)
  _propertyMutationCallback(description, before, after)
  return true
}

export function getLastCommittedBeforeState(): string | null {
  return _lastCommittedBeforeState
}

function serializeScopedField(field: object | undefined): string | undefined {
  const serialize = (field as { serialize?: () => unknown } | undefined)?.serialize
  if (typeof serialize !== 'function') return undefined
  try {
    return JSON.stringify(serialize.call(field))
  } catch {
    return undefined
  }
}

// React hook that provides captureStart/commitChange for use in field components.
// Call captureStart() at the beginning of a user interaction (focus, drag start).
// Call commitChange(description) when the interaction ends (blur, drag end, close).
// A commit that changed something inside a FieldEditScope also counts as a user field edit.
export function usePropertyHistory() {
  const beforeRef = useRef<string | null>(null)
  // Read through a ref so commitChange keeps a stable identity (the code editor binds it once)
  const scope = useFieldEditScope()
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  // The scoped field's own value at captureStart, so a commit only counts as an edit of
  // that field when it changed. Other inputs can change while it is focused (keyframe
  // playback, upstream connections) and still make the whole snapshot differ.
  const fieldBeforeRef = useRef<string | undefined>(undefined)

  const captureStart = useCallback(() => {
    beforeRef.current = captureOperatorInputs()
    fieldBeforeRef.current = serializeScopedField(scopeRef.current?.field)
  }, [])

  const commitChange = useCallback((description: string) => {
    if (beforeRef.current) {
      const changed = firePropertyMutation(description, beforeRef.current)
      beforeRef.current = null
      const scope = scopeRef.current
      // Node widgets without a field (ramp stops, histogram brush) fall back to the snapshot
      const fieldChanged =
        !scope?.field || serializeScopedField(scope.field) !== fieldBeforeRef.current
      fieldBeforeRef.current = undefined
      if (changed && fieldChanged) trackFieldEdit(scope)
    }
  }, [])

  return { captureStart, commitChange }
}
