import * as Dialog from '@radix-ui/react-dialog'
import { Button } from 'primereact/button'
import { useEffect, useMemo, useState } from 'react'
import { inferTableData, type ParsedTableDataClipboard } from '../table-data-clipboard'
import {
  type ColumnSchema,
  type ColumnType,
  getDefaultValue,
  getTableSchemaValidationError,
  type TableSchema,
} from '../table-schema'
import { coerceSchemaValue } from '../table-schema-clipboard'
import s from './table-import-dialog.module.css'

const COLUMN_TYPES: Array<{ label: string; value: ColumnType }> = [
  { label: 'Number', value: 'number' },
  { label: 'String', value: 'string' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Color', value: 'color' },
  { label: 'Point 2D', value: 'point2d' },
  { label: 'Point 3D', value: 'point3d' },
  { label: 'Vector 2D', value: 'vec2' },
  { label: 'Vector 3D', value: 'vec3' },
  { label: 'Date', value: 'date' },
  { label: 'Date & Time', value: 'dateTime' },
  { label: 'String Literal', value: 'stringLiteral' },
]

export type TableImportMode = 'blank' | 'canvas' | 'overflow'

export interface TableImportPreviewModel {
  format: string
  schema: TableSchema
  data: unknown[]
  /** Raw cells aligned with `data`, used to report import coercions accurately. */
  sourceRows?: unknown[][]
  /** Target coordinate of sourceRows[0][0] for an anchored existing-table paste. */
  sourceOrigin?: { row: number; column: number }
}

/**
 * A parser-agnostic request used by canvas, blank-table, and overflow imports.
 * `createPreview` must retain the complete payload; the dialog only renders 50 rows.
 */
export interface TableImportRequest {
  mode: TableImportMode
  format: string
  defaultFirstRowContainsHeaders?: boolean
  firstRowContainsHeadersEditable?: boolean
  /** Only columns at and after this index may be edited in the preview. */
  editableColumnStart?: number
  /** Reasons this paste needs review, such as conversion failures or overflow. */
  reasons?: string[]
  createPreview: (firstRowContainsHeaders: boolean) => TableImportPreviewModel
}

export function createTableImportRequest(
  parsed: ParsedTableDataClipboard,
  mode: TableImportMode,
  options: { defaultFirstRowContainsHeaders?: boolean } = {}
): TableImportRequest {
  return {
    mode,
    format: parsed.format,
    defaultFirstRowContainsHeaders: options.defaultFirstRowContainsHeaders ?? mode !== 'overflow',
    firstRowContainsHeadersEditable:
      (parsed.columns?.length ?? 0) === 0 && (parsed.columnNames?.length ?? 0) === 0,
    createPreview: firstRowContainsHeaders => {
      const inferred = inferTableData(parsed.rows, {
        firstRowContainsHeaders,
        columnNames: parsed.columnNames,
        columns: parsed.columns,
      })
      return {
        format: parsed.format,
        schema: inferred.schema,
        data: inferred.data,
        sourceRows: inferred.sourceRows,
      }
    },
  }
}

export interface TableImportResult extends TableImportPreviewModel {
  conversionCounts: {
    preserved: number
    coerced: number
    reset: number
  }
}

export interface TableImportDialogProps {
  open: boolean
  request?: TableImportRequest
  onOpenChange: (open: boolean) => void
  onConfirm: (result: TableImportResult) => void
}

function cloneSchema(schema: TableSchema): TableSchema {
  return {
    columns: schema.columns.map(column => ({
      ...column,
      ...(column.options && {
        options: {
          ...column.options,
          ...(column.options.values && { values: [...column.options.values] }),
        },
      }),
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function applyTableImportSchema(
  preview: TableImportPreviewModel,
  schema: TableSchema,
  editableColumnStart = 0
): TableImportResult {
  const counts = { preserved: 0, coerced: 0, reset: 0 }
  const data = preview.data.map((row, rowIndex) => {
    const source = isRecord(row) ? row : {}
    return Object.fromEntries(
      schema.columns.map((column, index) => {
        const sourceColumn = preview.schema.columns[index]
        const existingValue = sourceColumn ? source[sourceColumn.name] : undefined
        const sourceRowIndex = preview.sourceOrigin ? rowIndex - preview.sourceOrigin.row : rowIndex
        const sourceColumnIndex = preview.sourceOrigin ? index - preview.sourceOrigin.column : index
        const rawSourceRow = preview.sourceRows?.[sourceRowIndex]
        const isInsideSource =
          rawSourceRow !== undefined &&
          sourceColumnIndex >= 0 &&
          sourceColumnIndex < rawSourceRow.length
        if (preview.sourceOrigin && !isInsideSource) {
          if (index < editableColumnStart) return [column.name, existingValue]
          return [column.name, coerceSchemaValue(existingValue, column).value]
        }
        const sourceValue = preview.sourceRows ? rawSourceRow?.[sourceColumnIndex] : existingValue
        const conversion = coerceSchemaValue(sourceValue, column)
        counts[conversion.status] += 1
        return [column.name, conversion.value]
      })
    )
  })

  return {
    format: preview.format,
    schema: cloneSchema(schema),
    data,
    conversionCounts: counts,
  }
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function parseDefaultValue(text: string, column: ColumnSchema): unknown | undefined {
  if (column.type === 'string' || column.type === 'color' || column.type === 'date') return text
  if (column.type === 'number') {
    const value = Number(text)
    return text.trim() !== '' && Number.isFinite(value) ? value : undefined
  }
  if (column.type === 'boolean') {
    if (/^true$/i.test(text.trim())) return true
    if (/^false$/i.test(text.trim())) return false
    return undefined
  }
  if (column.type === 'stringLiteral') return text
  try {
    return JSON.parse(text)
  } catch {
    const conversion = coerceSchemaValue(text, column)
    return conversion.status === 'reset' ? undefined : conversion.value
  }
}

function DefaultValueInput({
  column,
  onChange,
}: {
  column: ColumnSchema
  onChange: (value: unknown) => void
}) {
  const formatted = formatCell(column.defaultValue ?? getDefaultValue(column))
  const [text, setText] = useState(formatted)

  useEffect(() => setText(formatted), [formatted])

  if (column.type === 'boolean') {
    return (
      <select
        aria-label={`Default value for ${column.name}`}
        value={String(column.defaultValue ?? getDefaultValue(column))}
        onChange={event => onChange(event.currentTarget.value === 'true')}
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    )
  }

  return (
    <input
      aria-label={`Default value for ${column.name}`}
      value={text}
      onChange={event => setText(event.currentTarget.value)}
      onBlur={() => {
        const value = parseDefaultValue(text, column)
        if (value !== undefined) onChange(value)
        else setText(formatted)
      }}
    />
  )
}

function NumberOptions({
  column,
  onChange,
}: {
  column: ColumnSchema
  onChange: (column: ColumnSchema) => void
}) {
  const setNumberOption = (key: 'min' | 'max' | 'softMin' | 'softMax' | 'step', text: string) => {
    const options = { ...column.options }
    if (text === '') delete options[key]
    else {
      const value = Number(text)
      if (Number.isFinite(value)) options[key] = value
    }
    onChange({ ...column, options: Object.keys(options).length > 0 ? options : undefined })
  }

  return (
    <div className={s.options}>
      {(['min', 'max', 'softMin', 'softMax', 'step'] as const).map(key => (
        <label key={key}>
          {key}
          <input
            type="number"
            aria-label={`${key} for ${column.name}`}
            value={column.options?.[key] ?? ''}
            onChange={event => setNumberOption(key, event.currentTarget.value)}
          />
        </label>
      ))}
    </div>
  )
}

function ColumnOptions({
  column,
  onChange,
}: {
  column: ColumnSchema
  onChange: (column: ColumnSchema) => void
}) {
  if (column.type === 'number') return <NumberOptions column={column} onChange={onChange} />

  if (column.type === 'stringLiteral') {
    return (
      <div className={s.options}>
        <label>
          Values
          <input
            aria-label={`Allowed values for ${column.name}`}
            value={column.options?.values?.join(', ') ?? ''}
            onChange={event => {
              const values = event.currentTarget.value
                .split(',')
                .map(value => value.trim())
                .filter(Boolean)
              const freeform = column.options?.freeform
              onChange({
                ...column,
                options:
                  values.length > 0 || freeform
                    ? { ...(freeform && { freeform }), ...(values.length > 0 && { values }) }
                    : undefined,
              })
            }}
          />
        </label>
        <label className={s.checkboxLabel}>
          <input
            type="checkbox"
            checked={column.options?.freeform ?? false}
            onChange={event => {
              const freeform = event.currentTarget.checked
              const values = column.options?.values
              onChange({
                ...column,
                options:
                  freeform || (values?.length ?? 0) > 0
                    ? { ...(values && { values }), ...(freeform && { freeform }) }
                    : undefined,
              })
            }}
          />
          Allow other values
        </label>
      </div>
    )
  }

  if (column.type === 'point2d') {
    return (
      <label className={s.checkboxLabel}>
        <input
          type="checkbox"
          checked={column.options?.geocoder ?? false}
          onChange={event => {
            const geocoder = event.currentTarget.checked
            onChange({ ...column, options: geocoder ? { geocoder: true } : undefined })
          }}
        />
        Enable geocoder
      </label>
    )
  }

  return <span className={s.noOptions}>No type options</span>
}

export function TableImportDialog({
  open,
  request,
  onOpenChange,
  onConfirm,
}: TableImportDialogProps) {
  const defaultHeaders = request?.defaultFirstRowContainsHeaders ?? request?.mode !== 'overflow'
  const [firstRowContainsHeaders, setFirstRowContainsHeaders] = useState(defaultHeaders)
  const preview = useMemo(
    () => request?.createPreview(firstRowContainsHeaders),
    [firstRowContainsHeaders, request]
  )
  const [schema, setSchema] = useState<TableSchema>(() =>
    cloneSchema(preview?.schema ?? { columns: [] })
  )

  useEffect(() => {
    if (!open || !request) return
    setFirstRowContainsHeaders(
      request.defaultFirstRowContainsHeaders ?? request.mode !== 'overflow'
    )
  }, [open, request])

  useEffect(() => {
    if (preview) setSchema(cloneSchema(preview.schema))
  }, [preview])

  const result = useMemo(
    () =>
      preview
        ? applyTableImportSchema(preview, schema, request?.editableColumnStart ?? 0)
        : undefined,
    [preview, request?.editableColumnStart, schema]
  )
  const validationError = getTableSchemaValidationError(schema)
  const isAnchoredPreview = preview?.sourceOrigin !== undefined
  const visibleRowStart = preview?.sourceOrigin?.row ?? 0
  const visibleRowLimit = isAnchoredPreview ? Math.min(50, preview?.sourceRows?.length ?? 50) : 50
  const visibleRows = result?.data.slice(visibleRowStart, visibleRowStart + visibleRowLimit) ?? []
  const visibleRowEnd = visibleRowStart + visibleRows.length
  const sourceRowCount =
    preview?.sourceOrigin && preview.sourceRows
      ? preview.sourceRows.length
      : (result?.data.length ?? 0)
  const sourceColumnCount =
    preview?.sourceOrigin && preview.sourceRows
      ? preview.sourceRows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
      : schema.columns.length
  const columnEntries = schema.columns.map((column, index) => ({
    column,
    index,
    key:
      preview?.schema.columns[index]?.id ??
      preview?.schema.columns[index]?.name ??
      column.id ??
      column.name,
  }))
  const editableColumnEntries = columnEntries.slice(request?.editableColumnStart ?? 0)

  const updateColumn = (index: number, column: ColumnSchema) => {
    setSchema(current => ({
      columns: current.columns.map((candidate, candidateIndex) =>
        candidateIndex === index ? column : candidate
      ),
    }))
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          <Dialog.Title className={s.title}>Import Table Data</Dialog.Title>
          <Dialog.Description className={s.description}>
            {request?.mode === 'canvas'
              ? 'Review the inferred columns before creating the table.'
              : 'Review the inferred columns before importing the data.'}
          </Dialog.Description>

          {(request?.reasons?.length ?? 0) > 0 && (
            <ul className={s.reasons} aria-label="Reasons this import needs review">
              {request?.reasons?.map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}

          <div className={s.summary} aria-live="polite">
            <span>{sourceRowCount} rows</span>
            <span>{sourceColumnCount} columns</span>
            <span>{request?.format ?? 'unknown'} format</span>
            <span>{result?.conversionCounts.coerced ?? 0} values converted</span>
            <span>{result?.conversionCounts.reset ?? 0} values reset</span>
            {preview?.sourceOrigin && (
              <span>
                {result?.data.length ?? 0} × {schema.columns.length} resulting table
              </span>
            )}
          </div>

          {request?.firstRowContainsHeadersEditable !== false && (
            <label className={s.headerToggle}>
              <input
                type="checkbox"
                checked={firstRowContainsHeaders}
                onChange={event => setFirstRowContainsHeaders(event.currentTarget.checked)}
              />
              First row contains column names
            </label>
          )}

          <div className={s.columnList}>
            {editableColumnEntries.map(({ column, index, key }) => (
              <div className={s.columnEditor} key={key}>
                <label>
                  Name
                  <input
                    aria-label={`Column ${index + 1} name`}
                    value={column.name}
                    onChange={event =>
                      updateColumn(index, { ...column, name: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  Type
                  <select
                    aria-label={`Type for ${column.name}`}
                    value={column.type}
                    onChange={event => {
                      const type = event.currentTarget.value as ColumnType
                      const next = {
                        ...(column.id && { id: column.id }),
                        name: column.name,
                        type,
                      } satisfies ColumnSchema
                      updateColumn(index, { ...next, defaultValue: getDefaultValue(next) })
                    }}
                  >
                    {COLUMN_TYPES.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={s.fieldGroup}>
                  <span>Default</span>
                  <DefaultValueInput
                    column={column}
                    onChange={defaultValue => updateColumn(index, { ...column, defaultValue })}
                  />
                </div>
                <ColumnOptions column={column} onChange={next => updateColumn(index, next)} />
              </div>
            ))}
          </div>

          <section
            className={s.previewWrapper}
            aria-label="Imported table data preview"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the scrollable preview must be reachable by keyboard.
            tabIndex={0}
          >
            <table className={s.previewTable} aria-label="Imported table data">
              <thead>
                <tr>
                  {columnEntries.map(({ column, index, key }) => (
                    <th key={key} scope="col">
                      {column.name || `Column ${index + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, rowIndex) => {
                  const record = isRecord(row) ? row : {}
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview rows preserve source order and have no identities.
                    <tr key={rowIndex}>
                      {columnEntries.map(({ column, key }) => (
                        <td key={key}>{formatCell(record[column.name])}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {isAnchoredPreview ? (
              <div className={s.truncatedNotice}>
                Showing rows {visibleRowStart + 1}–{visibleRowEnd} around the pasted data.
              </div>
            ) : (
              (result?.data.length ?? 0) > 50 && (
                <div className={s.truncatedNotice}>Showing the first 50 rows.</div>
              )
            )}
          </section>

          {validationError && (
            <div className={s.error} role="alert">
              {validationError}
            </div>
          )}

          <div className={s.footer}>
            <Dialog.Close asChild>
              <Button label="Cancel" className="p-button-text" />
            </Dialog.Close>
            <Button
              label={
                request?.mode === 'canvas'
                  ? 'Create Table'
                  : (result?.conversionCounts.reset ?? 0) > 0
                    ? 'Import and Reset'
                    : 'Import Data'
              }
              icon="pi pi-check"
              disabled={!result || validationError !== undefined}
              onClick={() => result && !validationError && onConfirm(result)}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
