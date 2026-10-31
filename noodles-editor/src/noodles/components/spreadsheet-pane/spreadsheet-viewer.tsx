import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnSchema } from '../../table-schema'
import { inferSchema } from '../../table-schema'
import s from './spreadsheet-viewer.module.css'

const columnHelper = createColumnHelper<Record<string, unknown>>()

/**
 * Columns grouped as the vectors they store: the planner keeps a vector as numbered component
 * columns (`magnitude_color_0, _1, _2`), shown here under the vector's own name, each component
 * by the name an expression reads it with (`magnitude_color.r`, `position.x`).
 */
export function vectorGroups(
  columns: ColumnSchema[]
): (ColumnSchema | { name: string; components: { column: ColumnSchema; label: string }[] })[] {
  const names = new Set(columns.map(c => c.name))
  const family = (name: string) => {
    const m = /^(.+)_([0-3])$/.exec(name)
    return m && !names.has(m[1]) ? { base: m[1], index: Number(m[2]) } : undefined
  }
  const counts = new Map<string, number[]>()
  for (const c of columns) {
    const f = family(c.name)
    if (f && c.type === 'number') counts.set(f.base, [...(counts.get(f.base) ?? []), f.index])
  }
  const vectors = new Set(
    [...counts]
      .filter(([, ks]) => ks.length >= 2 && ks.every((_, i) => ks.includes(i)))
      .map(([base]) => base)
  )
  const out: ReturnType<typeof vectorGroups> = []
  for (const c of columns) {
    const f = family(c.name)
    if (!f || !vectors.has(f.base) || c.type !== 'number') {
      out.push(c)
      continue
    }
    // A vector joins the list where its first component was
    if (f.index !== 0) continue
    const width = counts.get(f.base)?.length ?? 0
    const letters = /colou?r/i.test(f.base) ? 'rgba' : 'xyzw'
    out.push({
      name: f.base,
      components: Array.from({ length: width }, (_, i) => ({
        column: columns.find(x => x.name === `${f.base}_${i}`) as ColumnSchema,
        label: letters[i],
      })),
    })
  }
  return out
}

export function SpreadsheetViewer({ data, operatorId }: { data: unknown; operatorId: string }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [visibilityMenuOpen, setVisibilityMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)

  // Reset sort/visibility when switching to a different operator
  // biome-ignore lint/correctness/useExhaustiveDependencies: operatorId triggers the reset
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

  const groups = useMemo(() => (schema ? vectorGroups(schema.columns) : []), [schema])
  const columns = useMemo(
    () =>
      groups.map(g =>
        'components' in g
          ? columnHelper.group({
              id: g.name,
              header: () => (
                <span
                  title={`${g.name}: read it whole, or as ${g.name}[0] or ${g.name}.${g.components[0].label}`}
                >
                  {g.name}
                </span>
              ),
              columns: g.components.map(({ column, label }) =>
                columnHelper.accessor(column.name, {
                  header: () => (
                    <span className={s.component} title={`${g.name}.${label}`}>
                      {label}
                    </span>
                  ),
                  cell: info => formatCellValue(info.getValue(), column),
                })
              ),
            })
          : columnHelper.accessor(g.name, {
              header: g.name,
              cell: info => formatCellValue(info.getValue(), g),
            })
      ),
    [groups]
  )

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
    virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0

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
            {groups.map(g => {
              // A vector shows or hides with all its components
              const ids = 'components' in g ? g.components.map(c => c.column.name) : [g.name]
              return (
                <label key={g.name} className={s.visibilityItem}>
                  <input
                    type="checkbox"
                    checked={columnVisibility[ids[0]] !== false}
                    onChange={e =>
                      setColumnVisibility(prev => ({
                        ...prev,
                        ...Object.fromEntries(ids.map(id => [id, e.target.checked])),
                      }))
                    }
                  />
                  <span>{g.name}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>
      <div ref={tableContainerRef} className={s.tableWrapper}>
        <table className={s.table}>
          <thead>
            {table.getHeaderGroups().map((headerGroup, row, groups) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  // A column outside any vector spans the header rows from the top, drawn
                  // once where its placeholder is; a vector's name sits over its components
                  if (!header.isPlaceholder && row > 0 && !header.column.parent) return null
                  const group = header.subHeaders.length > 0
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      rowSpan={header.isPlaceholder ? groups.length - row : undefined}
                      className={
                        group
                          ? s.groupHeader
                          : header.column.getCanSort()
                            ? s.sortableHeader
                            : undefined
                      }
                      onClick={group ? undefined : header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {!group && sorted && (
                        <i
                          className={sorted === 'asc' ? 'pi pi-sort-up' : 'pi pi-sort-down'}
                          style={{ marginLeft: '4px', fontSize: '10px' }}
                        />
                      )}
                    </th>
                  )
                })}
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
