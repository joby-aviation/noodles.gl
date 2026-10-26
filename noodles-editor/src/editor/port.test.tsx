import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { docStore } from './doc-store'
import { useNodeLinkTarget } from './link-drag'
import { connections, outputKey } from './param-links'
import { Port } from './port'
import { getUIStore } from './ui-store'

const node = (id: string, op: string, params: DocNode['params'] = {}) =>
  ({ id, op, x: 0, y: 0, params }) satisfies DocNode

const doc = (): EditorDoc => ({
  version: 1,
  name: 'ports',
  nodes: [
    node('size', 'number', { value: 4 }),
    node('range', 'extent'),
    node('dots', 'scatter', { radiusScale: { ref: 'size/value' } }),
  ],
  edges: [],
})

beforeEach(() => docStore().load(doc()))
afterEach(() => {
  cleanup()
  getUIStore().setLinkDrag(null)
  vi.useRealTimers()
})

const tooltip = () => document.querySelector('[role="tooltip"]')

it('lists what a port is connected to after the pointer rests on it', () => {
  vi.useFakeTimers()
  const { container } = render(
    <Port
      side="out"
      drag={{ kind: 'source', key: 'size.value' }}
      connections={connections(docStore().get().doc, 'size.value').readBy}
      hint="Drag to connect"
    />
  )
  const port = container.querySelector('[data-port="out"]') as HTMLElement
  expect(port.className).toMatch(/portOn/)
  fireEvent.mouseEnter(port)
  expect(tooltip()).toBeNull()
  act(() => vi.advanceTimersByTime(500))
  expect(tooltip()?.textContent).toBe('Read bydots › Radius scale')
  // Pressing the port to drag it closes the list, so it doesn't cover the rows below
  fireEvent.mouseDown(port)
  expect(tooltip()).toBeNull()
})

it('says what dragging does while a port connects to nothing', () => {
  vi.useFakeTimers()
  const { container } = render(
    <Port side="in" drag={{ kind: 'target', key: 'dots.opacity' }} connections={[]} hint="Drag" />
  )
  const port = container.querySelector('[data-port="in"]') as HTMLElement
  expect(port.className).not.toMatch(/portOn/)
  fireEvent.mouseEnter(port)
  act(() => vi.advanceTimersByTime(500))
  expect(tooltip()?.textContent).toBe('ReadsDrag')
})

function NodeRow({ id }: { id: string }) {
  const link = useNodeLinkTarget(id)
  return (
    <div data-testid={id} {...link.props}>
      {link.picker}
    </div>
  )
}

it('offers the inputs of a dropped-on layer that take the dragged output', () => {
  const { getByTestId } = render(<NodeRow id="dots" />)
  act(() => getUIStore().setLinkDrag({ kind: 'source', key: outputKey('range', 'max') }))
  fireEvent.drop(getByTestId('dots'), { clientX: 10, clientY: 10 })
  const options = [...document.querySelectorAll('[role="option"]')].map(o => o.textContent)
  expect(options.some(o => o?.startsWith('/dots › Opacity'))).toBe(true)
  expect(options.some(o => o?.includes('Fill color'))).toBe(false)
})

it('offers the outputs and parameters of a dropped-on node a dragged input can read', () => {
  const { getByTestId } = render(<NodeRow id="range" />)
  act(() => getUIStore().setLinkDrag({ kind: 'target', key: 'dots.opacity' }))
  fireEvent.drop(getByTestId('range'), { clientX: 10, clientY: 10 })
  const options = [...document.querySelectorAll('[role="option"]')].map(o => o.textContent)
  expect(options).toEqual(['/range › minoutput', '/range › maxoutput'])
  fireEvent.click(document.querySelector('[role="option"]:last-child') as Element)
  expect(docStore().get().doc.edges).toEqual([
    expect.objectContaining({ source: 'range', sourcePort: 'max', targetPort: 'par:opacity' }),
  ])
})
