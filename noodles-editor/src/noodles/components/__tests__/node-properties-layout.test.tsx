// Layout tests for NodeProperties rows, run with the real CSS modules so flex sizing applies.
// Field labels must keep room next to number, select and vector inputs.
import { cleanup, render } from '@testing-library/react'
import type { Edge } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOps } from '../../store'
import { transformGraph } from '../../transform-graph'
import { NodeProperties } from '../node-properties'

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({
      setEdges: vi.fn(),
      getEdges: () => [],
      setNodes: vi.fn(),
      getNodes: vi.fn(() => []),
      getNode: vi.fn(),
    }),
    useStore: (selector: (state: { nodes: unknown[]; edges: Edge[] }) => unknown) =>
      selector({ nodes: [], edges: [] }),
  }
})

// Content widths of the right panel at 1440px: default 15% and minimum 12%, less 8px padding
const DEFAULT_WIDTH = 200
const MIN_WIDTH = 157

const FIELDS = ['opacity', 'getLineWidth', 'radiusUnits', 'getPixelOffset']

const renderAtWidth = (width: number) => {
  transformGraph({
    nodes: [
      {
        id: '/scatter',
        type: 'ScatterplotLayerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {}, visibleInputs: FIELDS },
      },
    ],
    edges: [],
  })
  return render(
    <ReactFlowProvider>
      <div style={{ width, fontSize: 11 }}>
        <NodeProperties nodeId="/scatter" />
      </div>
    </ReactFlowProvider>
  )
}

const rowParts = (container: HTMLElement, name: string) => {
  // The panel's label span, not the hidden <label> the field component renders
  const label = Array.from(
    container.querySelectorAll<HTMLElement>('[role="listitem"] span:not(:has(*))')
  ).find(el => el.textContent === name)
  if (!label) throw new Error(`No label for ${name}`)
  const row = label.closest('[role="listitem"]') as HTMLElement
  const inputs = Array.from(
    row.querySelectorAll<HTMLElement>('input:not([type="checkbox"]), select')
  )
  return { label, inputs }
}

describe('NodeProperties row layout', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  it('shows short labels in full beside number and select inputs at the default width', () => {
    const { container } = renderAtWidth(DEFAULT_WIDTH)
    for (const name of ['opacity', 'radiusUnits']) {
      const { label } = rowParts(container, name)
      expect(label.scrollWidth, name).toBeLessThanOrEqual(label.clientWidth + 1)
      expect(label.title, name).toBe(name)
    }
  })

  it.each([DEFAULT_WIDTH, MIN_WIDTH])(
    'keeps labels readable and inputs off the label at %ipx',
    width => {
      const { container } = renderAtWidth(width)
      for (const name of FIELDS) {
        const { label, inputs } = rowParts(container, name)
        const labelRect = label.getBoundingClientRect()
        // Room for a few characters before the ellipsis
        expect(labelRect.width, name).toBeGreaterThan(30)
        expect(inputs.length, name).toBeGreaterThan(0)
        for (const input of inputs) {
          const inputRect = input.getBoundingClientRect()
          const sameLine = inputRect.top < labelRect.bottom
          if (sameLine) expect(inputRect.left, name).toBeGreaterThanOrEqual(labelRect.right)
          expect(inputRect.width, name).toBeGreaterThan(20)
        }
      }
    }
  )

  it('wraps vector channels onto their own line under the label', () => {
    const { container } = renderAtWidth(MIN_WIDTH)
    const { label, inputs } = rowParts(container, 'getPixelOffset')
    const labelRect = label.getBoundingClientRect()
    expect(inputs).toHaveLength(2)
    for (const input of inputs) {
      expect(input.getBoundingClientRect().top).toBeGreaterThanOrEqual(labelRect.bottom)
    }
  })
})
