import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './020-drop-unsupported-view-inputs'

describe('020-drop-unsupported-view-inputs', () => {
  const baseProject: NoodlesProjectJSON = {
    version: 19,
    timeline: {},
    nodes: [],
    edges: [],
  }

  function node(id: string, type: string, inputs: Record<string, unknown>) {
    return { id, type, position: { x: 0, y: 0 }, data: { inputs } }
  }

  it("maps OrbitViewOp orbitAxis 'X' to 'Y'", async () => {
    const project = {
      ...baseProject,
      nodes: [
        node('/orbit-x', 'OrbitViewOp', { orbitAxis: 'X', fovy: 50 }),
        node('/orbit-z', 'OrbitViewOp', { orbitAxis: 'Z' }),
      ],
    }

    const migrated = await up(project)

    expect(migrated.nodes.map(n => n.data.inputs)).toEqual([
      { orbitAxis: 'Y', fovy: 50 },
      { orbitAxis: 'Z' },
    ])
  })

  it('removes MapViewOp altitude values and edges', async () => {
    const project = {
      ...baseProject,
      nodes: [
        node('/altitude', 'NumberOp', { val: 3 }),
        node('/map', 'MapViewOp', { altitude: 3, fovy: 50 }),
        node('/globe', 'GlobeViewOp', { altitude: 3 }),
      ],
      edges: [
        {
          id: '/altitude.out.val->/map.par.altitude',
          source: '/altitude',
          target: '/map',
          sourceHandle: 'out.val',
          targetHandle: 'par.altitude',
        },
        {
          id: '/altitude.out.val->/map.par.fovy',
          source: '/altitude',
          target: '/map',
          sourceHandle: 'out.val',
          targetHandle: 'par.fovy',
        },
        {
          id: '/altitude.out.val->/globe.par.altitude',
          source: '/altitude',
          target: '/globe',
          sourceHandle: 'out.val',
          targetHandle: 'par.altitude',
        },
      ],
    }

    const migrated = await up(project)

    expect(migrated.nodes.map(n => n.data.inputs)).toEqual([
      { val: 3 },
      { fovy: 50 },
      { altitude: 3 },
    ])
    expect(migrated.edges.map(e => e.id)).toEqual([
      '/altitude.out.val->/map.par.fovy',
      '/altitude.out.val->/globe.par.altitude',
    ])
  })

  it('removes ScaleWidgetOp label values', async () => {
    const project = {
      ...baseProject,
      nodes: [node('/scale', 'ScaleWidgetOp', { label: 'Distance', placement: 'top-left' })],
    }

    const migrated = await up(project)

    expect(migrated.nodes[0].data.inputs).toEqual({ placement: 'top-left' })
  })

  it('returns the same project when nothing needs migrating', async () => {
    const project = { ...baseProject, nodes: [node('/orbit', 'OrbitViewOp', {})] }
    expect(await up(project)).toBe(project)
    expect(await down(project)).toBe(project)
  })
})
