import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '../../utils/analytics'
import {
  CanvasQuickstart,
  CanvasQuickstartButton,
  canvasQuickstartDismissed,
  initialQuickstartState,
  useCanvasQuickstart,
} from './canvas-quickstart'

vi.mock('../../utils/analytics', () => ({ analytics: { track: vi.fn() } }))

// Resets the store the way a page load starts it, reading the saved preference
function renderQuickstart() {
  useCanvasQuickstart.setState(initialQuickstartState())
  render(
    <ReactFlowProvider>
      <CanvasQuickstart />
      <CanvasQuickstartButton />
    </ReactFlowProvider>
  )
}

describe('CanvasQuickstart', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(analytics.track).mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the canvas tips on a first visit until dismissed', () => {
    renderQuickstart()
    expect(screen.getByText('Getting around')).toBeTruthy()
    expect(screen.getByText('Drag the background')).toBeTruthy()
    expect(analytics.track).toHaveBeenCalledWith('canvas_quickstart_opened', {
      trigger: 'first_visit',
    })

    fireEvent.click(screen.getByText('Got it'))
    expect(screen.queryByText('Getting around')).toBeNull()
    expect(canvasQuickstartDismissed()).toBe(true)
    expect(analytics.track).toHaveBeenCalledWith('canvas_quickstart_dismissed')
  })

  it('reopens from the help button after being dismissed', () => {
    renderQuickstart()
    fireEvent.click(screen.getByLabelText('Dismiss canvas tips'))
    expect(screen.queryByText('Getting around')).toBeNull()

    fireEvent.click(screen.getByLabelText('Show canvas tips'))
    expect(screen.getByText('Getting around')).toBeTruthy()
    expect(analytics.track).toHaveBeenCalledWith('canvas_quickstart_opened', {
      trigger: 'button',
    })
    // Reopening by hand keeps it dismissed for the next visit
    expect(canvasQuickstartDismissed()).toBe(true)
  })

  it('stays hidden after a reload once dismissed', () => {
    localStorage.setItem('noodles-canvas-quickstart-dismissed', '1')
    renderQuickstart()
    expect(screen.queryByText('Getting around')).toBeNull()
    expect(screen.getByLabelText('Show canvas tips')).toBeTruthy()
    expect(analytics.track).not.toHaveBeenCalled()
  })

  it('counts the first-visit showing once when the canvas remounts', () => {
    renderQuickstart()
    cleanup()
    render(
      <ReactFlowProvider>
        <CanvasQuickstart />
      </ReactFlowProvider>
    )
    expect(analytics.track).toHaveBeenCalledTimes(1)
  })
})
