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

    expect(proposal.lines.map(line => line.text)).toEqual([
      'Add NumberOp /threshold',
      'Set radius = 4 on /points',
      'Move /viewer to (800, 200)',
      'Connect /threshold.out.val to /points.par.radius',
      'Disconnect /a.out.data->/b.par.data',
      'Delete /scratch',
    ])
    expect(proposal.modifications).toHaveLength(6)
  })

  it('shows the proposed values, so 4 and 4000 read differently', () => {
    const { lines } = createProposal([
      { type: 'update_node', data: { id: '/a', data: { inputs: { radius: 4 } } } },
      { type: 'update_node', data: { id: '/b', data: { inputs: { radius: 4000 } } } },
      {
        type: 'add_node',
        data: { id: '/c', type: 'ColorOp', data: { inputs: { color: [255, 0, 0] } } },
      },
    ])
    expect(lines.map(line => line.text)).toEqual([
      'Set radius = 4 on /a',
      'Set radius = 4000 on /b',
      'Add ColorOp /c with color = [255,0,0]',
    ])
  })

  it('lists a move alongside the inputs it comes with', () => {
    const [line] = createProposal([
      {
        type: 'update_node',
        data: { id: '/points', position: { x: 10.4, y: 20 }, data: { inputs: { radius: 4 } } },
      },
    ]).lines
    expect(line.text).toBe('Update /points: set radius = 4; move to (10, 20)')
  })

  it('cuts long values to a preview and keeps them in full in the detail', () => {
    const code = 'const rows = data.filter(d => d.value > 10)\nreturn rows.map(d => d.value * 2)'
    const [line] = createProposal([
      { type: 'update_node', data: { id: '/code', data: { inputs: { code, scale: 2 } } } },
    ]).lines
    expect(line.text.length).toBeLessThan(code.length + 20)
    expect(line.text).toMatch(/^Set code = "const rows .*…, scale = 2 on \/code$/)
    expect(line.detail).toBe(`code:\n${code}`)
  })
})
