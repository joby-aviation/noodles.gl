import type { EditorDoc } from '@noodles.gl/planner'
import { lowerDocument } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { DocStore } from '../editor/doc-store'
import {
  applyModifications,
  type DocToolContext,
  deleteKeyframe,
  getNodeInfo,
  getOperatorSchema,
  getTimeline,
  listNodes,
  setKeyframe,
} from './doc-tools'

const doc = (): EditorDoc => ({
  version: 1,
  name: 'tools',
  nodes: [
    {
      id: '/quakes',
      op: 'sql',
      name: 'quakes',
      x: 0,
      y: 0,
      params: { query: 'SELECT 1.0 AS lng, 2.0 AS lat, 5.0 AS mag' },
    },
    { id: 'n1', op: 'scatter', name: 'dots', x: 300, y: 0, params: { position: '[lng, lat]' } },
    { id: '/deck', op: 'deck', name: 'deck', x: 600, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: '/quakes', sourcePort: 'out', target: 'n1', targetPort: 'in' },
    { id: 'e2', source: 'n1', sourcePort: 'out', target: '/deck', targetPort: 'layers', index: 0 },
  ],
})

const context = (d = doc()): DocToolContext & { store: DocStore } => ({
  store: new DocStore(d),
  engine: () => undefined,
})

describe('node names', () => {
  it('finds a node by id, by name, and without its leading slash', () => {
    const ctx = context()
    expect(getNodeInfo(ctx, { nodeId: 'dots' }).data).toMatchObject({ id: 'n1', op: 'scatter' })
    expect(getNodeInfo(ctx, { nodeId: 'quakes' }).data).toMatchObject({ id: '/quakes' })
    expect(getNodeInfo(ctx, { nodeId: '/dots' }).data).toMatchObject({ id: 'n1' })
  })

  it('suggests names when a node is not found', () => {
    expect(getNodeInfo(context(), { nodeId: 'quake' }).error).toMatch(/Did you mean: quakes/)
  })

  it('lists nodes with their wires and parameters', () => {
    const data = listNodes(context()).data as { nodes: { name: string }[]; edges: string[] }
    expect(data.nodes.map(n => n.name)).toEqual(['quakes', 'dots', 'deck'])
    expect(data.edges).toContain('n1.out -> /deck.layers')
  })
})

