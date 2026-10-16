import { act, cleanup, render } from '@testing-library/react'
import { type EdgeProps, Position, ReactFlowProvider } from '@xyflow/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import s from '../../noodles.module.css'
import { MathOp } from '../../operators'
import { clearOps, setOp } from '../../store'
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

describe('edges into a locked node', () => {
  afterEach(() => {
    cleanup()
    clearOps()
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
})
