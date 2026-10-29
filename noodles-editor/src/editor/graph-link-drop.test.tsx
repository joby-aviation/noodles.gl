import { type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDeckOperators } from '../runtime/deck-ops'
import { DocNetwork, startGraphLink } from './doc-network'
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

describe('a Properties port dragged over the node graph', () => {
  it('reveals the parameter handles it can drive, and no others', { timeout: 30_000 }, async () => {
    vi.useRealTimers()
    const { container } = render(
      <ReactFlowProvider>
        <div style={{ width: 1200, height: 600 }}>
          <DocNetwork />
        </div>
      </ReactFlowProvider>
    )
    const pitch = () =>
      container.querySelector('.react-flow__handle[data-nodeid="map"][data-handleid="par:pitch"]')
    await waitFor(
      () => expect(container.querySelector('.react-flow__node[data-id="map"]')).toBeTruthy(),
      {
        timeout: 10_000,
      }
    )
    expect(pitch()).toBeNull()
    act(() => getUIStore().setLinkDrag({ kind: 'source', key: 'tilt.value' }))
    await waitFor(() => expect(pitch()).toBeTruthy())
    // The drag over, the handle goes again
    act(() => getUIStore().setLinkDrag(null))
    await waitFor(() => expect(pitch()).toBeNull())
  })
})

describe('a View State dropped on a deck in the node graph', () => {
  it('wires into its view state at once, with no picker to choose from', {
    timeout: 30_000,
  }, async () => {
    vi.useRealTimers()
    registerDeckOperators()
    docStore().load({
      version: 1,
      name: 'camera',
      nodes: [
        { id: 'shot', op: 'view-state', name: 'shot', x: 0, y: 0, params: {} },
        { id: 'map', op: 'deck', name: 'map', x: 300, y: 0, params: {} },
      ],
      edges: [],
    })
    const { container } = render(
      <ReactFlowProvider>
        <div style={{ width: 1200, height: 600 }}>
          <DocNetwork />
        </div>
      </ReactFlowProvider>
    )
    const deck = () =>
      container.querySelector('.react-flow__node[data-id="map"] > div') as HTMLElement
    await waitFor(() => expect(deck()).toBeTruthy(), { timeout: 10_000 })
    act(() => getUIStore().setLinkDrag({ kind: 'source', key: 'shot>viewState' }))
    fireEvent.pointerUp(deck())
    expect(docStore().get().doc.edges).toContainEqual(
      expect.objectContaining({
        source: 'shot',
        sourcePort: 'viewState',
        target: 'map',
        targetPort: 'viewState',
      })
    )
    expect(document.querySelector('input[placeholder="Which input reads it?"]')).toBeNull()
  })
})
