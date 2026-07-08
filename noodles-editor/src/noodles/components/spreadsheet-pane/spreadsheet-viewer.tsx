import {
  type SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnSchema } from '../../table-schema'
import { inferSchema } from '../../table-schema'
import s from './spreadsheet-viewer.module.css'

const columnHelper = createColumnHelper<Record<string, unknown>>()

export function SpreadsheetViewer({
  data,
  operatorId,
}: {
  data: unknown
  operatorId: string
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [visibilityMenuOpen, setVisibilityMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)

  // Reset sort/visibility when switching to a different operator
  useEffect(() => {
    setSorting([])
    setColumnVisibility({})
  }, [operatorId])

  const { rows, schema } = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return { rows: [], schema: null }
    if (typeof data[0] !== 'object' || data[0] === null) return { rows: [], schema: null }
    try {
      return { rows: data as Record<string, unknown>[], schema: inferSchema(data) }
    } catch {
      return { rows: [], schema: null }
    }
  }, [data])

  const columns = useMemo(() => {
    if (!schema) return []
    return schema.columns.map(col =>
      columnHelper.accessor(col.name, {
        header: col.name,
        cell: info => formatCellValue(info.getValue(), col),
      })
    )
  }, [schema])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const tableRows = table.getRowModel().rows

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 30,
    overscan: 10,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const paddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0

  // Close visibility menu when clicking outside
  useEffect(() => {
    if (!visibilityMenuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setVisibilityMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [visibilityMenuOpen])

  if (!schema || rows.length === 0) {
    return (
      <div className={s.emptyState}>
        {!Array.isArray(data)
          ? 'Not an array'
          : data.length === 0
            ? 'Empty array'
            : 'Data is not tabular (must be array of objects)'}
      </div>
    )
  }

  return (
    <div className={s.container}>
      <div className={s.toolbar}>
        <span className={s.rowCount}>{rows.length.toLocaleString()} rows</span>
        <button
          type="button"
          className={s.toolbarButton}
          onClick={() => setVisibilityMenuOpen(!visibilityMenuOpen)}
          title="Toggle columns"
        >
          <i className="pi pi-filter" />
        </button>
        {visibilityMenuOpen && (
          <div ref={menuRef} className={s.visibilityMenu}>
            {schema.columns.map(col => (
              <label key={col.name} className={s.visibilityItem}>
                <input
                  type="checkbox"
                  checked={columnVisibility[col.name] !== false}
                  onChange={e =>
                    setColumnVisibility(prev => ({ ...prev, [col.name]: e.target.checked }))
                  }
                />
                <span>{col.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div ref={tableContainerRef} className={s.tableWrapper}>
        <table className={s.table}>
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className={header.column.getCanSort() ? s.sortableHeader : undefined}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() && (
                      <i
                        className={
                          header.column.getIsSorted() === 'asc'
                            ? 'pi pi-sort-up'
                            : 'pi pi-sort-down'
                        }
                        style={{ marginLeft: '4px', fontSize: '10px' }}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: paddingTop }} />
              </tr>
            )}
            {virtualItems.map(virtualRow => {
              const row = tableRows[virtualRow.index]
              return (
                <tr key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: paddingBottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatCellValue(value: unknown, column: ColumnSchema): string {
  if (value == null) return ''

  switch (column.type) {
    case 'number':
      return typeof value === 'number'
        ? Number.isInteger(value)
          ? value.toLocaleString()
          : value.toFixed(2)
        : String(value)
    case 'boolean':
      return value ? '✓' : '✗'
    case 'color':
      return typeof value === 'string' ? value : JSON.stringify(value)
    case 'date':
    case 'dateTime':
      return String(value)
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}
