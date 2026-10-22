import { act, cleanup, render } from '@testing-library/react'
import { type Edge, type EdgeProps, Position, ReactFlowProvider } from '@xyflow/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import s from '../../noodles.module.css'
import { MathOp } from '../../operators'
import { clearOps, setOp, useUIStore } from '../../store'
import { edgeComponents } from '../op-components'

const edgeProps = {
  id: '/number.out.val->/math.par.a',
  source: '/number',
  target: '/math',
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 0,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
} as EdgeProps

function renderEdge(type: keyof typeof edgeComponents) {
  const Edge = edgeComponents[type] as ComponentType<EdgeProps>
  const { container } = render(
    <ReactFlowProvider>
      <svg>
        <title>edge</title>
        <Edge {...edgeProps} />
      </svg>
    </ReactFlowProvider>
  )
  return container.querySelector('path.react-flow__edge-path') as SVGPathElement
}

function lockedTarget() {
  const op = new MathOp('/math', { operator: 'add', a: 2, b: 3 })
  op.locked.next(true)
  setOp(op.id, op)
}

describe('edges into a locked node', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    const ui = useUIStore.getState()
    ui.setTargetedEdge(null)
    ui.setNodeDragState(null)
    ui.setInspectedReferenceEdge(null)
  })

  for (const type of ['default', 'MultiInputEdge', 'ReferenceEdge'] as const) {
    it(`fades a ${type} edge while its target is locked`, () => {
      const op = new MathOp('/math', { operator: 'add', a: 2, b: 3 })
      setOp(op.id, op)
      const path = renderEdge(type)

      expect(path).not.toHaveClass(s.lockedEdge)

      act(() => op.locked.next(true))
      expect(path).toHaveClass(s.lockedEdge)

      act(() => op.locked.next(false))
      expect(path).not.toHaveClass(s.lockedEdge)
    })
  }

  const highlights = {
    'connection drag': () =>
      useUIStore.getState().setTargetedEdge({ id: edgeProps.id, compatible: true }),
    'node drag': () =>
      useUIStore.getState().setNodeDragState({
        nodeId: '/other',
        hasExistingConnections: false,
        targetedEdge: { id: edgeProps.id, canInsert: true },
      }),
  }

  for (const type of ['default', 'MultiInputEdge'] as const) {
    for (const [name, highlight] of Object.entries(highlights)) {
      it(`shows a ${name} highlight on a faded ${type} edge`, () => {
        lockedTarget()
        const path = renderEdge(type)

        act(highlight)
        expect(path).toHaveClass(s.targetedEdge)
        expect(path).not.toHaveClass(s.lockedEdge)

        act(() => {
          useUIStore.getState().setTargetedEdge(null)
          useUIStore.getState().setNodeDragState(null)
        })
        expect(path).toHaveClass(s.lockedEdge)
      })
    }
  }

  it('shows an inspected ReferenceEdge at full strength', () => {
    lockedTarget()
    const path = renderEdge('ReferenceEdge')

    act(() => useUIStore.getState().setInspectedReferenceEdge({ id: edgeProps.id } as Edge))
    expect(path).toHaveClass(s.inspectedReferenceEdge)
    expect(path).not.toHaveClass(s.lockedEdge)

    act(() => useUIStore.getState().setInspectedReferenceEdge(null))
    expect(path).toHaveClass(s.lockedEdge)
  })
})
