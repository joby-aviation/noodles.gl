// A camera parameter that doesn't evaluate (a reference to a node that is gone reads NaN) stays
// out of the view the map gets: MapLibre throws on a NaN pitch, and the map would take the whole
// editor down with it.
import type { EditorDoc } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { Engine, finiteCamera } from '../engine'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

const doc = (params: Record<string, unknown>): EditorDoc => ({
  version: 1,
  name: 'camera',
  nodes: [{ id: 'map', op: 'deck', x: 0, y: 0, params: params as never }],
  edges: [],
})

it('leaves out camera values that are not finite numbers, and keeps the rest', () => {
  expect(
    finiteCamera({ longitude: 1, latitude: 2, zoom: 3, pitch: Number.NaN, bearing: null })
  ).toEqual({
    longitude: 1,
    latitude: 2,
    zoom: 3,
  })
  expect(finiteCamera({ zoom: Number.POSITIVE_INFINITY, transitionDuration: 0 })).toEqual({
    transitionDuration: 0,
  })
})

it('gives the map a finite view when a camera parameter references a node that is gone', async () => {
  const engine = new Engine(duck)
  await engine.setDoc(doc({ pitch: { ref: 'gone/value' }, zoom: 5 }))
  await engine.settle()
  const view = engine.vis().deckProps.viewState
  for (const v of Object.values(view))
    if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
  expect(view.zoom).toBe(5)
  expect(view).not.toHaveProperty('pitch')
})
