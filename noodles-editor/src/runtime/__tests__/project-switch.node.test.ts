// Two projects whose data files share a project name, `@/data.csv`, as the examples' do. The
// engine is one for the whole session, so opening the second must not read the first's file
// or reuse the relation memoized for it.
import type { EditorDoc } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { Engine } from '../engine'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

const FILES: Record<string, string> = {
  quakes: 'Longitude,Latitude,Magnitude\n-122.4,37.8,3.1\n-118.2,34.1,4.5\n',
  taxis: 'pickup_longitude,pickup_latitude,fare\n-74.0,40.7,12\n-73.9,40.8,30\n',
}

// The same graph in each project, apart from the columns its position reads
const doc = (name: string, position: string): EditorDoc => ({
  version: 1,
  name,
  nodes: [
    { id: 'data-source', op: 'file', x: 0, y: 0, params: { url: '@/data.csv', format: 'csv' } },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'data-source', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
})

it('reads each project’s own file when another project opens', async () => {
  let project = 'quakes'
  const engine = new Engine(duck, {
    registerFile: async (name, bytes) => duck.registerFile(name, bytes),
    readAsset: async () => new TextEncoder().encode(FILES[project]),
  })
  await engine.setDoc(doc('quakes', '[Longitude, Latitude]'))
  await engine.settle()
  expect(engine.runtime.program()?.errors).toEqual([])
  expect(engine.runtime.layers().find(l => l.id === 'dots')?.data?.rows).toBe(2)

  project = 'taxis'
  await engine.openProject()
  await engine.setDoc(doc('taxis', '[pickup_longitude, pickup_latitude]'))
  await engine.settle()
  expect(engine.runtime.error()).toBeUndefined()
  expect(engine.runtime.program()?.errors).toEqual([])
  const layer = engine.runtime.layers().find(l => l.id === 'dots')
  expect(layer?.error).toBeUndefined()
  expect(layer?.data?.rows).toBe(2)
})

// A host operator's read of a node's rows is cached by relation hash. Two projects with the
// same file name and graph hash the same, so the cache must not outlive the project.
it('reads host rows from the project that is open', async () => {
  let csv = 'Longitude,Latitude,Magnitude\n-122.4,37.8,3.1\n'
  const engine = new Engine(duck, {
    registerFile: async (name, bytes) => duck.registerFile(name, bytes),
    readAsset: async () => new TextEncoder().encode(csv),
  })
  const rowsOf = async () => {
    for (let i = 0; i < 50; i++) {
      const rows = engine.peekRows('data-source')
      if (rows) return rows
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('rows never read')
  }
  await engine.setDoc(doc('first', '[Longitude, Latitude]'))
  await engine.settle()
  expect(await rowsOf()).toEqual([{ Longitude: -122.4, Latitude: 37.8, Magnitude: 3.1 }])

  csv = 'Longitude,Latitude,Magnitude\n-118.2,34.1,4.5\n'
  await engine.openProject()
  await engine.setDoc(doc('second', '[Longitude, Latitude]'))
  await engine.settle()
  expect(await rowsOf()).toEqual([{ Longitude: -118.2, Latitude: 34.1, Magnitude: 4.5 }])
})
