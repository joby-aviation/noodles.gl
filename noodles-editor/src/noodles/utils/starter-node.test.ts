import type { DocEdge, DocNode, EditorDoc } from '@noodles.gl/planner'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimStarterSelection,
  findStarterNodeId,
  panViewportToShow,
  resetStarterSelectionForTests,
} from './starter-node'

const LAYERS = new Set(['scatter', 'arc', 'hexagon', 'grid'])
const isLayerOp = (op: string) => LAYERS.has(op)

const node = (id: string, op: string, extra: Partial<DocNode> = {}): DocNode => ({
  id,
  op,
  name: id,
  x: 0,
  y: 0,
  params: {},
  ...extra,
})
let n = 0
const edge = (source: string, target: string, targetPort: string, index?: number): DocEdge => ({
  id: `e${n++}`,
  source,
  sourcePort: 'out',
  target,
  targetPort,
  ...(index !== undefined && { index }),
})
const doc = (nodes: DocNode[], edges: DocEdge[], meta?: EditorDoc['meta']) => ({
  nodes,
  edges,
  meta,
})

describe('findStarterNodeId', () => {
  it("picks the first layer wired into the deck, in the deck's layer order", () => {
    const project = doc(
      [node('arcs', 'arc'), node('pickups', 'scatter'), node('deck', 'deck')],
      [edge('arcs', 'deck', 'layers', 1), edge('pickups', 'deck', 'layers', 0)]
    )
    expect(findStarterNodeId(project, isLayerOp)).toBe('pickups')
  })

  it('looks upstream through operators that pass layers along', () => {
    const project = doc(
      [
        node('data', 'file'),
        node('hexes', 'hexagon'),
        node('grid', 'grid'),
        node('switch', 'switch'),
        node('deck', 'deck'),
      ],
      [
        edge('switch', 'deck', 'layers'),
        edge('hexes', 'switch', 'in', 0),
        edge('grid', 'switch', 'in', 1),
        edge('data', 'hexes', 'in'),
      ]
    )
    expect(findStarterNodeId(project, isLayerOp)).toBe('hexes')
  })

  it('skips layers inside subnets, since the graph opens at the root', () => {
    const project = doc(
      [
        node('group', 'subnet'),
        node('inner', 'scatter', { parent: 'group' }),
        node('outer', 'scatter'),
        node('deck', 'deck'),
      ],
      [edge('group', 'deck', 'layers', 0), edge('outer', 'deck', 'layers', 1)]
    )
    expect(findStarterNodeId(project, isLayerOp)).toBe('outer')
  })

  it('returns null without a deck or without layers', () => {
    expect(findStarterNodeId(doc([node('a', 'scatter')], []), isLayerOp)).toBeNull()
    expect(findStarterNodeId(doc([node('deck', 'deck')], []), isLayerOp)).toBeNull()
  })

  it('does not loop forever on a cycle', () => {
    const project = doc(
      [node('a', 'code'), node('b', 'code'), node('deck', 'deck')],
      [edge('a', 'deck', 'layers'), edge('b', 'a', 'in'), edge('a', 'b', 'in')]
    )
    expect(findStarterNodeId(project, isLayerOp)).toBeNull()
  })

  it('uses meta.startNode when it names a root node, by id or name', () => {
    const nodes = [
      node('first', 'scatter'),
      node('n2', 'number', { name: 'controls' }),
      node('deck', 'deck'),
    ]
    const edges = [edge('first', 'deck', 'layers')]
    expect(findStarterNodeId(doc(nodes, edges, { startNode: 'n2' }), isLayerOp)).toBe('n2')
    expect(findStarterNodeId(doc(nodes, edges, { startNode: 'controls' }), isLayerOp)).toBe('n2')
    // A start node that is not in the graph falls back to the deck's first layer
    expect(findStarterNodeId(doc(nodes, edges, { startNode: 'gone' }), isLayerOp)).toBe('first')
  })
})

describe('claimStarterSelection', () => {
  beforeEach(() => resetStarterSelectionForTests())

  const example = { exampleId: 'nyc-taxis', fromBundledExample: true, agentControlled: false }

  it('claims an example only once per session', () => {
    expect(claimStarterSelection(example)).toBe(true)
    expect(claimStarterSelection(example)).toBe(false)
    expect(claimStarterSelection({ ...example, exampleId: 'world-flights' })).toBe(true)
  })

  it('never claims a copy the user may have edited', () => {
    expect(claimStarterSelection({ ...example, fromBundledExample: false })).toBe(false)
    // The bundled load that follows still gets its selection
    expect(claimStarterSelection(example)).toBe(true)
  })

  it('never claims when an agent drives the editor', () => {
    expect(claimStarterSelection({ ...example, agentControlled: true })).toBe(false)
  })
})

describe('panViewportToShow', () => {
  const pane = { width: 1000, height: 500 }

  it('leaves the view alone when the node is already on screen', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    expect(
      panViewportToShow({ x: 100, y: 100, width: 200, height: 100 }, viewport, pane)
    ).toBeNull()
  })

  it('centers an off-screen node without changing the zoom', () => {
    const viewport = { x: 0, y: 0, zoom: 2 }
    const next = panViewportToShow({ x: 1000, y: 1000, width: 100, height: 50 }, viewport, pane)
    expect(next).toEqual({ x: -1600, y: -1800, zoom: 2 })
  })

  it('only moves the axis the node overflows', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    const next = panViewportToShow({ x: 100, y: 600, width: 200, height: 100 }, viewport, pane)
    expect(next).toEqual({ x: 0, y: -400, zoom: 1 })
  })

  it('lines up a node taller than the pane by its top edge', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    const next = panViewportToShow({ x: 100, y: -300, width: 200, height: 800 }, viewport, pane)
    expect(next).toEqual({ x: 0, y: 324, zoom: 1 })
  })
})
