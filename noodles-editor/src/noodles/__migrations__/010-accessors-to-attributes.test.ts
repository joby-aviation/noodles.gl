import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './010-accessors-to-attributes'

describe('010-accessors-to-attributes', () => {
  it('should migrate AccessorOp to CreateAttributeOp', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/data-source',
          type: 'FileOp',
          position: { x: 100, y: 100 },
          data: { inputs: { url: 'data.csv' } },
        },
        {
          id: '/accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 100 },
          data: { inputs: { expression: '[d.lng, d.lat]' } },
        },
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 300, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data-source.out.data->/accessor.par.data',
          source: '/data-source',
          target: '/accessor',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/accessor.out.accessor->/scatterplot.par.getPosition',
          source: '/accessor',
          target: '/scatterplot',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    // Should remove AccessorOp node
    expect(migrated.nodes.find(n => n.id === '/accessor')).toBeUndefined()

    // Should create CreateAttributeOp node
    const createAttrNode = migrated.nodes.find(n => n.id === '/accessor-attr')
    expect(createAttrNode).toBeDefined()
    expect(createAttrNode?.type).toBe('CreateAttributeOp')
    expect(createAttrNode?.data.inputs.attributeName).toBe('position')
    expect(createAttrNode?.data.inputs.expression).toBe('[d.lng, d.lat]')
    expect(createAttrNode?.data.inputs.dataType).toBe('vec2')

    // Should rewire edges through CreateAttributeOp
    const dataSourceEdge = migrated.edges.find(
      e => e.source === '/data-source' && e.target === '/accessor-attr'
    )
    expect(dataSourceEdge).toBeDefined()
    expect(dataSourceEdge?.targetHandle).toBe('par.data')

    const layerEdge = migrated.edges.find(
      e => e.source === '/accessor-attr' && e.target === '/scatterplot'
    )
    expect(layerEdge).toBeDefined()
    expect(layerEdge?.targetHandle).toBe('par.data')

    // Should remove old edges
    expect(migrated.edges.find(e => e.id === '/accessor.out.accessor->/scatterplot.par.getPosition')).toBeUndefined()
  })

  it('should handle multiple accessors with different types', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/position-accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 100 },
          data: { inputs: { expression: '[d.lng, d.lat]' } },
        },
        {
          id: '/color-accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 200 },
          data: { inputs: { expression: 'd.value > 100 ? [255, 0, 0, 255] : [0, 255, 0, 255]' } },
        },
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 300, y: 150 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data.out.data->/position-accessor.par.data',
          source: '/data',
          target: '/position-accessor',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/position-accessor.out.accessor->/scatterplot.par.getPosition',
          source: '/position-accessor',
          target: '/scatterplot',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
        {
          id: '/data.out.data->/color-accessor.par.data',
          source: '/data',
          target: '/color-accessor',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/color-accessor.out.accessor->/scatterplot.par.getFillColor',
          source: '/color-accessor',
          target: '/scatterplot',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getFillColor',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    // Should create two CreateAttributeOp nodes
    const positionAttrNode = migrated.nodes.find(n => n.id === '/position-accessor-attr')
    expect(positionAttrNode).toBeDefined()
    expect(positionAttrNode?.data.inputs.attributeName).toBe('position')
    expect(positionAttrNode?.data.inputs.dataType).toBe('vec2')

    const colorAttrNode = migrated.nodes.find(n => n.id === '/color-accessor-attr')
    expect(colorAttrNode).toBeDefined()
    expect(colorAttrNode?.data.inputs.attributeName).toBe('fillColor')
    expect(colorAttrNode?.data.inputs.dataType).toBe('rgba')

    // Should remove both AccessorOp nodes
    expect(migrated.nodes.find(n => n.id === '/position-accessor')).toBeUndefined()
    expect(migrated.nodes.find(n => n.id === '/color-accessor')).toBeUndefined()
  })

  it('should handle ArcLayerOp with source and target positions', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/source-accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 100 },
          data: { inputs: { expression: '[d.origin_lng, d.origin_lat]' } },
        },
        {
          id: '/target-accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 200 },
          data: { inputs: { expression: '[d.dest_lng, d.dest_lat]' } },
        },
        {
          id: '/arc',
          type: 'ArcLayerOp',
          position: { x: 300, y: 150 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data.out.data->/source-accessor.par.data',
          source: '/data',
          target: '/source-accessor',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/source-accessor.out.accessor->/arc.par.getSourcePosition',
          source: '/source-accessor',
          target: '/arc',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getSourcePosition',
        },
        {
          id: '/data.out.data->/target-accessor.par.data',
          source: '/data',
          target: '/target-accessor',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/target-accessor.out.accessor->/arc.par.getTargetPosition',
          source: '/target-accessor',
          target: '/arc',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getTargetPosition',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    const sourceAttrNode = migrated.nodes.find(n => n.id === '/source-accessor-attr')
    expect(sourceAttrNode).toBeDefined()
    expect(sourceAttrNode?.data.inputs.attributeName).toBe('sourcePosition')

    const targetAttrNode = migrated.nodes.find(n => n.id === '/target-accessor-attr')
    expect(targetAttrNode).toBeDefined()
    expect(targetAttrNode?.data.inputs.attributeName).toBe('targetPosition')
  })

  it('should skip AccessorOp nodes without data source', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 100 },
          data: { inputs: { expression: '[d.lng, d.lat]' } },
        },
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 300, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/accessor.out.accessor->/scatterplot.par.getPosition',
          source: '/accessor',
          target: '/scatterplot',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    // Should not migrate (no data source)
    expect(migrated.nodes.find(n => n.id === '/accessor')).toBeDefined()
    expect(migrated.nodes.find(n => n.id === '/accessor-attr')).toBeUndefined()
  })

  it('should skip AccessorOp with empty expression', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 100 },
          data: { inputs: { expression: '' } },
        },
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 300, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data.out.data->/accessor.par.data',
          source: '/data',
          target: '/accessor',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/accessor.out.accessor->/scatterplot.par.getPosition',
          source: '/accessor',
          target: '/scatterplot',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    // Should not migrate (empty expression)
    expect(migrated.nodes.find(n => n.id === '/accessor')).toBeDefined()
    expect(migrated.nodes.find(n => n.id === '/accessor-attr')).toBeUndefined()
  })

  it('should handle project with no AccessorOp nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 200, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)

    // Should return unchanged
    expect(migrated.nodes).toEqual(project.nodes)
    expect(migrated.edges).toEqual(project.edges)
  })

  it('should migrate back down correctly', async () => {
    const projectWithCreateAttr: NoodlesProjectJSON = {
      version: 10,
      nodes: [
        {
          id: '/data-source',
          type: 'FileOp',
          position: { x: 100, y: 100 },
          data: { inputs: { url: 'data.csv' } },
        },
        {
          id: '/accessor-attr',
          type: 'CreateAttributeOp',
          position: { x: 200, y: 180 },
          data: {
            inputs: {
              attributeName: 'position',
              expression: '[d.lng, d.lat]',
              dataType: 'vec2',
            },
          },
        },
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 300, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data-source.out.data->/accessor-attr.par.data',
          source: '/data-source',
          target: '/accessor-attr',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/accessor-attr.out.data->/scatterplot.par.data',
          source: '/accessor-attr',
          target: '/scatterplot',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await down(projectWithCreateAttr)

    // Should remove CreateAttributeOp node
    expect(migrated.nodes.find(n => n.id === '/accessor-attr')).toBeUndefined()

    // Should create AccessorOp node
    const accessorNode = migrated.nodes.find(n => n.id === '/accessor')
    expect(accessorNode).toBeDefined()
    expect(accessorNode?.type).toBe('AccessorOp')
    expect(accessorNode?.data.inputs.expression).toBe('[d.lng, d.lat]')

    // Should rewire edges through AccessorOp
    const dataSourceEdge = migrated.edges.find(
      e => e.source === '/data-source' && e.target === '/accessor'
    )
    expect(dataSourceEdge).toBeDefined()
    expect(dataSourceEdge?.targetHandle).toBe('par.data')

    const layerEdge = migrated.edges.find(e => e.source === '/accessor' && e.target === '/scatterplot')
    expect(layerEdge).toBeDefined()
    expect(layerEdge?.targetHandle).toBe('par.getPosition')
  })

  it('should round-trip correctly', async () => {
    const original: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 100, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 100 },
          data: { inputs: { expression: '[d.lng, d.lat]' } },
        },
        {
          id: '/scatterplot',
          type: 'ScatterplotLayerOp',
          position: { x: 300, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data.out.data->/accessor.par.data',
          source: '/data',
          target: '/accessor',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/accessor.out.accessor->/scatterplot.par.getPosition',
          source: '/accessor',
          target: '/scatterplot',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(original)
    const reverted = await down(migrated)

    // Should have equivalent structure (AccessorOp restored)
    const accessorNode = reverted.nodes.find(n => n.type === 'AccessorOp')
    expect(accessorNode).toBeDefined()
    expect(accessorNode?.data.inputs.expression).toBe('[d.lng, d.lat]')

    // Should have data source → accessor → layer connection
    const dataToAccessor = reverted.edges.find(
      e => e.source === '/data' && e.target === accessorNode?.id && e.targetHandle === 'par.data'
    )
    expect(dataToAccessor).toBeDefined()

    const accessorToLayer = reverted.edges.find(
      e =>
        e.source === accessorNode?.id &&
        e.target === '/scatterplot' &&
        e.targetHandle === 'par.getPosition'
    )
    expect(accessorToLayer).toBeDefined()
  })
})
