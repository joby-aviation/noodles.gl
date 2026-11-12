// The plan is planner internals: only in debug mode, even in an area left open
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { docStore } from './doc-store'
import { PlanView } from './plan-view'
import { EDITORS } from './workspace'

describe('PlanView', () => {
  afterEach(() => {
    cleanup()
    docStore().set({ debug: false })
  })

  it('shows the plan only in debug mode', () => {
    docStore().set({ debug: false })
    render(<PlanView />)
    expect(screen.getByText(/Turn on Show editor debug info/)).toBeTruthy()
    act(() => docStore().set({ debug: true }))
    expect(screen.queryByText(/Turn on Show editor debug info/)).toBeNull()
  })

  it('is offered as an editor only in debug mode', () => {
    expect(EDITORS.find(e => e.type === 'plan')?.debug).toBe(true)
  })
})
