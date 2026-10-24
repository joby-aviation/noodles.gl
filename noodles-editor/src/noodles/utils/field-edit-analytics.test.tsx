import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../../utils/analytics'
import { FieldComponent } from '../components/field-components'
import { NumberField } from '../fields'
import { BooleanOp } from '../operators'
import { clearOps, setOp } from '../store'
import {
  FIELD_EDIT_IDLE_MS,
  FieldEditScope,
  flushFieldEdits,
  trackFieldEdit,
} from './field-edit-analytics'
import { registerPropertyMutationCallback } from './property-history'

vi.mock('../../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

const track = vi.mocked(analytics.track)

describe('trackFieldEdit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    track.mockClear()
  })

  afterEach(() => {
    flushFieldEdits()
    vi.useRealTimers()
  })

  it('sends one event per field after the edit burst goes idle', () => {
    const field = new NumberField(1)
    const scope = { source: 'node' as const, operatorType: 'NumberOp', field }

    for (let i = 0; i < 20; i++) {
      trackFieldEdit(scope)
      vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS / 2)
    }
    expect(track).not.toHaveBeenCalled()

    vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS)
    expect(track.mock.calls).toEqual([
      ['field_value_changed', { fieldType: 'number', operatorType: 'NumberOp', source: 'node' }],
    ])

    // A later edit is a new burst
    trackFieldEdit(scope)
    vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS)
    expect(track).toHaveBeenCalledTimes(2)
  })

  it('keeps separate bursts for separate fields', () => {
    const a = new NumberField(1)
    const b = new NumberField(2)
    trackFieldEdit({ source: 'node', operatorType: 'NumberOp', field: a })
    trackFieldEdit({ source: 'properties_panel', operatorType: 'NumberOp', field: b })
    trackFieldEdit({ source: 'node', operatorType: 'NumberOp', field: a })
    vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS)

    // b went idle first: a's second edit restarted its timer
    expect(track.mock.calls).toEqual([
      [
        'field_value_changed',
        { fieldType: 'number', operatorType: 'NumberOp', source: 'properties_panel' },
      ],
      ['field_value_changed', { fieldType: 'number', operatorType: 'NumberOp', source: 'node' }],
    ])
  })

  it('ignores edits outside a scope and never sends the value', () => {
    trackFieldEdit(null)
    trackFieldEdit({ operatorType: 'NumberOp', field: new NumberField(1) })
    vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS)
    expect(track).not.toHaveBeenCalled()

    trackFieldEdit({ source: 'node', operatorType: 'RampOp' })
    flushFieldEdits()
    expect(track.mock.calls).toEqual([
      ['field_value_changed', { fieldType: 'custom', operatorType: 'RampOp', source: 'node' }],
    ])
  })
})

describe('field_value_changed from field components', () => {
  let op: BooleanOp

  beforeEach(() => {
    vi.useFakeTimers()
    track.mockClear()
    op = new BooleanOp('/toggle')
    setOp(op.id, op)
    registerPropertyMutationCallback(vi.fn())
  })

  afterEach(() => {
    cleanup()
    flushFieldEdits()
    clearOps()
    registerPropertyMutationCallback(undefined)
    vi.useRealTimers()
  })

  function renderField(wrap: (children: ReactNode) => ReactNode) {
    return render(
      <ReactFlowProvider>
        {wrap(<FieldComponent id="val" field={op.inputs.val} disabled={false} />)}
      </ReactFlowProvider>
    )
  }

  it('tracks a user edit with the field and operator type', () => {
    renderField(children => (
      <FieldEditScope source="properties_panel" operatorType="BooleanOp">
        {children}
      </FieldEditScope>
    ))

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    fireEvent.click(checkbox)
    fireEvent.click(checkbox)
    expect(track).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS))
    expect(track.mock.calls).toEqual([
      [
        'field_value_changed',
        { fieldType: 'boolean', operatorType: 'BooleanOp', source: 'properties_panel' },
      ],
    ])
  })

  it('does not track programmatic updates', () => {
    renderField(children => (
      <FieldEditScope source="node" operatorType="BooleanOp">
        {children}
      </FieldEditScope>
    ))

    // Project load, keyframe playback and upstream propagation all go through setValue
    act(() => {
      op.inputs.val.setValue(true)
      op.inputs.val.setValue(false)
      op.inputs.val.next(true)
    })
    act(() => vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS * 3))
    flushFieldEdits()
    expect(track).not.toHaveBeenCalled()
  })

  it('does not track edits outside a node or the properties panel', () => {
    renderField(children => children)
    fireEvent.click(screen.getByRole('checkbox'))
    act(() => vi.advanceTimersByTime(FIELD_EDIT_IDLE_MS))
    expect(track).not.toHaveBeenCalled()
  })
})
