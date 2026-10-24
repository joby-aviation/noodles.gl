// Noodles containers as subnets: the same nodes inside, wired through the subnet's ports.
import { flattenSubnets, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import {
  type NoodlesEdge,
  type NoodlesNode,
  type NoodlesProject,
  toEditorDoc,
} from './to-editor-doc'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  duck = await openNodeDuck()
}, 30_000)

const op = (id: string, type: string, inputs: Record<string, unknown> = {}): NoodlesNode => ({
  id,
  type,
  data: { inputs },
  position: { x: 0, y: 0 },
})
const wire = (source: string, sh: string, target: string, th: string): NoodlesEdge => ({
  id: `${source}.${sh}->${target}.${th}`,
  source,
  sourceHandle: sh,
  target,
  targetHandle: th,
})

// A container as Noodles makes one: its GraphInput and GraphOutput, and the bridges to them
const container = (id: string): { nodes: NoodlesNode[]; edges: NoodlesEdge[] } => ({
  nodes: [
    op(id, 'ContainerOp'),
    op(`${id}/container-input`, 'GraphInputOp'),
    op(`${id}/container-output`, 'GraphOutputOp'),
  ],
  edges: [
    wire(id, 'par.in', `${id}/container-input`, 'par.parentValue'),
    wire(`${id}/container-output`, 'out.propagatedValue', id, 'out.out'),
  ],
})

const QUERY = 'SELECT * FROM (VALUES (1.0, 2.0), (3.0, 4.0)) AS t(lng, lat)'

describe('containers', () => {
  it('become subnets around the layers they held, wired through in0 and out0', async () => {
    const g = container('/group')
    const project: NoodlesProject = {
      version: 19,
      nodes: [
        op('/rows', 'DuckDbOp', { query: QUERY }),
        ...g.nodes,
        op('/group/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
        op('/group/dots', 'ScatterplotLayerOp'),
        op('/deck', 'DeckRendererOp'),
      ],
      edges: [
        ...g.edges,
        wire('/rows', 'out.data', '/group', 'par.in'),
        wire('/group/container-input', 'out.value', '/group/dots', 'par.data'),
        wire('/group/where', 'out.accessor', '/group/dots', 'par.getPosition'),
        wire('/group/dots', 'out.layer', '/group/container-output', 'par.value'),
        wire('/group', 'out.out', '/deck', 'par.layers'),
      ],
    }
    const { doc } = toEditorDoc(project)
    const sub = doc.nodes.find(n => n.id === '/group')
    expect(sub).toMatchObject({ op: 'subnet', name: 'group' })
    expect(doc.nodes.find(n => n.id === '/group/dots')?.parent).toBe('/group')
    const inside = doc.nodes
      .filter(n => n.parent === '/group')
      .map(n => n.op)
      .sort()
    expect(inside).toEqual(['attribute', 'scatter', 'subnet-input', 'subnet-output'])
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/rows', target: '/group', targetPort: 'in0' })
    )
    expect(doc.edges).toContainEqual(
      expect.objectContaining({
        source: '/group',
        sourcePort: 'out0',
        target: '/deck',
        targetPort: 'layers',
      })
    )
    // Flattened, it is the graph the container drew
    const flat = flattenSubnets(doc)
    expect(flat.nodes.some(n => n.op === 'subnet')).toBe(false)
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const runtime = new ProgramRuntime(duck)
    await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
    expect(runtime.program()?.errors).toEqual([])
    expect(runtime.layers().map(l => [l.id, l.data?.rows])).toEqual([['/group/dots', 2]])
  })

  it('nest, innermost first', () => {
    const outer = container('/outer')
    const inner = container('/outer/inner')
    const project: NoodlesProject = {
      version: 19,
      nodes: [
        op('/rows', 'DuckDbOp', { query: QUERY }),
        ...outer.nodes,
        ...inner.nodes,
        op('/outer/inner/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
        op('/outer/inner/dots', 'ScatterplotLayerOp'),
        op('/deck', 'DeckRendererOp'),
      ],
      edges: [
        ...outer.edges,
        ...inner.edges,
        wire('/rows', 'out.data', '/outer', 'par.in'),
        wire('/outer/container-input', 'out.value', '/outer/inner', 'par.in'),
        wire('/outer/inner/container-input', 'out.value', '/outer/inner/dots', 'par.data'),
        wire('/outer/inner/where', 'out.accessor', '/outer/inner/dots', 'par.getPosition'),
        wire('/outer/inner/dots', 'out.layer', '/outer/inner/container-output', 'par.value'),
        wire('/outer/inner', 'out.out', '/outer/container-output', 'par.value'),
        wire('/outer', 'out.out', '/deck', 'par.layers'),
      ],
    }
    const { doc } = toEditorDoc(project)
    expect(doc.nodes.find(n => n.id === '/outer/inner')).toMatchObject({
      op: 'subnet',
      parent: '/outer',
    })
    expect(doc.nodes.find(n => n.id === '/outer/inner/dots')?.parent).toBe('/outer/inner')
    expect(lowerDocument(doc).errors).toEqual([])
    expect(
      lowerDocument(doc)
        .graph.nodes.filter(n => n.type === 'layer')
        .map(n => n.id)
    ).toEqual(['/outer/inner/dots'])
  })

  it('refuse a ForLoop, naming it', () => {
    const project: NoodlesProject = {
      version: 19,
      nodes: [op('/loop/begin', 'ForLoopBeginOp'), op('/deck', 'DeckRendererOp')],
      edges: [],
    }
    expect(() => toEditorDoc(project)).toThrow(/\/loop\/begin: a ForLoop is not converted/)
  })
})
