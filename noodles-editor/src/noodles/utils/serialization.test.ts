import { describe, expect, it } from 'vitest'
import { hexToColor } from '../../utils/color'
import { CodeField, ColorField, NumberField } from '../fields'
import { NumberOp, ScenegraphLayerOp, TableEditorOp } from '../operators'
import { edgeId } from './id-utils'
import { safeStringify, serializeEdges, serializeNodes } from './serialization'

describe('safeStringify', () => {
  it('serializes a basic object correctly', () => {
    const obj = { a: 1, b: 'text', c: true }
    const result = safeStringify(obj)
    expect(result).toEqual(JSON.stringify(obj, null, 2))
  })

  it('removes circular references', () => {
    const obj = { name: 'A' } as Record<string, unknown>
    obj.self = obj
    const result = safeStringify(obj)
    expect(result).toEqual('{\n  "name": "A"\n}')
  })

  it('removes functions', () => {
    const obj = { a: 1, fn: () => {} }
    const result = safeStringify(obj)
    expect(result).toEqual('{\n  "a": 1\n}')
  })

  it('handles nested objects with circular references', () => {
    const obj = { a: { b: {} } } as Record<string, unknown>
    obj.a.b.c = obj.a
    const result = safeStringify(obj)
    expect(result).toEqual('{\n  "a": {\n    "b": {}\n  }\n}')
  })

  it('handles arrays with circular references', () => {
    const arr: unknown[] = []
    arr.push(arr)
    const result = safeStringify({ arr })
    expect(result).toContain('"arr": [\n    null\n  ]')
  })
})

type MockInput = { serialize: () => unknown }
type MockOp = {
  inputs: Record<string, MockInput>
  locked: { value: boolean }
  createInputs: () => unknown
}

const makeOp = (inputs: Record<string, unknown>, locked = false): MockOp => ({
  inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { serialize: () => v }])),
  locked: { value: locked },
  createInputs: () => ({}),
})

