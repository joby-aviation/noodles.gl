import type { EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { graphDrop } from './link-drag'

const doc = (): EditorDoc => ({
  version: 1,
  name: 'links',
  nodes: [
    { id: 'tilt', op: 'number', name: 'tilt', x: 0, y: 0, params: { value: 30 } },
    { id: 'rows', op: 'sql', name: 'rows', x: 0, y: 0, params: { query: 'SELECT 1 AS x' } },
    { id: 'map', op: 'deck', name: 'map', x: 300, y: 0, params: {} },
  ],
  edges: [],
})

// A node graph handle, as xyflow draws one
const handle = (nodeId: string, port: string, type: 'source' | 'target') => {
  const el = document.createElement('div')
  el.className = `react-flow__handle ${type}`
  el.setAttribute('data-nodeid', nodeId)
  el.setAttribute('data-handleid', port)
  return el
}

describe('a property port dropped on the node graph', () => {
  it('makes a property’s output drive a node’s parameter handle, as a reference', () => {
    const d = doc()
    const apply = graphDrop(
      d,
      { kind: 'source', key: 'tilt.value' },
      handle('map', 'par:pitch', 'target')
    )
    expect(apply?.apply(d)).toBe(true)
    expect(apply?.target).toBe('map.pitch')
    expect(d.nodes.find(n => n.id === 'map')?.params.pitch).toEqual({ ref: 'tilt/value' })
  })

  it('wires an output row into a parameter handle, and a property’s input to a node’s output', () => {
    const d = doc()
    graphDrop(d, { kind: 'source', key: 'tilt>out' }, handle('map', 'par:pitch', 'target'))?.apply(
      d
    )
    expect(d.edges).toContainEqual(
      expect.objectContaining({
        source: 'tilt',
        sourcePort: 'out',
        target: 'map',
        targetPort: 'par:pitch',
      })
    )
    const e = doc()
    graphDrop(e, { kind: 'target', key: 'map.bearing' }, handle('tilt', 'out', 'source'))?.apply(e)
    expect(e.edges).toContainEqual(
      expect.objectContaining({ source: 'tilt', target: 'map', targetPort: 'par:bearing' })
    )
  })

  it('refuses what can’t link: a table into a number, an input onto an input, a reference handle', () => {
    const d = doc()
    expect(
      graphDrop(d, { kind: 'target', key: 'map.pitch' }, handle('rows', 'out', 'source'))
    ).toBeUndefined()
    expect(
      graphDrop(d, { kind: 'target', key: 'map.pitch' }, handle('map', 'par:zoom', 'target'))
    ).toBeUndefined()
    expect(
      graphDrop(d, { kind: 'source', key: 'tilt.value' }, handle('map', 'ref-in', 'target'))
    ).toBeUndefined()
    expect(graphDrop(d, { kind: 'source', key: 'tilt.value' }, null)).toBeUndefined()
  })
})
