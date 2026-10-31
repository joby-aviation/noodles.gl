// DateMath, DateParts and DateFormat feeding a layer convert to date functions in row
// expressions: dates as epoch seconds, computed in DuckDB.
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import {
  CONVERTED_SCHEMA,
  MigrationError,
  type NoodlesEdge,
  type NoodlesNode,
  type NoodlesProject,
  toEditorDoc,
} from './to-editor-doc'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 30_000)

const op = (id: string, type: string, inputs: Record<string, unknown> = {}): NoodlesNode => ({
  id,
  type,
  data: { inputs },
})
const wire = (source: string, out: string, target: string, field: string): NoodlesEdge => ({
  id: `${source}.${out}->${target}.${field}`,
  source,
  sourceHandle: `out.${out}`,
  target,
  targetHandle: `par.${field}`,
})

// Two rows, a day and a half apart
const QUERY =
  "SELECT * FROM (VALUES (-74.0, 40.7, TIMESTAMP '2026-03-01 06:00:00'), (-73.9, 40.8, TIMESTAMP '2026-03-02 18:30:00')) t(lng, lat, ts)"

// A layer over the rows, its position from the rows' lng and lat
function project(
  nodes: NoodlesNode[],
  edges: NoodlesEdge[],
  layer = 'TextLayerOp'
): NoodlesProject {
  return {
    version: CONVERTED_SCHEMA,
    nodes: [
      op('/rows', 'DuckDbOp', { query: QUERY }),
      op('/when', 'AccessorOp', { expression: 'd.ts' }),
      op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
      op('/labels', layer),
      op('/deck', 'DeckRendererOp'),
      op('/out', 'OutOp'),
      ...nodes,
    ],
    edges: [
      wire('/rows', 'data', '/labels', 'data'),
      wire('/where', 'accessor', '/labels', 'getPosition'),
      wire('/labels', 'layer', '/deck', 'layers'),
      wire('/deck', 'vis', '/out', 'vis'),
      ...edges,
    ],
  }
}

async function values(p: NoodlesProject, attribute: string) {
  const { doc } = toEditorDoc(p)
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  const node = doc.nodes.find(n => n.op === 'attribute' && n.params.name === attribute)
  expect(node, attribute).toBeDefined()
  const preview = await runtime.preview(node?.id ?? '')
  return preview.rows.map(r => r[attribute])
}

describe('date operators', () => {
  it('formats a date column with a Noodles pattern', async () => {
    const p = project(
      [op('/label', 'DateFormatOp', { pattern: 'YYYY-MM-DD HH:mm' })],
      [wire('/when', 'accessor', '/label', 'date'), wire('/label', 'text', '/labels', 'getText')]
    )
    expect(await values(p, 'label')).toEqual(['2026-03-01 06:00', '2026-03-02 18:30'])
  })

  it('adds to a date and reads a part of the result', async () => {
    const p = project(
      [
        op('/later', 'DateMathOp', { operator: 'add', amount: 12, unit: 'hours' }),
        op('/parts', 'DatePartsOp'),
      ],
      [
        wire('/when', 'accessor', '/later', 'date'),
        wire('/later', 'result', '/parts', 'date'),
        wire('/parts', 'day', '/labels', 'getRadius'),
      ],
      'ScatterplotLayerOp'
    )
    // Twelve hours on: the first is still the 1st, the second is the 3rd
    expect(await values(p, 'parts_day')).toEqual([1, 3])
  })

  it('measures from a constant date, in fractional units', async () => {
    const p = project(
      [
        op('/start', 'DateTimeOp', { date: '2026-03-01T00:00:00' }),
        op('/age', 'DateMathOp', { operator: 'difference', unit: 'days' }),
      ],
      [
        wire('/start', 'date', '/age', 'date'),
        wire('/when', 'accessor', '/age', 'dateB'),
        wire('/age', 'result', '/labels', 'getRadius'),
      ],
      'ScatterplotLayerOp'
    )
    expect(await values(p, 'age')).toEqual([0.25, 1.7708333333333333])
  })

  it('refuses an operator it has no words for', () => {
    const p = project(
      [op('/odd', 'DateMathOp', { operator: 'round' })],
      [wire('/when', 'accessor', '/odd', 'date'), wire('/odd', 'result', '/labels', 'getRadius')],
      'ScatterplotLayerOp'
    )
    expect(() => toEditorDoc(p)).toThrow(MigrationError)
  })
})
