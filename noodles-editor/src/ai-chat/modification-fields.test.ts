import { describe, expect, it } from 'vitest'
import {
  checkFields,
  type FieldCheckContext,
  qualifyHandle,
  resolveOperatorType,
} from './modification-fields'
import { getOperatorRegistry } from './runtime-operator-registry'
import type { ProjectModification } from './types'

// The real registry, so a renamed field breaks these tests rather than the model
const registry = getOperatorRegistry()

function context(types: Record<string, string>, live: string[] = []): FieldCheckContext {
  return {
    registry,
    types: new Map(Object.entries(types)),
    liveFields: () => live,
  }
}

const edge = (sourceHandle: string, targetHandle: string): ProjectModification => ({
  type: 'add_edge',
  data: {
    id: `/data.${sourceHandle}->/points.${targetHandle}`,
    source: '/data',
    target: '/points',
    sourceHandle,
    targetHandle,
  },
})

const TYPES = { '/data': 'FileOp', '/points': 'ScatterplotLayerOp', '/deck': 'DeckRendererOp' }

describe('resolveOperatorType', () => {
  it('maps a display name or a missing Op suffix to the type', () => {
    expect(resolveOperatorType('File', registry)).toBe('FileOp')
    expect(resolveOperatorType('GeoJsonLayer', registry)).toBe('GeoJsonLayerOp')
    expect(resolveOperatorType('scatterplotlayerop', registry)).toBe('ScatterplotLayerOp')
  })

  it('leaves a real type and an unknown name alone', () => {
    expect(resolveOperatorType('HeatmapLayerOp', registry)).toBe('HeatmapLayerOp')
    expect(resolveOperatorType('Heatmap', registry)).toBe('Heatmap')
  })
})

describe('qualifyHandle', () => {
  it('adds the side a bare field name is on', () => {
    expect(qualifyHandle('data', 'source')).toBe('out.data')
    expect(qualifyHandle('data', 'target')).toBe('par.data')
    expect(qualifyHandle('par.data', 'target')).toBe('par.data')
  })
})

describe('checkFields', () => {
  it('accepts real types, inputs and handles', () => {
    const add: ProjectModification = {
      type: 'add_node',
      data: {
        id: '/points',
        type: 'ScatterplotLayerOp',
        data: { inputs: { getFillColor: '#f00' } },
      },
    }
    expect(checkFields(add, context({}))).toEqual([])
    expect(checkFields(edge('out.data', 'par.data'), context(TYPES))).toEqual([])
  })

  it('names close operator types for one that does not exist', () => {
    const [problem] = checkFields(
      { type: 'add_node', data: { id: '/heat', type: 'Heatmap' } },
      context({})
    )
    expect(problem).toContain('Unknown operator type Heatmap')
    expect(problem).toContain('HeatmapLayerOp')
  })

  it('suggests the inputs an unknown one resembles', () => {
    const [problem] = checkFields(
      { type: 'update_node', data: { id: '/points', data: { inputs: { color: '#f00' } } } },
      context(TYPES)
    )
    expect(problem).toContain('/points (ScatterplotLayerOp) has no input color')
    expect(problem).toContain('getFillColor')
  })

  it('reports the handle the benchmark ceiling got wrong, with the right one', () => {
    const problems = checkFields(
      {
        type: 'add_edge',
        data: {
          id: '/points.out.vis->/deck.par.vis',
          source: '/points',
          target: '/deck',
          sourceHandle: 'out.vis',
          targetHandle: 'par.layers',
        },
      },
      context(TYPES)
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('/points (ScatterplotLayerOp) has no output vis')
    expect(problems[0]).toContain('out.layer')
  })

  it('checks the whole name after the prefix, since that is what the graph looks up', () => {
    // 'par.data.features' names a field 'data.features', which ScatterplotLayerOp
    // does not have; accepting it because 'data' exists queued an edge that
    // connected nothing
    const [problem] = checkFields(edge('out.data', 'par.data.features'), context(TYPES))
    expect(problem).toContain('/points (ScatterplotLayerOp) has no input data.features')
  })

  it('catches an edge wired backwards', () => {
    const [problem] = checkFields(edge('par.data', 'par.data'), context(TYPES))
    expect(problem).toContain('sourceHandle par.data is on the wrong side')
  })

  it('requires both handles', () => {
    const [problem] = checkFields(
      { type: 'add_edge', data: { id: 'x', source: '/data', target: '/points' } },
      context(TYPES)
    )
    expect(problem).toContain('add_edge needs sourceHandle')
  })

  it('accepts inputs the live operator has beyond its class', () => {
    const update: ProjectModification = {
      type: 'update_node',
      data: { id: '/points', data: { inputs: { myThreshold: 3 } } },
    }
    expect(checkFields(update, context(TYPES, ['myThreshold']))).toEqual([])
  })

  it('accepts inputs a new node declares for itself', () => {
    const add: ProjectModification = {
      type: 'add_node',
      data: {
        id: '/points',
        type: 'ScatterplotLayerOp',
        data: { customInputs: [{ name: 'myThreshold' }], inputs: { myThreshold: 3 } },
      },
    }
    expect(checkFields(add, context({}))).toEqual([])
  })

  it('leaves a node of an unknown type to the check that reports it', () => {
    expect(checkFields(edge('out.data', 'par.data'), context({ '/data': 'NopeOp' }))).toEqual([])
  })
})
