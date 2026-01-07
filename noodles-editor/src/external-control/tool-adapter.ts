
// Tool adapter for exposing MCP tools to external control
// Provides a unified interface for tool execution


import { MCPTools } from '../ai-chat/mcp-tools'
import { globalContextManager } from '../ai-chat/global-context-manager'
import { getOpStore } from '../noodles/store'
import { opTypes } from '../noodles/operators'

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, {
    type: string
    description?: string
    required?: boolean
    default?: any
  }>
}

export interface ToolExecutionResult {
  success: boolean
  result?: any
  error?: {
    message: string
    code?: string
    details?: any
  }
  executionTime: number
}

// Registry of available tools for external control
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()
  private mcpTools: MCPTools

  constructor() {
    // Use context loader for full functionality (code search, operator schemas, docs, etc.)
    const contextLoader = globalContextManager.getLoader()
    this.mcpTools = new MCPTools(contextLoader ?? undefined)
    this.registerDefaultTools()
  }

  // Register default tools
  private registerDefaultTools() {
    // Project management tools
    this.register({
      name: 'getCurrentProject',
      description: 'Get the current project state including all nodes and edges',
      parameters: {},
    })

    this.register({
      name: 'applyModifications',
      description: 'Apply modifications to the project (add/update/delete nodes and edges)',
      parameters: {
        modifications: {
          type: 'object',
          description: 'Project modifications to apply',
          required: true,
        },
      },
    })

    this.register({
      name: 'listNodes',
      description: 'List all nodes in the current project',
      parameters: {},
    })

    this.register({
      name: 'getNodeInfo',
      description: 'Get detailed information about a specific node',
      parameters: {
        nodeId: {
          type: 'string',
          description: 'ID of the node',
          required: true,
        },
      },
    })

    this.register({
      name: 'getNodeOutput',
      description: 'Get the output value of a specific node',
      parameters: {
        nodeId: {
          type: 'string',
          description: 'ID of the node',
          required: true,
        },
        outputName: {
          type: 'string',
          description: 'Name of the output field',
          default: 'result',
        },
      },
    })

    // Debugging tools
    this.register({
      name: 'captureVisualization',
      description: 'Capture a screenshot of the current visualization',
      parameters: {
        format: {
          type: 'string',
          description: 'Image format (png or jpeg)',
          default: 'png',
        },
        quality: {
          type: 'number',
          description: 'JPEG quality (0-1)',
          default: 0.9,
        },
      },
    })

    this.register({
      name: 'getConsoleErrors',
      description: 'Get recent console errors',
      parameters: {
        limit: {
          type: 'number',
          description: 'Maximum number of errors to return',
          default: 10,
        },
      },
    })

    this.register({
      name: 'getRenderStats',
      description: 'Get rendering statistics from Deck.gl',
      parameters: {},
    })

    // Pipeline tools
    this.register({
      name: 'createNode',
      description: 'Create a new node of a specific type',
      parameters: {
        type: {
          type: 'string',
          description: 'Operator type (e.g., FileOp, FilterOp)',
          required: true,
        },
        id: {
          type: 'string',
          description: 'Node ID (generated if not provided)',
        },
        position: {
          type: 'object',
          description: 'Position on canvas {x, y}',
          default: { x: 100, y: 100 },
        },
        inputs: {
          type: 'object',
          description: 'Initial input values',
          default: {},
        },
      },
    })

    this.register({
      name: 'connectNodes',
      description: 'Create a connection between two nodes',
      parameters: {
        sourceId: {
          type: 'string',
          description: 'Source node ID',
          required: true,
        },
        targetId: {
          type: 'string',
          description: 'Target node ID',
          required: true,
        },
        sourceField: {
          type: 'string',
          description: 'Source output field',
          default: 'out.result',
        },
        targetField: {
          type: 'string',
          description: 'Target input field',
          default: 'par.data',
        },
      },
    })

    this.register({
      name: 'deleteNode',
      description: 'Delete a node and its connections',
      parameters: {
        nodeId: {
          type: 'string',
          description: 'ID of the node to delete',
          required: true,
        },
      },
    })

    this.register({
      name: 'listOperatorTypes',
      description: 'List all available operator types',
      parameters: {},
    })
  }

  // Register a tool
  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }

  // Get tool definition
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  // List all tools
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  // Execute a tool
  async execute(
    toolName: string,
    args: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now()

    try {
      // Check if tool exists
      const tool = this.tools.get(toolName)
      if (!tool) {
        return {
          success: false,
          error: {
            message: `Unknown tool: ${toolName}`,
            code: 'UNKNOWN_TOOL',
          },
          executionTime: Date.now() - startTime,
        }
      }

      // Validate required parameters
      for (const [param, config] of Object.entries(tool.parameters)) {
        if (config.required && !(param in args)) {
          return {
            success: false,
            error: {
              message: `Missing required parameter: ${param}`,
              code: 'MISSING_PARAMETER',
            },
            executionTime: Date.now() - startTime,
          }
        }
      }

      // Execute the tool
      let result: any

      switch (toolName) {
        // MCP tools
        case 'getCurrentProject':
        case 'applyModifications':
        case 'listNodes':
        case 'getNodeInfo':
        case 'getNodeOutput':
        case 'captureVisualization':
        case 'getConsoleErrors':
        case 'getRenderStats': {
          const mcpMethod = (this.mcpTools as any)[toolName]
          if (typeof mcpMethod === 'function') {
            result = await mcpMethod.call(this.mcpTools, args)
          } else {
            throw new Error(`MCP tool method not found: ${toolName}`)
          }
          break
        }

        // Custom tools
        case 'createNode': {
          result = await this.createNode(args)
          break
        }

        case 'connectNodes': {
          result = await this.connectNodes(args)
          break
        }

        case 'deleteNode': {
          result = await this.deleteNode(args)
          break
        }

        case 'listOperatorTypes': {
          result = this.listOperatorTypes()
          break
        }

        default:
          throw new Error(`Tool not implemented: ${toolName}`)
      }

      return {
        success: true,
        result,
        executionTime: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'EXECUTION_ERROR',
          details: error instanceof Error ? error.stack : undefined,
        },
        executionTime: Date.now() - startTime,
      }
    }
  }

  // Create a new node
  private async createNode(args: {
    type: string
    id?: string
    position?: { x: number; y: number }
    inputs?: Record<string, any>
  }): Promise<any> {
    const { type, id, position = { x: 100, y: 100 }, inputs = {} } = args

    // Check if operator type exists
    const OpClass = opTypes[type]
    if (!OpClass) {
      throw new Error(`Unknown operator type: ${type}`)
    }

    // Generate ID if not provided
    const nodeId = id || `/${type.toLowerCase()}-${Date.now()}`

    // Create the node
    const node = {
      id: nodeId,
      type,
      position,
      data: {
        inputs,
      },
    }

    // Apply the modification
    await this.mcpTools.applyModifications({
      modifications: {
        nodes: [{ type: 'add', node }],
      },
    })

    return {
      nodeId,
      type,
      position,
    }
  }

  // Connect two nodes
  private async connectNodes(args: {
    sourceId: string
    targetId: string
    sourceField?: string
    targetField?: string
  }): Promise<any> {
    const {
      sourceId,
      targetId,
      sourceField = 'out.result',
      targetField = 'par.data',
    } = args

    // Create the edge
    const edge = {
      id: `${sourceId}.${sourceField}->${targetId}.${targetField}`,
      source: sourceId,
      target: targetId,
      sourceHandle: sourceField,
      targetHandle: targetField,
    }

    // Apply the modification
    await this.mcpTools.applyModifications({
      modifications: {
        edges: [{ type: 'add', edge }],
      },
    })

    return {
      edgeId: edge.id,
      source: sourceId,
      target: targetId,
    }
  }

  // Delete a node
  private async deleteNode(args: { nodeId: string }): Promise<any> {
    const { nodeId } = args

    // Apply the modification
    await this.mcpTools.applyModifications({
      modifications: {
        nodes: [{ type: 'delete', nodeId }],
      },
    })

    return {
      nodeId,
      deleted: true,
    }
  }

  // List available operator types
  private listOperatorTypes(): any {
    const types: Record<string, any> = {}

    for (const [name, OpClass] of Object.entries(opTypes)) {
      types[name] = {
        name,
        displayName: (OpClass as any).displayName || name,
        description: (OpClass as any).description || '',
      }
    }

    return types
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry()