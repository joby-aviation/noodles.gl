import type { DocEdge, DocNode, EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { dependencies, layerStack, moveLayer } from './layer-stack'

const node = (
  id: string,
  op: string,
  params: DocNode['params'] = {},
  extra: Partial<DocNode> = {}
) => ({ id, op, x: 0, y: 0, params, ...extra }) satisfies DocNode

const edge = (source: string, target: string, targetPort: string, index?: number): DocEdge => ({
  id: `${source}->${target}.${targetPort}`,
  source,
  sourcePort: 'out',
  target,
  targetPort,
  ...(index !== undefined ? { index } : {}),
})

// quakes feeds both layers; dots is colored through a filter and a ramp, and its radius is
// driven by a number node; arcs reads a parameter of ctl by reference. The deck draws dots,
// then arcs on top, through a view.
function fixture(): EditorDoc {
  return {
    version: 1,
    name: 'stack',
    nodes: [
      node('quakes', 'file'),
      node('filter', 'filter'),
      node('ramp', 'color-ramp'),
      node('radius', 'number'),
      node('dots', 'scatter'),
      node('ctl', 'number'),
      node('arcs', 'arc', { width: { ref: 'ctl/value' } }),
      node('view', 'map-view'),
      node('deck', 'deck'),
      node('note', 'comment'),
      node('spare', 'number'),
    ],
    edges: [
      edge('quakes', 'filter', 'in'),
      edge('filter', 'ramp', 'in'),
      edge('ramp', 'dots', 'in'),
      edge('radius', 'dots', 'par:radius'),
      edge('quakes', 'arcs', 'in'),
      edge('dots', 'deck', 'layers', 0),
      edge('arcs', 'deck', 'layers', 1),
      edge('view', 'deck', 'views'),
    ],
  }
}

describe('dependencies', () => {
  it('reads wires, parameter drivers and references', () => {
    const deps = dependencies(fixture())
    expect(deps.get('dots')).toEqual(['ramp', 'radius'])
    expect(deps.get('arcs')).toEqual(['quakes', 'ctl'])
  })

  it('reads ch() in expressions and skips references to missing nodes', () => {
    const doc = fixture()
    doc.nodes.push(
      node('expr', 'number', { value: { expr: "ch('ctl/value') * 2 + ch('gone/x')" } })
    )
    expect(dependencies(doc).get('expr')).toEqual(['ctl'])
  })
})

describe('layerStack', () => {
  it('lists the top layer first, each with what feeds it, sources first', () => {
    const stack = layerStack(fixture())
    expect(stack.layers).toEqual([
      { id: 'arcs', visible: true, upstream: ['quakes', 'ctl'] },
      { id: 'dots', visible: true, upstream: ['quakes', 'filter', 'ramp', 'radius'] },
    ])
  })

  it('marks a node that feeds more than one layer as shared', () => {
    expect(layerStack(fixture()).shared).toEqual(new Map([['quakes', ['arcs', 'dots']]]))
  })

  it('puts the deck and its other inputs in the scene, and the rest in unused', () => {
    const stack = layerStack(fixture())
    expect(stack.scene).toEqual(['deck', 'view'])
    // The comment is not listed anywhere
    expect(stack.unused).toEqual(['spare'])
  })

  it('shows a bypassed layer as hidden', () => {
    const doc = fixture()
    doc.nodes.find(n => n.id === 'arcs')!.flags = { bypass: true }
    expect(layerStack(doc).layers[0]).toMatchObject({ id: 'arcs', visible: false })
  })

  it('has no layers without a deck, and lists every root node as unused', () => {
    const doc = fixture()
    doc.nodes = doc.nodes.filter(n => n.id !== 'deck')
    const stack = layerStack(doc)
    expect(stack.layers).toEqual([])
    expect(stack.unused).toContain('dots')
    expect(stack.unused).not.toContain('note')
  })

  it('leaves nodes inside a subnet out of unused', () => {
    const doc = fixture()
    doc.nodes.push(node('group', 'subnet'), node('inner', 'number', {}, { parent: 'group' }))
    expect(layerStack(doc).unused).toEqual(['spare', 'group'])
  })
})

describe('moveLayer', () => {
  const order = (doc: EditorDoc) => layerStack(doc).layers.map(l => l.id)

  it('moves a layer to the top of the stack by raising its edge index', () => {
    const doc = fixture()
    moveLayer(doc, 'dots', 0)
    expect(order(doc)).toEqual(['dots', 'arcs'])
    expect(doc.edges.find(e => e.source === 'dots' && e.target === 'deck')?.index).toBe(1)
  })

  it('clamps the position and ignores a node the deck does not draw', () => {
    const doc = fixture()
    moveLayer(doc, 'arcs', 99)
    expect(order(doc)).toEqual(['dots', 'arcs'])
    moveLayer(doc, 'spare', 0)
    expect(order(doc)).toEqual(['dots', 'arcs'])
  })
})
