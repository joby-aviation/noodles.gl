import {
  type SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnSchema } from '../../table-schema'
import { inferSchema } from '../../table-schema'
import s from './spreadsheet-viewer.module.css'

const columnHelper = createColumnHelper<Record<string, unknown>>()

export function SpreadsheetViewer({ data }: { data: unknown }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [visibilityMenuOpen, setVisibilityMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Validate data is array of objects
  const { rows, schema } = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) {
      return { rows: [], schema: null }
    }

    const firstRow = data[0]
    if (typeof firstRow !== 'object' || firstRow === null) {
      return { rows: [], schema: null }
    }

    try {
      const inferredSchema = inferSchema(data)
      return { rows: data, schema: inferredSchema }
    } catch {
      return { rows: [], schema: null }
    }
  }, [data])

  // Build columns from schema
  const columns = useMemo(() => {
    if (!schema) return []

    return schema.columns.map(col =>
      columnHelper.accessor(col.name, {
        header: col.name,
        cell: info => {
          const value = info.getValue()
          return formatCellValue(value, col)
        },
      })
    )
  }, [schema])

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

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
        <span className={s.rowCount}>{rows.length} rows</span>
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
                    setColumnVisibility(prev => ({
                      ...prev,
                      [col.name]: e.target.checked,
                    }))
                  }
                />
                <span>{col.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className={s.tableWrapper}>
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
                          header.column.getIsSorted() === 'asc' ? 'pi pi-sort-up' : 'pi pi-sort-down'
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
            {table.getRowModel().rows.map(row => (
              <tr key={row.id}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
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
          ? String(value)
          : value.toFixed(2)
        : String(value)
    case 'boolean':
      return value ? '✓' : ''
    case 'color':
      return typeof value === 'string' ? value : JSON.stringify(value)
    case 'date':
    case 'dateTime':
      return String(value)
    default:
      if (typeof value === 'object') {
        return JSON.stringify(value)
      }
      return String(value)
  }
}
