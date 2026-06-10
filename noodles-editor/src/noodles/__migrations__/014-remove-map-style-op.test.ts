import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './014-remove-map-style-op'

const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'
const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

function makeProject(overrides: Partial<NoodlesProjectJSON> = {}): NoodlesProjectJSON {
  return {
    version: 13,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    timeline: {},
    ...overrides,
  }
}

describe('014-remove-map-style-op', () => {
  it('inlines the map style value onto the connected MaplibreBasemapOp', async () => {
    const project = makeProject({
      nodes: [
        {
          id: '/map-style',
          type: 'MapStyleOp',
          position: { x: 0, y: 0 },
          data: { inputs: { mapStyle: CARTO_LIGHT } },
        },
        {
          id: '/basemap',
          type: 'MaplibreBasemapOp',
          position: { x: 320, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/map-style.out.mapStyle->/basemap.par.mapStyle',
          source: '/map-style',
          target: '/basemap',
          sourceHandle: 'out.mapStyle',
          targetHandle: 'par.mapStyle',
        },
      ],
    })

    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(1)
    expect(migrated.nodes[0].type).toBe('MaplibreBasemapOp')
    expect((migrated.nodes[0].data?.inputs as Record<string, unknown>).mapStyle).toBe(CARTO_LIGHT)
    expect(migrated.edges).toHaveLength(0)
  })

  it('uses CARTO_DARK as fallback when MapStyleOp has no value', async () => {
    const project = makeProject({
      nodes: [
        {
          id: '/map-style',
          type: 'MapStyleOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/basemap',
          type: 'MaplibreBasemapOp',
          position: { x: 320, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/map-style.out.mapStyle->/basemap.par.mapStyle',
          source: '/map-style',
          target: '/basemap',
          sourceHandle: 'out.mapStyle',
          targetHandle: 'par.mapStyle',
        },
      ],
    })

    const migrated = await up(project)
    expect((migrated.nodes[0].data?.inputs as Record<string, unknown>).mapStyle).toBe(CARTO_DARK)
  })

  it('is a no-op when there are no MapStyleOp nodes', async () => {
    const project = makeProject({
      nodes: [
        {
          id: '/basemap',
          type: 'MaplibreBasemapOp',
          position: { x: 0, y: 0 },
          data: { inputs: { mapStyle: CARTO_LIGHT } },
        },
      ],
      edges: [],
    })

    const migrated = await up(project)
    expect(migrated).toBe(project)
  })

  it('removes a MapStyleOp that is not connected to anything', async () => {
    const project = makeProject({
      nodes: [
        {
          id: '/map-style',
          type: 'MapStyleOp',
          position: { x: 0, y: 0 },
          data: { inputs: { mapStyle: CARTO_LIGHT } },
        },
      ],
      edges: [],
    })

    const migrated = await up(project)
    expect(migrated.nodes).toHaveLength(0)
  })

  it('is reversible', async () => {
    const original = makeProject({
      nodes: [
        {
          id: '/map-style',
          type: 'MapStyleOp',
          position: { x: 0, y: 0 },
          data: { inputs: { mapStyle: CARTO_LIGHT } },
        },
        {
          id: '/basemap',
          type: 'MaplibreBasemapOp',
          position: { x: 320, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/map-style.out.mapStyle->/basemap.par.mapStyle',
          source: '/map-style',
          target: '/basemap',
          sourceHandle: 'out.mapStyle',
          targetHandle: 'par.mapStyle',
        },
      ],
    })

    const migrated = await up(original)
    const reverted = await down(migrated)

    // MapStyleOp should be recreated with the correct value
    const mapStyleNode = reverted.nodes.find(n => n.type === 'MapStyleOp')
    expect(mapStyleNode).toBeDefined()
    expect((mapStyleNode?.data?.inputs as Record<string, unknown>).mapStyle).toBe(CARTO_LIGHT)

    // mapStyle should be removed from basemap inputs
    const basemapNode = reverted.nodes.find(n => n.type === 'MaplibreBasemapOp')
    expect((basemapNode?.data?.inputs as Record<string, unknown>).mapStyle).toBeUndefined()

    // Edge should be recreated
    expect(reverted.edges).toHaveLength(1)
    expect(reverted.edges[0].sourceHandle).toBe('out.mapStyle')
    expect(reverted.edges[0].targetHandle).toBe('par.mapStyle')
  })

  it('down does not recreate MapStyleOp when mapStyle is fed by an existing edge', async () => {
    const project = makeProject({
      nodes: [
        {
          id: '/basemap',
          type: 'MaplibreBasemapOp',
          position: { x: 320, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/custom-style',
          type: 'StringOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/custom-style.out.value->/basemap.par.mapStyle',
          source: '/custom-style',
          target: '/basemap',
          sourceHandle: 'out.value',
          targetHandle: 'par.mapStyle',
        },
      ],
    })

    const reverted = await down(project)
    expect(reverted.nodes.find(n => n.type === 'MapStyleOp')).toBeUndefined()
    expect(reverted.edges).toHaveLength(1)
  })
})
