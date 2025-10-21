import Anthropic from '@anthropic-ai/sdk'
import { MCPTools } from './mcp-tools'
import type { Message, ClaudeResponse, ProjectModification, ToolCall, ToolResult } from './types'

export class ClaudeClient {
  // Configuration constants
  private static readonly MODEL = 'claude-3-5-sonnet-20241022'
  private static readonly MAX_TOKENS = 8192
  private static readonly MAX_CONVERSATION_HISTORY = 4 // Keep only last 2 exchanges (4 messages) to prevent token overflow

  private client: Anthropic
  private tools: MCPTools
  private conversationHistory: Message[] = []

  constructor(apiKey: string, tools: MCPTools) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    this.tools = tools
  }

  // Strip images from message content to reduce token usage in conversation history
  private stripImages(content: string | any[]): string {
    try {
      // If content is already a string, return as-is
      if (typeof content === 'string') {
        return content
      }

      // If content is an array (multi-part message with text and images)
      // Extract only text parts and concatenate them
      if (Array.isArray(content)) {
        return content
          .filter(part => part && part.type === 'text')
          .map(part => part.text || '')
          .join('\n')
      }

      // Fallback for unexpected content types
      console.warn('Unexpected content type in stripImages:', typeof content, content)
      return String(content)
    } catch (error) {
      console.error('Error in stripImages:', error, content)
      return ''
    }
  }

  // Send a message to Claude with current project context
  async sendMessage(params: {
    message: string
    project: any
    screenshot?: string
    screenshotFormat?: 'png' | 'jpeg'
    autoCapture?: boolean
    conversationHistory?: Message[]
  }): Promise<ClaudeResponse> {
    const { message, project, conversationHistory = [] } = params

    // Limit conversation history to prevent token overflow
    const limitedHistory = conversationHistory.slice(-ClaudeClient.MAX_CONVERSATION_HISTORY)

    // Auto-capture is disabled by default - too large for context
    // AI should explicitly use capture_visualization tool when needed
    const screenshot = params.screenshot
    const screenshotFormat = params.screenshotFormat || 'jpeg'

    // Disable auto-capture to reduce token usage
    // const visualKeywords = ['see', 'look', 'show', 'appear', 'display', 'visual', 'render', 'color', 'layer']
    // const shouldAutoCapture = params.autoCapture !== false &&
    //   visualKeywords.some(kw => message.toLowerCase().includes(kw))
    //
    // if (shouldAutoCapture && !screenshot) {
    //   const result = await this.tools.captureVisualization({ format: 'jpeg', quality: 0.5 })
    //   if (result.success) {
    //     screenshot = result.data.screenshot
    //     screenshotFormat = result.data.format || 'jpeg'
    //   }
    // }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(project)

    // Prepare message content (with optional screenshot)
    const userContent: any[] = [{ type: 'text', text: message }]

    if (screenshot) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: `image/${screenshotFormat}`,
          data: screenshot
        }
      })
    }

    // Strip images from conversation history to drastically reduce token usage
    // Images are only included in the current message, not in history
    const messages: Anthropic.MessageParam[] = [
      ...limitedHistory.map(m => ({
        role: m.role,
        content: this.stripImages(m.content)
      })),
      {
        role: 'user' as const,
        content: userContent
      }
    ]

    // Define tools for Claude
    const tools = this.getTools()

    // Log message being sent for debugging
    console.log('Sending to Claude:', {
      messageCount: messages.length,
      systemPromptLength: systemPrompt.length,
      hasScreenshot: !!screenshot,
      conversationHistoryLength: limitedHistory.length
    })

    // Send to Claude with error handling
    let response
    try {
      response = await this.client.messages.create({
        model: ClaudeClient.MODEL,
        max_tokens: ClaudeClient.MAX_TOKENS,
        system: systemPrompt,
        messages,
        tools
      })
    } catch (error) {
      console.error('Claude API error:', error)
      console.error('Messages sent:', JSON.stringify(messages, null, 2))
      throw error
    }

    const toolCalls: ToolCall[] = []
    let finalText = ''
    let capturedScreenshot: string | null = null
    let capturedScreenshotFormat: 'png' | 'jpeg' = 'jpeg'
    const collectedModifications: ProjectModification[] = []

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.MessageParam = {
        role: 'user',
        content: []
      }

      for (const content of response.content) {
        if (content.type === 'tool_use') {
          let result: ToolResult
          try {
            result = await this.executeTool(content.name, content.input)
            toolCalls.push({
              name: content.name,
              params: content.input,
              result
            })

            // If this was a capture_visualization call, save the screenshot
            // to attach to the next message instead of in the tool result
            if (content.name === 'capture_visualization' && result.success && result.data?.screenshot) {
              capturedScreenshot = result.data.screenshot
              capturedScreenshotFormat = result.data.format || 'jpeg'
            }

            // If this was an apply_modifications call, collect the modifications
            if (content.name === 'apply_modifications' && result.success && result.data?.modifications) {
              console.log('[Claude] Collected modifications from tool call:', result.data.modifications)
              collectedModifications.push(...result.data.modifications)
            }
          } catch (error) {
            console.error('Error executing tool:', content.name, error)
            result = {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error executing tool'
            }
            toolCalls.push({
              name: content.name,
              params: content.input,
              result
            })
          }

          // Strip large data (like screenshots) from tool results before sending back to Claude
          // to prevent token overflow. Screenshots are attached as images in the next message.
          let sanitizedResult: ToolResult = result
          if (result.success && result.data && 'screenshot' in result.data) {
            const data = { ...result.data }
            delete data.screenshot
            sanitizedResult = {
              success: true,
              data: {
                ...data,
                message: 'Screenshot captured successfully and attached to this message for your analysis'
              }
            }
          }

          (toolResults.content as any[]).push({
            type: 'tool_result',
            tool_use_id: content.id,
            content: JSON.stringify(sanitizedResult)
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

      // If we captured a screenshot, attach it as an image to the tool result message
      if (capturedScreenshot) {
        const toolResultsWithImage: any[] = Array.isArray(toolResults.content)
          ? [...toolResults.content]
          : []

        toolResultsWithImage.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: `image/${capturedScreenshotFormat}`,
            data: capturedScreenshot
          }
        })

        messages.push({
          role: 'user',
          content: toolResultsWithImage
        })

        capturedScreenshot = null // Reset for next iteration
        capturedScreenshotFormat = 'jpeg' // Reset to default
      } else {
        messages.push(toolResults)
      }

      try {
        response = await this.client.messages.create({
          model: ClaudeClient.MODEL,
          max_tokens: ClaudeClient.MAX_TOKENS,
          system: systemPrompt,
          messages,
          tools
        })
      } catch (error) {
        console.error('Claude API error in tool use loop:', error)
        console.error('Messages at error:', JSON.stringify(messages.slice(-3), null, 2))
        throw error
      }
    }

    // Extract final text response
    for (const content of response.content) {
      if (content.type === 'text') {
        finalText += content.text
      }
    }

    // Parse project modifications from response text
    const textModifications = this.extractProjectModifications(finalText)

    // Combine modifications from tool calls and text
    const allModifications = [...collectedModifications, ...textModifications]
    console.log('[Claude] Total modifications to apply:', allModifications.length)

    return {
      message: finalText,
      projectModifications: allModifications,
      toolCalls
    }
  }

  private buildSystemPrompt(project: any): string {
    const nodeCount = (project.nodes || []).length
    const edgeCount = (project.edges || []).length

    return `You are an AI assistant for Noodles.gl, a node-based geospatial visualization editor.

**Current Project**: ${nodeCount} nodes, ${edgeCount} connections

**Core Capabilities**:
1. **Data Visualization**: Create maps and visualizations from geospatial data
2. **State Updates**: Modify existing visualizations (size, color, filters, etc.)
3. **Debugging**: Diagnose issues with visibility, errors, or rendering
4. **Data Operations**: Query, filter, and transform data with SQL or operators

**Critical Workflows**:

1. **Basic Plotting**:
   - Data → Accessor (position) → Layer → Renderer → Output
   - Always include MaplibreBasemapOp for geographic context
   - Choose layer type based on data: ScatterplotLayerOp (points), ArcLayerOp (routes), GeoJsonLayerOp (polygons)
   - Use AccessorOp for extracting coordinates: \`[d.longitude, d.latitude]\` or \`[d.lng, d.lat]\` depending on field names
   - Use \`capture_visualization\` tool ONLY when user explicitly asks to see the visualization

2. **Updating Visualizations**:
   - Use \`list_nodes\` to see current nodes and find targets
   - Use \`get_node_info\` to see the node's inputs AND incoming edge connections
   - **CRITICAL**: Properties like \`getFillColor\`, \`getRadius\` come from edges AND direct inputs - check both
   - To change these, update the SOURCE node connected via the edge (e.g., ColorOp, NumberOp) if one exists
   - Example: Change color → update ColorOp's \`color\` input, NOT layer's \`getFillColor\` if connected, OR update layer's \`getFillColor\` if not connected
   - Direct properties (\`opacity\`, \`visible\`) can be updated on the layer itself if not connected via edges
   - Call \`apply_modifications\` tool with the correct source node
   - Modifications are applied automatically - visualization updates in real-time

3. **Debugging Issues**:
   - Use \`capture_visualization\` ONLY if user asks "why can't I see" or explicitly wants to see the current state
   - Check \`get_console_errors\` for JavaScript errors
   - Use \`list_nodes\` to verify graph structure
   - Use \`get_node_info\` to check connections
   - Common issues: missing edges, opacity=0, disconnected nodes, invalid accessors

4. **Data Inspection & SQL**:
   - Use \`get_node_output\` to read data from any operator
   - Inspect data structure and sample rows
   - DuckDbOp supports full SQL: SELECT, WHERE, JOIN, GROUP BY, etc.
   - Example: \`SELECT * FROM data WHERE magnitude > 5\`
   - Always verify data transformations with \`get_node_output\`

**Node Graph Layout**:
- Arrange LEFT → RIGHT: Data sources → Transforms/Accessors → Layers → Renderer → Output
- Increment X position by ~300-400 for each step
- Use consistent Y positions for related nodes

**Common Operators & Properties**:
- Data: FileOp, JSONOp, DuckDbOp
- Layers: ScatterplotLayerOp, ArcLayerOp, GeoJsonLayerOp, HexagonLayerOp, PathLayerOp
- Utilities: AccessorOp, ColorOp, ColorRampOp, MapRangeOp
- Output: MaplibreBasemapOp, DeckRendererOp, OutOp

**CRITICAL: Understanding Node Inputs vs Edges**:

Each node has its OWN inputs. Nodes connect via EDGES that link outputs to inputs.

Example graph: \`ColorOp → ScatterplotLayerOp\`
- ColorOp has input: \`color: "#ff0000"\` ← UPDATE THIS to change color
- ColorOp outputs to: \`out.color\`
- Edge connects: \`ColorOp.out.color → ScatterplotLayerOp.par.getFillColor\`
- ScatterplotLayerOp receives color via the edge

**To change a property**:
1. Use \`get_node_info\` to find which node owns the property
2. Check edges to trace data flow
3. Update the SOURCE node's input, not the target handle name
4. Example: Change color → update ColorOp's \`color\` input, NOT ScatterplotLayerOp

**Common Node Types & Their Inputs**:
- ColorOp: \`color\` (hex string)
- NumberOp: \`value\` (number)
- AccessorOp: \`expression\` (JS string)
- ScatterplotLayerOp: \`opacity\`, \`visible\`, \`radiusScale\` (direct properties only)
- All layer inputs starting with \`get*\` come from connected nodes via edges!

**Tool Usage Priority**:
1. \`list_nodes\` - Understand project structure (lightweight, use often)
2. \`get_node_info\` - Debug specific node issues (lightweight)
3. \`get_node_output\` - Inspect data at any pipeline stage (lightweight)
4. \`get_console_errors\` - Check for JavaScript errors when debugging
5. \`capture_visualization\` - Use ONLY when explicitly requested by user (expensive)

**Project Modifications**:
Use the \`apply_modifications\` tool to modify the project. Pass an array of modifications:

Example:
\`\`\`
apply_modifications({
  modifications: [
    {
      type: "update_node",
      data: {
        id: "/existing-node",
        data: {
          inputs: { getRadius: 20 }
        }
      }
    }
  ]
})
\`\`\`

**IMPORTANT**:
- Always use the \`apply_modifications\` TOOL, not text/JSON
- Modifications are applied immediately when you call the tool
- When updating nodes, only specify fields you want to change (inputs are merged)
- After applying, tell the user what you changed

**Communication Style**:
- Explain what you're doing and why
- Verify changes with screenshots
- Ask clarifying questions if request is ambiguous
- Show data samples when inspecting pipelines`
  }

  private getTools(): Anthropic.Tool[] {
    // Essential tools for visualization, debugging, and project state manipulation
    return [
      // Visual debugging tools
      {
        name: 'capture_visualization',
        description: 'Capture a screenshot of the current visualization. The screenshot will be attached to your next message so you can see it.',
        input_schema: {
          type: 'object',
          properties: {
            includeUI: { type: 'boolean' },
            format: { type: 'string', enum: ['png', 'jpeg'] },
            quality: { type: 'number', description: 'JPEG quality 0-1, default 0.7' }
          }
        }
      },
      {
        name: 'get_console_errors',
        description: 'Get recent browser console errors and warnings',
        input_schema: {
          type: 'object',
          properties: {
            since: { type: 'number' },
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
        description: 'Get layer information',
        input_schema: {
          type: 'object',
          properties: {
            layerId: { type: 'string' }
          },
          required: ['layerId']
        }
      },
      // Project state tools
      {
        name: 'apply_modifications',
        description: 'Apply modifications to the project (add/update/delete nodes or edges). Use this instead of returning JSON in text.',
        input_schema: {
          type: 'object',
          properties: {
            modifications: {
              type: 'array',
              description: 'Array of modifications to apply',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['add_node', 'update_node', 'delete_node', 'add_edge', 'delete_edge']
                  },
                  data: {
                    type: 'object',
                    description: 'The node or edge data'
                  }
                },
                required: ['type', 'data']
              }
            }
          },
          required: ['modifications']
        }
      },
      {
        name: 'get_current_project',
        description: 'Get the current project state including all nodes and edges',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'list_nodes',
        description: 'List all nodes in the project with their current state and execution status',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_node_info',
        description: 'Get detailed information about a specific node including connections and schema',
        input_schema: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: 'The ID of the node to inspect' }
          },
          required: ['nodeId']
        }
      },
      {
        name: 'get_node_output',
        description: 'Read the output data from a specific operator/node. Useful for inspecting data at any point in the pipeline.',
        input_schema: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: 'The ID of the node to read output from' },
            maxRows: { type: 'number', description: 'Maximum number of rows to return (default: 10)' }
          },
          required: ['nodeId']
        }
      }
    ]
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
      inspect_layer: (p) => this.tools.inspectLayer(p),
      apply_modifications: (p) => this.tools.applyModifications(p),
      get_current_project: () => this.tools.getCurrentProject(),
      list_nodes: () => this.tools.listNodes(),
      get_node_info: (p) => this.tools.getNodeInfo(p),
      get_node_output: (p) => this.tools.getNodeOutput(p)
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

    console.log('[Claude] Extracting modifications from response, found', matches.length, 'JSON blocks')

    for (const match of matches) {
      try {
        const json = JSON.parse(match[1])
        console.log('[Claude] Parsed JSON block:', json)
        if (json.modifications && Array.isArray(json.modifications)) {
          console.log('[Claude] Found modifications array with', json.modifications.length, 'modifications')
          return json.modifications
        }
      } catch (e) {
        console.warn('[Claude] Failed to parse JSON block:', e)
        continue
      }
    }

    console.log('[Claude] No modifications found in response')
    return []
  }
}
