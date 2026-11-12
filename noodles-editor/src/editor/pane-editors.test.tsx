import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { docStore } from './doc-store'
import { PaneEditorFor, rampStops, stopsText } from './pane-editors'

const docWith = (node: DocNode): EditorDoc => ({
  version: 1,
  name: 'test',
  nodes: [node],
  edges: [],
})

const nodeIn = (id: string) =>
  docStore()
    .get()
    .doc.nodes.find(n => n.id === id) as DocNode

describe('pane editors', () => {
  afterEach(() => cleanup())

  it('gives ramp stops ids and writes them back sorted, without ids', () => {
    const node: DocNode = {
      id: 'r',
      op: 'ramp',
      x: 0,
      y: 0,
      params: {
        stops: JSON.stringify([
          { pos: 1, val: 0 },
          { pos: 0, val: 1, interp: 'hold' },
        ]),
      },
    }
    const stops = rampStops(node)
    expect(stops.map(st => st.id)).toEqual(['0', '1'])
    expect(JSON.parse(stopsText(stops))).toEqual([
      { pos: 0, val: 1, interp: 'hold' },
      { pos: 1, val: 0 },
    ])
  })

  it('starts an empty ramp from the default stops', () => {
    const node: DocNode = { id: 'r', op: 'ramp', x: 0, y: 0, params: { stops: '' } }
    expect(rampStops(node).map(st => [st.pos, st.val])).toEqual([
      [0, 0],
      [1, 1],
    ])
  })

  it("adds a table row to the node's rows parameter", () => {
    const node: DocNode = {
      id: 't',
      op: 'table',
      x: 0,
      y: 0,
      params: { rows: JSON.stringify([{ name: 'a', n: 1 }]), schema: '' },
    }
    docStore().load(docWith(node))
    const { getByRole } = render(<PaneEditorFor node={nodeIn('t')} />)
    fireEvent.click(getByRole('button', { name: /add row/i }))
    const rows = JSON.parse(String(nodeIn('t').params.rows))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ name: 'a', n: 1 })
  })

  it('draws nothing for an operator without an editor', () => {
    const node: DocNode = { id: 'f', op: 'filter', x: 0, y: 0, params: {} }
    const { container } = render(<PaneEditorFor node={node} />)
    expect(container.innerHTML).toBe('')
  })
})
