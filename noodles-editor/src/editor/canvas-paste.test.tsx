// Pasting onto the network: a table from a spreadsheet becomes a Table node after the import
// dialog, copied nodes paste as nodes, and a paste into a text field is left alone
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../index.css'
import { CanvasPaste } from './canvas-paste'
import { DocNetwork } from './doc-network'
import { docStore, EMPTY_DOC } from './doc-store'

function paste(target: EventTarget, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (mime: string) => data[mime] ?? '' },
  })
  act(() => target.dispatchEvent(event))
  return event
}

function renderNetwork() {
  render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 400 }}>
        <DocNetwork>
          <CanvasPaste />
        </DocNetwork>
      </div>
    </ReactFlowProvider>
  )
}

const pane = () => document.querySelector<HTMLElement>('.react-flow__pane') as HTMLElement

describe('pasting onto the network', () => {
  beforeEach(() => {
    vi.useRealTimers()
    docStore().load(structuredClone(EMPTY_DOC))
  })
  afterEach(() => cleanup())

  it('makes a Table node from a pasted spreadsheet range', async () => {
    renderNetwork()
    await waitFor(() => expect(pane()).toBeTruthy())
    const event = paste(pane(), { 'text/plain': 'name\tvalue\nAlpha\t42\nBeta\t7' })
    expect(event.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Table' }))

    const { doc, selection } = docStore().get()
    expect(doc.nodes.map(n => n.op)).toEqual(['table'])
    const table = doc.nodes[0]
    expect(JSON.parse(String(table.params.rows))).toEqual([
      { name: 'Alpha', value: 42 },
      { name: 'Beta', value: 7 },
    ])
    expect(
      JSON.parse(String(table.params.schema)).columns.map((c: { name: string }) => c.name)
    ).toEqual(['name', 'value'])
    expect(selection).toEqual([table.id])
  })

  it('pastes copied nodes, wherever the paste lands', async () => {
    renderNetwork()
    await waitFor(() => expect(pane()).toBeTruthy())
    const clip = {
      type: 'application/x-noodles-doc-nodes',
      nodes: [{ id: 'k', op: 'number', name: 'k', x: 0, y: 0, params: { value: 3 } }],
      edges: [],
    }
    const event = paste(window, { 'text/plain': JSON.stringify(clip) })
    expect(event.defaultPrevented).toBe(true)
    expect(
      docStore()
        .get()
        .doc.nodes.map(n => n.op)
    ).toEqual(['number'])
    expect(screen.queryByRole('button', { name: 'Create Table' })).toBeNull()
  })

  it('leaves a paste into a text field alone', async () => {
    renderNetwork()
    await waitFor(() => expect(pane()).toBeTruthy())
    const input = document.createElement('input')
    document.body.appendChild(input)
    const event = paste(input, { 'text/plain': 'name\tvalue\nAlpha\t42' })
    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('button', { name: 'Create Table' })).toBeNull()
    input.remove()
  })
})
