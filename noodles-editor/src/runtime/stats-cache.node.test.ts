// A layer's stats (the extent behind colmin/colmax) are reused across requeries while their
// query and its values stay the same.
import { describe, expect, it } from 'vitest'
import { queryLayer, type StatsCache } from './execute'

// A SQL engine that counts the queries it runs. The stats query returns its bound value, so a
// change of value shows up in the published parameter.
function countingSql() {
  const runs: string[] = []
  const table = (row: Record<string, unknown>) => ({
    get: () => row,
    getChild: () => null,
    numRows: 0,
    schema: { fields: [] },
  })
  return {
    runs,
    run: async (sql: string, params: unknown[]) => {
      runs.push(sql)
      return { table: table(sql === 'STATS' ? { lo: params[0] ?? 1 } : {}) }
    },
  }
}

// A layer that reads one stats query, bound to `cut`, and its own query, bound to `size`
const layer = {
  id: 'dots',
  plan: {
    stats: [{ sql: 'STATS', params: ['cut'], outputs: [{ column: 'lo', param: 'dots_v_min' }] }],
    sql: 'ROWS',
    sqlParams: ['size'],
    attributes: [],
    derived: [],
  },
} as unknown as Parameters<typeof queryLayer>[1]

describe('stats cache', () => {
  it('reuses a stats result while its query and values stay the same', async () => {
    const sql = countingSql()
    const cache: StatsCache = new Map()
    const engine = sql as unknown as Parameters<typeof queryLayer>[0]
    const first = await queryLayer(engine, layer, { cut: 2, size: 1 }, cache)
    // Only the layer's own query reads `size`, so its requery reuses the stats
    const second = await queryLayer(engine, layer, { cut: 2, size: 5 }, cache)
    expect(sql.runs).toEqual(['STATS', 'ROWS', 'ROWS'])
    expect(first.stats).toEqual({ dots_v_min: 2 })
    expect(second.stats).toEqual({ dots_v_min: 2 })

    // A value the stats read runs them again
    const third = await queryLayer(engine, layer, { cut: 7, size: 5 }, cache)
    expect(sql.runs.filter(r => r === 'STATS')).toHaveLength(2)
    expect(third.stats).toEqual({ dots_v_min: 7 })
  })

  it('publishes a shared result under each stats node’s own names', async () => {
    const sql = countingSql()
    const cache: StatsCache = new Map()
    const engine = sql as unknown as Parameters<typeof queryLayer>[0]
    // Two layers whose stats run the same query over the same rows
    const other = {
      ...layer,
      id: 'rings',
      plan: {
        ...layer.plan,
        stats: [
          { sql: 'STATS', params: ['cut'], outputs: [{ column: 'lo', param: 'rings_v_min' }] },
        ],
      },
    } as unknown as Parameters<typeof queryLayer>[1]
    await queryLayer(engine, layer, { cut: 3, size: 1 }, cache)
    const second = await queryLayer(engine, other, { cut: 3, size: 1 }, cache)
    expect(sql.runs.filter(r => r === 'STATS')).toHaveLength(1)
    expect(second.stats).toEqual({ rings_v_min: 3 })
  })

  it('runs the stats every time without a cache', async () => {
    const sql = countingSql()
    const engine = sql as unknown as Parameters<typeof queryLayer>[0]
    await queryLayer(engine, layer, { cut: 2, size: 1 })
    await queryLayer(engine, layer, { cut: 2, size: 5 })
    expect(sql.runs.filter(r => r === 'STATS')).toHaveLength(2)
  })
})
