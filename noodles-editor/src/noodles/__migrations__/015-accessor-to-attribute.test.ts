import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './015-accessor-to-attribute'

describe('015-accessor-to-attribute migration', () => {
  it('should convert AccessorOp to CreateAttributeOp for ScatterplotLayer', async () => {
    const project: NoodlesProjectJSON = {
      version: 14,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: { inputs: { url: '@/data.csv' } },
        },
        {
          id: '/accessor-position',
          type: 'AccessorOp',
          position: { x: 200, y: 0 },
          data: { inputs: { expression: '[d.lng, d.lat, 0]' } },
        },
        {
          id: '/layer',
          type: 'ScatterplotLayerOp',
          position: { x: 400, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data.out.data->/layer.par.data',
          source: '/data',
          target: '/layer',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/accessor-position.out.accessor->/layer.par.getPosition',
          source: '/accessor-position',
          target: '/layer',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    // AccessorOp should be removed
    expect(migrated.nodes.find(n => n.id === '/accessor-position')).toBeUndefined()

    // CreateAttributeOp should be added
    const createAttrNode = migrated.nodes.find(n => n.type === 'CreateAttributeOp')
    expect(createAttrNode).toBeDefined()
    expect(createAttrNode?.data.inputs.name).toBe('position')
    expect(createAttrNode?.data.inputs.expression).toBe('[d.lng, d.lat, 0]')
    expect(createAttrNode?.data.inputs.source).toBe('expression')
    expect(createAttrNode?.data.inputs.size).toBe(3)

    // Old accessor edge should be removed
    expect(migrated.edges.find(e => e.sourceHandle === 'out.accessor')).toBeUndefined()

    // Data should flow through CreateAttributeOp
    const dataToAttr = migrated.edges.find(
      e => e.source === '/data' && e.target === createAttrNode?.id
    )
    expect(dataToAttr).toBeDefined()
    expect(dataToAttr?.targetHandle).toBe('par.data')

    const attrToLayer = migrated.edges.find(
      e => e.source === createAttrNode?.id && e.target === '/layer'
    )
    expect(attrToLayer).toBeDefined()
    expect(attrToLayer?.targetHandle).toBe('par.data')
  })

  it('should chain multiple CreateAttributeOps for multiple accessors', async () => {
    const project: NoodlesProjectJSON = {
      version: 14,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: { inputs: { url: '@/data.csv' } },
        },
        {
          id: '/accessor-position',
          type: 'AccessorOp',
          position: { x: 200, y: 0 },
          data: { inputs: { expression: '[d.lng, d.lat, 0]' } },
        },
        {
          id: '/accessor-radius',
          type: 'AccessorOp',
          position: { x: 200, y: 100 },
          data: { inputs: { expression: 'd.value * 10' } },
        },
        {
          id: '/accessor-color',
          type: 'AccessorOp',
          position: { x: 200, y: 200 },
          data: { inputs: { expression: '[d.r, d.g, d.b, 255]' } },
        },
        {
          id: '/layer',
          type: 'ScatterplotLayerOp',
          position: { x: 400, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data.out.data->/layer.par.data',
          source: '/data',
          target: '/layer',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/accessor-position.out.accessor->/layer.par.getPosition',
          source: '/accessor-position',
          target: '/layer',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
        {
          id: '/accessor-radius.out.accessor->/layer.par.getRadius',
          source: '/accessor-radius',
          target: '/layer',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getRadius',
        },
        {
          id: '/accessor-color.out.accessor->/layer.par.getFillColor',
          source: '/accessor-color',
          target: '/layer',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getFillColor',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    // All AccessorOps should be removed
    expect(migrated.nodes.filter(n => n.type === 'AccessorOp')).toHaveLength(0)

    // Three CreateAttributeOps should be added
    const createAttrNodes = migrated.nodes.filter(n => n.type === 'CreateAttributeOp')
    expect(createAttrNodes).toHaveLength(3)

    // Check attribute names
    const names = createAttrNodes.map(n => n.data.inputs.name).sort()
    expect(names).toEqual(['fillColor', 'position', 'radius'])

    // Check chaining: data -> attr1 -> attr2 -> attr3 -> layer
    const posNode = createAttrNodes.find(n => n.data.inputs.name === 'position')
    const radiusNode = createAttrNodes.find(n => n.data.inputs.name === 'radius')
    const colorNode = createAttrNodes.find(n => n.data.inputs.name === 'fillColor')

    expect(posNode).toBeDefined()
    expect(radiusNode).toBeDefined()
    expect(colorNode).toBeDefined()

    // Verify chain
    const dataToFirst = migrated.edges.find(e => e.source === '/data' && e.targetHandle === 'par.data')
    expect(dataToFirst).toBeDefined()

    const lastToLayer = migrated.edges.find(e => e.target === '/layer' && e.targetHandle === 'par.data')
    expect(lastToLayer).toBeDefined()

    // Should have 4 edges: data->attr, attr->attr, attr->attr, attr->layer
    const attrEdges = migrated.edges.filter(
      e =>
        e.targetHandle === 'par.data' &&
        (e.source === '/data' || migrated.nodes.find(n => n.id === e.source)?.type === 'CreateAttributeOp')
    )
    expect(attrEdges).toHaveLength(4)
  })

  it('should handle color accessors with size 4', async () => {
    const project: NoodlesProjectJSON = {
      version: 14,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 0 },
          data: { inputs: { expression: '[255, 0, 0, 255]' } },
        },
        {
          id: '/layer',
          type: 'PathLayerOp',
          position: { x: 400, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data.out.data->/layer.par.data',
          source: '/data',
          target: '/layer',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/accessor.out.accessor->/layer.par.getColor',
          source: '/accessor',
          target: '/layer',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getColor',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    const createAttrNode = migrated.nodes.find(n => n.type === 'CreateAttributeOp')
    expect(createAttrNode?.data.inputs.size).toBe(4)
    expect(createAttrNode?.data.inputs.name).toBe('color')
  })

  it('should not migrate if no AccessorOps present', async () => {
    const project: NoodlesProjectJSON = {
      version: 14,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
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
          id: '/data.out.data->/layer.par.data',
          source: '/data',
          target: '/layer',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    expect(migrated).toEqual(project)
  })

  it('should handle AccessorOps not connected to layers', async () => {
    const project: NoodlesProjectJSON = {
      version: 14,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/accessor',
          type: 'AccessorOp',
          position: { x: 200, y: 0 },
          data: { inputs: { expression: 'd.value' } },
        },
        {
          id: '/other',
          type: 'FilterOp',
          position: { x: 400, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/accessor.out.accessor->/other.par.condition',
          source: '/accessor',
          target: '/other',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.condition',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    // Should not migrate AccessorOps that aren't connected to layer accessor inputs
    expect(migrated.nodes.find(n => n.id === '/accessor')).toBeDefined()
    expect(migrated.nodes.filter(n => n.type === 'CreateAttributeOp')).toHaveLength(0)
  })

  it('should handle layers with no data edge', async () => {
    const project: NoodlesProjectJSON = {
      version: 14,
      nodes: [
        {
          id: '/accessor',
          type: 'AccessorOp',
          position: { x: 0, y: 0 },
          data: { inputs: { expression: '[0, 0, 0]' } },
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
          id: '/accessor.out.accessor->/layer.par.getPosition',
          source: '/accessor',
          target: '/layer',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    // Should not migrate if no data edge exists
    expect(migrated.nodes.find(n => n.id === '/accessor')).toBeDefined()
    expect(migrated.nodes.filter(n => n.type === 'CreateAttributeOp')).toHaveLength(0)
  })

  it('should handle re-layout with proper y positioning', async () => {
    const project: NoodlesProjectJSON = {
      version: 14,
      nodes: [
        {
          id: '/data',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/acc1',
          type: 'AccessorOp',
          position: { x: 200, y: 50 },
          data: { inputs: { expression: 'd.a' } },
        },
        {
          id: '/acc2',
          type: 'AccessorOp',
          position: { x: 200, y: 50 },
          data: { inputs: { expression: 'd.b' } },
        },
        {
          id: '/layer',
          type: 'ScatterplotLayerOp',
          position: { x: 400, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/data.out.data->/layer.par.data',
          source: '/data',
          target: '/layer',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
        {
          id: '/acc1.out.accessor->/layer.par.getPosition',
          source: '/acc1',
          target: '/layer',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getPosition',
        },
        {
          id: '/acc2.out.accessor->/layer.par.getRadius',
          source: '/acc2',
          target: '/layer',
          sourceHandle: 'out.accessor',
          targetHandle: 'par.getRadius',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    const createAttrNodes = migrated.nodes
      .filter(n => n.type === 'CreateAttributeOp')
      .sort((a, b) => a.position.y - b.position.y)

    expect(createAttrNodes).toHaveLength(2)

    // Nodes should be vertically spaced by 120px
    expect(createAttrNodes[1].position.y).toBeGreaterThan(createAttrNodes[0].position.y)
  })

  it('should return project unchanged for down migration', async () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await down(project)
    expect(migrated).toEqual(project)
  })
})
