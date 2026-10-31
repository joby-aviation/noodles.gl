import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TableSchema } from '../table-schema'
import { TableEditor } from './table-editor'

const virtualizerSpies = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  setFirstVisible: undefined as ((value: number) => void) | undefined,
}))

vi.mock('@tanstack/react-virtual', async () => {
  const React = await import('react')
  return {
    useVirtualizer: ({
      count,
      estimateSize,
      scrollMargin = 0,
    }: {
      count: number
      estimateSize: () => number
      scrollMargin?: number
    }) => {
      const [firstVisible, setFirstVisible] = React.useState(0)
      const visibleCount = Math.min(20, count)
      const size = estimateSize()
      const lastStart = Math.max(0, count - visibleCount)
      const start = Math.min(firstVisible, lastStart)
      virtualizerSpies.setFirstVisible = setFirstVisible
      return {
        getVirtualItems: () =>
          Array.from({ length: visibleCount }, (_, offset) => {
            const index = start + offset
            return {
              index,
              key: index,
              start: index * size + scrollMargin,
              end: (index + 1) * size + scrollMargin,
              size,
              lane: 0,
            }
          }),
        getTotalSize: () => count * size,
        scrollToIndex: (index: number, options?: { align?: string }) => {
          virtualizerSpies.scrollToIndex(index, options)
          setFirstVisible(Math.max(0, Math.min(lastStart, index - Math.floor(visibleCount / 2))))
        },
      }
    },
  }
})

