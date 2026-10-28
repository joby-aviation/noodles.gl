// The per-row channels Noodles' layers took as accessors: a scatterplot's and a column's outline
// color and width, a trail's width, a polygon's outline width, an arc's tilt and a label's border.
// Each is a column the worker computes and deck reads as a binary attribute.
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, expect, it } from 'vitest'
import { DeckLayerBuilder } from '../deck-layers'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
}, 60_000)

const ROWS =
  "SELECT CAST(i AS DOUBLE) AS i, 'p' || i AS name, [[0.0, i], [1.0, i], [1.0, i + 0.5]] AS path, [0.0, 1.0, 2.0] AS ts FROM range(3) t(i)"

const layers: [string, string, Record<string, unknown>][] = [
  [
    'dots',
    'scatter',
    {
      position: '[i, 0.0]',
      lineWidth: 'i + 1',
      lineColorChannel: '[1.0, 0.0, 0.0]',
      stroked: true,
    },
  ],
  ['bars', 'column', { position: '[i, 0.0]', elevation: 'i', lineWidth: 'i + 1', stroked: true }],
  ['trails', 'trips', { position: 'path', timestamp: 'ts', width: 'i + 1' }],
  ['arcs', 'arc', { source: '[i, 0.0]', target: '[i, 1.0]', tiltBy: 'i * 10' }],
  [
    'labels',
    'text',
    { position: '[i, 0.0]', text: 'name', borderWidthBy: 'i + 1', background: true },
  ],
]

const doc: EditorDoc = {
  version: 1,
  name: 'layer-channels',
  nodes: [
    { id: 'rows', op: 'sql', x: 0, y: 0, params: { query: ROWS } },
    ...layers.map(([id, op, params]) => ({ id, op, x: 0, y: 0, params: params as never })),
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    ...layers.map(([id]) => ({
      id: `in-${id}`,
      source: 'rows',
      sourcePort: 'out',
      target: id,
      targetPort: 'in',
    })),
    ...layers.map(([id], index) => ({
      id: `out-${id}`,
      source: id,
      sourcePort: 'out',
      target: 'map',
      targetPort: 'layers',
      index,
    })),
  ],
}

it('computes each per-row channel and hands it to deck', async () => {
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.error()).toBeUndefined()
  const built = new DeckLayerBuilder().build(
    runtime.layers().map(l => {
      expect(l.error, l.id).toBeUndefined()
      return {
        id: l.id,
        kind: l.plan.kind,
        data: l.data,
        bindings: l.plan.plan.layer?.bindings ?? [],
        props: l.props,
      }
    })
  )
  const attribute = (id: string, name: string) => {
    const props = built.get(id)?.[0]?.props as unknown as {
      data: { attributes: Record<string, { value: ArrayLike<number> }> }
    }
    return Array.from(props.data.attributes[name]?.value ?? [])
  }
  expect(attribute('dots', 'getLineWidth')).toEqual([1, 2, 3])
  expect(attribute('dots', 'getLineColor').slice(0, 4)).toEqual([255, 0, 0, 255])
  expect(attribute('bars', 'getLineWidth')).toEqual([1, 2, 3])
  // A trail's width is per vertex, three to a trip
  expect(attribute('trails', 'getWidth')).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3])
  expect(attribute('arcs', 'getTilt')).toEqual([0, 10, 20])
  const text = built.get('labels')?.[0]?.props as unknown as {
    data: unknown[]
    getBorderWidth: (d: unknown) => number
  }
  expect(text.data.map(d => text.getBorderWidth(d))).toEqual([1, 2, 3])
})
