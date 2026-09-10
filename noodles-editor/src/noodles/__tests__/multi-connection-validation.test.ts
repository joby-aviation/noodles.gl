import { describe, it, expect, beforeEach } from 'vitest'
import type { NoodlesProjectJSON } from '../noodles'
import { transformGraph } from '../transform-graph'
import { getOpStore } from '../store'

describe('Multiple Connection Validation', () => {
  beforeEach(() => {
    const store = getOpStore()
    store.clearOps()
  })

  it('should throw error when multiple connections target a non-list field', () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [
        {
          id: '/data-source-1',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              url: 'data1.csv',
              format: 'csv',
            },
          },
        },
        {
          id: '/data-source-2',
          type: 'FileOp',
          position: { x: 0, y: 100 },
          data: {
            inputs: {
              url: 'data2.csv',
              format: 'csv',
            },
          },
        },
        {
          id: '/layer',
          type: 'ScatterplotLayerOp',
          position: { x: 200, y: 50 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [
        {
          id: '/data-source-1.out.data->/layer.par.data',
          source: '/data-source-1',
          sourceHandle: 'out.data',
          target: '/layer',
          targetHandle: 'par.data',
        },
        {
          id: '/data-source-2.out.data->/layer.par.data',
          source: '/data-source-2',
          sourceHandle: 'out.data',
          target: '/layer',
          targetHandle: 'par.data',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    expect(() => {
      transformGraph({ nodes: project.nodes, edges: project.edges })
    }).toThrow(/Multiple connections to non-list field "data" on \/layer/)
  })

  it('should allow multiple connections to ListField inputs', () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [
        {
          id: '/layer-1',
          type: 'ScatterplotLayerOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/layer-2',
          type: 'ArcLayerOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/deck',
          type: 'DeckRendererOp',
          position: { x: 200, y: 50 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/layer-1.out.layer->/deck.par.layers',
          source: '/layer-1',
          sourceHandle: 'out.layer',
          target: '/deck',
          targetHandle: 'par.layers',
        },
        {
          id: '/layer-2.out.layer->/deck.par.layers',
          source: '/layer-2',
          sourceHandle: 'out.layer',
          target: '/deck',
          targetHandle: 'par.layers',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    // Should not throw - DeckRendererOp.layers is a ListField
    expect(() => {
      transformGraph({ nodes: project.nodes, edges: project.edges })
    }).not.toThrow()
  })

  it('should allow single connection to non-list field', () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [
        {
          id: '/data-source',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              url: 'data.csv',
              format: 'csv',
            },
          },
        },
        {
          id: '/layer',
          type: 'ScatterplotLayerOp',
          position: { x: 200, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data-source.out.data->/layer.par.data',
          source: '/data-source',
          sourceHandle: 'out.data',
          target: '/layer',
          targetHandle: 'par.data',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    // Should not throw - only one connection
    expect(() => {
      transformGraph({ nodes: project.nodes, edges: project.edges })
    }).not.toThrow()
  })

  it('should include edge IDs in error message for debugging', () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [
        {
          id: '/data-source-1',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              url: 'data1.csv',
              format: 'csv',
            },
          },
        },
        {
          id: '/data-source-2',
          type: 'FileOp',
          position: { x: 0, y: 100 },
          data: {
            inputs: {
              url: 'data2.csv',
              format: 'csv',
            },
          },
        },
        {
          id: '/layer',
          type: 'ScatterplotLayerOp',
          position: { x: 200, y: 50 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [
        {
          id: '/data-source-1.out.data->/layer.par.data',
          source: '/data-source-1',
          sourceHandle: 'out.data',
          target: '/layer',
          targetHandle: 'par.data',
        },
        {
          id: '/data-source-2.out.data->/layer.par.data',
          source: '/data-source-2',
          sourceHandle: 'out.data',
          target: '/layer',
          targetHandle: 'par.data',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    expect(() => {
      transformGraph({ nodes: project.nodes, edges: project.edges })
    }).toThrow(/\/data-source-1\.out\.data->\/layer\.par\.data.*\/data-source-2\.out\.data->\/layer\.par\.data/)
  })
})
