import { type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startGraphLink } from './doc-network'
import { docStore } from './doc-store'
import { NodeFields } from './field-adapter'
import { ParamRow } from './param-row'
import { getUIStore } from './ui-store'

const doc = (): EditorDoc => ({
  version: 1,
  name: 'graph-links',
  nodes: [
    { id: 'tilt', op: 'number', name: 'tilt', x: 0, y: 0, params: { value: 30 } },
    { id: 'map', op: 'deck', name: 'map', x: 300, y: 0, params: {} },
  ],
  edges: [],
})

beforeEach(() => {
  docStore().load(doc())
  getUIStore().setLinkDrag(null)
})
afterEach(() => cleanup())

const pitchRow = () => {
  const node = docStore().get().doc.nodes[1]
  const def = OPERATOR_INDEX.get('deck')?.params.find(p => p.name === 'pitch')
  const b = def && new NodeFields(docStore(), node).bindings.get('pitch')
  if (!def || !b) throw new Error('no pitch')
  const view = render(<ParamRow node={node} def={def} field={b.field} wired={false} />)
  return view.container.querySelector('[data-field-row]') as HTMLElement
}

describe('a wire dragged from the node graph onto Properties', () => {
  it('lights the rows that can read a node’s output, and a drop wires it', () => {
    startGraphLink(null, { nodeId: 'tilt', handleId: 'out', handleType: 'source' })
    const row = pitchRow()
    expect(row.hasAttribute('data-link-accepts')).toBe(true)
    fireEvent.pointerUp(row)
    expect(docStore().get().doc.edges).toContainEqual(
      expect.objectContaining({
        source: 'tilt',
        sourcePort: 'out',
        target: 'map',
        targetPort: 'par:pitch',
      })
    )
  })

  it('starts no link from a data input or a reference handle', () => {
    startGraphLink(null, { nodeId: 'map', handleId: 'layers', handleType: 'target' })
    expect(getUIStore().linkDrag).toBeNull()
    startGraphLink(null, { nodeId: 'tilt', handleId: 'ref-out', handleType: 'source' })
    expect(getUIStore().linkDrag).toBeNull()
    startGraphLink(null, { nodeId: 'map', handleId: 'par:zoom', handleType: 'target' })
    expect(getUIStore().linkDrag).toEqual({ kind: 'target', key: 'map.zoom' })
  })
})
