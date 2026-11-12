// Analytics for parameter values the user edits in the parameter pane.
//
// The choke point is NodeFields.write (editor/field-adapter.ts): a widget the user changed
// writes its parameter there. Project loads, keyframe playback, undo/redo and assistant edits
// reach the widgets through NodeFields.sync, which never writes, so they are never counted.
//
// Edits of the same field within FIELD_EDIT_IDLE_MS of each other are one edit burst and send
// one event, after the burst goes idle. The value, parameter name, node id and code are never
// sent.

import { analytics } from '../../utils/analytics'

export type FieldEditSource = 'node' | 'properties_panel'

export interface FieldEditScope {
  source?: FieldEditSource
  operatorType?: string
  // Any field-like object; only its constructor's static `type` is read
  field?: object
}

interface FieldEditInfo {
  fieldType: string
  operatorType: string
  source: FieldEditSource
}

export const FIELD_EDIT_IDLE_MS = 1000

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

// Records one user edit. Restarts the field's idle timer, so a burst sends one event.
export function trackFieldEdit(scope: FieldEditScope | null) {
  if (!scope?.source) return
  // Edits to a pane editor's own widgets (ramp stops, a table) have no field; key them by scope
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
