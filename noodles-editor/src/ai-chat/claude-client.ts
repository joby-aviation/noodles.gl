import Anthropic from '@anthropic-ai/sdk'
import {
  compactConversation,
  estimateConversationTokens,
  shouldCompact,
} from './conversation-compaction'
import type { MCPTools } from './mcp-tools'
import systemPromptTemplate from './system-prompt.md?raw'
import type {
  ClaudeResponse,
  Message,
  NoodlesProject,
  ProjectModification,
  ToolCall,
  ToolResult,
} from './types'
import { parseModifications } from './types'

export class ClaudeClient {
  // Configuration constants
  private static readonly MODEL = 'claude-sonnet-4-5-20250929'
  private static readonly MAX_TOKENS = 8192
  // Increased from 4 to 10 since we now support compaction for longer conversations
  private static readonly MAX_CONVERSATION_HISTORY = 10
  // Token threshold for triggering compaction (~50k tokens leaves room for response)
  private static readonly COMPACTION_THRESHOLD = 50000

  private client: Anthropic
  private tools: MCPTools

  constructor(apiKey: string, tools: MCPTools) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    this.tools = tools
  }

  // Strip images from message content to reduce token usage in conversation history
  private stripImages(
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  ): string {
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
    project: NoodlesProject
    screenshot?: string
    screenshotFormat?: 'png' | 'jpeg'
    autoCapture?: boolean
    conversationHistory?: Message[]
  }): Promise<ClaudeResponse> {
    const { message, conversationHistory = [] } = params

    // Limit conversation history
    let limitedHistory = conversationHistory.slice(-ClaudeClient.MAX_CONVERSATION_HISTORY)

    // Check if compaction is needed for long conversations
    if (shouldCompact(limitedHistory, ClaudeClient.COMPACTION_THRESHOLD)) {
      console.log(
        '[Claude] Conversation history exceeds threshold, compacting...',
        `(~${estimateConversationTokens(limitedHistory)} tokens)`
      )
      try {
        limitedHistory = await compactConversation(
          this.client,
          limitedHistory,
          ClaudeClient.MODEL,
          2 // Keep last 2 exchanges intact
        )
        console.log('[Claude] Compaction complete, new history length:', limitedHistory.length)
      } catch (error) {
        console.error('[Claude] Compaction failed, using truncated history:', error)
        // Fallback to more aggressive truncation
        limitedHistory = conversationHistory.slice(-4)
      }
    }

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

    const systemPrompt = systemPromptTemplate

    // Prepare message content (with optional screenshot)
    const userContent: Anthropic.MessageParam['content'] = [{ type: 'text', text: message }]

    if (screenshot) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: `image/${screenshotFormat}`,
          data: screenshot,
        },
      })
    }

    // Strip images from conversation history to drastically reduce token usage
    // Images are only included in the current message, not in history
    const messages: Anthropic.MessageParam[] = [
      ...limitedHistory.map(m => ({
        role: m.role,
        content: this.stripImages(m.content),
      })),
      {
        role: 'user' as const,
        content: userContent,
      },
    ]

    // Define tools for Claude
    const tools = this.getTools()

    // Log message being sent for debugging
    console.log('Sending to Claude:', {
      messageCount: messages.length,
      systemPromptLength: systemPrompt.length,
      hasScreenshot: !!screenshot,
      conversationHistoryLength: limitedHistory.length,
    })

    // Send to Claude with error handling
    let response: Anthropic.Message
    try {
      response = await this.client.messages.create({
        model: ClaudeClient.MODEL,
        max_tokens: ClaudeClient.MAX_TOKENS,
        // Use prompt caching for system prompt (1-hour TTL) to reduce costs
        // System prompt is large and rarely changes, making it ideal for caching
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
        tools,
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
        content: [],
      }

      for (const content of response.content) {
        if (content.type === 'tool_use') {
          let result: ToolResult
          try {
            result = await this.executeTool(content.name, content.input)
            toolCalls.push({
              name: content.name,
              params: content.input,
              result,
            })

            // If this was a capture_visualization call, save the screenshot
            // to attach to the next message instead of in the tool result
            if (
              content.name === 'capture_visualization' &&
              result.success &&
              result.data?.screenshot
            ) {
              capturedScreenshot = result.data.screenshot
              capturedScreenshotFormat = result.data.format || 'jpeg'
            }

            // If this was an apply_modifications call, collect the modifications
            if (
              content.name === 'apply_modifications' &&
              result.success &&
              result.data?.modifications
            ) {
              console.log(
                '[Claude] Collected modifications from tool call:',
                result.data.modifications
              )
              collectedModifications.push(...result.data.modifications)
            }
          } catch (error) {
            console.error('Error executing tool:', content.name, error)
            result = {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error executing tool',
            }
            toolCalls.push({
              name: content.name,
              params: content.input,
              result,
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
                message:
                  'Screenshot captured successfully and attached to this message for your analysis',
              },
            }
          }

          if (Array.isArray(toolResults.content)) {
            toolResults.content.push({
              type: 'tool_result',
              tool_use_id: content.id,
              content: JSON.stringify(sanitizedResult),
            })
          }
        } else if (content.type === 'text') {
          finalText += content.text
        }
      }

      // Continue conversation with tool results
      messages.push({
        role: 'assistant',
        content: response.content,
      })

      // If we captured a screenshot, attach it as an image to the tool result message
      if (capturedScreenshot) {
        const toolResultsWithImage: Anthropic.MessageParam['content'] = Array.isArray(
          toolResults.content
        )
          ? [...toolResults.content]
          : []

        toolResultsWithImage.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: `image/${capturedScreenshotFormat}`,
            data: capturedScreenshot,
          },
        })

        messages.push({
          role: 'user',
          content: toolResultsWithImage,
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
          // Use prompt caching for system prompt (1-hour TTL) to reduce costs
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages,
          tools,
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
      toolCalls,
    }
  }

  private getTools(): Anthropic.Tool[] {
    // Essential tools for visualization, debugging, and project state manipulation
    return [
      // Visual debugging tools
      {
        name: 'capture_visualization',
        description:
          'Capture a screenshot of the current visualization. The screenshot will be attached to your next message so you can see it.',
        input_schema: {
          type: 'object',
          properties: {
            includeUI: { type: 'boolean' },
            format: { type: 'string', enum: ['png', 'jpeg'] },
            quality: { type: 'number', description: 'JPEG quality 0-1, default 0.7' },
          },
        },
      },
      {
        name: 'get_console_errors',
        description: 'Get recent browser console errors and warnings',
        input_schema: {
          type: 'object',
          properties: {
            since: { type: 'number' },
            level: { type: 'string', enum: ['error', 'warn', 'all'] },
            maxResults: { type: 'number' },
          },
        },
      },
      {
        name: 'get_render_stats',
        description: 'Get deck.gl rendering statistics',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'inspect_layer',
        description: 'Get layer information',
        input_schema: {
          type: 'object',
          properties: {
            layerId: { type: 'string' },
          },
          required: ['layerId'],
        },
      },
      // Project state tools
      {
        name: 'apply_modifications',
        description:
          'Apply modifications to the project (add/update/delete nodes or edges). Use this instead of returning JSON in text.',
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
                    enum: ['add_node', 'update_node', 'delete_node', 'add_edge', 'delete_edge'],
                  },
                  data: {
                    type: 'object',
                    description: 'The node or edge data',
                  },
                },
                required: ['type', 'data'],
              },
            },
          },
          required: ['modifications'],
        },
      },
      {
        name: 'get_current_project',
        description: 'Get the current project state including all nodes and edges',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_nodes',
        description: 'List all nodes in the project with their current state and execution status',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_node_info',
        description:
          'Get detailed information about a specific node including connections and schema',
        input_schema: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: 'The ID of the node to inspect' },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'get_node_output',
        description:
          'Read the output data from a specific operator/node. Useful for inspecting data at any point in the pipeline.',
        input_schema: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: 'The ID of the node to read output from' },
            maxRows: {
              type: 'number',
              description: 'Maximum number of rows to return (default: 10)',
            },
          },
          required: ['nodeId'],
        },
      },
    ]
  }

  private async executeTool(name: string, params: unknown): Promise<ToolResult> {
    // params comes from Claude's tool_use with validated schema
    // Using any here since we're dispatching to properly typed methods
    // biome-ignore lint/suspicious/noExplicitAny: params validated by Anthropic SDK schema
    const methodMap: Record<string, (params: any) => Promise<ToolResult>> = {
      search_code: p => this.tools.searchCode(p),
      get_source_code: p => this.tools.getSourceCode(p),
      get_operator_schema: p => this.tools.getOperatorSchema(p),
      list_operators: p => this.tools.listOperators(p),
      get_documentation: p => this.tools.getDocumentation(p),
      get_example: p => this.tools.getExample(p),
      list_examples: p => this.tools.listExamples(p),
      find_symbol: p => this.tools.findSymbol(p),
      analyze_project: p => this.tools.analyzeProject(p),
      capture_visualization: p => this.tools.captureVisualization(p),
      get_console_errors: p => this.tools.getConsoleErrors(p),
      get_render_stats: () => this.tools.getRenderStats(),
      inspect_layer: p => this.tools.inspectLayer(p),
      apply_modifications: p => this.tools.applyModifications(p),
      get_current_project: () => this.tools.getCurrentProject(),
      list_nodes: () => this.tools.listNodes(),
      get_node_info: p => this.tools.getNodeInfo(p),
      get_node_output: p => this.tools.getNodeOutput(p),
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

    console.log(
      '[Claude] Extracting modifications from response, found',
      matches.length,
      'JSON blocks'
    )

    for (const match of matches) {
      try {
        const json = JSON.parse(match[1])
        console.log('[Claude] Parsed JSON block:', json)

        // Use Zod schema for type-safe validation
        const modifications = parseModifications(json)
        if (modifications && modifications.length > 0) {
          console.log(
            '[Claude] Validated modifications array with',
            modifications.length,
            'modifications'
          )
          return modifications
        }
      } catch (e) {
        console.warn('[Claude] Failed to parse JSON block:', e)
      }
    }

    console.log('[Claude] No valid modifications found in response')
    return []
  }
}
