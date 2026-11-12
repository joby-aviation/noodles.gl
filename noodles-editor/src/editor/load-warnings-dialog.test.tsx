import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LoadWarningsDialog } from './load-warnings-dialog'
import { getUIStore } from './ui-store'

describe('LoadWarningsDialog', () => {
  afterEach(() => {
    cleanup()
    getUIStore().setLoadWarnings([])
  })

  it('lists what a conversion dropped, and closes', () => {
    render(<LoadWarningsDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() =>
      getUIStore().setLoadWarnings([
        '/k: dropped NumberOp; nothing drawn reads it',
        'timeline: keyframes on /k.par.val are not converted',
      ])
    )
    expect(screen.getByText('Converted from an older project')).toBeTruthy()
    expect(screen.getByText(/2 parts didn't carry over/)).toBeTruthy()
    expect(screen.getByText('/k: dropped NumberOp; nothing drawn reads it')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getUIStore().loadWarnings).toEqual([])
  })

  it('shows twenty and counts the rest', () => {
    render(<LoadWarningsDialog />)
    act(() => getUIStore().setLoadWarnings(Array.from({ length: 25 }, (_, i) => `warning ${i}`)))
    expect(screen.getByText('…and 5 more')).toBeTruthy()
  })
})