describe('TableEditor row virtualization', () => {
  afterEach(() => {
    cleanup()
    virtualizerSpies.scrollToIndex.mockClear()
  })

  it('mounts fewer than 50 rows and can navigate to the final row', () => {
    const schema: TableSchema = {
      columns: [{ name: 'label', type: 'string', defaultValue: '' }],
    }
    const data = Array.from({ length: 1_000 }, (_, index) => ({ label: `Row ${index + 1}` }))

    render(
      <div style={{ height: 300 }}>
        <TableEditor data={data} schema={schema} onDataChange={vi.fn()} onSchemaChange={vi.fn()} />
      </div>
    )

    expect(screen.getAllByRole('gridcell').length).toBeLessThan(50)
    expect(screen.queryByText('Row 1000')).toBeNull()

    const firstCell = screen.getByText('Row 1').closest('[role="gridcell"]') as HTMLElement
    fireEvent.keyDown(firstCell, { key: 'ArrowDown', ctrlKey: true })

    expect(virtualizerSpies.scrollToIndex).toHaveBeenCalledWith(999, { align: 'auto' })
    expect(screen.getByText('Row 1000').closest('[role="gridcell"]')).toHaveAttribute(
      'tabindex',
      '0'
    )
  })

  it('commits an active edit before a virtualized row can unmount on scroll', () => {
    const schema: TableSchema = {
      columns: [{ name: 'label', type: 'string', defaultValue: '' }],
    }
    const data = Array.from({ length: 1_000 }, (_, index) => ({ label: `Row ${index + 1}` }))
    const onDataChange = vi.fn()

    render(
      <TableEditor
        data={data}
        schema={schema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    fireEvent.doubleClick(screen.getByText('Row 1'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited first row' } })
    fireEvent.scroll(screen.getByRole('grid').parentElement as HTMLElement)

    expect(onDataChange).toHaveBeenCalledWith(
      [{ label: 'Edited first row' }, ...data.slice(1)],
      'Edit cell label'
    )
  })

  it('commits an active edit when a resize changes the mounted virtual range', () => {
    const schema: TableSchema = {
      columns: [{ name: 'label', type: 'string', defaultValue: '' }],
    }
    const data = Array.from({ length: 1_000 }, (_, index) => ({ label: `Row ${index + 1}` }))
    const onDataChange = vi.fn()

    render(
      <TableEditor
        data={data}
        schema={schema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    fireEvent.doubleClick(screen.getByText('Row 1'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited before resize' } })
    act(() => virtualizerSpies.setFirstVisible?.(500))

    expect(onDataChange).toHaveBeenCalledWith(
      [{ label: 'Edited before resize' }, ...data.slice(1)],
      'Edit cell label'
    )
  })

  it('parses buffered number text when a resize unmounts the edited row', () => {
    const schema: TableSchema = {
      columns: [{ name: 'amount', type: 'number', defaultValue: 0 }],
    }
    const data = Array.from({ length: 1_000 }, (_, index) => ({ amount: index + 10 }))
    const onDataChange = vi.fn()

    render(
      <TableEditor
        data={data}
        schema={schema}
        onDataChange={onDataChange}
        onSchemaChange={vi.fn()}
      />
    )

    const cell = document.querySelector<HTMLElement>(
      '[data-grid-row="0"][data-grid-column="0"]'
    ) as HTMLElement
    expect(cell).not.toBeNull()
    fireEvent.click(cell)
    fireEvent.keyDown(cell, { key: '.' })
    const editor = screen.getByRole('spinbutton', { name: 'Edit amount' })
    fireEvent.change(editor, { target: { value: '0' } })
    fireEvent.change(editor, { target: { value: '05' } })
    act(() => virtualizerSpies.setFirstVisible?.(500))

    expect(onDataChange).toHaveBeenCalledWith(
      [{ amount: 0.05 }, ...data.slice(1)],
      'Edit cell amount'
    )
  })

  it.each([
    ['vec2', [10, 20], 'X', [0, 20]],
    ['point2d', [10, 20], 'Longitude', [0, 20]],
    ['vec3', [10, 20, 30], 'X', [0, 20, 30]],
    ['point3d', [10, 20, 30], 'Longitude', [0, 20, 30]],
  ] as const)(
    'commits a cleared %s component when a resize unmounts the edited row',
    (type, initialValue, inputName, expectedValue) => {
      const schema: TableSchema = {
        columns: [{ name: 'position', type, defaultValue: initialValue }],
      }
      const data = Array.from({ length: 1_000 }, () => ({ position: initialValue }))
      const onDataChange = vi.fn()

      render(
        <TableEditor
          data={data}
          schema={schema}
          onDataChange={onDataChange}
          onSchemaChange={vi.fn()}
        />
      )

      const cell = document.querySelector<HTMLElement>(
        '[data-grid-row="0"][data-grid-column="0"]'
      ) as HTMLElement
      fireEvent.doubleClick(cell)
      fireEvent.change(screen.getByRole('spinbutton', { name: inputName }), {
        target: { value: '' },
      })
      act(() => virtualizerSpies.setFirstVisible?.(500))

      expect(onDataChange).toHaveBeenCalledWith(
        [{ position: expectedValue }, ...data.slice(1)],
        'Edit cell position'
      )
    }
  )

  it('keeps the grid focused and keyboard-reachable when the active row unmounts', () => {
    const schema: TableSchema = {
      columns: [{ name: 'label', type: 'string', defaultValue: '' }],
    }
    const data = Array.from({ length: 1_000 }, (_, index) => ({ label: `Row ${index + 1}` }))

    render(
      <TableEditor data={data} schema={schema} onDataChange={vi.fn()} onSchemaChange={vi.fn()} />
    )

    const firstCell = screen.getByText('Row 1').closest('[role="gridcell"]') as HTMLElement
    firstCell.focus()
    expect(firstCell).toHaveFocus()

    act(() => virtualizerSpies.setFirstVisible?.(500))

    const grid = screen.getByRole('grid')
    expect(grid).toHaveAttribute('tabindex', '0')
    expect(grid).toHaveFocus()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(virtualizerSpies.scrollToIndex).toHaveBeenCalledWith(1, { align: 'auto' })
    expect(screen.getByText('Row 2').closest('[role="gridcell"]')).toHaveFocus()
  })

  it('scrolls an unmounted active cell into view before keyboard editing', () => {
    const schema: TableSchema = {
      columns: [{ name: 'label', type: 'string', defaultValue: '' }],
    }
    const data = Array.from({ length: 1_000 }, (_, index) => ({ label: `Row ${index + 1}` }))

    render(
      <TableEditor data={data} schema={schema} onDataChange={vi.fn()} onSchemaChange={vi.fn()} />
    )

    const firstCell = screen.getByText('Row 1').closest('[role="gridcell"]') as HTMLElement
    firstCell.focus()
    act(() => virtualizerSpies.setFirstVisible?.(500))
    const grid = screen.getByRole('grid')
    expect(grid).toHaveFocus()

    fireEvent.keyDown(grid, { key: 'Z' })

    expect(virtualizerSpies.scrollToIndex).toHaveBeenCalledWith(0, { align: 'auto' })
    expect(screen.getByRole('textbox')).toHaveValue('Z')
  })
})
