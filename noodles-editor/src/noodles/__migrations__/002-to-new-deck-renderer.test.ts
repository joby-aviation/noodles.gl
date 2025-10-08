import type { Node as ReactFlowNode } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { DeckOpJson } from './002-to-new-deck-renderer'
import { down, up } from './002-to-new-deck-renderer'

type TestNode = ReactFlowNode<{
  inputs: Record<string, unknown>
}>

const createBaseTestProject = () => ({
  version: 1,
  nodes: [
    {
      id: 'deck',
      type: 'DeckRendererOp',
      position: { x: 0, y: 0 },
      data: {
        inputs: {
          mapStyle: 'mapbox://styles/mapbox/streets-v11',
          viewState: {
            latitude: 37.7749,
            longitude: -122.4194,
            zoom: 10,
          },
        },
      },
    },
  ] as TestNode[],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

describe('migrations 002 up', () => {
  it('migrates base DeckRendererOp to new deck renderer system', async () => {
    const project = createBaseTestProject()
    const migrated = await up(project)

    // Check new nodes were created
    expect(migrated.nodes).toHaveLength(3) // original 2 nodes + 3 new nodes

    // Check new nodes were created
    const basemapNode = migrated.nodes.find(n => n.type === 'MaplibreBasemapOp')
    expect(basemapNode).toBeDefined()
    expect(basemapNode!.id).toBe('basemap-0')
    expect(basemapNode!.position).toEqual({ x: 0, y: 230 })
    expect(basemapNode!.data.inputs).toEqual({
      mapStyle: 'mapbox://styles/mapbox/streets-v11',
      viewState: {
        latitude: 37.7749,
        longitude: -122.4194,
        zoom: 10,
      },
    })

    // Check OutOp was created
    const outNode = migrated.nodes.find(n => n.type === 'OutOp')
    expect(outNode).toBeDefined()
    expect(outNode!.id).toBe('out')
    expect(outNode!.position).toEqual({ x: 250, y: 0 })

    // Check DeckRendererOp position was updated
    const deckRendererNode = migrated.nodes.find(n => n.id === 'deck')
    expect(deckRendererNode).toBeDefined()
    expect(deckRendererNode!.position).toEqual({ x: 0, y: 0 })

    // Check edges were created
    expect(migrated.edges).toHaveLength(2)

    expect(migrated.edges).toContainEqual({
      id: 'basemap-0:maplibre->deck:basemap',
      source: 'basemap-0',
      target: 'deck',
      sourceHandle: 'maplibre',
      targetHandle: 'basemap',
    })
    expect(migrated.edges).toContainEqual({
      id: 'deck:vis->out:vis',
      source: 'deck',
      target: 'out',
      sourceHandle: 'vis',
      targetHandle: 'vis',
    })
  })

  it('migrates connected view state to new deck renderer system', async () => {
    const project = createBaseTestProject()
    const modified = {
      ...project,
      nodes: [
        ...project.nodes.map(n =>
          n.id === 'deck' ? { ...n, data: { inputs: { ...n.data.inputs, viewState: null } } } : n
        ),
        {
          id: 'view-state-0',
          type: 'ViewStateOp',
          position: { x: 0, y: 100 },
          data: {
            inputs: {
              viewState: {
                latitude: 1,
                longitude: 2,
                zoom: 3,
              },
            },
          },
        },
      ],
      edges: [
        {
          id: 'view-state-0:viewState->deck:viewState',
          source: 'view-state-0',
          target: 'deck',
          sourceHandle: 'viewState',
          targetHandle: 'viewState',
        },
      ],
    }

    const migrated = await up(modified)

    // Check new nodes were created
    expect(migrated.nodes).toHaveLength(4) // original 2 nodes + 2 new nodes

    // Check that basemap node view state isn't set if deck's view state is null
    const basemapNode = migrated.nodes.find(n => n.type === 'MaplibreBasemapOp')
    expect(basemapNode).toBeDefined()
    expect(basemapNode!.id).toBe('basemap-0')
    expect(basemapNode!.data.inputs).toEqual({
      mapStyle: 'mapbox://styles/mapbox/streets-v11',
      viewState: null,
    })

    // Check edges were created
    expect(migrated.edges).toHaveLength(3)
    expect(migrated.edges).toContainEqual({
      id: 'basemap-0:maplibre->deck:basemap',
      source: 'basemap-0',
      target: 'deck',
      sourceHandle: 'maplibre',
      targetHandle: 'basemap',
    })
    expect(migrated.edges).toContainEqual({
      id: 'view-state-0:viewState->basemap-0:viewState',
      source: 'view-state-0',
      target: 'basemap-0',
      sourceHandle: 'viewState',
      targetHandle: 'viewState',
    })

    // Check ViewStateOp was renamed to MapViewStateOp
    const mapViewStateNode = migrated.nodes.find(n => n.id === 'view-state-0')
    expect(mapViewStateNode).toBeDefined()
    expect(mapViewStateNode!.type).toBe('MapViewStateOp')
  })

  it('updates DeckRendererOp mapStyle connection to the basemap op', async () => {
    const project = createBaseTestProject()
    const modified = {
      ...project,
      nodes: [
        ...project.nodes.map(n =>
          n.id === 'deck' ? { ...n, data: { inputs: { ...n.data.inputs, mapStyle: null } } } : n
        ),
        {
          id: 'map-style-0',
          type: 'StringOp',
          position: { x: 0, y: 100 },
          data: {
            inputs: {
              value: 'some-value',
            },
          },
        },
      ],
      edges: [
        {
          id: 'map-style-0:value->deck:mapStyle',
          source: 'map-style-0',
          target: 'deck',
          sourceHandle: 'value',
          targetHandle: 'mapStyle',
        },
      ],
    }
    const migrated = await up(modified)

    // Check new nodes were created
    expect(migrated.nodes).toHaveLength(4) // original 2 nodes + 2 new node

    // Check that basemap node view state isn't set if deck's view state is null
    const basemapNode = migrated.nodes.find(n => n.type === 'MaplibreBasemapOp')
    expect(basemapNode).toBeDefined()
    expect(basemapNode!.id).toBe('basemap-0')
    expect(basemapNode!.data.inputs).toEqual({
      mapStyle: null,
      viewState: {
        latitude: 37.7749,
        longitude: -122.4194,
        zoom: 10,
      },
    })

    // Check edges were created
    expect(migrated.edges).toHaveLength(3)
    expect(migrated.edges).toContainEqual({
      id: 'map-style-0:value->basemap-0:mapStyle',
      source: 'map-style-0',
      target: 'basemap-0',
      sourceHandle: 'value',
      targetHandle: 'mapStyle',
    })
  })

  it('handles project without DeckRendererOp', async () => {
    const project = {
      version: 1,
      nodes: [
        {
          id: '1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { val: 5 },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)
    expect(migrated).toEqual(project)
  })
})

describe('migrations 002 down', () => {
  it('reverts base project migration', async () => {
    const project = createBaseTestProject()
    const migrated = await up(project)
    const reverted = await down(migrated)

    // Check nodes were removed
    expect(reverted.nodes).not.toHaveProperty('basemap-0')
    expect(reverted.nodes).not.toHaveProperty('out')

    // Check DeckRendererOp position was restored
    const deckRendererNode = reverted.nodes.find(n => n.id === 'deck')
    if (deckRendererNode) {
      expect(deckRendererNode.position).toEqual({ x: 0, y: 0 })
    }

    // Check edges were restored
    const edges = reverted.edges
    expect(edges).toHaveLength(0)
  })

  it('unsets DeckRendererOp viewState if connected', async () => {
    const project = createBaseTestProject()
    const modified = {
      ...project,
      nodes: [
        ...project.nodes.map(n =>
          n.id === 'deck' ? { ...n, data: { inputs: { ...n.data.inputs, viewState: null } } } : n
        ),
        {
          id: 'view-state-0',
          type: 'ViewStateOp',
          position: { x: 0, y: 100 },
          data: {
            inputs: {
              viewState: {
                latitude: 1,
                longitude: 2,
                zoom: 3,
              },
            },
          },
        },
      ],
      edges: [
        {
          id: 'view-state-0:viewState->deck:viewState',
          source: 'view-state-0',
          target: 'deck',
          sourceHandle: 'viewState',
          targetHandle: 'viewState',
        },
      ],
    }
    const migrated = await up(modified)
    const reverted = await down(migrated)

    // Check nodes were removed
    expect(reverted.nodes).not.toHaveProperty('basemap-0')
    expect(reverted.nodes).not.toHaveProperty('out')

    // Check DeckRendererOp viewState is unset
    const deckRendererNode = reverted.nodes.find(n => n.id === 'deck')
    if (deckRendererNode) {
      expect(deckRendererNode.data.inputs).toEqual({
        mapStyle: 'mapbox://styles/mapbox/streets-v11',
        viewState: null,
      })
    }

    // Check edges were restored
    const edges = reverted.edges
    expect(edges).toHaveLength(1)

    // Check MapViewStateOp was renamed back
    const viewStateNode = reverted.nodes.find(n => n.id === 'view-state-0')
    expect(viewStateNode).toBeDefined()
    expect(viewStateNode!.type).toBe('ViewStateOp')
  })

  it('restores DeckRendererOp ID from different ID', async () => {
    const project = createBaseTestProject()
    const migrated = await up(project)
    const modified = {
      ...migrated,
      nodes: migrated.nodes.map(node => {
        if (node.id === 'deck') {
          return { ...node, id: 'different-id' }
        }
        return node
      }),
    }
    const reverted = await down(modified)

    // Check DeckRendererOp ID was restored to 'deck'
    const deckRendererNode = reverted.nodes.find(n => n.type === 'DeckRendererOp')
    expect(deckRendererNode).toBeDefined()
    expect(deckRendererNode!.id).toBe('deck')
  })

  it('restores viewState and mapStyle from basemap op when present', async () => {
    const project = createBaseTestProject()
    const migrated = await up(project)
    const modified = {
      ...migrated,
      nodes: migrated.nodes.map(node => {
        if (node.id === 'deck') {
          return {
            ...node,
            data: {
              inputs: {
                mapStyle: null,
                viewState: null,
              },
            },
          }
        }
        return node
      }),
    }
    const reverted = await down(modified)

    // Check DeckRendererOp has restored viewState and mapStyle
    const deckRendererNode = reverted.nodes.find(n => n.id === 'deck') as DeckOpJson | undefined
    expect(deckRendererNode).toBeDefined()
    expect(deckRendererNode!.data.inputs).toEqual({
      mapStyle: 'mapbox://styles/mapbox/streets-v11',
      viewState: {
        latitude: 37.7749,
        longitude: -122.4194,
        zoom: 10,
      },
    })
  })

  it('restores viewState if basemap is not connected to deck', async () => {
    const project = createBaseTestProject()
    const migrated = await up(project)
    const modified = {
      ...migrated,
      nodes: migrated.nodes.filter(node => node.id !== 'basemap-0'),
      edges: migrated.edges.filter(edge => edge.source !== 'basemap-0'),
    }
    const reverted = await down(modified)

    // Check DeckRendererOp has no viewState
    const deckRendererNode = reverted.nodes.find(n => n.id === 'deck') as DeckOpJson | undefined
    expect(deckRendererNode).toBeDefined()
    expect(deckRendererNode!.data.inputs).toEqual({
      mapStyle: 'mapbox://styles/mapbox/streets-v11',
      viewState: {
        latitude: 37.7749,
        longitude: -122.4194,
        zoom: 10,
      },
    })
  })

  it('handles missing deck node by creating one', async () => {
    const project = createBaseTestProject()
    const migrated = await up(project)
    const modified = {
      ...migrated,
      nodes: migrated.nodes.filter(node => node.id !== 'deck'),
      edges: [],
    }
    const reverted = await down(modified)

    // Check new DeckRendererOp was created with default position
    const deckRendererNode = reverted.nodes.find(n => n.id === 'deck') as DeckOpJson | undefined
    expect(deckRendererNode).toBeDefined()
    expect(deckRendererNode!.type).toBe('DeckRendererOp')
    expect(deckRendererNode!.position).toEqual({ x: 0, y: 0 })
  })
})
