import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hexToColor } from '../../utils/color'
import { CodeField, ColorField, NumberField } from '../fields'
import { GeoJsonLayerOp, NumberOp, ScenegraphLayerOp, TableEditorOp } from '../operators'
import { clearOps, getOpStore, setOp } from '../store'
import { edgeId } from './id-utils'
import {
  NOODLES_VERSION,
  safeStringify,
  saveProjectLocally,
  serializeEdges,
  serializeNodes,
} from './serialization'

describe('safeStringify', () => {
  it('serializes a basic object correctly', () => {
    const obj = { a: 1, b: 'text', c: true }
    const result = safeStringify(obj)
    expect(result).toEqual(`${JSON.stringify(obj, null, 2)}\n`)
  })

  it('ensures output ends with a newline', () => {
    const obj = { test: 'value' }
    const result = safeStringify(obj)
    expect(result.endsWith('\n')).toBe(true)
    expect(result).toEqual(`${JSON.stringify(obj, null, 2)}\n`)
  })

  it('removes circular references', () => {
    const obj = { name: 'A' } as Record<string, unknown>
    obj.self = obj
    const result = safeStringify(obj)
    expect(result).toEqual('{\n  "name": "A"\n}\n')
  })

  it('removes functions', () => {
    const obj = { a: 1, fn: () => {} }
    const result = safeStringify(obj)
    expect(result).toEqual('{\n  "a": 1\n}\n')
  })

  it('handles nested objects with circular references', () => {
    const obj = { a: { b: {} } } as Record<string, unknown>
    obj.a.b.c = obj.a
    const result = safeStringify(obj)
    expect(result).toEqual('{\n  "a": {\n    "b": {}\n  }\n}\n')
  })

  it('handles arrays with circular references', () => {
    const arr: unknown[] = []
    arr.push(arr)
    const result = safeStringify({ arr })
    expect(result).toContain('"arr": [\n    null\n  ]')
  })
})

type MockInput = {
  serialize: () => unknown
  showByDefault: boolean
  defaultValue?: unknown
  value: unknown
  schema: { parse: (v: unknown) => unknown }
}
type MockOp = {
  inputs: Record<string, MockInput>
  locked: { value: boolean }
  visibleFields: { value: Set<string> | null }
  createInputs: () => unknown
  isFieldVisible: (name: string) => boolean
}

const makeOp = (
  inputs: Record<string, unknown>,
  locked = false,
  options?: { showByDefault?: Record<string, boolean>; defaultValues?: Record<string, unknown> }
): MockOp => {
  const inputEntries = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [
      k,
      {
        serialize: () => v,
        showByDefault: options?.showByDefault?.[k] ?? true,
        defaultValue: options?.defaultValues?.[k],
        value: v, // Mock value matches what serialize() returns
        schema: { parse: (val: unknown) => val }, // Identity transform for mocks
      },
    ])
  )

  const op: MockOp = {
    inputs: inputEntries,
    locked: { value: locked },
    visibleFields: { value: null },
    createInputs: () => ({}),
    isFieldVisible(name: string) {
      const visible = this.visibleFields.value
      if (visible === null) {
        return this.inputs[name]?.showByDefault ?? true
      }
      return visible.has(name)
    },
  }
  return op
}

