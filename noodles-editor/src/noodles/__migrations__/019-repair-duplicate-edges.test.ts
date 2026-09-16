import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './019-repair-duplicate-edges'

const edge = (
  source: string,
  target: string,
  id = `${source}.out.data->${target}.par.data`,
  targetHandle = 'par.data'
): Edge => ({
  id,
  source,
  sourceHandle: 'out.data',
  target,
  targetHandle,
})

const project = (edges: Edge[]): NoodlesProjectJSON => ({
  version: 18,
  timeline: {},
  nodes: [],
  edges,
  viewport: { x: 0, y: 0, zoom: 1 },
})

describe('019-repair-duplicate-edges', () => {
  it('keeps the first occurrence of duplicate logical connections in array order', async () => {
    const first = { ...edge('/a', '/switch', 'first'), data: { marker: 'first' } }
    const second = { ...edge('/b', '/switch', 'second'), data: { marker: 'second' } }
    const duplicate = { ...edge('/a', '/switch', 'alternate-id'), data: { marker: 'duplicate' } }

    const migrated = await up(project([first, second, duplicate]))

    expect(migrated.edges).toEqual([first, second])
  })

  it('repairs one stored ID used by different connections without losing either edge', async () => {
    const migrated = await up(
      project([edge('/a', '/target-a', 'collision'), edge('/b', '/target-b', 'collision')])
    )

    expect(migrated.edges).toEqual([edge('/a', '/target-a'), edge('/b', '/target-b')])
  })

  it('does not let a repaired ID rename a non-conflicting legacy edge', async () => {
    const reservedId = '/a.out.data->/target-a.par.data'
    const legacy = edge('/legacy', '/target-legacy', reservedId)
    const migrated = await up(
      project([edge('/a', '/target-a', 'collision'), edge('/b', '/target-b', 'collision'), legacy])
    )

    expect(migrated.edges[0].id).toBe(`${reservedId}#2`)
    expect(migrated.edges[1].id).toBe('/b.out.data->/target-b.par.data')
    expect(migrated.edges[2]).toBe(legacy)
  })

  it('leaves clean projects and non-canonical legacy IDs untouched', async () => {
    const edges = [edge('/a', '/target-a', 'legacy-edge-id')]
    const original = project(edges)

    await expect(up(original)).resolves.toBe(original)
  })

  it('does not attempt to reconstruct removed duplicates when migrating down', async () => {
    const original = { ...project([edge('/a', '/target')]), version: 19 }

    await expect(down(original)).resolves.toBe(original)
  })
})
