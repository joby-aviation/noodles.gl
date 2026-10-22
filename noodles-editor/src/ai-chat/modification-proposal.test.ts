import { describe, expect, it } from 'vitest'
import { createProposal } from './modification-proposal'

describe('createProposal', () => {
  it('describes each modification on one line, in order', () => {
    const proposal = createProposal([
      { type: 'add_node', data: { id: '/threshold', type: 'NumberOp' } },
      { type: 'update_node', data: { id: '/points', data: { inputs: { radius: 4 } } } },
      { type: 'update_node', data: { id: '/viewer', position: { x: 800, y: 200 } } },
      {
        type: 'add_edge',
        data: {
          id: '/threshold.out.val->/points.par.radius',
          source: '/threshold',
          sourceHandle: 'out.val',
          target: '/points',
          targetHandle: 'par.radius',
        },
      },
      { type: 'delete_edge', data: { id: '/a.out.data->/b.par.data' } },
      { type: 'delete_node', data: { id: '/scratch' } },
    ])

    expect(proposal.lines).toEqual([
      'Add NumberOp /threshold',
      'Set radius on /points',
      'Move /viewer',
      'Connect /threshold.out.val to /points.par.radius',
      'Disconnect /a.out.data->/b.par.data',
      'Delete /scratch',
    ])
    expect(proposal.modifications).toHaveLength(6)
  })
})
