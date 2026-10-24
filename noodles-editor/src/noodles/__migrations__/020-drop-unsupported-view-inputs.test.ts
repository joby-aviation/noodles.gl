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

  it('returns the same project when nothing needs migrating', async () => {
    const project = { ...baseProject, nodes: [node('/orbit', 'OrbitViewOp', {})] }
    expect(await up(project)).toBe(project)
    expect(await down(project)).toBe(project)
  })
})