describe('apply_modifications', () => {
  it('adds and wires nodes in one batch, by name, as one undo step', () => {
    const ctx = context()
    const result = applyModifications(ctx, {
      modifications: [
        // The wire comes first: nodes are added before wires wherever they sit
        { type: 'add_edge', source: 'quakes', target: 'size' },
        { type: 'add_edge', source: 'size', target: 'dots' },
        {
          type: 'add_node',
          op: 'attribute',
          name: 'size',
          params: { name: 'r', expression: 'mag * 2.0' },
        },
        { type: 'update_node', id: 'dots', params: { radius: 'r', fillColor: '#ff8000' } },
      ],
    })
    expect(result).toMatchObject({ success: true, data: { applied: 4 } })
    const d = ctx.store.get().doc
    const size = d.nodes.find(n => n.name === 'size')
    expect(d.edges.filter(e => e.target === 'n1' && e.targetPort === 'in')).toEqual([
      expect.objectContaining({ source: size?.id }),
    ])
    expect(d.nodes.find(n => n.id === 'n1')?.params).toMatchObject({
      radius: 'r',
      fillColor: [255, 128, 0],
    })
    expect(lowerDocument(d).errors).toEqual([])
    ctx.store.undo()
    expect(ctx.store.get().doc.nodes).toHaveLength(3)
  })

  it('applies nothing when any modification is wrong, and says what to fix', () => {
    const ctx = context()
    const result = applyModifications(ctx, {
      modifications: [
        { type: 'update_node', id: 'dots', params: { radiusScale: 4 } },
        { type: 'add_node', op: 'ScatterplotLayerOp' },
        { type: 'update_node', id: 'dots', params: { getRadius: 3 } },
        { type: 'add_edge', source: 'dots', target: 'quakes', targetPort: 'in0' },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Nothing was applied/)
    expect(result.error).toMatch(/Unknown operator 'ScatterplotLayerOp'. Did you mean: scatter/)
    expect(result.error).toMatch(/scatter has no parameter 'getRadius'/)
    expect(result.error).toMatch(/Cannot connect dots.out to quakes.in0/)
    expect(ctx.store.get().doc.nodes.find(n => n.id === 'n1')?.params.radiusScale).toBeUndefined()
    expect(ctx.store.canUndo()).toBe(false)
  })

  it('reads the older spellings: a data wrapper, nodeId, inputs and handles', () => {
    const ctx = context()
    const result = applyModifications(ctx, {
      modifications: [
        { type: 'update_node', data: { nodeId: 'dots', inputs: { opacity: 0.5 } } },
        { type: 'add_node', data: { op: 'number', name: 'k', position: { x: 10, y: 20 } } },
        {
          type: 'add_edge',
          data: {
            source: 'k',
            target: 'dots',
            sourceHandle: 'out.out',
            targetHandle: 'par.radiusScale',
          },
        },
      ],
    })
    expect(result.success).toBe(true)
    const d = ctx.store.get().doc
    expect(d.nodes.find(n => n.id === 'n1')?.params.opacity).toBe(0.5)
    expect(d.nodes.find(n => n.name === 'k')).toMatchObject({ x: 10, y: 20 })
    expect(d.edges.some(e => e.targetPort === 'par:radiusScale')).toBe(true)
  })

  it('reverts a parameter sent as null, and deletes nodes with their wires', () => {
    const ctx = context()
    applyModifications(ctx, {
      modifications: [{ type: 'update_node', id: 'dots', params: { position: null } }],
    })
    expect(ctx.store.get().doc.nodes.find(n => n.id === 'n1')?.params.position).toBeUndefined()
    applyModifications(ctx, { modifications: [{ type: 'delete_node', id: 'quakes' }] })
    expect(ctx.store.get().doc.edges.map(e => e.id)).toEqual(['e2'])
  })
})

describe('timeline tools', () => {
  it('keys a parameter named as node.param, and deletes the keyframe by time', () => {
    const ctx = context()
    expect(setKeyframe(ctx, { target: 'dots.opacity', time: 0, value: 0 }).success).toBe(true)
    expect(
      setKeyframe(ctx, { target: 'dots / opacity', time: 2, value: 1, interpolation: 'hold' })
        .success
    ).toBe(true)
    const tracks = (getTimeline(ctx).data as { tracks: { target: string; keyframes: unknown[] }[] })
      .tracks
    expect(tracks).toEqual([
      {
        target: 'n1.opacity',
        keyframes: [
          expect.objectContaining({ time: 0, value: 0 }),
          expect.objectContaining({ time: 2, value: 1, interpolation: 'hold' }),
        ],
      },
    ])
    expect(deleteKeyframe(ctx, { target: 'dots.opacity', time: 2 }).success).toBe(true)
    expect(ctx.store.get().doc.timeline?.tracks[0].keyframes).toHaveLength(1)
  })

  it('keys a table cell, by its path or as the panel names it, text included', () => {
    const d = doc()
    d.nodes.push({
      id: 't1',
      op: 'table',
      name: 'cities',
      x: 0,
      y: 200,
      params: { rows: '[{"city":"Denver","population":700}]' },
    })
    const ctx = context(d)
    expect(
      setKeyframe(ctx, { target: 'cities.rows.0.population', time: 1, value: 750 }).data
    ).toMatchObject({ target: 't1.rows.0.population' })
    expect(
      setKeyframe(ctx, { target: 'cities / city (row 1)', time: 1, value: 'Boulder' }).data
    ).toMatchObject({ target: 't1.rows.0.city', value: 'Boulder' })
    // Text only in a cell: a parameter's keyframes are numbers
    expect(setKeyframe(ctx, { target: 'dots.opacity', time: 1, value: 'half' }).success).toBe(false)
  })
})

describe('operator schema', () => {
  it("lists an operator's ports and parameters", () => {
    expect(getOperatorSchema({ type: 'scatter' }).data).toMatchObject({
      inputs: [{ name: 'in', type: 'table' }],
      outputs: [{ name: 'out', type: 'layer' }],
      params: expect.arrayContaining([
        expect.objectContaining({ name: 'radiusScale', kind: 'float' }),
      ]),
    })
    expect(getOperatorSchema({ type: 'FileOp' }).error).toMatch(/Did you mean: file/)
  })
})
