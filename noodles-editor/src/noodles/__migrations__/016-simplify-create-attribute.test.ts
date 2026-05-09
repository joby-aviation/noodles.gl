import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './016-simplify-create-attribute'

describe('Migration 016: Simplify CreateAttributeOp', () => {
  it('should convert column mode to expression', async () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      timeline: {},
      nodes: [
        {
          id: '/test/attr',
          type: 'CreateAttributeOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              data: undefined,
              name: 'myValue',
              source: 'column',
              column: 'value',
              expression: 'd.value',
              type: 'float',
              size: 1,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    expect(migrated.nodes[0].data?.inputs).toEqual({
      data: undefined,
      name: 'myValue',
      expression: 'd.value',
      type: 'float',
      size: 1,
    })
    expect(migrated.nodes[0].data?.inputs).not.toHaveProperty('source')
    expect(migrated.nodes[0].data?.inputs).not.toHaveProperty('column')
  })

  it('should convert nested column paths', async () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      timeline: {},
      nodes: [
        {
          id: '/test/attr',
          type: 'CreateAttributeOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              data: undefined,
              name: 'xCoord',
              source: 'column',
              column: 'coords.x',
              expression: 'd.value',
              type: 'float',
              size: 1,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    expect(migrated.nodes[0].data?.inputs).toMatchObject({
      expression: 'd.coords.x',
    })
  })

  it('should keep expression mode unchanged', async () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      timeline: {},
      nodes: [
        {
          id: '/test/attr',
          type: 'CreateAttributeOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              data: undefined,
              name: 'doubled',
              source: 'expression',
              column: '',
              expression: 'd.value * 2',
              type: 'float',
              size: 1,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    expect(migrated.nodes[0].data?.inputs).toMatchObject({
      expression: 'd.value * 2',
    })
    expect(migrated.nodes[0].data?.inputs).not.toHaveProperty('source')
    expect(migrated.nodes[0].data?.inputs).not.toHaveProperty('column')
  })

  it('should handle missing column field', async () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      timeline: {},
      nodes: [
        {
          id: '/test/attr',
          type: 'CreateAttributeOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              data: undefined,
              name: 'value',
              source: 'column',
              column: '',
              expression: 'd.fallback',
              type: 'float',
              size: 1,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    // Should keep expression since column is empty
    expect(migrated.nodes[0].data?.inputs).toMatchObject({
      expression: 'd.fallback',
    })
  })

  it('should not affect other operator types', async () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      timeline: {},
      nodes: [
        {
          id: '/test/number',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              value: 42,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    expect(migrated.nodes[0]).toEqual(project.nodes[0])
  })

  it('should handle projects with no CreateAttributeOp nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 15,
      timeline: {},
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    expect(migrated).toEqual(project)
  })

  describe('down migration', () => {
    it('should detect simple column references', async () => {
      const project: NoodlesProjectJSON = {
        version: 16,
        timeline: {},
        nodes: [
          {
            id: '/test/attr',
            type: 'CreateAttributeOp',
            position: { x: 0, y: 0 },
            data: {
              inputs: {
                data: undefined,
                name: 'myValue',
                expression: 'd.value',
                type: 'float',
                size: 1,
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      const migrated = await down(project)

      expect(migrated.nodes[0].data?.inputs).toMatchObject({
        source: 'column',
        column: 'value',
        expression: 'd.value',
      })
    })

    it('should keep complex expressions as expression mode', async () => {
      const project: NoodlesProjectJSON = {
        version: 16,
        timeline: {},
        nodes: [
          {
            id: '/test/attr',
            type: 'CreateAttributeOp',
            position: { x: 0, y: 0 },
            data: {
              inputs: {
                data: undefined,
                name: 'doubled',
                expression: 'd.value * 2',
                type: 'float',
                size: 1,
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      const migrated = await down(project)

      expect(migrated.nodes[0].data?.inputs).toMatchObject({
        source: 'expression',
        column: '',
        expression: 'd.value * 2',
      })
    })
  })
})