describe('serializeNodes', () => {
  it('includes group nodes as-is', () => {
    const ops = new Map()
    const groupNode = { id: 'group1', type: 'group', data: {}, position: { x: 0, y: 0 } }
    const result = serializeNodes(ops, [groupNode], [])
    expect(result).toEqual([groupNode])
  })

  it('skips nodes without corresponding op', () => {
    const ops = new Map()
    const node = { id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }
    const result = serializeNodes(ops, [node], [])
    expect(result).toEqual([])
  })

  it('serializes a single node with inputs and no incomers', () => {
    const ops = new Map()
    ops.set('node1', makeOp({ a: 1, b: 'text' }, false))

    const node = { id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }
    const result = serializeNodes(ops, [node], [])
    expect(result[0].data).toEqual({
      inputs: { a: 1, b: 'text' },
      locked: false,
    })
  })

  it('omits inputs for unlocked incomers', () => {
    const ops = new Map()
    ops.set('node1', makeOp({ x: 1 }, false))
    ops.set('node0', makeOp({ foo: 42 }, false))

    const node = { id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }
    const connection = {
      source: 'node0',
      target: 'node1',
      sourceHandle: 'out.foo',
      targetHandle: 'par.x',
    }
    const edge = {
      id: edgeId(connection),
      ...connection,
    }
    const result = serializeNodes(ops, [node], [edge])
    expect(result[0].data.inputs).toEqual({})
  })

  it('does not overwrite input if incoming edge is from locked op', () => {
    const ops = new Map()
    ops.set('node1', makeOp({ x: 123 }, false))
    ops.set('node0', makeOp({ foo: 'ignored' }, true)) // locked = true

    const node = { id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }
    const connection = {
      source: 'node0',
      target: 'node1',
      sourceHandle: 'out.foo',
      targetHandle: 'par.x',
    }
    const edge = {
      id: edgeId(connection),
      ...connection,
    }
    const result = serializeNodes(ops, [node], [edge])
    expect(result[0].data.inputs).toEqual({ x: 123 })
  })

  it('does not serialize default values', () => {
    const ops = new Map()
    ops.set('num1', new NumberOp('num1', { val: 123 }, false))
    ops.set('num2', new NumberOp('num2', { val: 0 }, false))
    const nodes = [
      { id: 'num1', type: 'NumberOp', data: { val: 123 }, position: { x: 0, y: 0 } },
      { id: 'num2', type: 'NumberOp', data: { val: 0 }, position: { x: 0, y: 0 } },
    ]
    const result = serializeNodes(ops, nodes, [])
    expect(result[0].data.inputs).toEqual({ val: 123 })
    expect(result[1].data.inputs).toEqual({})
  })

  it('does not serialize object default values', () => {
    const ops = new Map()
    ops.set('model', new ScenegraphLayerOp('model', {}, false))
    const nodes = [{ id: 'model', type: 'ScenegraphLayerOp', data: {}, position: { x: 0, y: 0 } }]
    const result = serializeNodes(ops, nodes, [])
    expect(result[0].data.inputs).not.toHaveProperty('getScale')
  })

  it('serializes multiple nodes with edges correctly', () => {
    const ops = new Map()
    ops.set('nodeA', makeOp({ val: 10 }, false))
    ops.set('nodeB', makeOp({ input: 5 }, false))

    const nodes = [
      { id: 'nodeA', type: 'basic', data: {}, position: { x: 0, y: 0 } },
      { id: 'nodeB', type: 'basic', data: {}, position: { x: 0, y: 0 } },
    ]
    const connection = {
      source: 'nodeA',
      target: 'nodeB',
      sourceHandle: 'out.val',
      targetHandle: 'par.input',
    }
    const edges = [
      {
        id: edgeId(connection),
        ...connection,
      },
    ]
    const result = serializeNodes(ops, nodes, edges)
    expect(result.length).toBe(2)
    const nodeB = result.find(n => n.id === 'nodeB')
    expect(nodeB?.data.inputs).toEqual({})
  })

  it('does not serialize selected property', () => {
    const ops = new Map()
    ops.set('node1', makeOp({ a: 1 }, false))

    const node = {
      id: 'node1',
      type: 'NumberOp',
      data: {},
      width: 100,
      height: 200,
      selected: true,
      position: { x: 0, y: 0 },
    }
    const [result] = serializeNodes(ops, [node], [])
    expect(result.data.selected).toBeUndefined()
  })

  it('does not serialize width and height for non-resizeable nodes', () => {
    const ops = new Map()
    ops.set('node1', makeOp({ a: 1 }, false))

    const node = {
      id: 'node1',
      type: 'NumberOp',
      data: { inputs: { a: 1 } },
      width: 100,
      height: 200,
      selected: true,
      position: { x: 0, y: 0 },
    }
    const [result] = serializeNodes(ops, [node], [])
    expect(result.width).toBeUndefined()
    expect(result.height).toBeUndefined()
  })
  it('serializes width and height for resizeable nodes', () => {
    const ops = new Map()
    ops.set('node1', new TableEditorOp('node1', {}, false))

    const node = {
      id: 'node1',
      type: 'TableEditorOp',
      data: {},
      width: 100,
      height: 200,
      position: { x: 0, y: 0 },
    }
    const [result] = serializeNodes(ops, [node], [])
    expect(result.width).toEqual(100)
    expect(result.height).toEqual(200)
  })

  describe('Field serialization', () => {
    it('serializes NumberField', () => {
      const field = new NumberField(42)
      const serialized = field.serialize()
      expect(serialized).toEqual(42)
    })

    it('serializes hex string ColorFields', () => {
      const field = new ColorField('#00ff00')
      const serialized = field.serialize()
      expect(serialized).toEqual('#00ff00')
    })

    it('serializes a ColorField with [R,G,B, A] array', () => {
      const field = new ColorField('#00ff00ff', { transform: hexToColor })
      expect(field.value).toEqual([0, 255, 0, 255])
      const serialized = field.serialize()
      expect(serialized).toEqual('#00ff00ff')
    })

    it('allows a ColorField with [R,G,B, A] array to be serialized as a hex string', () => {
      const field = new ColorField('#00ff00ff', { transform: hexToColor })
      const serialized = field.serialize()
      expect(serialized).toEqual('#00ff00ff')
    })

    it('serializes a CodeField as an array for easier diffing', () => {
      const field = new CodeField('return 5 + {{num.par.val}}', { language: 'javascript' })
      expect(field.value).toEqual('return 5 + {{num.par.val}}')
      const serialized = field.serialize()
      expect(serialized).toEqual(['return 5 + {{num.par.val}}'])

      const deserialized = CodeField.deserialize([
        'return 5 + {{num.par.val}}',
        'return 6 + {{num.par.val}}',
      ])
      expect(deserialized).toEqual('return 5 + {{num.par.val}}\nreturn 6 + {{num.par.val}}')
    })
  })
})

describe('serializeEdges', () => {
  it('serializes edges', () => {
    const ops = new Map()
    const nodes = [
      { id: 'node-0', type: 'NumberOp', data: {}, position: { x: 0, y: 0 } },
      { id: 'node-1', type: 'NumberOp', data: {}, position: { x: 0, y: 0 } },
    ]
    const edges = [
      {
        id: 'edge-0',
        source: 'node-0',
        target: 'node-1',
        sourceHandle: 'a',
        targetHandle: 'b',
        selected: true,
        animated: false,
      },
    ]
    const result = serializeEdges(ops, nodes, edges)
    expect(result).toEqual([
      { id: 'edge-0', source: 'node-0', target: 'node-1', sourceHandle: 'a', targetHandle: 'b' },
    ])
  })

  it('filters out orphaned edges', () => {
    const ops = new Map()
    const nodes = [
      { id: 'node-0', type: 'NumberOp', data: {}, position: { x: 0, y: 0 } },
      { id: 'node-1', type: 'NumberOp', data: {}, position: { x: 0, y: 0 } },
    ]
    const edges = [
      {
        id: 'valid-edge',
        source: 'node-0',
        target: 'node-1',
        sourceHandle: 'a',
        targetHandle: 'b',
      },
      {
        id: 'orphaned-edge-1',
        source: 'nonexistent-node',
        target: 'node-1',
        sourceHandle: 'a',
        targetHandle: 'b',
      },
      {
        id: 'orphaned-edge-2',
        source: 'node-0',
        target: 'nonexistent-node',
        sourceHandle: 'a',
        targetHandle: 'b',
      },
    ]
    const result = serializeEdges(ops, nodes, edges)
    expect(result).toEqual([
      {
        id: 'valid-edge',
        source: 'node-0',
        target: 'node-1',
        sourceHandle: 'a',
        targetHandle: 'b',
      },
    ])
  })
})
