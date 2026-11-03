import { debugHistory } from '../../utils/debug'
import { getGraphStore } from '../store'
import type { TableSchema } from '../table-schema'
import { deepEqual } from './deep-equal'
import type { OpId } from './id-utils'

const TABLE_HISTORY_VERSION = 1

interface TableDataPatch {
  start: number
  removeCount: number
  rows: unknown[]
  expectedRows: unknown[]
  expectedLength: number
}

interface TableHistoryOperation {
  opId: string
  data?: TableDataPatch
  schema?: TableSchema | null
}

interface TableHistorySnapshot {
  $tableHistory: typeof TABLE_HISTORY_VERSION
  operations: TableHistoryOperation[]
}

export interface TableHistoryState {
  data: unknown[]
  schema?: TableSchema | null
}

export interface TableHistorySnapshots {
  before: string
  after: string
}

function changedDataSlice(before: unknown[], after: unknown[]) {
  let start = 0
  while (start < before.length && start < after.length && deepEqual(before[start], after[start])) {
    start++
  }

  let suffix = 0
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    deepEqual(before[before.length - suffix - 1], after[after.length - suffix - 1])
  ) {
    suffix++
  }

  return {
    start,
    beforeRows: before.slice(start, before.length - suffix),
    afterRows: after.slice(start, after.length - suffix),
  }
}

function serializeSnapshot(operations: TableHistoryOperation[]): string {
  return JSON.stringify({ $tableHistory: TABLE_HISTORY_VERSION, operations })
}

export function createTableHistorySnapshots(
  opId: string,
  before: TableHistoryState,
  after: TableHistoryState
): TableHistorySnapshots | null {
  const dataChanged = !deepEqual(before.data, after.data)
  const schemaChanged = !deepEqual(before.schema, after.schema)
  if (!dataChanged && !schemaChanged) return null

  const beforeOperation: TableHistoryOperation = { opId }
  const afterOperation: TableHistoryOperation = { opId }

  if (dataChanged) {
    const slice = changedDataSlice(before.data, after.data)
    beforeOperation.data = {
      start: slice.start,
      removeCount: slice.afterRows.length,
      rows: slice.beforeRows,
      expectedRows: slice.afterRows,
      expectedLength: after.data.length,
    }
    afterOperation.data = {
      start: slice.start,
      removeCount: slice.beforeRows.length,
      rows: slice.afterRows,
      expectedRows: slice.beforeRows,
      expectedLength: before.data.length,
    }
  }

  if (schemaChanged) {
    beforeOperation.schema = before.schema ?? null
    afterOperation.schema = after.schema ?? null
  }

  try {
    return {
      before: serializeSnapshot([beforeOperation]),
      after: serializeSnapshot([afterOperation]),
    }
  } catch {
    // Unsupported values must not prevent the table edit itself. This mirrors the
    // best-effort serialization used by the general property-history path.
    debugHistory('Failed to serialize table history for %s', opId)
    return null
  }
}

function parseSnapshot(snapshot: string): TableHistorySnapshot | null {
  try {
    const parsed = JSON.parse(snapshot) as Partial<TableHistorySnapshot>
    if (parsed.$tableHistory !== TABLE_HISTORY_VERSION || !Array.isArray(parsed.operations)) {
      return null
    }
    return parsed as TableHistorySnapshot
  } catch {
    return null
  }
}

export function isTableHistorySnapshot(snapshot: string): boolean {
  return parseSnapshot(snapshot) !== null
}

export function mergeTableHistorySnapshots(
  earlier: TableHistorySnapshots,
  later: TableHistorySnapshots
): TableHistorySnapshots | null {
  const earlierBefore = parseSnapshot(earlier.before)
  const earlierAfter = parseSnapshot(earlier.after)
  const laterBefore = parseSnapshot(later.before)
  const laterAfter = parseSnapshot(later.after)
  if (!earlierBefore || !earlierAfter || !laterBefore || !laterAfter) return null

  return {
    // Undo the newest operation first so structural edits restore the row indexes
    // expected by earlier patches.
    before: serializeSnapshot([...laterBefore.operations, ...earlierBefore.operations]),
    after: serializeSnapshot([...earlierAfter.operations, ...laterAfter.operations]),
  }
}

export function applyTableHistorySnapshot(snapshot: string): boolean {
  const parsed = parseSnapshot(snapshot)
  if (!parsed) return false

  const store = getGraphStore()
  const opIds = new Set(parsed.operations.map(operation => operation.opId))
  for (const opId of opIds) {
    const op = store.getOp(opId as OpId)
    const dataInput = op?.inputs.data
    if (!op || !dataInput) {
      debugHistory('Could not restore table history for missing operator %s', opId)
      continue
    }

    let nextData = Array.isArray(dataInput.value) ? dataInput.value : []
    let dataChanged = false
    let nextSchema: TableSchema | null | undefined
    let schemaChanged = false
    let canRestore = true

    for (const operation of parsed.operations) {
      if (operation.opId !== opId) continue

      if (operation.data) {
        const currentRows = nextData.slice(
          operation.data.start,
          operation.data.start + operation.data.removeCount
        )
        if (
          nextData.length !== operation.data.expectedLength ||
          !deepEqual(currentRows, operation.data.expectedRows)
        ) {
          debugHistory('Skipped stale table history for %s', opId)
          canRestore = false
          break
        }
        nextData = [
          ...nextData.slice(0, operation.data.start),
          ...operation.data.rows,
          ...nextData.slice(operation.data.start + operation.data.removeCount),
        ]
        dataChanged = true
      }

      if ('schema' in operation) {
        nextSchema = operation.schema
        schemaChanged = true
      }
    }

    if (!canRestore) continue
    if (schemaChanged && op.inputs.schema) op.inputs.schema.setValue(nextSchema)
    if (!dataChanged) continue
    dataInput.setValue(nextData)
    op.outputs.data?.setValue(nextData)
  }

  return true
}
