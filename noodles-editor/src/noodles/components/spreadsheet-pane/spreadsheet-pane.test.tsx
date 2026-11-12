import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeRows } from '../../../editor/node-rows'

const storeState = {
  pinnedSpreadsheetNodeId: null as string | null,
}
const mockSetPinnedNodeId = vi.fn((id: string | null) => {
  storeState.pinnedSpreadsheetNodeId = id
})

vi.mock('../../../editor/ui-store', () => ({
  useUIStore: (
    selector: (
      s: typeof storeState & { setPinnedSpreadsheetNodeId: typeof mockSetPinnedNodeId }
    ) => unknown
  ) => selector({ ...storeState, setPinnedSpreadsheetNodeId: mockSetPinnedNodeId }),
}))

let rows: NodeRows = {}
const useNodeRows = vi.fn((_id: string | null) => rows)
vi.mock('../../../editor/node-rows', () => ({
  useNodeRows: (id: string | null) => useNodeRows(id),
}))

vi.mock('./spreadsheet-pane.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => String(prop) }),
}))

vi.mock('./spreadsheet-viewer', () => ({
  SpreadsheetViewer: ({ operatorId, data }: { operatorId: string; data: unknown }) => (
    <div data-testid="spreadsheet-viewer">
      {operatorId}:{Array.isArray(data) ? data.length : 0}
    </div>
  ),
}))

import { SpreadsheetPane } from './spreadsheet-pane'

describe('SpreadsheetPane', () => {
  beforeEach(() => {
    storeState.pinnedSpreadsheetNodeId = null
    rows = {}
    useNodeRows.mockClear()
    mockSetPinnedNodeId.mockClear()
  })

  afterEach(() => cleanup())

  it('shows empty state when no node or several are selected', () => {
    render(<SpreadsheetPane selectedNodeIds={['/a', '/b']} />)
    expect(screen.getByText('Select a node to view its data')).toBeTruthy()
    expect(useNodeRows).toHaveBeenLastCalledWith(null)
  })

  it("shows the node's rows, by name, with how many there are in all", () => {
    rows = { name: 'quakes', data: [{ a: 1 }, { a: 2 }], total: 900 }
    render(<SpreadsheetPane selectedNodeIds={['n1']} />)
    expect(useNodeRows).toHaveBeenLastCalledWith('n1')
    expect(screen.getByTestId('spreadsheet-viewer').textContent).toBe('n1:2')
    expect(screen.getByText('quakes · first 2 of 900')).toBeTruthy()
  })

  it('shows why a node has no rows', () => {
    rows = { name: 'dots', error: 'No outputs available' }
    render(<SpreadsheetPane selectedNodeIds={['n1']} />)
    expect(screen.getByText('No outputs available')).toBeTruthy()
  })

  it('clears a pinned node that was deleted', () => {
    storeState.pinnedSpreadsheetNodeId = '/gone'
    rows = { error: 'Node not found' }
    render(<SpreadsheetPane selectedNodeIds={[]} />)
    expect(mockSetPinnedNodeId).toHaveBeenCalledWith(null)
  })

  describe('pin/unpin', () => {
    it('pins the targeted node', () => {
      rows = { name: 'quakes', data: [] }
      render(<SpreadsheetPane selectedNodeIds={['n1']} />)
      fireEvent.click(screen.getByTitle('Pin current operator'))
      expect(mockSetPinnedNodeId).toHaveBeenCalledWith('n1')
    })

    it('unpins a pinned node', () => {
      storeState.pinnedSpreadsheetNodeId = 'n1'
      rows = { name: 'quakes', data: [] }
      render(<SpreadsheetPane selectedNodeIds={[]} />)
      fireEvent.click(screen.getByTitle('Unpin'))
      expect(mockSetPinnedNodeId).toHaveBeenCalledWith(null)
    })
  })
})
