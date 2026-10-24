import type { EditorDoc } from '@noodles.gl/planner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIELD_EDIT_IDLE_MS,
  flushFieldEdits,
  trackFieldEdit,
} from '../noodles/utils/field-edit-analytics'
import { analytics } from '../utils/analytics'
import { DocStore } from './doc-store'
import { NodeFields } from './field-adapter'

vi.mock('../utils/analytics', () => ({ analytics: { track: vi.fn() } }))

const track = vi.mocked(analytics.track)

const doc = (): EditorDoc => ({
  version: 1,
  name: 'p',
  nodes: [{ id: 'n1', op: 'number', name: 'size', x: 0, y: 0, params: { value: 1 } }],
  edges: [],
})

describe('field_value_changed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    track.mockClear()
  })

  afterEach(() => {
    flushFieldEdits()
    vi.useRealTimers()
  })

  it('sends one event per field after the edit burst goes idle', () => {
    const field = {}
    const scope = { source: 'properties_panel' as const, operatorType: 'number', field }
    for (let i = 0; i < 20; i++) {
      trackFieldEdit(scope)
      vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS / 2)
    }
    expect(track).not.toHaveBeenCalled()
    vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS)
    expect(track).toHaveBeenCalledTimes(1)
    trackFieldEdit(scope)
    vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS)
    expect(track).toHaveBeenCalledTimes(2)
  })

  it('ignores edits with no source', () => {
    trackFieldEdit(null)
    trackFieldEdit({ operatorType: 'number' })
    flushFieldEdits()
    expect(track).not.toHaveBeenCalled()
  })

  it('counts a widget edit in the pane, not a value the document brings in', () => {
    const store = new DocStore(doc())
    const fields = new NodeFields(store, store.get().doc.nodes[0])
    const field = fields.bindings.get('value')?.field
    // An undo, a load or playback reaches the widget through sync
    fields.sync({ ...store.get().doc.nodes[0], params: { value: 5 } })
    flushFieldEdits()
    expect(track).not.toHaveBeenCalled()

    field?.setValue(7 as never)
    expect(store.get().doc.nodes[0].params.value).toBe(7)
    vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS)
    expect(track.mock.calls).toEqual([
      [
        'field_value_changed',
        { fieldType: 'number', operatorType: 'number', source: 'properties_panel' },
      ],
    ])
    fields.dispose()
  })
})
