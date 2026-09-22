import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableEditorOp } from '../operators'
import { serializeTableRangeClipboard, TABLE_RANGE_CLIPBOARD_MIME } from '../table-data-clipboard'
import type { TableSchema } from '../table-schema'
import { keyboardManager } from '../utils/keyboard-manager'
import { TableEditor } from './table-editor'

const schema: TableSchema = {
  columns: [
    { name: 'name', type: 'string', defaultValue: '' },
    { name: 'count', type: 'number', defaultValue: 0 },
  ],
}

const data = [
  { name: 'Alice', count: 10 },
  { name: 'Bob', count: 20 },
]

const clipboard = {
  writeText: vi.fn<(text: string) => Promise<void>>(),
  readText: vi.fn<() => Promise<string>>(),
}

function dataTransfer(values: Record<string, string>): DataTransfer {
  return {
    getData: vi.fn((type: string) => values[type] ?? ''),
    setData: vi.fn(),
    clearData: vi.fn(),
    dropEffect: 'none',
    effectAllowed: 'all',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: Object.keys(values),
    setDragImage: vi.fn(),
  }
}

function dispatchClipboardEvent(
  target: Element,
  type: 'copy' | 'paste',
  clipboardData: DataTransfer
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })
  fireEvent(target, event)
  return event
}

function renderTable(
  overrides: {
    data?: unknown[]
    schema?: TableSchema
    onDataChange?: ReturnType<typeof vi.fn<(data: unknown[], description?: string) => void>>
    onSchemaChange?: ReturnType<typeof vi.fn<(schema: TableSchema, data?: unknown[]) => void>>
  } = {}
) {
  const onDataChange = overrides.onDataChange ?? vi.fn()
  const onSchemaChange = overrides.onSchemaChange ?? vi.fn()
  const result = render(
    <TableEditor
      op={new TableEditorOp('/clipboard-table')}
      data={overrides.data ?? data}
      schema={overrides.schema ?? schema}
      onDataChange={onDataChange}
      onSchemaChange={onSchemaChange}
      clipboard={clipboard}
    />
  )
  return { ...result, onDataChange, onSchemaChange }
}

