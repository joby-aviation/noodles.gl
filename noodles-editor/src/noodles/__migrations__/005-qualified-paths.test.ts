import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './005-qualified-paths'

const createOldFormatProject = (): NoodlesProjectJSON => ({
  version: 4,
  nodes: [
    {
      id: 'code1',
      type: 'CodeOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          code: ['console.log("hello")'],
        },
      },
    },
    {
      id: 'viewer1',
      type: 'ViewerOp',
      position: { x: 300, y: 100 },
      data: {
        inputs: {},
      },
    },
    {
      id: 'data-source',
      type: 'DataSourceOp',
      position: { x: 100, y: 300 },
      data: {
        inputs: {
          url: 'https://example.com/data.json',
        },
      },
    },
  ],
  edges: [
    {
      id: 'code1:result->viewer1:data',
      source: 'code1',
      target: 'viewer1',
      sourceHandle: 'result',
      targetHandle: 'data',
    },
    {
      id: 'data-source:data->code1:input',
      source: 'data-source',
      target: 'code1',
      sourceHandle: 'data',
      targetHandle: 'input',
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createNewFormatProject = (): NoodlesProjectJSON => ({
  version: 5,
  nodes: [
    {
      id: '/code1',
      type: 'CodeOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          code: ['console.log("hello")'],
        },
      },
    },
    {
      id: '/viewer1',
      type: 'ViewerOp',
      position: { x: 300, y: 100 },
      data: {
        inputs: {},
      },
    },
    {
      id: '/data-source',
      type: 'DataSourceOp',
      position: { x: 100, y: 300 },
      data: {
        inputs: {
          url: 'https://example.com/data.json',
        },
      },
    },
  ],
  edges: [
    {
      id: '/code1.out.result->/viewer1.par.data',
      source: '/code1',
      target: '/viewer1',
      sourceHandle: 'out.result',
      targetHandle: 'par.data',
    },
    {
      id: '/data-source.out.data->/code1.par.input',
      source: '/data-source',
      target: '/code1',
      sourceHandle: 'out.data',
      targetHandle: 'par.input',
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

describe('migration 005 up', () => {
  it('converts simple IDs to qualified paths', async () => {
    const project = createOldFormatProject()
    const migrated = await up(project)

    // Check that all node IDs are now qualified paths
    expect(migrated.nodes).toHaveLength(3)
    expect(migrated.nodes[0].id).toBe('/code1')
    expect(migrated.nodes[1].id).toBe('/viewer1')
    expect(migrated.nodes[2].id).toBe('/data-source')

    // Check that node data is preserved
    expect(migrated.nodes[0].data.inputs.code).toEqual(['console.log("hello")'])
    expect(migrated.nodes[2].data.inputs.url).toBe('https://example.com/data.json')
  })

  it('updates edge source and target references', async () => {
    const project = createOldFormatProject()
    const migrated = await up(project)

    expect(migrated.edges).toHaveLength(2)

    // Check first edge
    expect(migrated.edges[0].source).toBe('/code1')
    expect(migrated.edges[0].target).toBe('/viewer1')

    // Check second edge
    expect(migrated.edges[1].source).toBe('/data-source')
    expect(migrated.edges[1].target).toBe('/code1')
  })

  it('converts handle IDs to short format', async () => {
    const project = createOldFormatProject()
    const migrated = await up(project)

    // Check first edge handles
    expect(migrated.edges[0].sourceHandle).toBe('out.result')
    expect(migrated.edges[0].targetHandle).toBe('par.data')

    // Check second edge handles
    expect(migrated.edges[1].sourceHandle).toBe('out.data')
    expect(migrated.edges[1].targetHandle).toBe('par.input')
  })

  it('updates edge IDs to reflect new paths', async () => {
    const project = createOldFormatProject()
    const migrated = await up(project)

    expect(migrated.edges[0].id).toBe('/code1.out.result->/viewer1.par.data')
    expect(migrated.edges[1].id).toBe('/data-source.out.data->/code1.par.input')
  })

  it('handles nodes with no ID gracefully', async () => {
    const project: NoodlesProjectJSON = {
      version: 4,
      nodes: [
        {
          id: 'valid-node',
          type: 'CodeOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          // @ts-expect-error - testing edge case
          id: null,
          type: 'ViewerOp',
          position: { x: 100, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    expect(migrated.nodes[0].id).toBe('/valid-node')
    expect(migrated.nodes[1].id).toBe(null)
  })

  it('handles edges with null handles', async () => {
    const project: NoodlesProjectJSON = {
      version: 4,
      nodes: [
        {
          id: 'node1',
          type: 'CodeOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: 'node2',
          type: 'ViewerOp',
          position: { x: 100, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: 'edge1',
          source: 'node1',
          target: 'node2',
          sourceHandle: null,
          targetHandle: null,
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    await expect(async () => {
      await up(project)
    }).rejects.toThrow('Invalid connection')
  })

  it('handles DuckDbOp with query field in ReferenceEdges', async () => {
    const project: NoodlesProjectJSON = {
      version: 4,
      nodes: [
        {
          id: 'datasource1',
          type: 'DataSourceOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              url: 'https://example.com/data.json',
            },
          },
        },
        {
          id: 'duckdb1',
          type: 'DuckDbOp',
          position: { x: 100, y: 0 },
          data: {
            inputs: {
              query: ['SELECT * FROM {{datasource1.out.data}}'],
            },
          },
        },
      ],
      edges: [
        {
          id: 'ref-edge',
          type: 'ReferenceEdge',
          source: 'datasource1',
          target: 'duckdb1',
          sourceHandle: 'data',
          targetHandle: 'query',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    expect(migrated.nodes[0].id).toBe('/datasource1')
    expect(migrated.nodes[1].id).toBe('/duckdb1')
    expect(migrated.edges[0].source).toBe('/datasource1')
    expect(migrated.edges[0].target).toBe('/duckdb1')
    expect(migrated.edges[0].type).toBe('ReferenceEdge')
    expect(migrated.edges[0].sourceHandle).toBe('out.data')
    expect(migrated.edges[0].targetHandle).toBe('par.query')
  })

  it('handles ReferenceEdges without targetHandle for backward compatibility', async () => {
    const project: NoodlesProjectJSON = {
      version: 4,
      nodes: [
        {
          id: 'num',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              val: 42,
            },
          },
        },
        {
          id: 'code',
          type: 'CodeOp',
          position: { x: 100, y: 0 },
          data: {
            inputs: {
              code: ['return {{num.par.val}} * 2'],
            },
          },
        },
      ],
      edges: [
        {
          id: 'ref-edge',
          type: 'ReferenceEdge',
          source: 'num',
          target: 'code',
          sourceHandle: 'val',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    expect(migrated.nodes[0].id).toBe('/num')
    expect(migrated.nodes[1].id).toBe('/code')
    expect(migrated.edges[0].source).toBe('/num')
    expect(migrated.edges[0].target).toBe('/code')
    expect(migrated.edges[0].type).toBe('ReferenceEdge')
    expect(migrated.edges[0].sourceHandle).toBe('par.val')
    expect(migrated.edges[0].targetHandle).toBe(null)
  })
})

describe('migration 005 down', () => {
  it('converts qualified paths back to simple IDs', async () => {
    const project = createNewFormatProject()
    const reverted = await down(project)

    // Check that all node IDs are now simple IDs
    expect(reverted.nodes).toHaveLength(3)
    expect(reverted.nodes[0].id).toBe('code1')
    expect(reverted.nodes[1].id).toBe('viewer1')
    expect(reverted.nodes[2].id).toBe('data-source')

    // Check that node data is preserved
    expect(reverted.nodes[0].data.inputs.code).toEqual(['console.log("hello")'])
    expect(reverted.nodes[2].data.inputs.url).toBe('https://example.com/data.json')
  })

  it('updates edge source and target references back to simple IDs', async () => {
    const project = createNewFormatProject()
    const reverted = await down(project)

    expect(reverted.edges).toHaveLength(2)

    // Check first edge
    expect(reverted.edges[0].source).toBe('code1')
    expect(reverted.edges[0].target).toBe('viewer1')

    // Check second edge
    expect(reverted.edges[1].source).toBe('data-source')
    expect(reverted.edges[1].target).toBe('code1')
  })

  it('converts qualified handle IDs back to simple format', async () => {
    const project = createNewFormatProject()
    const reverted = await down(project)

    // Check first edge handles
    expect(reverted.edges[0].sourceHandle).toBe('result')
    expect(reverted.edges[0].targetHandle).toBe('data')

    // Check second edge handles
    expect(reverted.edges[1].sourceHandle).toBe('data')
    expect(reverted.edges[1].targetHandle).toBe('input')
  })

  it('handles nested paths by taking the last segment', async () => {
    const project: NoodlesProjectJSON = {
      version: 5,
      nodes: [
        {
          id: '/container/subcontainer/nested-node',
          type: 'CodeOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const reverted = await down(project)

    // Should take the last segment as the simple ID
    expect(reverted.nodes[0].id).toBe('nested-node')
  })

  it('is reversible with up migration', async () => {
    const originalProject = createOldFormatProject()

    // Migrate up then down
    const migrated = await up(originalProject)
    const reverted = await down(migrated)

    // Should be equivalent to original (though edge IDs might differ)
    expect(reverted.nodes).toEqual(originalProject.nodes)
    expect(reverted.edges.length).toBe(originalProject.edges.length)

    // Check edge content (ignoring IDs which may be regenerated)
    for (let i = 0; i < reverted.edges.length; i++) {
      const revertedEdge = reverted.edges[i]
      const originalEdge = originalProject.edges[i]

      expect(revertedEdge.source).toBe(originalEdge.source)
      expect(revertedEdge.target).toBe(originalEdge.target)
      expect(revertedEdge.sourceHandle).toBe(originalEdge.sourceHandle)
      expect(revertedEdge.targetHandle).toBe(originalEdge.targetHandle)
    }
  })
})
