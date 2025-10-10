/**
 * ClaudeClient - Main interface to Claude AI API
 */

import Anthropic from '@anthropic-ai/sdk'
import { MCPTools } from './mcp-tools'
import type { Message, ClaudeResponse, ProjectModification, ToolCall, ToolResult } from './types'

export class ClaudeClient {
  private client: Anthropic
  private tools: MCPTools
  private conversationHistory: Message[] = []

  constructor(apiKey: string, tools: MCPTools) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    this.tools = tools
  }

  /**
   * Send a message to Claude with current project context
   */
  async sendMessage(params: {
    message: string
    project: any
    screenshot?: string
    autoCapture?: boolean
    conversationHistory?: Message[]
  }): Promise<ClaudeResponse> {
    const { message, project, conversationHistory = [] } = params

    // Auto-capture screenshot if message suggests visual issue
    let screenshot = params.screenshot
    const visualKeywords = ['see', 'look', 'show', 'appear', 'display', 'visual', 'render', 'color', 'layer']
    const shouldAutoCapture = params.autoCapture !== false &&
      visualKeywords.some(kw => message.toLowerCase().includes(kw))

    if (shouldAutoCapture && !screenshot) {
      const result = await this.tools.captureVisualization({})
      if (result.success) {
        screenshot = result.data.screenshot
      }
    }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(project)

    // Prepare message content (with optional screenshot)
    const userContent: any[] = [{ type: 'text', text: message }]

    if (screenshot) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshot
        }
      })
    }

    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory.map(m => ({
        role: m.role,
        content: m.content
      })),
      {
        role: 'user' as const,
        content: userContent
      }
    ]

    // Define tools for Claude
    const tools = this.getTools()

    // Send to Claude
    let response = await this.client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      tools
    })

    const toolCalls: ToolCall[] = []
    let finalText = ''

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.MessageParam = {
        role: 'user',
        content: []
      }

      for (const content of response.content) {
        if (content.type === 'tool_use') {
          const result = await this.executeTool(content.name, content.input)
          toolCalls.push({
            name: content.name,
            params: content.input,
            result
          })

          (toolResults.content as any[]).push({
            type: 'tool_result',
            tool_use_id: content.id,
            content: JSON.stringify(result)
          })
        } else if (content.type === 'text') {
          finalText += content.text
        }
      }

      // Continue conversation with tool results
      messages.push({
        role: 'assistant',
        content: response.content
      })
      messages.push(toolResults)

      response = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools
      })
    }

    // Extract final text response
    for (const content of response.content) {
      if (content.type === 'text') {
        finalText += content.text
      }
    }

    // Parse project modifications from response
    const projectModifications = this.extractProjectModifications(finalText)

    return {
      message: finalText,
      projectModifications,
      toolCalls
    }
  }

  private buildSystemPrompt(project: any): string {
    const nodeTypes = [...new Set((project.nodes || []).map((n: any) => n.type))].join(', ')
    const hasContext = this.tools.hasContext()

    const capabilities = hasContext
      ? `You have access to tools that let you:
1. Search the Noodles.gl source code to understand operator implementations
2. Get complete operator schemas with input/output types
3. Access comprehensive documentation for users and developers
4. View example projects with annotations
5. Analyze the current project for issues and opportunities
6. **Capture screenshots of the visualization**
7. **Track console errors and warnings**
8. **Access rendering performance metrics**
9. **Inspect individual layers**`
      : `You have access to visual debugging tools that let you:
1. **Capture screenshots of the visualization**
2. **Track console errors and warnings**
3. **Access rendering performance metrics**
4. **Inspect individual layers**

**Note**: Advanced features (code search, operator schemas, documentation) are currently unavailable. To enable them, run: \`yarn generate:context\``

    return `You are an AI assistant integrated into Noodles.gl, a node-based editor for creating geospatial visualizations and data presentations.

## Your Capabilities

${capabilities}

## Visual Debugging

You have vision capabilities! When users report visual issues or ask about appearance:

1. **Use \`capture_visualization\`** to see what they're seeing
2. **Use \`get_console_errors\`** to check for runtime errors
3. **Use \`get_render_stats\`** for performance issues
4. **Use \`inspect_layer\`** to debug specific layers

Always explain what you see in screenshots and correlate visual output with code.

## Current Project Context

The user is working on a project with:
- ${(project.nodes || []).length} nodes (operators)
- ${(project.edges || []).length} connections (edges)

Node types in use: ${nodeTypes || 'none'}

Current project structure:
\`\`\`json
${JSON.stringify(project, null, 2)}
\`\`\`

## Guidelines for Helping Users

1. **Understanding requests**: When users ask to create visualizations, first understand their data source, visualization type, and desired operators.

2. **Using tools effectively**: ${hasContext ? 'Use `list_operators` to find relevant types, `get_operator_schema` to understand inputs, and `get_example` to see patterns.' : 'Use visual debugging tools to help diagnose issues with visualizations.'}

3. **Modifying projects**: When suggesting changes, provide complete node and edge specifications with proper operator paths.

4. **Project modifications format**: Output JSON like:
\`\`\`json
{
  "modifications": [
    {
      "type": "add_node",
      "data": {
        "id": "/my-node",
        "type": "GeoJsonLayerOp",
        "data": { "inputs": {}, "locked": false },
        "position": { "x": 0, "y": 0 }
      }
    }
  ]
}
\`\`\`

5. **Debugging**: ${hasContext ? 'Use `analyze_project` to validate, check console errors, and inspect implementations.' : 'Use `get_console_errors` and visual debugging tools to diagnose issues.'}

## Operator Types

- **Data Sources**: FileOp, JSONOp, DuckDbOp, CSVOp
- **Layers**: GeoJsonLayerOp, ScatterplotLayerOp, HexagonLayerOp, HeatmapLayerOp
- **Renderers**: DeckRendererOp, OutOp
- **Accessors**: AccessorOp, ColorRampOp
- **Utilities**: ExpressionOp, CodeOp, NumberOp, ContainerOp

Be helpful, thorough, and use your vision capabilities for comprehensive debugging!`
  }

  private getTools(): Anthropic.Tool[] {
    // Check if context is available
    const hasContext = this.tools.hasContext()

    const contextTools = hasContext ? [
      {
        name: 'search_code',
        description: 'Search the Noodles.gl source code for patterns, classes, functions, or implementations',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern (regex supported)' },
            path: { type: 'string', description: 'Optional: limit search to specific path' },
            contextLines: { type: 'number', description: 'Number of context lines (default: 3)' }
          },
          required: ['pattern']
        }
      },
      {
        name: 'get_source_code',
        description: 'Get the source code for a specific file and line range',
        input_schema: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'File path relative to project root' },
            startLine: { type: 'number', description: 'Start line (1-indexed)' },
            endLine: { type: 'number', description: 'End line (1-indexed)' }
          },
          required: ['file']
        }
      },
      {
        name: 'get_operator_schema',
        description: 'Get the complete schema for an operator type',
        input_schema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Operator type (e.g., "GeoJsonLayerOp")' }
          },
          required: ['type']
        }
      },
      {
        name: 'list_operators',
        description: 'List all available operator types',
        input_schema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Optional: filter by category' }
          }
        }
      },
      {
        name: 'get_documentation',
        description: 'Search the Noodles.gl documentation',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            section: { type: 'string', description: 'Optional: users or developers' }
          },
          required: ['query']
        }
      },
      {
        name: 'get_example',
        description: 'Get a complete example project by ID',
        input_schema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Example ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'list_examples',
        description: 'List all available example projects',
        input_schema: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            tag: { type: 'string' }
          }
        }
      },
      {
        name: 'find_symbol',
        description: 'Find a symbol (class, function, type) by name',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Symbol name' }
          },
          required: ['name']
        }
      },
      {
        name: 'analyze_project',
        description: 'Analyze the current project for validation, performance, or suggestions',
        input_schema: {
          type: 'object',
          properties: {
            project: { type: 'object', description: 'The current project JSON' },
            analysisType: {
              type: 'string',
              enum: ['validation', 'performance', 'suggestions']
            }
          },
          required: ['project', 'analysisType']
        }
      }
    ] : []

    // Visual debugging tools (always available)
    const visualTools = [
      {
        name: 'capture_visualization',
        description: 'Capture a screenshot of the current visualization',
        input_schema: {
          type: 'object',
          properties: {
            includeUI: { type: 'boolean' },
            format: { type: 'string', enum: ['png', 'jpeg'] }
          }
        }
      },
      {
        name: 'get_console_errors',
        description: 'Get recent browser console errors and warnings',
        input_schema: {
          type: 'object',
          properties: {
            since: { type: 'number', description: 'Timestamp' },
            level: { type: 'string', enum: ['error', 'warn', 'all'] },
            maxResults: { type: 'number' }
          }
        }
      },
      {
        name: 'get_render_stats',
        description: 'Get deck.gl rendering statistics',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'inspect_layer',
        description: 'Get detailed information about a specific layer',
        input_schema: {
          type: 'object',
          properties: {
            layerId: { type: 'string' }
          },
          required: ['layerId']
        }
      }
    ]

    return [...contextTools, ...visualTools]
  }

  private async executeTool(name: string, params: any): Promise<ToolResult> {
    const methodMap: Record<string, (params: any) => Promise<ToolResult>> = {
      search_code: (p) => this.tools.searchCode(p),
      get_source_code: (p) => this.tools.getSourceCode(p),
      get_operator_schema: (p) => this.tools.getOperatorSchema(p),
      list_operators: (p) => this.tools.listOperators(p),
      get_documentation: (p) => this.tools.getDocumentation(p),
      get_example: (p) => this.tools.getExample(p),
      list_examples: (p) => this.tools.listExamples(p),
      find_symbol: (p) => this.tools.findSymbol(p),
      analyze_project: (p) => this.tools.analyzeProject(p),
      capture_visualization: (p) => this.tools.captureVisualization(p),
      get_console_errors: (p) => this.tools.getConsoleErrors(p),
      get_render_stats: () => this.tools.getRenderStats(),
      inspect_layer: (p) => this.tools.inspectLayer(p)
    }

    const method = methodMap[name]
    if (!method) {
      return { success: false, error: `Unknown tool: ${name}` }
    }

    return method(params)
  }

  private extractProjectModifications(text: string): ProjectModification[] {
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/g
    const matches = [...text.matchAll(jsonBlockRegex)]

    for (const match of matches) {
      try {
        const json = JSON.parse(match[1])
        if (json.modifications && Array.isArray(json.modifications)) {
          return json.modifications
        }
      } catch (e) {
        continue
      }
    }

    return []
  }
}
