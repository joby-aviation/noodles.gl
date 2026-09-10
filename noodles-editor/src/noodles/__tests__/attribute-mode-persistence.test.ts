import { describe, it, expect, beforeEach } from 'vitest'
import { ArcLayerOp, ScatterplotLayerOp } from '../operators'
import type { NoodlesProjectJSON } from '../noodles'
import { transformGraph } from '../transform-graph'
import { getOpStore } from '../store'

describe('Attribute Mode Persistence', () => {
  beforeEach(() => {
    const store = getOpStore()
    store.clearOps()
  })

  it('should load ArcLayerOp with attribute mode from saved JSON', () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [
        {
          id: '/arc-layer',
          type: 'ArcLayerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              getSourcePosition: {
                attributeName: 'sourcePosition',
              },
              getTargetPosition: {
                attributeName: 'targetPosition',
              },
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    transformGraph({ nodes: project.nodes, edges: project.edges })

    const arcOp = getOpStore().getOp('/arc-layer') as ArcLayerOp
    expect(arcOp).toBeDefined()
    expect(arcOp.inputs.getSourcePosition.value).toEqual({
      attributeName: 'sourcePosition',
    })
    expect(arcOp.inputs.getTargetPosition.value).toEqual({
      attributeName: 'targetPosition',
    })
  })

  it('should load ScatterplotLayerOp with attribute mode from saved JSON', () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              getPosition: {
                attributeName: 'position',
              },
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    transformGraph({ nodes: project.nodes, edges: project.edges })

    const scatterOp = getOpStore().getOp('/scatterplot') as ScatterplotLayerOp
    expect(scatterOp).toBeDefined()
    expect(scatterOp.inputs.getPosition.value).toEqual({
      attributeName: 'position',
    })
  })

  it('should preserve attribute mode across save/load cycle', () => {
    // Create operator with attribute mode
    const arcOp = new ArcLayerOp('/arc-layer')
    arcOp.inputs.getSourcePosition.setValue({ attributeName: 'sourcePosition' })
    arcOp.inputs.getTargetPosition.setValue({ attributeName: 'targetPosition' })

    // Simulate serialization
    const serialized = {
      id: '/arc-layer',
      type: 'ArcLayerOp',
      position: { x: 0, y: 0 },
      data: {
        inputs: {
          getSourcePosition: arcOp.inputs.getSourcePosition.value,
          getTargetPosition: arcOp.inputs.getTargetPosition.value,
        },
      },
    }

    // Clear and reload
    getOpStore().clearOps()
    transformGraph({
      nodes: [serialized as any],
      edges: [],
    })

    // Verify attribute mode persisted
    const reloadedOp = getOpStore().getOp('/arc-layer') as ArcLayerOp
    expect(reloadedOp.inputs.getSourcePosition.value).toEqual({
      attributeName: 'sourcePosition',
    })
    expect(reloadedOp.inputs.getTargetPosition.value).toEqual({
      attributeName: 'targetPosition',
    })
  })

  it('should load with default uniform values when no attribute is specified', () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [
        {
          id: '/arc-layer',
          type: 'ArcLayerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    transformGraph({ nodes: project.nodes, edges: project.edges })

    const arcOp = getOpStore().getOp('/arc-layer') as ArcLayerOp
    expect(arcOp).toBeDefined()
    // Should have default uniform values
    expect(arcOp.inputs.getSourcePosition.value).toEqual([0, 0, 0])
    expect(arcOp.inputs.getTargetPosition.value).toEqual([0, 0, 0])
  })

  it('should load with expression mode from saved JSON', () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [
        {
          id: '/arc-layer',
          type: 'ArcLayerOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              getSourcePosition: {
                expression: '[d.home_lng, d.home_lat, 0]',
              },
              getTargetPosition: {
                expression: '[d.work_lng, d.work_lat, 0]',
              },
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    transformGraph({ nodes: project.nodes, edges: project.edges })

    const arcOp = getOpStore().getOp('/arc-layer') as ArcLayerOp
    expect(arcOp.inputs.getSourcePosition.value).toEqual({
      expression: '[d.home_lng, d.home_lat, 0]',
    })
    expect(arcOp.inputs.getTargetPosition.value).toEqual({
      expression: '[d.work_lng, d.work_lat, 0]',
    })
  })
})
