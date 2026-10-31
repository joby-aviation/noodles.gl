// The network layout: columns by data flow, chains level port to port, notes above the node
// they explain, layers in the order the deck draws them
import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { applyLayout, layoutNetwork } from './doc-layout'

const node = (id: string, op: string, x = 0, y = 0, params = {}): DocNode => ({
  id,
  op,
  name: id,
  x,
  y,
  params,
})
const wire = (source: string, target: string, targetPort = 'in', index?: number) => ({
  id: `${source}-${target}`,
  source,
  sourcePort: 'out',
  target,
  targetPort,
  ...(index === undefined ? {} : { index }),
})
const doc = (nodes: DocNode[], edges: ReturnType<typeof wire>[]): EditorDoc => ({
  version: 1,
  name: 'layout',
  nodes,
  edges,
})
const options = {
  size: (id: string) => (id.startsWith('note') ? { w: 300, h: 80 } : { w: 200, h: 80 }),
  noteHeight: () => 60,
}

describe('layoutNetwork', () => {
  it('puts a chain in columns, left to right and level, wherever it started', () => {
    const placed = layoutNetwork(
      doc(
        [
          node('map', 'deck', -500, 300),
          node('dots', 'scatter', 900, -40),
          node('data', 'file', 400, 700),
        ],
        [wire('data', 'dots'), wire('dots', 'map', 'layers', 0)]
      ),
      undefined,
      options
    )
    const [data, dots, map] = ['data', 'dots', 'map'].map(id => placed.get(id)!)
    expect(data.x).toBeLessThan(dots.x)
    expect(dots.x).toBeLessThan(map.x)
    expect(new Set([data.y, dots.y, map.y]).size).toBe(1)
  })

  it('centers a node on a taller one it reads', () => {
    const placed = layoutNetwork(
      doc([node('data', 'file'), node('dots', 'scatter')], [wire('data', 'dots')]),
      undefined,
      { ...options, size: (id: string) => ({ w: 200, h: id === 'data' ? 160 : 80 }) }
    )
    expect(placed.get('dots')!.y - placed.get('data')!.y).toBe(40)
  })

  it('stacks layers in the order the deck draws them, without overlap', () => {
    const placed = layoutNetwork(
      doc(
        [
          node('data', 'file'),
          node('b', 'scatter', 0, 0),
          node('a', 'path', 0, 500),
          node('map', 'deck'),
        ],
        [
          wire('data', 'a'),
          wire('data', 'b'),
          wire('a', 'map', 'layers', 0),
          wire('b', 'map', 'layers', 1),
        ]
      ),
      undefined,
      options
    )
    const [a, b] = [placed.get('a')!, placed.get('b')!]
    expect(a.x).toBe(b.x)
    expect(b.y).toBeGreaterThanOrEqual(a.y + 80)
  })

  it('places a source a reference reads in the column before its reader', () => {
    const placed = layoutNetwork(
      doc(
        [
          node('data', 'file'),
          node('attr', 'attribute'),
          node('dots', 'scatter', 0, 0, { fillColor: { ref: 'swatch/color' } }),
          node('swatch', 'color'),
        ],
        [wire('data', 'attr'), wire('attr', 'dots')]
      ),
      undefined,
      options
    )
    expect(placed.get('swatch')!.x).toBe(placed.get('attr')!.x)
  })

  it('puts a note above the node it explains, as wide as its column', () => {
    const d = doc(
      [
        node('data', 'file', 0, 100),
        node('note-data', 'comment', 0, 0),
        node('dots', 'scatter', 300, 100),
      ],
      [wire('data', 'dots')]
    )
    const placed = layoutNetwork(d, undefined, options)
    const [note, data] = [placed.get('note-data')!, placed.get('data')!]
    expect(note.x).toBe(data.x)
    expect(note.y + 60).toBeLessThanOrEqual(data.y)
    expect(note.width).toBe(220)
    const laid = applyLayout(d, placed)
    expect(laid.nodes.find(n => n.id === 'note-data')?.params).toMatchObject({
      width: 220,
      height: 60,
    })
  })

  it('lays out only the network asked for', () => {
    const inside = { ...node('inner', 'filter'), parent: 'net' }
    const placed = layoutNetwork(
      doc([node('net', 'subnet', 50, 50), inside], []),
      undefined,
      options
    )
    expect([...placed.keys()]).toEqual(['net'])
  })
})
