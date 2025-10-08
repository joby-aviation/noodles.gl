import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './003-references-to-code'

describe('003-references-to-code migration', () => {
  it('transforms edges from references to code handle for CodeOp nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 2,
      nodes: [
        {
          id: 'code-op-1',
          type: 'CodeOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              code: null,
              data: null,
            },
          },
        },
        {
          id: 'code-op-2',
          type: 'CodeOp',
          position: { x: 200, y: 0 },
          data: {
            inputs: {
              code: null,
              data: null,
            },
          },
        },
        {
          id: 'other-op',
          type: 'OtherOp',
          position: { x: 400, y: 0 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'code-op-1',
          target: 'code-op-2',
          sourceHandle: 'code',
          targetHandle: 'references',
        },
        {
          id: 'edge-2',
          source: 'other-op',
          target: 'code-op-2',
          sourceHandle: 'output',
          targetHandle: 'references',
        },
        {
          id: 'edge-3',
          source: 'code-op-1',
          target: 'other-op',
          sourceHandle: 'code',
          targetHandle: 'input',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    // Verify edges were transformed correctly
    expect(migrated.edges).toHaveLength(3)

    // Edge 1 should be transformed
    expect(migrated.edges[0]).toEqual({
      id: expect.any(String),
      source: 'code-op-1',
      target: 'code-op-2',
      sourceHandle: 'code',
      targetHandle: 'code',
      type: 'ReferenceEdge',
    })

    // Edge 2 should be transformed
    expect(migrated.edges[1]).toEqual({
      id: expect.any(String),
      source: 'other-op',
      target: 'code-op-2',
      sourceHandle: 'output',
      targetHandle: 'code',
      type: 'ReferenceEdge',
    })

    // Edge 3 should remain unchanged
    expect(migrated.edges[2]).toEqual({
      id: 'edge-3',
      source: 'code-op-1',
      target: 'other-op',
      sourceHandle: 'code',
      targetHandle: 'input',
    })
  })

  it('handles projects with no CodeOp nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 2,
      nodes: [
        {
          id: 'other-op',
          type: 'OtherOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)
    expect(migrated).toEqual(project)
  })

  it('handles duckdb op nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 2,
      nodes: [
        {
          id: 'duckdb-op-1',
          type: 'DuckDbOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              query: 'SELECT {{num.out.val}}',
            },
          },
        },
        {
          id: 'num',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              val: 10,
            },
          },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'duckdb-op-1',
          target: 'num',
          sourceHandle: 'val',
          targetHandle: 'query',
          type: 'ReferenceEdge',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)
    expect(migrated.nodes[0].data.inputs.query).toEqual('SELECT {{num.out.val}}')
    expect(migrated.edges[0].targetHandle).toEqual('query')
  })

  it('reverts edges back to references handle in down migration', async () => {
    const project: NoodlesProjectJSON = {
      version: 3,
      nodes: [
        {
          id: 'code-op-1',
          type: 'CodeOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              code: null,
              data: null,
            },
          },
        },
        {
          id: 'code-op-2',
          type: 'CodeOp',
          position: { x: 200, y: 0 },
          data: {
            inputs: {
              code: null,
              data: null,
            },
          },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'code-op-1',
          target: 'code-op-2',
          sourceHandle: 'code',
          targetHandle: 'code',
          type: 'ReferenceEdge',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const reverted = await down(project)

    // Verify edge was reverted correctly
    expect(reverted.edges).toHaveLength(1)
    expect(reverted.edges[0]).toEqual({
      id: expect.any(String),
      source: 'code-op-1',
      target: 'code-op-2',
      sourceHandle: 'code',
      targetHandle: 'references',
    })
  })
})
