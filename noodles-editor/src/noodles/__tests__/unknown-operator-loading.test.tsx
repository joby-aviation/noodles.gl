// Loading a project with a missing operator type: React Flow renders the UnknownOperator
// placeholder, and saving writes the node back with its original type and data
import { act, cleanup, render, screen } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nodeComponents } from '../components/op-components'
import { clearOps, getOpStore } from '../store'
import { markUnknownOperatorNodes, transformGraph } from '../transform-graph'
import { serializeNodes } from '../utils/serialization'

describe('loading a project with a missing operator type', () => {
  afterEach(() => {
    cleanup()
    clearOps()
    vi.restoreAllMocks()
  })

  it('renders the placeholder and saves the original type', async () => {
    const projectNodes = [
      {
        id: '/missing',
        type: 'RemovedOp',
        data: { inputs: { threshold: 5 }, locked: true },
        position: { x: 0, y: 0 },
      },
      {
        id: '/num',
        type: 'NumberOp',
        data: { inputs: { val: 3 } },
        position: { x: 300, y: 0 },
      },
    ]
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Same steps as loadProjectFile in noodles.tsx
    transformGraph({ nodes: projectNodes, edges: [] })
    const nodes = markUnknownOperatorNodes(projectNodes)
    expect(nodes[0].type).toBe('UnknownOperator')
    expect(nodes[1]).toBe(projectNodes[1])

    render(
      <ReactFlowProvider>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeComponents} />
        </div>
      </ReactFlowProvider>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(screen.getByText('Unknown Operator')).toBeTruthy()
    expect(screen.getByText('RemovedOp')).toBeTruthy()

    const [saved] = serializeNodes(getOpStore(), nodes, [])
    expect(saved).toEqual(projectNodes[0])
  })
})
