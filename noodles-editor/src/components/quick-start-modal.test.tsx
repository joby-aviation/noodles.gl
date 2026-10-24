import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import cities from '../noodles/components/tools/__fixtures__/csv-drop/cities-lat-lng.csv?raw'
import sales from '../noodles/components/tools/__fixtures__/csv-drop/sales-no-coordinates.csv?raw'
import {
  getPendingQuickStartAction,
  planQuickStartAction,
  QuickStartModal,
} from './quick-start-modal'

const navigate = vi.fn()
vi.mock('wouter', () => ({ useLocation: () => ['/', navigate] }))
vi.mock('./projects-view', () => ({
  ProjectsView: () => null,
  prepareProjectOpen: () => Promise.resolve(),
  useRecentProjects: () => [],
}))

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

  it('keeps the AI path as a secondary action that still imports the file', async () => {
    render(<QuickStartModal open onOpenChange={() => {}} />)
    const file = dropFile('cities.csv', cities)

    await vi.waitFor(() => screen.getByRole('button', { name: 'Open with the AI assistant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open with the AI assistant' }))

    expect(getPendingQuickStartAction()).toEqual({ type: 'file', file, mode: 'chat' })
    expect(navigate).toHaveBeenCalledWith('/projects/new')
  })

  it('imports a CSV without coordinates instead of leaving it behind', async () => {
    render(<QuickStartModal open onOpenChange={() => {}} />)
    const file = dropFile('sales.csv', sales)

    await vi.waitFor(() => screen.getByText(/No latitude\/longitude or geometry column found/))
    expect(screen.queryByRole('button', { name: 'Show on map' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open in editor' }))

    expect(getPendingQuickStartAction()).toEqual({ type: 'file', file, mode: 'map' })
    expect(navigate).toHaveBeenCalledWith('/projects/new')
  })

  it('offers the AI assistant for a CSV without coordinates', async () => {
    render(<QuickStartModal open onOpenChange={() => {}} />)
    dropFile('sales.csv', sales)

    await vi.waitFor(() => screen.getByRole('button', { name: 'Ask AI to map it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI to map it' }))

    expect(getPendingQuickStartAction()?.mode).toBe('chat')
    expect(navigate).toHaveBeenCalledWith('/projects/new')
  })

  it('accepts the binary formats the canvas accepts', async () => {
    render(<QuickStartModal open onOpenChange={() => {}} />)
    const file = dropFile('trips.parquet', 'PAR1')

    fireEvent.click(await screen.findByRole('button', { name: 'Show on map' }))

    expect(screen.queryByText(/Please upload/)).toBeNull()
    expect(getPendingQuickStartAction()).toEqual({ type: 'file', file, mode: 'map' })
  })

  it('rejects a format nothing can import', () => {
    render(<QuickStartModal open onOpenChange={() => {}} />)
    dropFile('notes.txt', 'hello')

    expect(screen.getByText(/Please upload a CSV/)).toBeTruthy()
    expect(getPendingQuickStartAction()).toBeNull()
  })

  it('opens the smallest featured example when closed without a choice', () => {
    render(<QuickStartModal open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(navigate).toHaveBeenCalledWith('/examples/california-earthquakes')
  })
})

// The editor runs this plan once the new project loads (noodles.tsx)
describe('planQuickStartAction', () => {
  const file = new File(['a,b\n1,2'], 'sales.csv', { type: 'text/csv' })

  it('imports the file and opens the assistant on the AI path', () => {
    expect(planQuickStartAction({ type: 'file', file, mode: 'chat' })).toEqual({
      importFile: file,
      chatMessage: 'I imported "sales.csv" into this project. Help me make a map from it.',
      event: 'quick_start_file_action_handled',
      mode: 'chat',
    })
  })

  it('imports the file without the assistant on the map path', () => {
    const plan = planQuickStartAction({ type: 'file', file, mode: 'map' })
    expect(plan?.importFile).toBe(file)
    expect(plan?.chatMessage).toBeUndefined()
  })

  it('opens the assistant with the question and nothing to import', () => {
    expect(planQuickStartAction({ type: 'llm', question: 'Map earthquakes' })).toEqual({
      chatMessage: 'Map earthquakes',
      event: 'quick_start_llm_action_handled',
    })
  })
})
