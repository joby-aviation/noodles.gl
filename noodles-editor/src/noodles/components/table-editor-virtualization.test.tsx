import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableEditorOp } from '../operators'
import type { TableSchema } from '../table-schema'
import { TableEditor } from './table-editor'

const virtualizerSpies = vi.hoisted(() => ({ scrollToIndex: vi.fn() }))

vi.mock('@tanstack/react-virtual', async () => {
  const React = await import('react')
  return {
    useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => {
      const [firstVisible, setFirstVisible] = React.useState(0)
      const visibleCount = Math.min(20, count)
      const size = estimateSize()
      const lastStart = Math.max(0, count - visibleCount)
      const start = Math.min(firstVisible, lastStart)
      return {
        getVirtualItems: () =>
          Array.from({ length: visibleCount }, (_, offset) => {
            const index = start + offset
            return {
              index,
              key: index,
              start: index * size,
              end: (index + 1) * size,
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
        <TableEditor
          op={new TableEditorOp('/virtual-table')}
          data={data}
          schema={schema}
          onDataChange={vi.fn()}
          onSchemaChange={vi.fn()}
        />
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
        op={new TableEditorOp('/virtual-table')}
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
})