describe('serializeNodes', () => {
  afterEach(() => {
    clearOps()
  })

  it('includes group nodes as-is', () => {
    const groupNode = { id: 'group1', type: 'group', data: {}, position: { x: 0, y: 0 } }
    const result = serializeNodes(getOpStore(), [groupNode], [])
    expect(result).toEqual([groupNode])
  })

  it('skips nodes without corresponding op', () => {
    const node = { id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }
    const result = serializeNodes(getOpStore(), [node], [])
    expect(result).toEqual([])
  })

  it('serializes a single node with inputs and no incomers', () => {
    setOp('node1', makeOp({ a: 1, b: 'text' }, false) as any)

    const node = { id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }
    const result = serializeNodes(getOpStore(), [node], [])
    expect(result[0].data).toEqual({
      inputs: { a: 1, b: 'text' },
      locked: false,
    })
  })

  it('omits inputs for unlocked incomers', () => {
    setOp('node1', makeOp({ x: 1 }, false))
    setOp('node0', makeOp({ foo: 42 }, false))

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
    const result = serializeNodes(getOpStore(), [node], [edge])
    expect(result[0].data.inputs).toEqual({})
  })

  it('does not overwrite input if incoming edge is from locked op', () => {
    setOp('node1', makeOp({ x: 123 }, false))
    setOp('node0', makeOp({ foo: 'ignored' }, true)) // locked = true

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
    const result = serializeNodes(getOpStore(), [node], [edge])
    expect(result[0].data.inputs).toEqual({ x: 123 })
  })

  it('does not serialize default values', () => {
    setOp('num1', new NumberOp('num1', { val: 123 }, false))
    setOp('num2', new NumberOp('num2', { val: 0 }, false))
    const nodes = [
      { id: 'num1', type: 'NumberOp', data: { val: 123 }, position: { x: 0, y: 0 } },
      { id: 'num2', type: 'NumberOp', data: { val: 0 }, position: { x: 0, y: 0 } },
    ]
    const result = serializeNodes(getOpStore(), nodes, [])
    expect(result[0].data.inputs).toEqual({ val: 123 })
    expect(result[1].data.inputs).toEqual({})
  })

  it('does not serialize object default values', () => {
    setOp('model', new ScenegraphLayerOp('model', {}, false))
    const nodes = [{ id: 'model', type: 'ScenegraphLayerOp', data: {}, position: { x: 0, y: 0 } }]
    const result = serializeNodes(getOpStore(), nodes, [])
    expect(result[0].data.inputs).not.toHaveProperty('getScale')
  })

  it('serializes multiple nodes with edges correctly', () => {
    setOp('nodeA', makeOp({ val: 10 }, false))
    setOp('nodeB', makeOp({ input: 5 }, false))

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
    const result = serializeNodes(getOpStore(), nodes, edges)
    expect(result.length).toBe(2)
    const nodeB = result.find(n => n.id === 'nodeB')
    expect(nodeB?.data.inputs).toEqual({})
  })

  it('does not serialize selected property', () => {
    setOp('node1', makeOp({ a: 1 }, false))

    const node = {
      id: 'node1',
      type: 'NumberOp',
      data: {},
      width: 100,
      height: 200,
      selected: true,
      position: { x: 0, y: 0 },
    }
    const [result] = serializeNodes(getOpStore(), [node], [])
    expect(result.data.selected).toBeUndefined()
  })

  it('does not serialize width and height for non-resizeable nodes', () => {
    setOp('node1', makeOp({ a: 1 }, false))

    const node = {
      id: 'node1',
      type: 'NumberOp',
      data: { inputs: { a: 1 } },
      width: 100,
      height: 200,
      selected: true,
      position: { x: 0, y: 0 },
    }
    const [result] = serializeNodes(getOpStore(), [node], [])
    expect(result.width).toBeUndefined()
    expect(result.height).toBeUndefined()
  })
  it('serializes width and height for resizeable nodes', () => {
    setOp('node1', new TableEditorOp('node1', {}, false))

    const node = {
      id: 'node1',
      type: 'TableEditorOp',
      data: {},
      width: 100,
      height: 200,
      position: { x: 0, y: 0 },
    }
    const [result] = serializeNodes(getOpStore(), [node], [])
    expect(result.width).toEqual(100)
    expect(result.height).toEqual(200)
  })

  it('excludes ReferenceEdge connections when determining connected inputs', () => {
    setOp('node1', makeOp({ x: 123 }, false))
    setOp('node0', makeOp({ foo: 42 }, false))

    const node = { id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }
    const dataConnection = {
      source: 'node0',
      target: 'node1',
      sourceHandle: 'out.foo',
      targetHandle: 'par.x',
    }
    const referenceConnection = {
      source: 'node0',
      target: 'node1',
      sourceHandle: 'out.bar',
      targetHandle: 'par.y',
    }
    const edges = [
      {
        id: edgeId(dataConnection),
        type: 'ReferenceEdge',
        ...referenceConnection,
      },
      {
        id: edgeId(dataConnection),
        ...dataConnection,
      },
    ]
    const result = serializeNodes(getOpStore(), [node], edges)
    // The x input should be omitted because it has a data edge connection
    // But if there were a y input, it would be included because ReferenceEdges don't count as connections
    expect(result[0].data.inputs).toEqual({})
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
      expect(serialized).toEqual('#00ff00ff')
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
    const result = serializeEdges(getOpStore(), nodes, edges)
    expect(result).toEqual([
      { id: 'edge-0', source: 'node-0', target: 'node-1', sourceHandle: 'a', targetHandle: 'b' },
    ])
  })

  it('filters out orphaned edges', () => {
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
    const result = serializeEdges(getOpStore(), nodes, edges)
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

  it('filters out ReferenceEdge types', () => {
    const nodes = [
      { id: 'node-0', type: 'NumberOp', data: {}, position: { x: 0, y: 0 } },
      { id: 'node-1', type: 'NumberOp', data: {}, position: { x: 0, y: 0 } },
    ]
    const edges = [
      {
        id: 'data-edge',
        source: 'node-0',
        target: 'node-1',
        sourceHandle: 'a',
        targetHandle: 'b',
      },
      {
        id: 'reference-edge',
        type: 'ReferenceEdge',
        source: 'node-0',
        target: 'node-1',
        sourceHandle: 'c',
        targetHandle: 'd',
      },
    ]
    const result = serializeEdges(getOpStore(), nodes, edges)
    expect(result).toEqual([
      {
        id: 'data-edge',
        source: 'node-0',
        target: 'node-1',
        sourceHandle: 'a',
        targetHandle: 'b',
      },
    ])
  })
})

describe('saveProjectLocally', () => {
  let mockAnchorElement: HTMLAnchorElement
  let createElementSpy: ReturnType<typeof vi.spyOn>
  let appendChildSpy: ReturnType<typeof vi.spyOn>
  let removeChildSpy: ReturnType<typeof vi.spyOn>
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Mock anchor element
    mockAnchorElement = {
      download: '',
      href: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement

    // Mock DOM APIs
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchorElement)
    appendChildSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(() => mockAnchorElement)
    removeChildSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation(() => mockAnchorElement)

    // Mock URL APIs
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a ZIP with noodles.json for publicFolder storage', async () => {
    const projectName = 'test-project'
    const projectJson = {
      version: NOODLES_VERSION,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    await saveProjectLocally(projectName, projectJson, 'publicFolder')

    // Verify download was triggered
    expect(createElementSpy).toHaveBeenCalledWith('a')
    expect(mockAnchorElement.download).toBe('test-project.zip')
    expect(mockAnchorElement.href).toBe('blob:mock-url')
    expect(mockAnchorElement.click).toHaveBeenCalled()
    expect(appendChildSpy).toHaveBeenCalled()
    expect(removeChildSpy).toHaveBeenCalled()
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
  })

  it('creates a ZIP with correct filename', async () => {
    const projectName = 'my-awesome-viz'
    const projectJson = {
      version: NOODLES_VERSION,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    await saveProjectLocally(projectName, projectJson, 'publicFolder')

    expect(mockAnchorElement.download).toBe('my-awesome-viz.zip')
  })

  it('handles opfs storage type', async () => {
    const projectName = 'opfs-project'
    const projectJson = {
      version: NOODLES_VERSION,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    await saveProjectLocally(projectName, projectJson, 'opfs')

    // Should still create download
    expect(mockAnchorElement.download).toBe('opfs-project.zip')
    expect(mockAnchorElement.click).toHaveBeenCalled()
  })

  it('handles fileSystemAccess storage type', async () => {
    const projectName = 'fs-project'
    const projectJson = {
      version: NOODLES_VERSION,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    await saveProjectLocally(projectName, projectJson, 'fileSystemAccess')

    // Should still create download
    expect(mockAnchorElement.download).toBe('fs-project.zip')
    expect(mockAnchorElement.click).toHaveBeenCalled()
  })

  it('cleans up URL after download', async () => {
    const projectJson = {
      version: NOODLES_VERSION,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    await saveProjectLocally('test', projectJson, 'publicFolder')

    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
  })
})

// Note: serializeRenderSettings tests removed - function was removed in migration 012
// Render settings are now stored as OutOp node inputs

describe('Field visibility serialization (full set when differs from heuristic)', () => {
  describe('project save', () => {
    it('does not serialize visibleInputs when visibility matches heuristic', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      setOp('/geojson-0', op)

      const nodes = [
        { id: '/geojson-0', type: 'GeoJsonLayerOp', data: {}, position: { x: 0, y: 0 } },
      ]
      const result = serializeNodes(getOpStore(), nodes, [])

      expect(result[0].data).not.toHaveProperty('visibleInputs')
    })

    it('does not serialize visibleInputs when visibility matches heuristic (with custom values)', () => {
      // Mock op with showByDefault: false for 'hidden' field
      const op = makeOp({ visible: true, hidden: 'custom' }, false, {
        showByDefault: { visible: true, hidden: false },
      })
      // Set visibleFields to match what heuristic would derive (visible + hidden because hidden has value)
      op.visibleFields.value = new Set(['visible', 'hidden'])
      setOp('node1', op as any)

      const nodes = [{ id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }]
      const result = serializeNodes(getOpStore(), nodes, [])

      // Should NOT serialize because visibility matches heuristic
      expect(result[0].data).not.toHaveProperty('visibleInputs')
    })

    it('serializes full visibleInputs when user showed a field heuristic would hide', () => {
      const op = makeOp({ a: 1 }, false, { showByDefault: { a: true, b: false } })
      // User showed field 'b' which has showByDefault: false and no value
      op.visibleFields.value = new Set(['a', 'b'])
      // Add 'b' to inputs for the mock (but it won't be in serialized inputs since it has no custom value)
      op.inputs.b = { serialize: () => undefined, showByDefault: false }
      setOp('node1', op as any)

      const nodes = [{ id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }]
      const result = serializeNodes(getOpStore(), nodes, [])

      // Full set should be serialized since visibility differs from heuristic
      expect(result[0].data).toHaveProperty('visibleInputs')
      expect(result[0].data.visibleInputs).toContain('a')
      expect(result[0].data.visibleInputs).toContain('b')
    })

    it('serializes full visibleInputs when user hid a field heuristic would show', () => {
      const op = makeOp({ a: 1, b: 2 }, false, { showByDefault: { a: true, b: true } })
      // User hid field 'b' which has showByDefault: true
      op.visibleFields.value = new Set(['a'])
      setOp('node1', op as any)

      const nodes = [{ id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }]
      const result = serializeNodes(getOpStore(), nodes, [])

      // Full set should be serialized (only 'a' visible, 'b' hidden)
      expect(result[0].data).toHaveProperty('visibleInputs')
      expect(result[0].data.visibleInputs).toContain('a')
      expect(result[0].data.visibleInputs).not.toContain('b')
    })
  })

  it('does not serialize visibleInputs for GeoJsonLayerOp when getPointRadius is connected', () => {
    // This is the exact user scenario:
    // 1. Add GeoJsonLayerOp
    // 2. Show getPointRadius (which has showByDefault: false)
    // 3. Connect NumberOp to getPointRadius
    // 4. After connecting, visibleInputs should NOT be serialized
    const geojsonOp = new GeoJsonLayerOp('/geojson-layer')
    // Simulate user showing getPointRadius (which has showByDefault: false)
    geojsonOp.showField('getPointRadius')
    setOp('/geojson-layer', geojsonOp)

    // Add source NumberOp
    const numberOp = new NumberOp('/number-1', { val: 5 }, false)
    setOp('/number-1', numberOp)

    const nodes = [
      { id: '/geojson-layer', type: 'GeoJsonLayerOp', data: {}, position: { x: 0, y: 0 } },
    ]
    // Connect NumberOp to getPointRadius
    const edges = [
      {
        id: '/number-1.out.val->/geojson-layer.par.getPointRadius',
        source: '/number-1',
        target: '/geojson-layer',
        sourceHandle: 'out.val',
        targetHandle: 'par.getPointRadius',
      },
    ]

    const result = serializeNodes(getOpStore(), nodes, edges)

    // After connecting, getPointRadius is visible via heuristic (hasConnection)
    // so visibleInputs should NOT be serialized (visibility matches heuristic)
    expect(result[0].data).not.toHaveProperty('visibleInputs')
  })

  it('does not serialize visibleInputs when field becomes visible via connection', () => {
    // This tests the scenario: user shows a field (no value), then connects it
    // After connecting, visibleInputs should NOT be serialized because
    // the field is now visible via heuristic (hasConnection)
    const op = makeOp({ defaultField: 1 }, false, {
      showByDefault: { defaultField: true, connectedField: false },
    })
    // Add the connectedField input (has showByDefault: false)
    op.inputs.connectedField = { serialize: () => undefined, showByDefault: false }

    // User showed connectedField (which has showByDefault: false)
    op.visibleFields.value = new Set(['defaultField', 'connectedField'])
    setOp('targetNode', op as any)

    // Add source operator with locked = false
    const sourceOp = makeOp({ val: 42 }, false)
    setOp('sourceNode', sourceOp as any)

    const nodes = [{ id: 'targetNode', type: 'basic', data: {}, position: { x: 0, y: 0 } }]
    // Create edge connecting source to connectedField
    const edges = [
      {
        id: 'edge1',
        source: 'sourceNode',
        target: 'targetNode',
        sourceHandle: 'out.val',
        targetHandle: 'par.connectedField',
      },
    ]

    const result = serializeNodes(getOpStore(), nodes, edges)

    // Visibility matches heuristic:
    // - defaultField: showByDefault=true → visible
    // - connectedField: hasConnection=true → visible
    // Since current visibility matches heuristic, visibleInputs should NOT be serialized
    expect(result[0].data).not.toHaveProperty('visibleInputs')
  })

  it('does not serialize visibleInputs when field has both custom value and connection', () => {
    const op = makeOp({ defaultField: 1, connectedField: 999 }, false, {
      showByDefault: { defaultField: true, connectedField: false },
      defaultValues: { connectedField: 0 },
    })
    // User showed connectedField
    op.visibleFields.value = new Set(['defaultField', 'connectedField'])
    setOp('targetNode', op as any)

    // Add source operator
    const sourceOp = makeOp({ val: 42 }, false)
    setOp('sourceNode', sourceOp as any)

    const nodes = [{ id: 'targetNode', type: 'basic', data: {}, position: { x: 0, y: 0 } }]
    const edges = [
      {
        id: 'edge1',
        source: 'sourceNode',
        target: 'targetNode',
        sourceHandle: 'out.val',
        targetHandle: 'par.connectedField',
      },
    ]

    const result = serializeNodes(getOpStore(), nodes, edges)

    // connectedField is connected (from unlocked source), so:
    // 1. Its value should NOT be serialized (connection provides value)
    // 2. It's visible via heuristic (hasConnection), so visibleInputs shouldn't be serialized
    expect(result[0].data.inputs).not.toHaveProperty('connectedField')
    expect(result[0].data).not.toHaveProperty('visibleInputs')
  })

  describe('clipboard copy (forClipboard: true)', () => {
    it('always serializes visibleInputs for clipboard to preserve exact state', () => {
      const op = new GeoJsonLayerOp('/geojson-0')
      // Leave visibleFields as null (using defaults)
      setOp('/geojson-0', op)

      const nodes = [
        { id: '/geojson-0', type: 'GeoJsonLayerOp', data: {}, position: { x: 0, y: 0 } },
      ]
      const result = serializeNodes(getOpStore(), nodes, [], { forClipboard: true })

      // Clipboard always serializes to preserve exact state
      expect(result[0].data).toHaveProperty('visibleInputs')
      expect(result[0].data.visibleInputs).toContain('data')
      expect(result[0].data.visibleInputs).toContain('visible')
    })

    it('preserves connection-visible fields for clipboard', () => {
      const op = makeOp({ a: 1 }, false, { showByDefault: { a: true, connected: false } })
      op.inputs.connected = { serialize: () => undefined, showByDefault: false }
      // Simulate that 'connected' field is visible (due to connection)
      op.visibleFields.value = new Set(['a', 'connected'])
      setOp('node1', op as any)

      const nodes = [{ id: 'node1', type: 'basic', data: {}, position: { x: 0, y: 0 } }]
      // Simulate edge connection to 'connected' field
      const edges = [
        {
          id: 'edge1',
          source: 'other',
          target: 'node1',
          sourceHandle: 'out.val',
          targetHandle: 'par.connected',
        },
      ]
      const result = serializeNodes(getOpStore(), nodes, edges, { forClipboard: true })

      // Clipboard serializes full set, including connection-visible field
      expect(result[0].data).toHaveProperty('visibleInputs')
      expect(result[0].data.visibleInputs).toContain('a')
      expect(result[0].data.visibleInputs).toContain('connected')
    })
  })
})
