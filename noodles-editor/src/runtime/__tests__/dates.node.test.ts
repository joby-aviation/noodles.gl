// Date functions in row expressions: epoch seconds in and out, run by DuckDB.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

async function rows(expressions: Record<string, string>) {
  const attrs = Object.entries(expressions).map(([name, expression], i) => ({
    id: `a${i}`,
    op: 'attribute',
    x: 0,
    y: 0,
    params: { name, expression },
  }))
  const doc: EditorDoc = {
    version: 1,
    name: 'dates',
    nodes: [
      {
        id: 'src',
        op: 'sql',
        x: 0,
        y: 0,
        params: {
          query: "SELECT TIMESTAMP '2026-04-30 12:00:00' AS ts, '2026-01-31T00:00:00' AS iso",
        },
      },
      ...attrs,
      // A relation at the end, which previews read
      { id: 'all', op: 'sql', x: 0, y: 0, params: { query: 'SELECT * FROM {{input0}}' } },
    ],
    edges: [
      ...attrs.map((a, i) => ({
        id: `e${i}`,
        source: i === 0 ? 'src' : attrs[i - 1].id,
        sourcePort: 'out',
        target: a.id,
        targetPort: 'in',
      })),
      {
        id: 'last',
        source: attrs[attrs.length - 1].id,
        sourcePort: 'out',
        target: 'all',
        targetPort: 'in0',
      },
    ],
  }
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  const preview = await runtime.preview('all')
  expect(preview.note).toBeUndefined()
  return preview.rows[0] as Record<string, unknown>
}

const T = Date.UTC(2026, 3, 30, 12) / 1000

describe('date functions', () => {
  it('reads a timestamp or ISO text as epoch seconds', async () => {
    const r = await rows({ t: 'epoch(ts)', i: 'epoch(iso)' })
    expect(r.t).toBe(T)
    expect(r.i).toBe(Date.UTC(2026, 0, 31) / 1000)
  })

  it('adds and subtracts, on the calendar for months', async () => {
    const r = await rows({
      t: 'epoch(ts)',
      weeks: "date_add(t, 2, 'weeks')",
      back: "date_add(t, -3, 'hours')",
      month: "date_add(epoch(iso), 1, 'months')",
    })
    expect(r.weeks).toBe(Date.UTC(2026, 4, 14, 12) / 1000)
    expect(r.back).toBe(Date.UTC(2026, 3, 30, 9) / 1000)
    // January 31 plus a month is the end of February, as Temporal has it
    expect(r.month).toBe(Date.UTC(2026, 1, 28) / 1000)
  })

  it('measures differences, keeping the fraction of fixed units', async () => {
    const r = await rows({
      t: 'epoch(ts)',
      half: "date_diff(t, date_add(t, 12, 'hours'), 'days')",
      months: "date_diff(epoch(iso), date_add(epoch(iso), 2, 'months'), 'months')",
      neg: "date_diff(t, date_add(t, -3, 'hours'), 'hours')",
    })
    expect(r.half).toBe(0.5)
    expect(r.months).toBe(2)
    expect(r.neg).toBe(-3)
  })

  it('splits a date into parts and formats it', async () => {
    const r = await rows({
      t: 'epoch(ts)',
      year: "date_part(t, 'year')",
      month: "date_part(t, 'month')",
      dow: "date_part(t, 'dayOfWeek')",
      text: "date_format(t, 'YYYY/MM/DD HH:mm')",
      iso: "date_format(t, '')",
    })
    expect([r.year, r.month, r.dow]).toEqual([2026, 4, 4])
    expect(r.text).toBe('2026/04/30 12:00')
    expect(r.iso).toBe('2026-04-30T12:00:00')
  })
})
