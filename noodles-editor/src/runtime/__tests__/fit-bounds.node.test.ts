// The SQL a camera fit reads its bounds with, for each way rows hold a position.
import type { RelShape } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { boundsSelect, fitRow } from '../deck-ops'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 30_000)

const shape = (columns: [string, string][], vectors: string[] = []): RelShape => ({
  columns: columns.map(([name, duckType]) => ({ name, duckType, type: 'other' })),
  vectors: vectors.map(name => ({ name, width: 2 })),
})

async function bounds(select: string, from: string) {
  const { table } = await duck.run(`SELECT ${select} FROM (${from})`)
  return (table.toArray()[0] as { toJSON(): Record<string, unknown> }).toJSON()
}

describe('boundsSelect', () => {
  const expected = { west: 1, east: 3, south: 2, north: 5 }

  it('reads a geometry column by its extent, lines included', async () => {
    const from = `SELECT ST_Point(1, 2) AS geom UNION ALL SELECT ST_GeomFromText('LINESTRING(2 3, 3 5)')`
    expect(await bounds(boundsSelect('geom', shape([['geom', 'GEOMETRY']])), from)).toEqual(
      expected
    )
  })

  it('reads a vector stored as components', async () => {
    const from = 'SELECT 1.0 AS p_0, 2.0 AS p_1 UNION ALL SELECT 3.0, 5.0'
    expect(await bounds(boundsSelect('p', shape([], ['p'])), from)).toEqual(expected)
  })

  it('reads an expression, and a list column', async () => {
    const from = 'SELECT 1 AS lng, 2 AS lat, [1.0, 2.0] AS pos UNION ALL SELECT 3, 5, [3.0, 5.0]'
    expect(await bounds(boundsSelect('[lng, lat]', shape([])), from)).toEqual(expected)
    expect(await bounds(boundsSelect('pos', shape([['pos', 'DOUBLE[]']])), from)).toEqual(expected)
  })
})

describe('fitRow', () => {
  it('fits the whole world when there are no rows', () => {
    const none = { west: null, east: null, south: null, north: null }
    const fit = fitRow(none, 0, { width: 1000, height: 500 })
    expect(fit.bounds).toEqual([
      [-180, -85],
      [180, 85],
    ])
    expect(Number.isFinite(fit.zoom)).toBe(true)
  })

  it('keeps padding smaller than the surface, which fitBounds would refuse', () => {
    const row = { west: 0, east: 1, south: 0, north: 1 }
    expect(Number.isFinite(fitRow(row, 5000, { width: 300, height: 200 }).zoom)).toBe(true)
  })
})
