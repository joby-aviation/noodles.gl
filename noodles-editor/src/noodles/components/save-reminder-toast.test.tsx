import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SaveReminderToast } from './save-reminder-toast'

describe('SaveReminderToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not show toast initially', () => {
    const onSave = vi.fn()
    render(<SaveReminderToast hasUnsavedChanges={false} onSave={onSave} />)

    // Toast should not be visible
    expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
  })

  it('should show toast after 2 minutes with unsaved changes', async () => {
    const onSave = vi.fn()
    render(<SaveReminderToast hasUnsavedChanges={true} onSave={onSave} />)

    // Fast-forward time by 2 minutes
    vi.advanceTimersByTime(2 * 60 * 1000)

    // Toast should now be visible
    await waitFor(() => {
      expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    })
  })

  it('should not show toast before 2 minutes', () => {
    const onSave = vi.fn()
    render(<SaveReminderToast hasUnsavedChanges={true} onSave={onSave} />)

    // Fast-forward time by 1 minute
    vi.advanceTimersByTime(1 * 60 * 1000)

    // Toast should not be visible yet
    expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
  })

  it('should reset timer when changes are saved', async () => {
    const onSave = vi.fn()
    const { rerender } = render(<SaveReminderToast hasUnsavedChanges={true} onSave={onSave} />)

    // Fast-forward time by 1 minute
    vi.advanceTimersByTime(1 * 60 * 1000)

    // Save changes
    rerender(<SaveReminderToast hasUnsavedChanges={false} onSave={onSave} />)

    // Make more changes
    rerender(<SaveReminderToast hasUnsavedChanges={true} onSave={onSave} />)

    // Fast-forward by 1 minute (total would be 2 minutes from first change, but timer was reset)
    vi.advanceTimersByTime(1 * 60 * 1000)

    // Toast should not be visible yet because timer was reset
    expect(screen.queryByText('Unsaved Changes')).not.toBeInTheDocument()
  })

  it('should only show toast once per unsaved session', async () => {
    const onSave = vi.fn()
    render(<SaveReminderToast hasUnsavedChanges={true} onSave={onSave} />)

    // Fast-forward time by 2 minutes - toast appears
    vi.advanceTimersByTime(2 * 60 * 1000)

    await waitFor(() => {
      expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    })

    // Fast-forward more time - toast should not appear again
    vi.advanceTimersByTime(5 * 60 * 1000)

    // Should still only see one toast message
    expect(screen.getAllByText('Unsaved Changes')).toHaveLength(1)
  })
})
