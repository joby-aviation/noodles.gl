/**
 * ClaudeClient - Main interface to Claude AI API
 * Updated: 2025-10-11
 */

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

  /**
   * Strip images from message content to reduce token usage in conversation history
   */
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

    // Limit conversation history to prevent token overflow
    const limitedHistory = conversationHistory.slice(-ClaudeClient.MAX_CONVERSATION_HISTORY)

    // Auto-capture screenshot if message suggests visual issue
    let screenshot = params.screenshot
    const visualKeywords = ['see', 'look', 'show', 'appear', 'display', 'visual', 'render', 'color', 'layer']
    const shouldAutoCapture = params.autoCapture !== false &&
      visualKeywords.some(kw => message.toLowerCase().includes(kw))

    if (shouldAutoCapture && !screenshot) {
      // Use lower quality and JPEG for auto-capture to reduce token usage
      const result = await this.tools.captureVisualization({ format: 'jpeg', quality: 0.5 })
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
          media_type: 'image/jpeg',
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
            media_type: 'image/jpeg',
            data: capturedScreenshot
          }
        })

        messages.push({
          role: 'user',
          content: toolResultsWithImage
        })

        capturedScreenshot = null // Reset for next iteration
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

    // Parse project modifications from response
    const projectModifications = this.extractProjectModifications(finalText)

    return {
      message: finalText,
      projectModifications,
      toolCalls
    }
  }

  private buildSystemPrompt(project: any): string {
    const nodeCount = (project.nodes || []).length
    const edgeCount = (project.edges || []).length

    return `You are an AI assistant for Noodles.gl, a node-based geospatial visualization editor.

**Project**: ${nodeCount} nodes, ${edgeCount} connections

**Key Rules**:
- Always arrange nodes LEFT to RIGHT (data sources left, layers middle, output right)
- Verify work with \`capture_visualization\` after changes
- Don't output code unless asked - use the node graph
- Output modifications as JSON: \`{"modifications": [{"type": "add_node", "data": {...}}]}\`

**Common Operators**: FileOp, JSONOp, DuckDbOp, GeoJsonLayerOp, ScatterplotLayerOp, HexagonLayerOp, DeckRendererOp, OutOp

Use tools to see visuals, check errors, and inspect layers.`
  }

  private getTools(): Anthropic.Tool[] {
    // Only include visual debugging tools by default (lightweight)
    // Context tools are loaded lazily when needed
    return [
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
