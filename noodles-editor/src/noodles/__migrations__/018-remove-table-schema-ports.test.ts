import { describe, expect, it, vi } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './018-remove-table-schema-ports'

const parentSchema = {
  columns: [
    { name: 'city', type: 'string' as const, defaultValue: '' },
    { name: 'count', type: 'number' as const, defaultValue: 0 },
  ],
}

function tableNode(
  id: string,
  inputs: Record<string, unknown> = {},
  visibleInputs?: string[]
): NoodlesProjectJSON['nodes'][number] {
  return {
    id,
    type: 'TableEditorOp',
    position: { x: 0, y: 0 },
    data: { inputs, ...(visibleInputs && { visibleInputs }) },
  }
}

function nodeInputs(node: NoodlesProjectJSON['nodes'][number] | undefined) {
  return ((node?.data as { inputs?: Record<string, unknown> } | undefined)?.inputs ?? {}) as Record<
    string,
    unknown
  >
}

const baseProject: NoodlesProjectJSON = {
  version: 17,
  timeline: {},
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

describe('018-remove-table-schema-ports', () => {
  it('materializes schemas for standalone legacy tables', async () => {
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        tableNode('/inferred', { data: [{ city: 'Los Angeles', count: 1 }] }),
        tableNode('/empty'),
      ],
    }

    const migrated = await up(project)

    expect(nodeInputs(migrated.nodes[0]).schema).toEqual(parentSchema)
    expect(nodeInputs(migrated.nodes[1]).schema).toEqual({ columns: [] })
  })

  it('materializes recursive TableEditor schema chains and removes only schema edges', async () => {
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        tableNode('/parent', { schema: parentSchema, data: [{ city: 'Los Angeles', count: 1 }] }),
        tableNode('/child', { data: [{ city: 'New York', count: 2 }] }, ['data', 'schema']),
        tableNode('/grandchild', { data: [{ city: 'London', count: 3 }] }),
        {
          id: '/viewer',
          type: 'ViewerOp',
          position: { x: 100, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/parent.out.schema->/child.par.schema',
          source: '/parent',
          sourceHandle: 'schema',
          target: '/child',
          targetHandle: 'schema',
        },
        {
          id: '/child.out.schema->/grandchild.par.schema',
          source: '/child',
          sourceHandle: 'out.schema',
          target: '/grandchild',
          targetHandle: 'par.schema',
        },
        {
          id: '/grandchild.out.data->/viewer.par.data',
          source: '/grandchild',
          sourceHandle: 'out.data',
          target: '/viewer',
          targetHandle: 'par.data',
        },
      ],
    }

    const migrated = await up(project)

    expect(migrated.edges).toEqual([project.edges[2]])
    for (const id of ['/parent', '/child', '/grandchild']) {
      const node = migrated.nodes.find(candidate => candidate.id === id)
      const schema = nodeInputs(node).schema as typeof parentSchema
      expect(schema).toEqual(parentSchema)
      expect(schema.columns.every(column => !Object.hasOwn(column, 'id'))).toBe(true)
    }
    expect(nodeInputs(migrated.nodes[1]).data).toEqual([{ city: 'New York', count: 2 }])
    expect(migrated.nodes[1].data.visibleInputs).toEqual(['data'])
  })

  it('prefers a persisted effective target snapshot and propagates it downstream', async () => {
    const childSnapshot = {
      columns: [
        ...parentSchema.columns,
        { name: 'offset', type: 'vec2' as const, defaultValue: [0, 0] },
      ],
    }
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        tableNode('/parent', { schema: parentSchema }),
        tableNode('/child', { schema: childSnapshot }),
        tableNode('/grandchild'),
      ],
      edges: [
        {
          id: '/parent.out.schema->/child.par.schema',
          source: '/parent',
          sourceHandle: 'out.schema',
          target: '/child',
          targetHandle: 'par.schema',
        },
        {
          id: '/child.out.schema->/grandchild.par.schema',
          source: '/child',
          sourceHandle: 'out.schema',
          target: '/grandchild',
          targetHandle: 'par.schema',
        },
      ],
    }

    const migrated = await up(project)

    expect(nodeInputs(migrated.nodes.find(node => node.id === '/child')).schema).toEqual(
      childSnapshot
    )
    expect(nodeInputs(migrated.nodes.find(node => node.id === '/grandchild')).schema).toEqual(
      childSnapshot
    )
  })

  it('materializes a TableEditor schema into a generic consumer', async () => {
    const persistedSnapshot = { columns: [{ name: 'local', type: 'string' }] }
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        tableNode('/table', { schema: parentSchema }),
        {
          id: '/consumer',
          type: 'JSONOp',
          position: { x: 100, y: 0 },
          data: { inputs: { text: 'keep me' } },
        },
        {
          id: '/consumer-with-snapshot',
          type: 'UnknownOp',
          position: { x: 200, y: 0 },
          data: { inputs: { value: persistedSnapshot } },
        },
      ],
      edges: [
        {
          id: '/table.out.schema->/consumer.par.value',
          source: '/table',
          sourceHandle: 'out.schema',
          target: '/consumer',
          targetHandle: 'par.value',
        },
        {
          id: '/table.out.schema->/consumer-with-snapshot.par.value',
          source: '/table',
          sourceHandle: 'out.schema',
          target: '/consumer-with-snapshot',
          targetHandle: 'par.value',
        },
      ],
    }

    const migrated = await up(project)
    const consumer = migrated.nodes.find(node => node.id === '/consumer')

    expect(consumer?.data.inputs).toEqual({ text: 'keep me', value: parentSchema })
    expect(migrated.nodes.find(node => node.id === '/consumer-with-snapshot')?.data.inputs).toEqual(
      {
        value: persistedSnapshot,
      }
    )
    expect(migrated.edges).toEqual([])
  })

  it('reports malformed sources and falls back to inferred target data without IDs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        {
          id: '/source',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { value: 1 } },
        },
        tableNode('/target', {
          schema: { columns: [{ name: 'broken', type: 'not-a-type' }] },
          data: [{ label: 'A', active: true }],
        }),
      ],
      edges: [
        {
          id: '/source.out.val->/target.par.schema',
          source: '/source',
          sourceHandle: 'out.val',
          target: '/target',
          targetHandle: 'par.schema',
        },
      ],
    }

    const migrated = await up(project)
    const schema = nodeInputs(migrated.nodes[1]).schema

    expect(schema).toEqual({
      columns: [
        { name: 'label', type: 'string', defaultValue: '' },
        { name: 'active', type: 'boolean', defaultValue: false },
      ],
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('malformed persisted schema'))
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve schema connection')
    )
    expect(migrated.migrationDiagnostics).toEqual([
      {
        type: 'stale-edge',
        message:
          'Could not resolve schema connection /source.out.val->/target.par.schema; the source is not a TableEditor schema output.',
      },
      { type: 'stale-edge', message: 'Ignored malformed persisted schema on /target.' },
    ])
    warn.mockRestore()
  })

  it('reports schema cycles, removes their edges, and materializes an inferred fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        tableNode('/first', { data: [{ firstValue: 1 }] }),
        tableNode('/second', { data: [{ secondValue: true }] }),
      ],
      edges: [
        {
          id: '/first.out.schema->/second.par.schema',
          source: '/first',
          sourceHandle: 'out.schema',
          target: '/second',
          targetHandle: 'par.schema',
        },
        {
          id: '/second.out.schema->/first.par.schema',
          source: '/second',
          sourceHandle: 'out.schema',
          target: '/first',
          targetHandle: 'par.schema',
        },
      ],
    }

    const migrated = await up(project)

    expect(migrated.edges).toEqual([])
    expect(
      migrated.nodes.every(node =>
        Array.isArray((nodeInputs(node).schema as { columns?: unknown[] }).columns)
      )
    ).toBe(true)
    expect(migrated.migrationDiagnostics).toEqual([
      {
        type: 'stale-edge',
        message: expect.stringContaining('Schema connection cycle'),
      },
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Schema connection cycle'))
    warn.mockRestore()
  })

  it('reports a removed schema-output edge whose target node is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [tableNode('/table', { schema: parentSchema })],
      edges: [
        {
          id: '/table.out.schema->/missing.par.value',
          source: '/table',
          sourceHandle: 'out.schema',
          target: '/missing',
          targetHandle: 'par.value',
        },
      ],
    }

    const migrated = await up(project)

    expect(migrated.edges).toEqual([])
    expect(migrated.migrationDiagnostics).toEqual([
      {
        type: 'stale-edge',
        message: expect.stringContaining('target node is missing'),
      },
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('target node is missing'))
    warn.mockRestore()
  })

  it('keeps materialized schemas when migrating down', async () => {
    const project = {
      ...baseProject,
      version: 18,
      nodes: [tableNode('/table', { schema: parentSchema })],
    }

    await expect(down(project)).resolves.toBe(project)
  })
})
