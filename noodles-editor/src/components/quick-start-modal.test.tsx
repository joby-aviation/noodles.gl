import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import cities from '../noodles/components/tools/__fixtures__/csv-drop/cities-lat-lng.csv?raw'
import sales from '../noodles/components/tools/__fixtures__/csv-drop/sales-no-coordinates.csv?raw'
import { getPendingQuickStartAction, QuickStartModal } from './quick-start-modal'

const navigate = vi.fn()
vi.mock('wouter', () => ({ useLocation: () => ['/', navigate] }))
vi.mock('./projects-view', () => ({ ProjectsView: () => null, useRecentProjects: () => [] }))

function dropFile(name: string, contents: string) {
  const file = new File([contents], name, { type: 'text/csv' })
  const zone = screen.getByText('Drop your data file here').closest('[role="button"]')!
  // fireEvent copies only own properties of dataTransfer, which a real one has none of
  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(file)
  act(() => {
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  })
  return file
}

describe('QuickStartModal file drop', () => {
  // Reading the dropped file is a real browser task, which the global fake clock
  // would never let finish
  beforeEach(() => {
    vi.useRealTimers()
    navigate.mockReset()
    getPendingQuickStartAction()
  })

  afterEach(() => {
    cleanup()
    vi.useFakeTimers({ now: new Date('2025-02-01T00:00:00Z') })
  })

  it('maps a CSV with coordinates without the AI assistant', async () => {
    const onOpenChange = vi.fn()
    render(<QuickStartModal open onOpenChange={onOpenChange} />)
    const file = dropFile('cities.csv', cities)

    await vi.waitFor(() => screen.getByText('Found 24 points in lat and lng'))
    fireEvent.click(screen.getByRole('button', { name: 'Show on map' }))

    expect(getPendingQuickStartAction()).toEqual({ type: 'file', file, mode: 'map' })
    expect(navigate).toHaveBeenCalledWith('/projects/new')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the AI path as a secondary action', async () => {
    render(<QuickStartModal open onOpenChange={() => {}} />)
    dropFile('cities.csv', cities)

    await vi.waitFor(() => screen.getByRole('button', { name: 'Ask AI instead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI instead' }))

    expect(getPendingQuickStartAction()?.mode).toBe('chat')
    expect(navigate).toHaveBeenCalledWith('/examples/nyc-taxis')
  })

  it('says why a CSV without coordinates goes to the AI assistant', async () => {
    render(<QuickStartModal open onOpenChange={() => {}} />)
    dropFile('sales.csv', sales)

    await vi.waitFor(() => screen.getByText(/No latitude\/longitude or geometry column found/))
    expect(screen.queryByRole('button', { name: 'Show on map' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI to map it' }))

    expect(getPendingQuickStartAction()?.mode).toBe('chat')
    expect(navigate).toHaveBeenCalledWith('/examples/nyc-taxis')
  })
})
