import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { docStore, useEditor } from '../../editor/doc-store'
import { PaneEditorFor } from '../../editor/pane-editors'

// What the engine evaluated at the playhead: an animated cell's value
const engine = vi.hoisted(() => {
  const slots = new Map<string, unknown>()
  return { slots, state: { slots, errors: [], layers: [], ready: true } }
})
vi.mock('../../editor/doc-engine', () => ({
  useEngineState: () => engine.state,
  currentEngine: () => undefined,
}))

const ROWS = [
  { name: 'Alice', count: 10 },
  { name: 'Bob', count: 20 },
]
const table: DocNode = {
  id: 'table',
  op: 'table',
  name: 'table',
  x: 0,
  y: 0,
  params: { rows: JSON.stringify(ROWS) },
}
const doc = (tracks: NonNullable<EditorDoc['timeline']>['tracks'] = []): EditorDoc => ({
  version: 1,
  name: 't',
  nodes: [table],
  edges: [],
  timeline: { length: 10, fps: 30, tracks },
})

// The pane as the app shows it: the node re-read from the document on every edit
function Pane() {
  const node = useEditor(st => st.doc.nodes[0])
  return <PaneEditorFor node={node} />
}

const track = (target: string) =>
  docStore()
    .get()
    .doc.timeline?.tracks.find(t => t.target === target)

describe('TableEditor cell keyframes', () => {
  afterEach(() => {
    cleanup()
    engine.slots.clear()
  })

  it('offers a keyframe on every cell a keyframe can hold', () => {
    docStore().load(doc())
    render(<Pane />)
    expect(screen.getAllByRole('button', { name: 'Add keyframe' })).toHaveLength(4)
  })

  it('keys a cell at the playhead with its value, without editing it', () => {
    docStore().load(doc())
    docStore().set({ time: 2 })
    render(<Pane />)
    // Row 1, "count": the second row's buttons come after the first row's two
    fireEvent.click(screen.getAllByRole('button', { name: 'Add keyframe' })[3])
    expect(track('table.rows.1.count')?.keyframes.map(k => [k.time, k.value])).toEqual([[2, 20]])
    expect(screen.queryByRole('spinbutton')).toBeNull()
    // Text holds rather than eases
    fireEvent.click(screen.getAllByRole('button', { name: 'Add keyframe' })[0])
    expect(track('table.rows.0.name')?.keyframes[0]).toMatchObject({
      value: 'Alice',
      interpolation: 'hold',
    })
  })

  it('shows an animated cell at the playhead, and removes the key there', () => {
    docStore().load(
      doc([
        {
          target: 'table.rows.0.count',
          keyframes: [{ id: 'k', time: 0, value: 5, interpolation: 'linear' }],
        },
      ])
    )
    engine.slots.set('table.rows.0.count', 7.5)
    render(<Pane />)
    expect(screen.getByText('7.5')).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove keyframe' }))
    })
    expect(track('table.rows.0.count')).toBeUndefined()
    // The typed rows were never touched
    expect(JSON.parse(String(docStore().get().doc.nodes[0].params.rows))).toEqual(ROWS)
  })

  it('keys an edit to an animated cell at the playhead, leaving the typed rows', () => {
    docStore().load(
      doc([
        {
          target: 'table.rows.1.count',
          keyframes: [{ id: 'k', time: 0, value: 20, interpolation: 'linear' }],
        },
      ])
    )
    docStore().set({ time: 3 })
    engine.slots.set('table.rows.1.count', 20)
    render(<Pane />)
    // A click selects the cell; a double click edits it
    fireEvent.doubleClick(screen.getByText('20').closest('[role="gridcell"]') as HTMLElement)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(track('table.rows.1.count')?.keyframes.map(k => [k.time, k.value])).toEqual([
      [0, 20],
      [3, 45],
    ])
    expect(JSON.parse(String(docStore().get().doc.nodes[0].params.rows))).toEqual(ROWS)
  })
})
