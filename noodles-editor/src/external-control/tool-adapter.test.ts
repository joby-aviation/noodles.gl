import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ToolDefinition, type ToolExecutionResult, ToolRegistry } from './tool-adapter'

// Mock the dependencies
vi.mock('../ai-chat/mcp-tools', () => ({
  MCPTools: class MockMCPTools {
    getCurrentProject = async () => ({ nodes: [], edges: [] })
    applyModifications = async () => ({ success: true })
    listNodes = async () => []
    getNodeInfo = async () => null
    getNodeOutput = async () => null
    captureVisualization = async () => null
    getConsoleErrors = async () => []
    getRenderStats = async () => ({})
  },
}))

vi.mock('../ai-chat/global-context-manager', () => ({
  globalContextManager: {
    getLoader: () => null,
  },
}))

vi.mock('../noodles/store', () => ({
  getOpStore: () => ({
    ops: new Map(),
  }),
}))

vi.mock('../noodles/operators', () => ({
  opTypes: {
    FileOp: { displayName: 'File', description: 'Load files' },
    FilterOp: { displayName: 'Filter', description: 'Filter data' },
    NumberOp: { displayName: 'Number', description: 'Numeric value' },
    CodeOp: { displayName: 'Code', description: 'Custom code' },
  },
}))

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new ToolRegistry()
  })

  describe('constructor and default tools', () => {
    it('registers default tools on construction', () => {
      const tools = registry.listTools()
      expect(tools.length).toBeGreaterThan(0)
    })

    it('registers project management tools', () => {
      expect(registry.getTool('getCurrentProject')).toBeDefined()
      expect(registry.getTool('applyModifications')).toBeDefined()
      expect(registry.getTool('listNodes')).toBeDefined()
      expect(registry.getTool('getNodeInfo')).toBeDefined()
      expect(registry.getTool('getNodeOutput')).toBeDefined()
    })

    it('registers debugging tools', () => {
      expect(registry.getTool('captureVisualization')).toBeDefined()
      expect(registry.getTool('getConsoleErrors')).toBeDefined()
      expect(registry.getTool('getRenderStats')).toBeDefined()
    })

    it('registers pipeline tools', () => {
      expect(registry.getTool('createNode')).toBeDefined()
      expect(registry.getTool('connectNodes')).toBeDefined()
      expect(registry.getTool('deleteNode')).toBeDefined()
      expect(registry.getTool('listOperatorTypes')).toBeDefined()
    })
  })

  describe('register()', () => {
    it('registers a new tool', () => {
      const tool: ToolDefinition = {
        name: 'customTool',
        description: 'A custom tool',
        parameters: {
          param1: { type: 'string', required: true },
        },
      }

      registry.register(tool)

      expect(registry.getTool('customTool')).toEqual(tool)
    })

    it('overwrites existing tool with same name', () => {
      const tool1: ToolDefinition = {
        name: 'testTool',
        description: 'First version',
        parameters: {},
      }
      const tool2: ToolDefinition = {
        name: 'testTool',
        description: 'Second version',
        parameters: { newParam: { type: 'number' } },
      }

      registry.register(tool1)
      registry.register(tool2)

      expect(registry.getTool('testTool')?.description).toBe('Second version')
    })
  })

  describe('getTool()', () => {
    it('returns tool definition for registered tool', () => {
      const tool = registry.getTool('createNode')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('createNode')
      expect(tool?.description).toContain('Create a new node')
    })

    it('returns undefined for unregistered tool', () => {
      expect(registry.getTool('nonExistentTool')).toBeUndefined()
    })
  })

  describe('listTools()', () => {
    it('returns all registered tools', () => {
      const tools = registry.listTools()
      expect(Array.isArray(tools)).toBe(true)
      expect(tools.every(t => t.name && t.description)).toBe(true)
    })

    it('includes newly registered tools', () => {
      const customTool: ToolDefinition = {
        name: 'myCustomTool',
        description: 'Custom',
        parameters: {},
      }

      registry.register(customTool)
      const tools = registry.listTools()

      expect(tools.find(t => t.name === 'myCustomTool')).toBeDefined()
    })
  })

  describe('execute()', () => {
    describe('error handling', () => {
      it('returns error for unknown tool', async () => {
        const result = await registry.execute('unknownTool', {})

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('UNKNOWN_TOOL')
        expect(result.error?.message).toContain('unknownTool')
      })

      it('returns error for missing required parameter', async () => {
        const result = await registry.execute('getNodeInfo', {})

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('MISSING_PARAMETER')
        expect(result.error?.message).toContain('nodeId')
      })

      it('tracks execution time', async () => {
        const result = await registry.execute('unknownTool', {})

        expect(result.executionTime).toBeDefined()
        expect(typeof result.executionTime).toBe('number')
        expect(result.executionTime).toBeGreaterThanOrEqual(0)
      })
    })

    describe('listOperatorTypes', () => {
      it('returns available operator types', async () => {
        const result = await registry.execute('listOperatorTypes', {})

        expect(result.success).toBe(true)
        expect(result.result).toBeDefined()
        expect(result.result.FileOp).toBeDefined()
        expect(result.result.FilterOp).toBeDefined()
        expect(result.result.NumberOp).toBeDefined()
        expect(result.result.CodeOp).toBeDefined()
      })

      it('includes displayName and description', async () => {
        const result = await registry.execute('listOperatorTypes', {})

        expect(result.result.FileOp.displayName).toBe('File')
        expect(result.result.FileOp.description).toBe('Load files')
      })
    })

    describe('createNode', () => {
      it('creates node with provided parameters', async () => {
        const result = await registry.execute('createNode', {
          type: 'NumberOp',
          id: '/my-number',
          position: { x: 200, y: 300 },
          inputs: { value: 42 },
        })

        expect(result.success).toBe(true)
        expect(result.result.nodeId).toBe('/my-number')
        expect(result.result.type).toBe('NumberOp')
        expect(result.result.position).toEqual({ x: 200, y: 300 })
      })

      it('generates ID if not provided', async () => {
        const result = await registry.execute('createNode', {
          type: 'NumberOp',
        })

        expect(result.success).toBe(true)
        expect(result.result.nodeId).toMatch(/^\/numberop-\d+$/)
      })

      it('uses default position if not provided', async () => {
        const result = await registry.execute('createNode', {
          type: 'NumberOp',
        })

        expect(result.success).toBe(true)
        expect(result.result.position).toEqual({ x: 100, y: 100 })
      })

      it('returns error for unknown operator type', async () => {
        const result = await registry.execute('createNode', {
          type: 'NonExistentOp',
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toContain('Unknown operator type')
      })

      it('requires type parameter', async () => {
        const result = await registry.execute('createNode', {})

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('MISSING_PARAMETER')
      })
    })

    describe('connectNodes', () => {
      it('creates edge with provided parameters', async () => {
        const result = await registry.execute('connectNodes', {
          sourceId: '/source-node',
          targetId: '/target-node',
          sourceField: 'out.data',
          targetField: 'par.input',
        })

        expect(result.success).toBe(true)
        expect(result.result.source).toBe('/source-node')
        expect(result.result.target).toBe('/target-node')
        expect(result.result.edgeId).toBe('/source-node.out.data->/target-node.par.input')
      })

      it('uses default fields if not provided', async () => {
        const result = await registry.execute('connectNodes', {
          sourceId: '/source-node',
          targetId: '/target-node',
        })

        expect(result.success).toBe(true)
        expect(result.result.edgeId).toBe('/source-node.out.result->/target-node.par.data')
      })

      it('requires sourceId and targetId parameters', async () => {
        const result1 = await registry.execute('connectNodes', {
          targetId: '/target',
        })
        expect(result1.success).toBe(false)
        expect(result1.error?.code).toBe('MISSING_PARAMETER')

        const result2 = await registry.execute('connectNodes', {
          sourceId: '/source',
        })
        expect(result2.success).toBe(false)
        expect(result2.error?.code).toBe('MISSING_PARAMETER')
      })
    })

    describe('deleteNode', () => {
      it('deletes node and returns confirmation', async () => {
        const result = await registry.execute('deleteNode', {
          nodeId: '/node-to-delete',
        })

        expect(result.success).toBe(true)
        expect(result.result.nodeId).toBe('/node-to-delete')
        expect(result.result.deleted).toBe(true)
      })

      it('requires nodeId parameter', async () => {
        const result = await registry.execute('deleteNode', {})

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('MISSING_PARAMETER')
        expect(result.error?.message).toContain('nodeId')
      })
    })

    describe('MCP tool delegation', () => {
      it('delegates getCurrentProject to MCPTools', async () => {
        const result = await registry.execute('getCurrentProject', {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ nodes: [], edges: [] })
      })

      it('delegates listNodes to MCPTools', async () => {
        const result = await registry.execute('listNodes', {})

        expect(result.success).toBe(true)
        expect(result.result).toEqual([])
      })

      it('delegates getConsoleErrors to MCPTools', async () => {
        const result = await registry.execute('getConsoleErrors', { limit: 5 })

        expect(result.success).toBe(true)
        expect(result.result).toEqual([])
      })
    })
  })
})

describe('ToolDefinition interface', () => {
  it('supports required and optional parameters', () => {
    const tool: ToolDefinition = {
      name: 'testTool',
      description: 'Test tool',
      parameters: {
        required1: { type: 'string', required: true },
        required2: { type: 'number', required: true, description: 'A number' },
        optional1: { type: 'boolean', required: false, default: true },
        optional2: { type: 'object', description: 'Optional object' },
      },
    }

    expect(tool.parameters.required1.required).toBe(true)
    expect(tool.parameters.optional1.default).toBe(true)
  })
})

describe('ToolExecutionResult interface', () => {
  it('represents successful result', () => {
    const result: ToolExecutionResult = {
      success: true,
      result: { data: 'test' },
      executionTime: 100,
    }

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('represents failed result', () => {
    const result: ToolExecutionResult = {
      success: false,
      error: {
        message: 'Something went wrong',
        code: 'ERR_TEST',
        details: { info: 'additional' },
      },
      executionTime: 50,
    }

    expect(result.success).toBe(false)
    expect(result.result).toBeUndefined()
    expect(result.error?.code).toBe('ERR_TEST')
  })
})
