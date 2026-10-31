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
  fireEvent.pointerDown(port, { button: 0 })
  expect(tooltip()).toBeNull()
  fireEvent.pointerUp(window)
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
  fireEvent.pointerUp(getByTestId('dots'), { clientX: 10, clientY: 10 })
  const options = [...document.querySelectorAll('[role="option"]')].map(o => o.textContent)
  expect(options.some(o => o?.startsWith('/dots › Opacity'))).toBe(true)
  expect(options.some(o => o?.includes('Fill color'))).toBe(false)
})

it('offers the outputs and parameters of a dropped-on node a dragged input can read', () => {
  const { getByTestId } = render(<NodeRow id="range" />)
  act(() => getUIStore().setLinkDrag({ kind: 'target', key: 'dots.opacity' }))
  fireEvent.pointerUp(getByTestId('range'), { clientX: 10, clientY: 10 })
  const options = [...document.querySelectorAll('[role="option"]')].map(o => o.textContent)
  expect(options).toEqual(['/range › minoutput', '/range › maxoutput'])
  fireEvent.click(document.querySelector('[role="option"]:last-child') as Element)
  expect(docStore().get().doc.edges).toEqual([
    expect.objectContaining({ source: 'range', sourcePort: 'max', targetPort: 'par:opacity' }),
  ])
})

it('opens the list above a port near the bottom of the window', () => {
  vi.useFakeTimers()
  const { container } = render(
    <div style={{ position: 'fixed', bottom: 4, left: 10, width: 200, height: 24 }}>
      <Port side="in" drag={{ kind: 'target', key: 'dots.opacity' }} connections={[]} hint="Drag" />
    </div>
  )
  fireEvent.mouseEnter(container.querySelector('[data-port="in"]') as HTMLElement)
  act(() => vi.advanceTimersByTime(500))
  const tip = tooltip() as HTMLElement
  const port = container.querySelector('[data-port="in"]') as HTMLElement
  expect(tip.style.top).toBe('')
  expect(tip.getBoundingClientRect().bottom).toBeLessThanOrEqual(port.getBoundingClientRect().top)
})

it('draws a line from a dragged port to the pointer and links where it is released', () => {
  const { container, getByTestId } = render(
    <>
      <Port side="out" drag={{ kind: 'source', key: 'size.value' }} connections={[]} hint="" />
      <NodeRow id="dots" />
    </>
  )
  const port = container.querySelector('[data-port="out"]') as HTMLElement
  const line = () => document.querySelector('[data-link-line] path')
  fireEvent.pointerDown(port, { clientX: 5, clientY: 5, button: 0 })
  // A press alone is a click: no line, no drag
  expect(line()).toBeNull()
  fireEvent.pointerMove(window, { clientX: 60, clientY: 40 })
  expect(line()?.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ C /)
  expect(getUIStore().linkDrag).toEqual({ kind: 'source', key: 'size.value' })
  expect(getByTestId('dots').dataset.linkAccepts).toBe('true')

  fireEvent.pointerUp(getByTestId('dots'), { clientX: 60, clientY: 40 })
  expect(line()).toBeNull()
  const options = [...document.querySelectorAll('[role="option"]')].map(o => o.textContent)
  expect(options.some(o => o?.startsWith('/dots › Opacity'))).toBe(true)
})

it('cancels a port drag with Escape', () => {
  const { container } = render(
    <Port side="in" drag={{ kind: 'target', key: 'dots.opacity' }} connections={[]} hint="" />
  )
  fireEvent.pointerDown(container.querySelector('[data-port="in"]') as HTMLElement, { button: 0 })
  fireEvent.pointerMove(window, { clientX: 80, clientY: 80 })
  expect(document.querySelector('[data-link-line]')).not.toBeNull()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(document.querySelector('[data-link-line]')).toBeNull()
  expect(getUIStore().linkDrag).toBeNull()
})
