import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CanvasQuickstart,
  CanvasQuickstartButton,
  canvasQuickstartDismissed,
  useCanvasQuickstart,
} from './canvas-quickstart'

vi.mock('../../utils/analytics', () => ({ analytics: { track: vi.fn() } }))

function renderQuickstart() {
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
    useCanvasQuickstart.setState({ open: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the canvas tips until dismissed', () => {
    renderQuickstart()
    expect(screen.getByText('Getting around')).toBeTruthy()
    expect(screen.getByText('Drag the background')).toBeTruthy()

    fireEvent.click(screen.getByText('Got it'))
    expect(screen.queryByText('Getting around')).toBeNull()
    expect(canvasQuickstartDismissed()).toBe(true)
  })

  it('reopens from the help button after being dismissed', () => {
    renderQuickstart()
    fireEvent.click(screen.getByLabelText('Dismiss canvas tips'))
    expect(screen.queryByText('Getting around')).toBeNull()

    fireEvent.click(screen.getByLabelText('Show canvas tips'))
    expect(screen.getByText('Getting around')).toBeTruthy()
    // Reopening by hand keeps it dismissed for the next visit
    expect(canvasQuickstartDismissed()).toBe(true)
  })

  it('stays hidden for a returning user', () => {
    localStorage.setItem('noodles-canvas-quickstart-dismissed', '1')
    useCanvasQuickstart.setState({ open: !canvasQuickstartDismissed() })
    renderQuickstart()
    expect(screen.queryByText('Getting around')).toBeNull()
    expect(screen.getByLabelText('Show canvas tips')).toBeTruthy()
  })
})