describe('TableEditor spreadsheet clipboard', () => {
  beforeEach(() => {
    clipboard.readText.mockReset()
    clipboard.writeText.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    keyboardManager.cleanup()
  })

  it('owns copy for a selected range and writes TSV, HTML, and typed data', () => {
    const graphCopy = vi.fn()
    render(
      <div onCopy={graphCopy}>
        <TableEditor
          op={new TableEditorOp('/clipboard-table')}
          data={data}
          schema={schema}
          onDataChange={vi.fn()}
          onSchemaChange={vi.fn()}
          clipboard={clipboard}
        />
      </div>
    )

    const alice = screen.getByText('Alice').closest('[role="gridcell"]') as HTMLElement
    const ten = screen.getByText('10').closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(alice)
    fireEvent.keyDown(alice, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(ten, { key: 'ArrowDown', shiftKey: true })

    const transfer = dataTransfer({})
    dispatchClipboardEvent(ten, 'copy', transfer)

    expect(graphCopy).not.toHaveBeenCalled()
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'Alice\t10\nBob\t20')
    expect(transfer.setData).toHaveBeenCalledWith(
      'text/html',
      '<table><tbody><tr><td>Alice</td><td>10</td></tr><tr><td>Bob</td><td>20</td></tr></tbody></table>'
    )
    const richCall = vi
      .mocked(transfer.setData)
      .mock.calls.find(([type]) => type === TABLE_RANGE_CLIPBOARD_MIME)
    expect(JSON.parse(richCall?.[1] ?? '{}')).toMatchObject({
      $noodles: 'table-range',
      version: 1,
      values: [
        ['Alice', 10],
        ['Bob', 20],
      ],
    })
  })

  it('leaves native editor copy and paste alone while keeping them out of graph handlers', () => {
    const graphCopy = vi.fn()
    const graphPaste = vi.fn()
    render(
      <div onCopy={graphCopy} onPaste={graphPaste}>
        <TableEditor
          op={new TableEditorOp('/clipboard-table')}
          data={data}
          schema={schema}
          onDataChange={vi.fn()}
          onSchemaChange={vi.fn()}
          clipboard={clipboard}
        />
      </div>
    )

    fireEvent.doubleClick(screen.getByText('Alice'))
    const input = screen.getByRole('textbox')
    const transfer = dataTransfer({})
    dispatchClipboardEvent(input, 'copy', transfer)
    const pasteEvent = dispatchClipboardEvent(input, 'paste', dataTransfer({ 'text/plain': 'Z' }))

    expect(graphCopy).not.toHaveBeenCalled()
    expect(graphPaste).not.toHaveBeenCalled()
    expect(transfer.setData).not.toHaveBeenCalled()
    expect(pasteEvent.defaultPrevented).toBe(false)
  })

  it('blocks graph shortcuts while a table range owns paste', () => {
    const viewerShortcut = vi.fn()
    keyboardManager.init()
    keyboardManager.register('v', viewerShortcut)
    renderTable()

    const alice = screen.getByText('Alice').closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(alice)
    dispatchClipboardEvent(alice, 'paste', dataTransfer({ 'text/plain': 'Carol' }))
    // Releasing Command before V produces an unmodified keyup in browsers.
    fireEvent.keyUp(alice, { key: 'v' })

    expect(viewerShortcut).not.toHaveBeenCalled()
  })

  it('retries rich copy without the custom MIME before using plain text', async () => {
    const richClipboard = {
      readText: vi.fn<() => Promise<string>>(),
      writeText: vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined),
      write: vi
        .fn<(items: ClipboardItem[]) => Promise<void>>()
        .mockRejectedValueOnce(new DOMException('Unsupported type', 'NotSupportedError'))
        .mockResolvedValueOnce(undefined),
    }
    render(
      <TableEditor
        op={new TableEditorOp('/clipboard-table')}
        data={data}
        schema={schema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
        clipboard={richClipboard}
      />
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Table actions' }), {
      button: 0,
      ctrlKey: false,
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Copy All Data'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(richClipboard.write).toHaveBeenCalledTimes(2)
    const fallbackItem = richClipboard.write.mock.calls[1]?.[0][0]
    expect(fallbackItem?.types).toEqual(expect.arrayContaining(['text/plain', 'text/html']))
    expect(fallbackItem?.types).not.toContain(TABLE_RANGE_CLIPBOARD_MIME)
    expect(richClipboard.writeText).not.toHaveBeenCalled()
  })

  it('exposes range, column, and table clipboard actions', () => {
    renderTable()
    const alice = screen.getByText('Alice').closest('[role="gridcell"]') as HTMLElement
    fireEvent.contextMenu(alice)
    expect(screen.getByText('Copy', { selector: '[role="menuitem"]' })).toBeDefined()
    expect(screen.getByText('Copy with Column Names')).toBeDefined()
    expect(screen.getByText('Paste', { selector: '[role="menuitem"]' })).toBeDefined()
    expect(screen.getByText('Clear Selection')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Column actions for name' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(screen.getByText('Copy Column Values')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Table actions' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(screen.getByText('Copy All Data')).toBeDefined()
    expect(screen.getByText('Paste Data', { selector: '[role="menuitem"]' })).toBeDefined()
  })

  it('applies a lossless anchored paste and grows rows atomically', () => {
    const { onDataChange } = renderTable()
    const alice = screen.getByText('Alice').closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(alice)

    dispatchClipboardEvent(
      alice,
      'paste',
      dataTransfer({
        'text/plain': 'Carol\t30\nDora\t40\nEve\t50',
      })
    )

    expect(onDataChange).toHaveBeenCalledOnce()
    expect(onDataChange).toHaveBeenCalledWith(
      [
        { name: 'Carol', count: 30 },
        { name: 'Dora', count: 40 },
        { name: 'Eve', count: 50 },
      ],
      'Paste table data'
    )
  })

  it('anchors a paste at the top-left of an equal-sized selection', () => {
    const rows = Array.from({ length: 16 }, (_, index) => ({ value: `Original ${index + 1}` }))
    const { onDataChange } = renderTable({
      data: rows,
      schema: { columns: [{ name: 'value', type: 'string', defaultValue: '' }] },
    })
    const first = screen.getByText('Original 1').closest('[role="gridcell"]') as HTMLElement
    const eighth = screen.getByText('Original 8').closest('[role="gridcell"]') as HTMLElement

    fireEvent.pointerDown(first, { button: 0, pointerId: 1 })
    fireEvent.pointerEnter(eighth, { pointerId: 1 })
    fireEvent.pointerUp(document, { button: 0, pointerId: 1 })
    const pastedValues = Array.from({ length: 8 }, (_, index) => [`Pasted ${index + 1}`])
    const serialized = serializeTableRangeClipboard(
      [{ name: 'value', type: 'string', defaultValue: '' }],
      pastedValues
    )
    dispatchClipboardEvent(
      eighth,
      'paste',
      dataTransfer({
        'text/plain': serialized.plainText,
        [TABLE_RANGE_CLIPBOARD_MIME]: serialized.richText,
      })
    )

    expect(onDataChange).toHaveBeenCalledWith(
      [
        ...Array.from({ length: 8 }, (_, index) => ({ value: `Pasted ${index + 1}` })),
        ...rows.slice(8),
      ],
      'Paste table data'
    )
  })

  it('opens overflow preview instead of truncating pasted columns', () => {
    const { onDataChange, onSchemaChange } = renderTable()
    const count = screen.getByText('10').closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(count)
    dispatchClipboardEvent(count, 'paste', dataTransfer({ 'text/plain': '30\textra' }))

    expect(onDataChange).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Import Table Data' })).toBeDefined()
    expect(screen.getByText('1 pasted column extends beyond the table.')).toBeDefined()
    expect(screen.getByText('1 values converted')).toBeDefined()
    expect(screen.queryByRole('combobox', { name: 'Type for name' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Type for count' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Type for Column 2' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Import Data' }))

    expect(onSchemaChange).toHaveBeenCalledOnce()
    const [nextSchema, nextData] = onSchemaChange.mock.calls[0] as [TableSchema, unknown[]]
    expect(nextSchema.columns).toHaveLength(3)
    expect(nextSchema.columns[2].name).toBe('Column 2')
    expect(nextData).toEqual([
      { name: 'Alice', count: 30, 'Column 2': 'extra' },
      { name: 'Bob', count: 20, 'Column 2': '' },
    ])
  })

  it('requires explicit preview confirmation before resetting an invalid cell', () => {
    const { onDataChange, onSchemaChange } = renderTable()
    const count = screen.getByText('10').closest('[role="gridcell"]') as HTMLElement
    fireEvent.click(count)
    dispatchClipboardEvent(count, 'paste', dataTransfer({ 'text/plain': 'not-a-number' }))

    expect(onDataChange).not.toHaveBeenCalled()
    expect(screen.getByText('1 values reset')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Import and Reset' }))
    expect(onSchemaChange).toHaveBeenCalledWith(schema, [
      { name: 'Alice', count: 0 },
      { name: 'Bob', count: 20 },
    ])
  })

  it('uses Paste Data as the primary blank-table action and infers a schema in preview', async () => {
    const onSchemaChange = vi.fn()
    clipboard.readText.mockResolvedValue('name\tcount\nAlice\t10')
    renderTable({ data: [], schema: { columns: [] }, onSchemaChange })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Paste Data' }))
      await Promise.resolve()
    })

    expect(screen.getByRole('checkbox', { name: 'First row contains column names' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Type for count' })).toHaveValue('number')
    fireEvent.click(screen.getByRole('button', { name: 'Import Data' }))
    expect(onSchemaChange).toHaveBeenCalledWith(
      {
        columns: [
          { name: 'name', type: 'string', defaultValue: '' },
          { name: 'count', type: 'number', defaultValue: 0 },
        ],
      },
      [{ name: 'Alice', count: 10 }]
    )
  })

  it('offers a focused data paste catcher when clipboard permission is denied', async () => {
    clipboard.readText.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    renderTable({ data: [], schema: { columns: [] } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Paste Data' }))
      await Promise.resolve()
    })

    const pasteTarget = screen.getByRole('textbox', { name: 'Paste table data' })
    act(() => vi.runOnlyPendingTimers())
    expect(pasteTarget).toHaveFocus()
  })
})
