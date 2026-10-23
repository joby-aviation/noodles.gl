import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectionsOp } from '../operators'
import {
  NOODLES_VERSION,
  type NoodlesProjectJSON,
  safeStringify,
  saveProjectLocally,
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

  it('preserves repeated non-circular references', () => {
    const shared = { name: 'shared' }
    const result = safeStringify({ first: shared, second: shared })

    expect(JSON.parse(result)).toEqual({
      first: { name: 'shared' },
      second: { name: 'shared' },
    })
  })

  it('preserves optional name field in project JSON', () => {
    const projectWithName: NoodlesProjectJSON = {
      version: NOODLES_VERSION,
      name: 'NYC Taxis',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const result = safeStringify(projectWithName)
    const parsed = JSON.parse(result)
    expect(parsed.name).toBe('NYC Taxis')
  })

  it('allows project JSON without name field', () => {
    const projectWithoutName: NoodlesProjectJSON = {
      version: NOODLES_VERSION,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const result = safeStringify(projectWithoutName)
    const parsed = JSON.parse(result)
    expect(parsed.name).toBeUndefined()
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

    await saveProjectLocally(projectName, projectJson, 'publicFolder', new Map())

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

    await saveProjectLocally(projectName, projectJson, 'publicFolder', new Map())

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

    await saveProjectLocally(projectName, projectJson, 'opfs', new Map())

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

    await saveProjectLocally(projectName, projectJson, 'fileSystemAccess', new Map())

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

    await saveProjectLocally('test', projectJson, 'publicFolder', new Map())

    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
  })

  it('adds the cache folder to the ZIP', async () => {
    const projectJson = {
      version: NOODLES_VERSION,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const cacheFile = '{"version":1,"id":"/directions","type":"DirectionsOp","outputs":{}}\n'

    await saveProjectLocally(
      'cached',
      projectJson,
      'memory',
      new Map([['directions.json', cacheFile]])
    )

    const { default: JSZip } = await import('jszip')
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const zip = await JSZip.loadAsync(blob)
    await expect(zip.file('cached/cache/directions.json')?.async('text')).resolves.toBe(cacheFile)
  })
})

// Note: serializeRenderSettings tests removed - function was removed in migration 012
// Render settings are now stored as OutOp node inputs
