// A project made from a ?createFromSQL= query draws the query's rows.
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../../runtime/__tests__/duckdb-node'
import { ProgramRuntime } from '../../runtime/program-runtime'
import { createProjectFromSQL } from './create-from-sql'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

it('draws a point per row of the query', async () => {
  const doc = createProjectFromSQL({
    sql: 'SELECT * FROM (VALUES (-73.98, 40.75, 1), (-0.12, 51.5, 2)) t(lng, lat, n)',
  })
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.program()?.errors).toEqual([])
  const [layer] = runtime.layers()
  expect(layer.error).toBeUndefined()
  expect(layer.data?.rows).toBe(2)
})
