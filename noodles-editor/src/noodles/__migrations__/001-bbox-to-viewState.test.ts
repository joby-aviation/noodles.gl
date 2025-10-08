import { describe, expect, it, vi } from 'vitest'
import { down, up } from './001-bbox-to-viewState'

type ConnectionMinimal = {
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

const mockEdgeId = vi.hoisted(() => (connection: ConnectionMinimal) => {
  const { source, sourceHandle, target, targetHandle } = connection
  return `${source}:${sourceHandle}->${target}:${targetHandle}`
})

vi.mock('../utils/id-utils', () => ({
  edgeId: mockEdgeId,
}))

describe('migrations 001', () => {
  const project = {
    version: 0,
    nodes: [
      {
        id: '1',
        type: 'BoundingBoxOp',
        data: {
          inputs: {
            data: [
              { lng: 0, lat: 0 },
              { lng: 1, lat: 1 },
            ],
          },
        },
        position: { x: 0, y: 0 },
      },
      { id: '2', type: 'DeckRendererOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
    ],
    edges: [
      {
        id: '1:bbox->2:viewState',
        source: '1',
        target: '2',
        sourceHandle: 'bbox',
        targetHandle: 'viewState',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    timeline: {},
  }

  it('migrates bbox to viewState or viewState to bbox', async () => {
    const migrated = await up(project)

    expect(migrated.edges[0].sourceHandle).toEqual('viewState')
    expect(migrated.edges[0].id).toEqual('1:viewState->2:viewState')

    const reverted = await down(migrated)
    expect(reverted.edges[0].sourceHandle).toEqual('bbox')
    expect(reverted.edges[0].id).toEqual('1:bbox->2:viewState')
    expect(reverted).toEqual(project)
  })
})
