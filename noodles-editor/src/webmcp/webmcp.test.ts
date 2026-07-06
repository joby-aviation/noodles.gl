import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolDefinitions } from '../ai-chat/tool-definitions'
import { setCurrentProject, setModificationApplier } from './bridge'
import { initWebMCP } from './register'

// The polyfill import is a side effect only — the tests install their own fake
vi.mock('@mcp-b/global', () => ({}))

vi.mock('../ai-chat/global-context-manager', () => ({
  globalContextManager: {
    waitForReady: vi.fn(async () => null),
  },
}))

vi.mock('../ai-chat/mcp-tools', () => {
  class MockMCPTools {
    static instances: MockMCPTools[] = []

    constructor() {
      MockMCPTools.instances.push(this)
    }

    setProject = vi.fn()
    listNodes = vi.fn(async () => ({
      success: true,
      data: [{ id: '/scatter', type: 'ScatterplotLayerOp' }],
    }))
    getRenderStats = vi.fn(async () => ({ success: true, data: { fps: 60 } }))
    inspectLayer = vi.fn(async () => ({ success: false, error: 'Layer not found: missing' }))
    getConsoleErrors = vi.fn(async () => {
      throw new Error('console tracking exploded')
    })
    captureVisualization = vi.fn(async () => ({
      success: true,
      data: { screenshot: 'aGVsbG8=', format: 'jpeg', width: 8, height: 8 },
    }))
    applyModifications = vi.fn(async (params: { modifications: unknown[] }) => ({
      success: true,
      data: {
        modifications: params.modifications,
        modificationsCount: params.modifications.length,
      },
    }))
  }
  return { MCPTools: MockMCPTools }
})

interface RegisteredTool {
  name: string
  description: string
  inputSchema: { type: string }
  execute: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    isError?: boolean
  }>
}

let registered: Map<string, RegisteredTool>
let registerTool: ReturnType<typeof vi.fn>
let controller: AbortController

async function init() {
  controller = new AbortController()
  await initWebMCP(controller.signal)
}

function getRegistered(name: string): RegisteredTool {
  const tool = registered.get(name)
  if (!tool) throw new Error(`Tool not registered: ${name}`)
  return tool
}

describe('initWebMCP', () => {
  beforeEach(() => {
    registered = new Map()
    registerTool = vi.fn((tool: RegisteredTool, options?: { signal?: AbortSignal }) => {
      if (registered.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`)
      if (options?.signal?.aborted) return
      registered.set(tool.name, tool)
      options?.signal?.addEventListener('abort', () => registered.delete(tool.name))
    })
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: { registerTool },
    })
    setModificationApplier(null)
  })

  afterEach(() => {
    controller?.abort()
  })

  it('registers every tool definition with an abort signal', async () => {
    await init()
    expect(registerTool).toHaveBeenCalledTimes(toolDefinitions.length)
    for (const def of toolDefinitions) {
      expect(registered.has(def.name), def.name).toBe(true)
    }
    for (const call of registerTool.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('skips re-initialization while already active', async () => {
    await init()
    const first = controller
    await initWebMCP(new AbortController().signal)
    expect(registerTool).toHaveBeenCalledTimes(toolDefinitions.length)
    first.abort()
  })

  it('re-registers cleanly after abort', async () => {
    await init()
    controller.abort()
    expect(registered.size).toBe(0)
    await init()
    expect(registered.size).toBe(toolDefinitions.length)
  })

  it('returns successful results as a JSON text block', async () => {
    await init()
    const response = await getRegistered('list_nodes').execute({})
    expect(response.isError).toBeUndefined()
    expect(response.content).toHaveLength(1)
    expect(response.content[0].type).toBe('text')
    expect(JSON.parse(response.content[0].text ?? '')).toEqual([
      { id: '/scatter', type: 'ScatterplotLayerOp' },
    ])
  })

  it('returns tool failures as isError responses', async () => {
    await init()
    const response = await getRegistered('inspect_layer').execute({ layerId: 'missing' })
    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('Layer not found')
  })

  it('converts thrown errors into isError responses instead of rejecting', async () => {
    await init()
    const response = await getRegistered('get_console_errors').execute({})
    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('console tracking exploded')
  })

  it('returns screenshots as an image block without base64 in the text', async () => {
    await init()
    const response = await getRegistered('capture_visualization').execute({ format: 'jpeg' })
    expect(response.isError).toBeUndefined()
    const [image, meta] = response.content
    expect(image.type).toBe('image')
    expect(image.data).toBe('aGVsbG8=')
    expect(image.mimeType).toBe('image/jpeg')
    expect(meta.type).toBe('text')
    expect(meta.text).not.toContain('aGVsbG8=')
    expect(meta.text).toContain('"width"')
  })

  it('fails apply_modifications when the editor applier is not registered', async () => {
    await init()
    const response = await getRegistered('apply_modifications').execute({
      modifications: [{ type: 'add_node', data: { id: '/n', type: 'NumberOp' } }],
    })
    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('Editor not mounted')
  })

  it('applies modifications through the registered editor applier', async () => {
    await init()
    const applier = vi.fn(() => ({ success: true, warnings: undefined }))
    setModificationApplier(applier)

    const modifications = [{ type: 'add_node', data: { id: '/n', type: 'NumberOp' } }]
    const response = await getRegistered('apply_modifications').execute({ modifications })

    expect(response.isError).toBeUndefined()
    expect(applier).toHaveBeenCalledWith(modifications)
    expect(response.content[0].text).toContain('1 modification(s) applied')
  })

  it('reports applier failures as isError responses', async () => {
    await init()
    setModificationApplier(() => ({ success: false, error: 'validation failed' }))
    const response = await getRegistered('apply_modifications').execute({
      modifications: [{ type: 'add_node', data: { id: '/n', type: 'NumberOp' } }],
    })
    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain('validation failed')
  })

  it('keeps the MCPTools project in sync via the bridge', async () => {
    await init()
    const { MCPTools } = await import('../ai-chat/mcp-tools')
    const instances = (
      MCPTools as unknown as { instances: Array<{ setProject: ReturnType<typeof vi.fn> }> }
    ).instances
    const tools = instances[instances.length - 1]

    const project = { nodes: [{ id: '/n', type: 'NumberOp' }], edges: [] }
    setCurrentProject(project)
    expect(tools.setProject).toHaveBeenCalledWith(project)

    // After abort the subscription is removed
    controller.abort()
    tools.setProject.mockClear()
    setCurrentProject(project)
    expect(tools.setProject).not.toHaveBeenCalled()
  })
})
