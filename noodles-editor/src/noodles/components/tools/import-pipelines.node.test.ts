// The SQL an import writes, run on DuckDB: renamed columns and geometry parsed from text.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../../../runtime/__tests__/duckdb-node'
import { ProgramRuntime } from '../../../runtime/program-runtime'
import { type CoordinateDetection, detectCoordinates, type Row } from './detect-coordinates'
import { createImportDoc, type DetectedFormat } from './import-pipelines'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

const EMPTY: EditorDoc = { version: 1, name: 'import', nodes: [], edges: [] }
const detect = (rows: Row[]): CoordinateDetection => detectCoordinates(Object.keys(rows[0]), rows)

async function drawn(
  url: string,
  csv: string,
  format: DetectedFormat,
  detection: CoordinateDetection
) {
  duck.registerText(url, csv)
  const built = createImportDoc({
    doc: EMPTY,
    url,
    format,
    basePosition: { x: 0, y: 0 },
    detection,
  })
  const doc = { ...EMPTY, nodes: built.nodes, edges: built.edges }
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  expect(runtime.program()?.errors).toEqual([])
  return Object.fromEntries(
    runtime.layers().map(l => [doc.nodes.find(n => n.id === l.id)?.name, l.data?.rows])
  )
}

describe('imported files on DuckDB', () => {
  it('draws points from columns the expression language cannot name', async () => {
    const rows = [
      { 'Lon (deg)': -74, 'Lat (deg)': 40.7 },
      { 'Lon (deg)': -0.1, 'Lat (deg)': 51.5 },
    ]
    const csv = '"Lon (deg)","Lat (deg)"\n-74,40.7\n-0.1,51.5\n'
    expect(await drawn('odd.csv', csv, 'csv', detect(rows))).toEqual({ points1: 2 })
  })

  it('draws WKT points, and WKT shapes as polygons, skipping an unreadable cell', async () => {
    const points = [{ WKT: 'POINT (1 2)' }, { WKT: 'POINT (3 4)' }]
    expect(
      await drawn('points.csv', 'WKT\n"POINT (1 2)"\n"POINT (3 4)"\n', 'csv', detect(points))
    ).toEqual({ points1: 2 })
    const shapes = [
      { geom: 'POLYGON ((0 0, 1 0, 1 1, 0 0))' },
      { geom: 'POLYGON ((5 5, 6 5, 6 6, 5 5))' },
    ]
    const csv =
      'geom,name\n"POLYGON ((0 0, 1 0, 1 1, 0 0))",a\n"POLYGON ((5 5, 6 5, 6 6, 5 5))",b\nnot wkt,c\n'
    // Three vertices per triangle once the closing one is dropped, two triangles
    expect(await drawn('shapes.csv', csv, 'csv', detect(shapes))).toMatchObject({ fill1: 6 })
  })
})
