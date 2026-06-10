import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../error-boundary'

vi.mock('../error-boundary.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => prop }),
}))

// Throws every time it renders
function AlwaysThrow() {
  throw new Error('Test crash')
}

// Throws when shouldThrow is true, renders normally otherwise
function MaybeThrow({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test crash')
  return <div>Recovered</div>
}

describe('ErrorBoundary', () => {
  let originalConsoleError: typeof console.error

  beforeEach(() => {
    originalConsoleError = console.error
    // suppress React's error boundary noise in test output
    console.error = vi.fn()
  })

  afterEach(() => {
    console.error = originalConsoleError
    cleanup()
  })

  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Normal content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Normal content')).toBeInTheDocument()
  })

  it('shows error UI with Reset button when a child throws', () => {
    render(
      <ErrorBoundary>
        <AlwaysThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText(/Node Graph Error/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reset/ })).toBeInTheDocument()
  })

  it('shows Undo Last Change button when onUndo is provided and child has crashed', () => {
    render(
      <ErrorBoundary onUndo={vi.fn()}>
        <AlwaysThrow />
      </ErrorBoundary>
    )
    expect(screen.getByRole('button', { name: 'Undo Last Change' })).toBeInTheDocument()
  })

  it('does not show Undo Last Change button when onUndo is not provided', () => {
    render(
      <ErrorBoundary>
        <AlwaysThrow />
      </ErrorBoundary>
    )
    expect(screen.queryByRole('button', { name: 'Undo Last Change' })).not.toBeInTheDocument()
  })

  it('calls onUndo when Undo Last Change is clicked', () => {
    const onUndo = vi.fn()
    render(
      <ErrorBoundary onUndo={onUndo}>
        <AlwaysThrow />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo Last Change' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('remounts children after clicking Undo Last Change', () => {
    const onUndo = vi.fn()
    const { rerender } = render(
      <ErrorBoundary onUndo={onUndo}>
        <MaybeThrow shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText(/Node Graph Error/)).toBeInTheDocument()
    // Simulate the undo fixing the underlying state before the boundary resets
    rerender(
      <ErrorBoundary onUndo={onUndo}>
        <MaybeThrow shouldThrow={false} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo Last Change' }))
    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })

  it('remounts children after clicking Reset', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <MaybeThrow shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText(/Node Graph Error/)).toBeInTheDocument()
    rerender(
      <ErrorBoundary>
        <MaybeThrow shouldThrow={false} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }))
    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })

  it('does not call onUndo when Reset is clicked', () => {
    const onUndo = vi.fn()
    render(
      <ErrorBoundary onUndo={onUndo}>
        <AlwaysThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText(/Node Graph Error/)).toBeInTheDocument()
    // AlwaysThrow will crash again after reset, but we only care that onUndo wasn't called
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }))
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('shows Refresh Page button and Undo when max resets is reached', () => {
    // maxResets=1 means after 1 crash within the timeout window, the limit is reached
    const onUndo = vi.fn()
    render(
      <ErrorBoundary onUndo={onUndo} maxResets={0}>
        <AlwaysThrow />
      </ErrorBoundary>
    )
    // Reset button replaced by Refresh Page
    expect(screen.queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refresh Page/ })).toBeInTheDocument()
    // Undo still shown
    expect(screen.getByRole('button', { name: 'Undo Last Change' })).toBeInTheDocument()
  })
})
