// Analytics for field values the user edits in a node or the properties panel.
//
// The choke point is usePropertyHistory's commitChange: field components call captureStart
// when an edit begins (focus, drag start) and commitChange when it ends (blur, drag end,
// picker close), and the commit only counts when the operator inputs actually changed.
// Project loads, keyframe playback, upstream propagation, undo/redo and AI modifications
// set field values without going through commitChange, so they are never counted.
//
// The scope (where the field is shown, which operator, which field) comes from
// FieldEditScope providers around node components, node fields and properties panel
// fields. Commits outside any scope are not tracked.
//
// Commits for the same field within FIELD_EDIT_IDLE_MS of each other are one edit burst
// and send one event, after the burst goes idle. The value, field name, node id and code
// are never sent.

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { analytics } from '../../utils/analytics'

export type FieldEditSource = 'node' | 'properties_panel'

export interface FieldEditInfo {
  fieldType: string
  operatorType: string
  source: FieldEditSource
}

interface FieldEditScopeValue {
  source?: FieldEditSource
  operatorType?: string
  // Any field-like object; only its constructor's static `type` is read
  field?: object
}

export const FIELD_EDIT_IDLE_MS = 1000

const FieldEditScopeContext = createContext<FieldEditScopeValue | null>(null)

// Nested providers fill in what their parent left out: the node or panel sets source and
// operatorType, the field component sets the field
export function FieldEditScope({
  source,
  operatorType,
  field,
  children,
}: FieldEditScopeValue & { children: ReactNode }) {
  const parent = useContext(FieldEditScopeContext)
  const value = useMemo(
    () => ({
      source: source ?? parent?.source,
      operatorType: operatorType ?? parent?.operatorType,
      field: field ?? parent?.field,
    }),
    [source, operatorType, field, parent]
  )
  return <FieldEditScopeContext.Provider value={value}>{children}</FieldEditScopeContext.Provider>
}

export function useFieldEditScope(): FieldEditScopeValue | null {
  return useContext(FieldEditScopeContext)
}

function fieldTypeOf(field: object | undefined): string {
  if (!field) return 'custom'
  const type = (field.constructor as { type?: unknown }).type
  return typeof type === 'string' ? type : 'unknown'
}

const pending = new Map<object, { info: FieldEditInfo; timer: ReturnType<typeof setTimeout> }>()

function flush(key: object) {
  const entry = pending.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(key)
  analytics.track('field_value_changed', { ...entry.info })
}

// Records one committed user edit. Called by commitChange after a mutation that changed
// the operator inputs. Restarts the field's idle timer, so a burst sends one event.
export function trackFieldEdit(scope: FieldEditScopeValue | null) {
  if (!scope?.source) return
  // Edits to a node's own widgets (ramp stops, histogram brush) have no field; key them by scope
  const key = scope.field ?? scope
  const info: FieldEditInfo = {
    fieldType: fieldTypeOf(scope.field),
    operatorType: scope.operatorType || 'unknown',
    source: scope.source,
  }
  const existing = pending.get(key)
  if (existing) clearTimeout(existing.timer)
  pending.set(key, { info, timer: setTimeout(() => flush(key), FIELD_EDIT_IDLE_MS) })
}

// Sends every pending burst now, e.g. when the page is hidden and may not come back
export function flushFieldEdits() {
  for (const key of [...pending.keys()]) flush(key)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushFieldEdits)
}
