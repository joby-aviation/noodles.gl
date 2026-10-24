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
import { dismissStarterHint, getAllOps, getGraphStore } from '../store'
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
  const store = getGraphStore()
  const uiState = data[UI_STATE_KEY] as Record<string, NodeUIMetadata> | undefined
  for (const [id, inputs] of Object.entries(data)) {
    if (id === UI_STATE_KEY) continue
    const op = store.getOp(id as OpId)
    if (!op) continue
    const opInputs = op.inputs as Record<string, IField>
    for (const [name, value] of Object.entries(inputs)) {
      const field = getInputField(opInputs, name)
      if (field) {
        // Routes { $expr } payloads to setExpression, plain values to setValue
        applySerializedFieldValue(field as Field, value)
      }
    }
    applyNodeUIMetadata(op.inputs, uiState?.[id])
  }
}

// Records a property mutation to the undo/redo history. Captures the "after" state unless
// one is passed and calls the registered callback with both before and after. Skips if state
// is unchanged. Returns whether a mutation was recorded. Mirrors fireTimelineMutation() in
// timeline-store.ts.
export function firePropertyMutation(
  description: string,
  before: string | null,
  afterState?: string | null
): boolean {
  if (before === null) return false
  const after = afterState === undefined ? captureOperatorInputs() : afterState
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

interface OperatorInput {
  op: { id: OpId; inputs: object }
  // Input name, then child keys down to the field (e.g. `padding.top`)
  path: string
  field: IField
}

function findFieldPath(fields: object, field: object): string[] | undefined {
  for (const [key, child] of Object.entries(fields as Record<string, object>)) {
    if (child === field) return [key]
    // Compound fields hold their children in `fields`. A list's `fields` is a Map, which has
    // no own entries, so list items aren't matched.
    const children = (child as { fields?: unknown }).fields
    if (typeof children !== 'object' || children === null) continue
    const rest = findFieldPath(children, field)
    if (rest) return [key, ...rest]
  }
  return undefined
}

// The operator input a field belongs to, down to a compound input's child
function findOperatorInput(field: object | undefined): OperatorInput | undefined {
  const op = (field as { op?: OperatorInput['op'] } | undefined)?.op
  if (!field || !op) return undefined
  const path = findFieldPath(op.inputs, field)
  return path ? { op, path: path.join('.'), field: field as IField } : undefined
}

// Resolves a snapshot key: an input name, or a dotted path to a compound input's child
function getInputField(inputs: Record<string, IField>, key: string): IField | undefined {
  if (inputs[key] || !key.includes('.')) return inputs[key]
  let field: unknown = { fields: inputs }
  for (const part of key.split('.')) {
    field = (field as { fields?: Record<string, unknown> } | undefined)?.fields?.[part]
  }
  return field as IField | undefined
}

// One field and its operator's UI state, in the snapshot format applyOperatorInputs reads.
// Only the focused field is saved, so undo leaves its siblings where playback put them.
function captureInputState({ op, path, field }: OperatorInput): string | null {
  const state: Record<string, unknown> = { [op.id]: { [path]: field.serialize() } }
  const ui = captureNodeUIMetadata(op.inputs as Record<string, unknown>)
  if (ui) state[UI_STATE_KEY] = { [op.id]: ui }
  try {
    return JSON.stringify(state)
  } catch {
    debugHistory('Failed to serialize %s.%s for property history', op.id, path)
    return null
  }
}

// React hook that provides captureStart/commitChange for use in field components.
// Call captureStart() at the beginning of a user interaction (focus, drag start).
// Call commitChange(description) when the interaction ends (blur, drag end, close).
// A commit that changed something inside a FieldEditScope also counts as a user field edit.
//
// Other inputs can change while a field is focused (keyframe playback, upstream
// connections), so when the scope names a field, the undo step holds only that field.
// Node widgets without a field (ramp stops, histogram brush) edit several
// inputs at once and record the whole snapshot.
export function usePropertyHistory() {
  const beforeRef = useRef<string | null>(null)
  // Read through a ref so commitChange keeps a stable identity (the code editor binds it once)
  const scope = useFieldEditScope()
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  // Where the scoped field sits in its operator's inputs, and its own value at captureStart
  const inputRef = useRef<OperatorInput | undefined>(undefined)
  const fieldBeforeRef = useRef<string | undefined>(undefined)

  const captureStart = useCallback(() => {
    const field = scopeRef.current?.field
    inputRef.current = findOperatorInput(field)
    beforeRef.current = inputRef.current
      ? captureInputState(inputRef.current)
      : captureOperatorInputs()
    fieldBeforeRef.current = serializeScopedField(field)
  }, [])

  const commitChange = useCallback((description: string) => {
    const before = beforeRef.current
    if (!before) return
    const input = inputRef.current
    const field = scopeRef.current?.field
    const fieldChanged = !field || serializeScopedField(field) !== fieldBeforeRef.current
    beforeRef.current = null
    inputRef.current = undefined
    fieldBeforeRef.current = undefined

    let changed = false
    if (input) changed = firePropertyMutation(description, before, captureInputState(input))
    // A scoped field outside its operator's inputs can't be isolated; record only its own edits
    else if (fieldChanged) changed = firePropertyMutation(description, before)
    if (changed && fieldChanged) trackFieldEdit(scopeRef.current)
  }, [])

  return { captureStart, commitChange }
}
