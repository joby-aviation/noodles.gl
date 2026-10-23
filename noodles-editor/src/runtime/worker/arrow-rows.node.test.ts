import { tableFromJSON, tableToIPC } from 'apache-arrow'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { tableFromRows } from './arrow-rows'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 30_000)

// world-flights' shape: per flight a path of [lng, lat, alt], a timestamp per vertex, and text
// properties
function flights(count: number, points: number) {
  return Array.from({ length: count }, (_, i) => ({
    path: Array.from({ length: points }, (_, k) => [k * 0.01 + i, k * 0.02, 1000 + k]),
    timestamps: Array.from({ length: points }, (_, k) => 1_567_555_200 + k * 60),
    callsign: `F${i}`,
    origin: i % 2 ? 'LHR' : 'JFK',
    speed: i * 1.5,
    landed: i % 3 === 0,
  }))
}

const load = (name: string, ipc: Uint8Array) => duck.insertArrow(name, ipc)
const rows = (sql: string) => duck.rows(sql)

describe('rows into Arrow by column', () => {
  it('reads back what tableFromJSON reads back', async () => {
    const data = flights(20, 5)
    load('fast_small', tableToIPC(tableFromRows(data)!, 'stream'))
    load('slow_small', tableToIPC(tableFromJSON(data), 'stream'))
    const q = (t: string) =>
      rows(
        `SELECT callsign, origin, speed, landed, path[2][1] AS lng, path[2][3] AS alt, timestamps[3] AS t, len(path) AS n FROM ${t} ORDER BY callsign`
      )
    expect(await q('fast_small')).toEqual(await q('slow_small'))
  })

  it('keeps nulls and uneven points, and refuses objects', async () => {
    const t = tableFromRows([
      { a: 1, p: [[1, 2]], s: 'x' },
      { a: null, p: [[1, 2, 3]], s: null },
      { a: 3, p: null, s: 'z' },
    ])!
    load('mixed', tableToIPC(t, 'stream'))
    expect(await rows('SELECT a, len(p)::INTEGER AS n, s FROM mixed')).toEqual([
      { a: 1, n: 1, s: 'x' },
      { a: null, n: 1, s: null },
      { a: 3, n: null, s: 'z' },
    ])
    expect(tableFromRows([{ o: { nested: 1 } }])).toBeUndefined()
    expect(tableFromRows([{ m: 1 }, { m: 'two' }])).toBeUndefined()
  })

  it('loads world-flights-sized paths', async () => {
    // 1.5M vertices: about 0.2 s here, against about 1 s through tableFromJSON (Node, 2026-10-23)
    const data = flights(12_938, 116)
    load('big', tableToIPC(tableFromRows(data)!, 'stream'))
    const [n] = await rows('SELECT sum(len(path))::INTEGER AS n FROM big')
    expect(n.n).toBe(12_938 * 116)
  }, 120_000)
})
