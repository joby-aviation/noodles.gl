// A multi input draws as a pill that lists its wires in order, and each wire ends on its own
// slot, even when the document numbers them with gaps
import type { EditorDoc } from '@noodles.gl/planner'
import { cleanup, render, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../index.css'
import '../noodles/layers.css'
import { DocNetwork } from './doc-network'
import { docStore } from './doc-store'
import { MIN_PILL_HEIGHT, pillHeight } from './multi-port'

const doc = (): EditorDoc => ({
  version: 1,
  name: 'pill',
  nodes: [
    { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
    { id: 'a', op: 'scatter', x: 300, y: 0, params: { position: '[x, y]' } },
    { id: 'b', op: 'scatter', x: 300, y: 150, params: { position: '[x, y]' } },
    { id: 'c', op: 'scatter', x: 300, y: 300, params: { position: '[x, y]' } },
    { id: 'deck', op: 'deck', x: 600, y: 100, params: {} },
  ],
  edges: [
    { id: 'e0', source: 'src', sourcePort: 'out', target: 'a', targetPort: 'in' },
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'b', targetPort: 'in' },
    { id: 'e2', source: 'src', sourcePort: 'out', target: 'c', targetPort: 'in' },
    // Older files number layers with gaps
    { id: 'l0', source: 'c', sourcePort: 'out', target: 'deck', targetPort: 'layers', index: 20 },
    { id: 'l1', source: 'a', sourcePort: 'out', target: 'deck', targetPort: 'layers', index: 0 },
    { id: 'l2', source: 'b', sourcePort: 'out', target: 'deck', targetPort: 'layers', index: 10 },
  ],
})

const handle = (container: HTMLElement, node: string, port: string) =>
  container.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${node}"] .react-flow__handle[data-handleid="${port}"]`
  )

// Where a wire's path ends: the last point of its bezier
const endY = (container: HTMLElement, edge: string) => {
  const d =
    container
      .querySelector(`.react-flow__edge[data-id="${edge}"] path.react-flow__edge-path`)
      ?.getAttribute('d') ?? ''
  return Number(d.trim().split(/[ ,]+/).at(-1))
}

describe('multi input handle', () => {
  afterEach(() => cleanup())

  it('draws a pill with a slot per wire, in order', { timeout: 30_000 }, async () => {
    vi.useRealTimers()
    docStore().load(doc())
    const { container } = render(
      <ReactFlowProvider>
        <div style={{ width: 1200, height: 600 }}>
          <DocNetwork />
        </div>
      </ReactFlowProvider>
    )
    await waitFor(() => expect(handle(container, 'deck', 'layers')).toBeTruthy(), {
      timeout: 10_000,
    })
    const layers = handle(container, 'deck', 'layers') as HTMLElement
    expect(layers.offsetHeight).toBe(pillHeight(3))
    expect(layers.title).toBe('1. a\n2. b\n3. c')
    // An empty multi input is still a pill; a single input is a dot
    expect(handle(container, 'deck', 'views')?.offsetHeight).toBe(MIN_PILL_HEIGHT)
    const single = handle(container, 'a', 'in') as HTMLElement
    expect(single.offsetHeight).toBe(single.offsetWidth)

    await waitFor(() => expect(Number.isFinite(endY(container, 'l1'))).toBe(true), {
      timeout: 10_000,
    })
    const [a, b, c] = ['l1', 'l2', 'l0'].map(id => endY(container, id))
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })
})
