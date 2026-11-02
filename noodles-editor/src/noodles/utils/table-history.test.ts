import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TableSchema } from '../table-schema'
import {
  applyTableHistorySnapshot,
  createTableHistorySnapshots,
  mergeTableHistorySnapshots,
} from './table-history'

const { getOp } = vi.hoisted(() => ({ getOp: vi.fn() }))

vi.mock('../store', () => ({ getGraphStore: () => ({ getOp }) }))

function field<T>(initialValue: T) {
  return {
    value: initialValue,
    setValue: vi.fn(function (this: { value: T }, value: T) {
      this.value = value
    }),
  }
}

function tableOp(data: unknown[], schema: TableSchema | null = null) {
  return {
    id: '/table',
    inputs: { data: field(data), schema: field<TableSchema | null>(schema) },
    outputs: { data: field(data) },
  }
}

afterEach(() => {
  getOp.mockReset()
})

describe('table history patches', () => {
  it('stores only the changed row slice for a large table', () => {
    const before = Array.from({ length: 10_000 }, (_, index) => ({
      label: `Row ${index}`,
      value: index,
    }))
    const after = before.with(5_000, { label: 'Edited row', value: 5_000 })

    const snapshots = createTableHistorySnapshots('/table', { data: before }, { data: after })

    expect(snapshots).not.toBeNull()
    expect(snapshots!.before.length).toBeLessThan(200)
    expect(snapshots!.after.length).toBeLessThan(200)
    expect(snapshots!.before).not.toContain('Row 9999')
    expect(snapshots!.after).not.toContain('Row 9999')
  })

  it('applies cell edits and schema changes in both directions', () => {
    const oldSchema: TableSchema = {
      columns: [{ name: 'city', type: 'string', defaultValue: '' }],
    }
    const newSchema: TableSchema = {
      columns: [{ id: 'city', name: 'metro', type: 'string', defaultValue: '' }],
    }
    const before = [{ city: 'Los Angeles' }, { city: 'Seattle' }]
    const after = [{ metro: 'Los Angeles' }, { metro: 'Portland' }]
    const op = tableOp(after, newSchema)
    getOp.mockReturnValue(op)
    const snapshots = createTableHistorySnapshots(
      '/table',
      { data: before, schema: oldSchema },
      { data: after, schema: newSchema }
    )!

    expect(applyTableHistorySnapshot(snapshots.before)).toBe(true)
    expect(op.inputs.data.value).toEqual(before)
    expect(op.inputs.schema.value).toEqual(oldSchema)
    expect(op.outputs.data.value).toEqual(before)

    expect(applyTableHistorySnapshot(snapshots.after)).toBe(true)
    expect(op.inputs.data.value).toEqual(after)
    expect(op.inputs.schema.value).toEqual(newSchema)
    expect(op.outputs.data.value).toEqual(after)
  })

  it('merges edits and structural row changes in reversible order', () => {
    const before = [{ value: 'A' }, { value: 'B' }]
    const edited = [{ value: 'Edited' }, { value: 'B' }]
    const after = [...edited, { value: 'C' }]
    const first = createTableHistorySnapshots('/table', { data: before }, { data: edited })!
    const second = createTableHistorySnapshots('/table', { data: edited }, { data: after })!
    const merged = mergeTableHistorySnapshots(first, second)!
    const op = tableOp(after)
    getOp.mockReturnValue(op)

    applyTableHistorySnapshot(merged.before)
    expect(op.inputs.data.value).toEqual(before)
    expect(op.inputs.data.setValue).toHaveBeenCalledTimes(1)

    op.inputs.data.setValue.mockClear()
    applyTableHistorySnapshot(merged.after)
    expect(op.inputs.data.value).toEqual(after)
    expect(op.inputs.data.setValue).toHaveBeenCalledTimes(1)
  })

  it('returns null when neither data nor schema changed', () => {
    const data = [{ value: 1 }]
    expect(createTableHistorySnapshots('/table', { data }, { data })).toBeNull()
  })
})
