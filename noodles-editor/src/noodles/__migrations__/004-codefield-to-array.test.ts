import { describe, expect, it } from 'vitest'

import { down, up } from './004-codefield-to-array'

describe('004-codefield-to-array', async () => {
  it('should migrate codefield to array', async () => {
    const project = {
      nodes: [
        {
          id: '1',
          type: 'CodeOp',
          data: { inputs: { code: 'console.log("Hello, world!")\nconst a = 1\nreturn a + 2' } },
          position: { x: 0, y: 0 },
        },
        {
          id: '2',
          type: 'DuckDbOp',
          data: { inputs: { query: 'SELECT 1 as val;' } },
          position: { x: 0, y: 0 },
        },
        {
          id: '3',
          type: 'JSONOp',
          data: { inputs: { text: '{"a": 1}' } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      version: 3,
      timeline: {},
    }
    const result = await up(project)
    expect(result.nodes[0].data.inputs.code).toEqual([
      'console.log("Hello, world!")',
      'const a = 1',
      'return a + 2',
    ])
    expect(result.nodes[1].data.inputs.query).toEqual(['SELECT 1 as val;'])
    expect(result.nodes[2].data.inputs.text).toEqual(['{"a": 1}'])
  })

  it('should migrate codefield to array', async () => {
    const project = {
      nodes: [
        {
          id: '1',
          type: 'CodeOp',
          data: {
            inputs: { code: ['console.log("Hello, world!")', 'const a = 1', 'return a + 2'] },
          },
          position: { x: 0, y: 0 },
        },
        {
          id: '2',
          type: 'DuckDbOp',
          data: { inputs: { query: ['SELECT 1 as val;'] } },
          position: { x: 0, y: 0 },
        },
        {
          id: '3',
          type: 'JSONOp',
          data: { inputs: { text: ['{"a": 1}'] } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      version: 3,
      timeline: {},
    }
    const result = await down(project)
    expect(result.nodes[0].data.inputs.code).toEqual(
      'console.log("Hello, world!")\nconst a = 1\nreturn a + 2'
    )
    expect(result.nodes[1].data.inputs.query).toEqual('SELECT 1 as val;')
    expect(result.nodes[2].data.inputs.text).toEqual('{"a": 1}')
  })
})
