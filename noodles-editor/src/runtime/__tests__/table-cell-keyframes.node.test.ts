// Keyframed table cells: a track per cell, `nodeId.rows.<row>.<column>`, laid over the table's
// rows in SQL, so playing the timeline rebinds the cell and never reloads the table.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

const ROWS = [
  { city: 'Denver', population: 700, label: 'a' },
  { city: 'Boulder', population: 100, label: 'b' },
]

const key = (time: number, value: number | string, interpolation = 'linear') => ({
  id: `k${time}`,
  time,
  value,
  interpolation: interpolation as 'linear' | 'hold',
})

const doc = (tracks: NonNullable<EditorDoc['timeline']>['tracks']): EditorDoc => ({
  version: 1,
  name: 'cells',
  nodes: [
    { id: 'cities', op: 'table', x: 0, y: 0, params: { rows: JSON.stringify(ROWS) } },
    // A layer sized by the cell, as a table drawn on a map is
    {
      id: 'dots',
      op: 'scatter',
      x: 0,
      y: 0,
      params: { position: '[0.0, 0.0]', radius: 'population' },
    },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'cities', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
  timeline: { length: 10, fps: 30, tracks },
})

async function at(d: EditorDoc, runtime: ProgramRuntime, T: number) {
  const lowered = lowerDocument(d)
  expect(lowered.errors).toEqual([])
  await runtime.setValues(parameterValues(lowered, { T, F: T * 30 }).values)
  await runtime.idle()
  return (await runtime.preview('cities')).rows
}

describe('keyframed table cells', () => {
  it('animates a cell, row by row, without recompiling while playing', async () => {
    const d = doc([{ target: 'cities.rows.1.population', keyframes: [key(0, 100), key(10, 300)] }])
    const lowered = lowerDocument(d)
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    const compiles = runtime.counters.compiles
    expect((await at(d, runtime, 5)).map(r => r.population)).toEqual([700, 200])
    expect((await at(d, runtime, 10)).map(r => r.population)).toEqual([700, 300])
    expect(runtime.counters.compiles).toBe(compiles)
    // The rest of the table is as typed, columns and order alike
    const rows = await at(d, runtime, 0)
    expect(rows.map(r => r.city)).toEqual(['Denver', 'Boulder'])
    // Its row numbers, which match the cells, are not shown
    expect(Object.keys(rows[0]).sort()).toEqual(['city', 'label', 'population'])
  })

  it('holds a text cell from one key to the next', async () => {
    const d = doc([
      {
        target: 'cities.rows.0.label',
        keyframes: [key(0, 'first', 'hold'), key(4, 'later', 'hold')],
      },
    ])
    const lowered = lowerDocument(d)
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect((await at(d, runtime, 2))[0].label).toBe('first')
    expect((await at(d, runtime, 6))[0].label).toBe('later')
  })

  it('ignores a track for a row or column the table no longer has', () => {
    const d = doc([
      { target: 'cities.rows.9.population', keyframes: [key(0, 1)] },
      { target: 'cities.rows.0.gone', keyframes: [key(0, 1)] },
    ])
    const lowered = lowerDocument(d)
    expect(lowered.errors).toEqual([])
    expect(lowered.graph.nodes.find(n => n.id === 'cities')?.type).toBe('js')
  })
})
