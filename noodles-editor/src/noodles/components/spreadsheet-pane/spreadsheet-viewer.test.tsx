import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpreadsheetViewer } from './spreadsheet-viewer'

// CSS modules
vi.mock('./spreadsheet-viewer.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => String(prop) }),
}))

// @tanstack/react-virtual needs a scroll container with measurable height
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => {
    const size = estimateSize()
    const items = Array.from({ length: count }, (_, i) => ({
      index: i,
      start: i * size,
      end: (i + 1) * size,
      size,
      key: i,
      lane: 0,
    }))
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * size,
    }
  },
}))

const SAMPLE_DATA = [
  { id: 1, name: 'Alice', active: true, score: 3.14 },
  { id: 2, name: 'Bob', active: false, score: 2.71 },
  { id: 3, name: 'Carol', active: true, score: 1.41 },
]

describe('SpreadsheetViewer', () => {
  afterEach(() => cleanup())

  describe('empty / non-tabular data', () => {
    it('shows "Not an array" for non-array data', () => {
      render(<SpreadsheetViewer data={{ foo: 'bar' }} operatorId="/op" />)
      expect(screen.getByText('Not an array')).toBeTruthy()
    })

    it('shows "Empty array" for empty array', () => {
      render(<SpreadsheetViewer data={[]} operatorId="/op" />)
      expect(screen.getByText('Empty array')).toBeTruthy()
    })

    it('shows "Not tabular" for array of primitives', () => {
      render(<SpreadsheetViewer data={[1, 2, 3]} operatorId="/op" />)
      expect(screen.getByText(/not tabular/i)).toBeTruthy()
    })

    it('shows null data as empty array message', () => {
      render(<SpreadsheetViewer data={null} operatorId="/op" />)
      expect(screen.getByText('Not an array')).toBeTruthy()
    })
  })

  describe('table rendering', () => {
    it('renders column headers from data keys', () => {
      render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op" />)
      expect(screen.getByText('id')).toBeTruthy()
      expect(screen.getByText('name')).toBeTruthy()
      expect(screen.getByText('active')).toBeTruthy()
      expect(screen.getByText('score')).toBeTruthy()
    })

    it('renders row count in toolbar', () => {
      render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op" />)
      expect(screen.getByText('3 rows')).toBeTruthy()
    })

    it('renders string values correctly', () => {
      render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op" />)
      expect(screen.getByText('Alice')).toBeTruthy()
      expect(screen.getByText('Bob')).toBeTruthy()
    })

    it('renders boolean true as ✓ and false as ✗', () => {
      render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op" />)
      const checks = screen.getAllByText('✓')
      const crosses = screen.getAllByText('✗')
      expect(checks.length).toBeGreaterThan(0)
      expect(crosses.length).toBeGreaterThan(0)
    })

    it('renders float numbers with 2 decimal places', () => {
      render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op" />)
      expect(screen.getByText('3.14')).toBeTruthy()
      expect(screen.getByText('2.71')).toBeTruthy()
    })

    it('renders integers without decimal places', () => {
      render(<SpreadsheetViewer data={[{ count: 42 }]} operatorId="/op" />)
      expect(screen.getByText('42')).toBeTruthy()
      // No "42.00"
      expect(screen.queryByText('42.00')).toBeNull()
    })
  })

  describe('column visibility', () => {
    it('shows filter button', () => {
      render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op" />)
      // The pi-filter button
      const btn = screen.getByTitle('Toggle columns')
      expect(btn).toBeTruthy()
    })

    it('opens column visibility menu on filter click', () => {
      render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op" />)
      fireEvent.click(screen.getByTitle('Toggle columns'))
      // All column names should appear in the menu checkboxes
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes.length).toBe(4) // id, name, active, score
    })

    it('hides a column when its checkbox is unchecked', () => {
      render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op" />)
      fireEvent.click(screen.getByTitle('Toggle columns'))
      const checkboxes = screen.getAllByRole('checkbox')
      // Uncheck 'name' column (index 1)
      fireEvent.click(checkboxes[1])
      // 'Alice' etc. should no longer be in the table cells
      expect(screen.queryByText('Alice')).toBeNull()
    })
  })

  describe('operator switching', () => {
    it('resets column visibility when operatorId changes', () => {
      const { rerender } = render(<SpreadsheetViewer data={SAMPLE_DATA} operatorId="/op-a" />)
      // Hide the 'name' column
      fireEvent.click(screen.getByTitle('Toggle columns'))
      const checkboxes = screen.getAllByRole('checkbox')
      fireEvent.click(checkboxes[1]) // hide 'name'
      expect(screen.queryByText('Alice')).toBeNull()
      // Close the menu
      fireEvent.click(screen.getByTitle('Toggle columns'))

      // Switch operator
      rerender(
        <SpreadsheetViewer
          data={[{ city: 'NYC', pop: 8000000 }]}
          operatorId="/op-b"
        />
      )
      // New columns visible — 'city' should appear in the header
      expect(screen.getByRole('columnheader', { name: 'city' })).toBeTruthy()
      expect(screen.getByText('NYC')).toBeTruthy()
    })
  })

  describe('formatCellValue edge cases', () => {
    it('renders null cells as empty string', () => {
      render(
        <SpreadsheetViewer
          data={[{ value: null }, { value: 'hello' }]}
          operatorId="/op"
        />
      )
      // 'hello' should be there, no crash on null
      expect(screen.getByText('hello')).toBeTruthy()
    })

    it('renders objects as JSON', () => {
      render(
        <SpreadsheetViewer
          data={[{ meta: { x: 1 } }]}
          operatorId="/op"
        />
      )
      expect(screen.getByText('{"x":1}')).toBeTruthy()
    })
  })
})
