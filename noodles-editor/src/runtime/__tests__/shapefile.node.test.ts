// A shapefile by URL: GDAL reads its index, attributes and projection from files beside the
// .shp, so the engine fetches those too and hands DuckDB all of them.
import type { EditorDoc } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { Engine } from '../engine'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

type Place = { x: number; y: number; name: string }

// A point shapefile's .shp, .shx and .dbf, written by hand: each a header and fixed-size records
function shapefile(places: Place[]): Record<'shp' | 'shx' | 'dbf', Uint8Array> {
  const header = (words: number) => {
    const v = new DataView(new ArrayBuffer(100))
    v.setInt32(0, 9994)
    v.setInt32(24, words)
    v.setInt32(28, 1000, true)
    v.setInt32(32, 1, true)
    const xs = places.map(p => p.x)
    const ys = places.map(p => p.y)
    const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    for (const [k, b] of bounds.entries()) v.setFloat64(36 + k * 8, b, true)
    return new Uint8Array(v.buffer)
  }
  // Each point record: an 8-byte header and 20 bytes of shape type, x and y
  const shp = new Uint8Array(100 + places.length * 28)
  shp.set(header(shp.length / 2))
  const shx = new Uint8Array(100 + places.length * 8)
  shx.set(header(shx.length / 2))
  places.forEach((p, i) => {
    const at = 100 + i * 28
    const record = new DataView(shp.buffer, at, 28)
    record.setInt32(0, i + 1)
    record.setInt32(4, 10)
    record.setInt32(8, 1, true)
    record.setFloat64(12, p.x, true)
    record.setFloat64(20, p.y, true)
    const index = new DataView(shx.buffer, 100 + i * 8, 8)
    index.setInt32(0, at / 2)
    index.setInt32(4, 10)
  })
  // One text field, `name`, ten characters wide
  const width = 10
  const dbf = new Uint8Array(32 + 32 + 1 + places.length * (1 + width) + 1)
  const d = new DataView(dbf.buffer)
  d.setUint8(0, 3)
  d.setInt32(4, places.length, true)
  d.setInt16(8, 65, true)
  d.setInt16(10, 1 + width, true)
  dbf.set(new TextEncoder().encode('name'), 32)
  dbf[43] = 'C'.charCodeAt(0)
  dbf[48] = width
  dbf[64] = 0x0d
  places.forEach((p, i) => {
    dbf.set(new TextEncoder().encode(` ${p.name.padEnd(width)}`), 65 + i * (1 + width))
  })
  dbf[dbf.length - 1] = 0x1a
  return { shp, shx, dbf }
}

const PLACES = [
  { x: -122.4, y: 37.8, name: 'sf' },
  { x: -74.0, y: 40.7, name: 'nyc' },
]

const doc = (url: string): EditorDoc => ({
  version: 1,
  name: 'shapefile',
  nodes: [
    { id: 'places', op: 'geojson', x: 0, y: 0, params: { url } },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: 'geom' } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'places', sourcePort: 'features', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers', index: 0 },
  ],
})

// An engine whose fetches read `files` by extension, recording what it asked for
async function open(url: string, files: Partial<Record<string, Uint8Array>>) {
  const fetched: string[] = []
  const engine = new Engine(duck, {
    registerFile: async (name, bytes) => duck.registerFile(name, bytes),
    fetchBytes: async u => {
      fetched.push(u)
      const bytes = files[u.split('.').pop() ?? '']
      if (!bytes) throw new Error(`Failed to fetch ${u}: 404`)
      return bytes
    },
  })
  await engine.setDoc(doc(url))
  await engine.settle()
  expect(engine.runtime.program()?.errors).toEqual([])
  const features = engine.runtime.program()?.relations.find(r => r.id === 'places#features')
  return { engine, fetched, features }
}

describe('a shapefile by URL', () => {
  it('fetches the files beside the .shp, so its features keep their attributes', async () => {
    const { engine, fetched, features } = await open('https://x/places.shp', shapefile(PLACES))
    expect(fetched).toEqual(
      ['shp', 'shx', 'dbf', 'prj', 'cpg'].map(ext => `https://x/places.${ext}`)
    )
    expect(await duck.rows(`SELECT name FROM ${features?.ref} ORDER BY name`)).toEqual([
      { name: 'nyc' },
      { name: 'sf' },
    ])
    expect(engine.runtime.layers().find(l => l.id === 'dots')?.data?.rows).toBe(2)
  })

  it('draws a shapefile without attributes when the .dbf is missing', async () => {
    const { dbf: _dbf, ...noAttributes } = shapefile(PLACES)
    const { engine } = await open('https://y/places.shp', noAttributes)
    expect(engine.runtime.layers().find(l => l.id === 'dots')?.data?.rows).toBe(2)
  })
})
