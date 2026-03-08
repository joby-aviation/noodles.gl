/**
 * AI Client — provider-agnostic wrapper that replaces direct ClaudeClient usage.
 *
 * Maintains the same external API as ClaudeClient so the chat panel
 * can switch to it with minimal changes. Internally delegates to
 * whichever AIProvider is resolved from the user's configured keys.
 */

import {
  compactConversation,
  estimateConversationTokens,
  shouldCompact,
} from './conversation-compaction'
import type { MCPTools } from './mcp-tools'
import { createProvider, type AIProvider, type AIToolDefinition } from './providers'
import type { ProviderPreference } from './providers/types'
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

// Re-export for convenience
export type { ProviderPreference } from './providers/types'

export class AIClient {
  private static readonly MAX_TOKENS = 8192
  private static readonly MAX_CONVERSATION_HISTORY = 10
  private static readonly COMPACTION_THRESHOLD = 50000

  private provider: AIProvider
  private tools: MCPTools
  /** Anthropic client for compaction (shared instance) */
  private compactionProvider: AIProvider | null

  /** Which provider is active (for UI display) */
  readonly providerName: string
  readonly providerModel: string

  constructor(provider: AIProvider, tools: MCPTools, compactionProvider?: AIProvider) {
    this.provider = provider
    this.tools = tools
    this.compactionProvider = compactionProvider ?? null
    this.providerName = provider.name
    this.providerModel = provider.model
  }

  /**
   * Factory: create an AIClient from configured keys.
   * Returns null if no API keys are available.
   */
  static create(
    keys: { anthropic?: string; openai?: string; openaiBaseUrl?: string },
    tools: MCPTools,
    preference: ProviderPreference = 'auto',
  ): AIClient | null {
    const resolved = createProvider(keys, preference)
    if (!resolved) return null

    // If primary is OpenAI but we also have Anthropic, use Anthropic for compaction
    // (it has better prompt caching and is cheaper for summarization)
    let compactionProvider: AIProvider | undefined
    if (resolved.source === 'openai' && keys.anthropic) {
      const anthropicResolved = createProvider(keys, 'anthropic')
      compactionProvider = anthropicResolved?.provider
    }

    return new AIClient(resolved.provider, tools, compactionProvider)
  }

  async sendMessage(params: {
    message: string
    project: NoodlesProject
    screenshot?: string
    screenshotFormat?: 'png' | 'jpeg'
    autoCapture?: boolean
    conversationHistory?: Message[]
  }): Promise<ClaudeResponse> {
    const { message, conversationHistory = [] } = params

    // Limit and optionally compact conversation history
    let limitedHistory = conversationHistory.slice(-AIClient.MAX_CONVERSATION_HISTORY)

    if (shouldCompact(limitedHistory, AIClient.COMPACTION_THRESHOLD)) {
      console.log(
        `[AIClient] Conversation exceeds threshold, compacting...`,
        `(~${estimateConversationTokens(limitedHistory)} tokens)`,
      )
      try {
        // Use compaction provider if available, otherwise skip
        // (compaction uses Anthropic SDK directly — future: make it provider-agnostic)
        if (this.compactionProvider?.id === 'anthropic' || this.provider.id === 'anthropic') {
          const Anthropic = (await import('@anthropic-ai/sdk')).default
          // Get the key from the provider (we trust the caller validated it)
          limitedHistory = await compactConversation(
            // compactConversation expects an Anthropic client instance
            // For now, only works with Anthropic provider
            new Anthropic({ apiKey: '', dangerouslyAllowBrowser: true }),
            limitedHistory,
            this.provider.model,
            2,
          )
        }
      } catch (error) {
        console.error('[AIClient] Compaction failed, using truncated history:', error)
        limitedHistory = conversationHistory.slice(-4)
      }
    }

    const screenshot = params.screenshot
    const screenshotFormat = params.screenshotFormat || 'jpeg'

    // Build user content
    const userContent: Array<{ type: string; text?: string; source?: { type: string; mediaType: string; data: string } }> = [
      { type: 'text', text: message },
    ]

    if (screenshot) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          mediaType: `image/${screenshotFormat}`,
          data: screenshot,
        },
      })
    }

    // Build messages array
    const messages = [
      ...limitedHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : this.stripImages(m.content),
      })),
      {
        role: 'user' as const,
        content: userContent as any,
      },
    ]

    // Get tool definitions
    const tools = this.getToolDefinitions()

    console.log(`[AIClient] Sending to ${this.providerName} (${this.providerModel}):`, {
      messageCount: messages.length,
      hasScreenshot: !!screenshot,
      historyLength: limitedHistory.length,
    })

    // Tool use loop
    const toolCalls: ToolCall[] = []
    let finalText = ''
    const collectedModifications: ProjectModification[] = []

    let response = await this.provider.send({
      system: systemPromptTemplate,
      messages: messages as any,
      tools,
      maxTokens: AIClient.MAX_TOKENS,
    })

    while (response.stopReason === 'tool_use' && response.toolCalls.length > 0) {
      // Execute each tool call
      const toolResults: Array<{ toolCallId: string; content: string }> = []

      for (const tc of response.toolCalls) {
        let result: ToolResult
        try {
          result = await this.executeTool(tc.name, tc.input)
          toolCalls.push({ name: tc.name, params: tc.input as any, result })

          if (tc.name === 'apply_modifications' && result.success && (result.data as any)?.modifications) {
            collectedModifications.push(...(result.data as any).modifications)
          }
        } catch (error) {
          result = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
          toolCalls.push({ name: tc.name, params: tc.input as any, result })
        }

        // Strip screenshots from results
        let sanitized = result
        if (result.success && result.data && 'screenshot' in (result.data as any)) {
          const data = { ...(result.data as any) }
          delete data.screenshot
          sanitized = { success: true, data: { ...data, message: 'Screenshot captured and attached' } }
        }

        toolResults.push({
          toolCallId: tc.id,
          content: JSON.stringify(sanitized),
        })
      }

      // Collect text from this response
      if (response.text) finalText += response.text

      // Build continuation messages
      // For Anthropic: assistant message with tool_use blocks, then user message with tool_result blocks
      // For OpenAI: assistant message with tool_calls, then tool messages
      // The provider handles the format internally — we just send the generic format
      messages.push({
        role: 'assistant' as const,
        content: response.text || `[Tool calls: ${response.toolCalls.map(t => t.name).join(', ')}]`,
      })

      // Add tool results as user message
      messages.push({
        role: 'user' as const,
        content: toolResults.map(r => `Tool result (${r.toolCallId}): ${r.content}`).join('\n') as any,
      })

      // Continue
      response = await this.provider.send({
        system: systemPromptTemplate,
        messages: messages as any,
        tools,
        maxTokens: AIClient.MAX_TOKENS,
      })
    }

    // Collect final text
    if (response.text) finalText += response.text

    // Parse modifications from text
    const textModifications = this.extractProjectModifications(finalText)
    const allModifications = [...collectedModifications, ...textModifications]

    return {
      message: finalText,
      projectModifications: allModifications,
      toolCalls,
    }
  }

  private stripImages(
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>,
  ): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter(part => part?.type === 'text')
        .map(part => part.text || '')
        .join('\n')
    }
    return String(content)
  }

  private getToolDefinitions(): AIToolDefinition[] {
    return [
      {
        name: 'capture_visualization',
        description: 'Capture a screenshot of the current visualization.',
        inputSchema: {
          type: 'object',
          properties: {
            includeUI: { type: 'boolean' },
            format: { type: 'string', enum: ['png', 'jpeg'] },
            quality: { type: 'number', description: 'JPEG quality 0-1' },
          },
        },
      },
      {
        name: 'get_console_errors',
        description: 'Get recent browser console errors and warnings',
        inputSchema: {
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
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'inspect_layer',
        description: 'Get layer information',
        inputSchema: {
          type: 'object',
          properties: { layerId: { type: 'string' } },
          required: ['layerId'],
        },
      },
      {
        name: 'apply_modifications',
        description: 'Apply modifications to the project (add/update/delete nodes or edges).',
        inputSchema: {
          type: 'object',
          properties: {
            modifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['add_node', 'update_node', 'delete_node', 'add_edge', 'delete_edge'] },
                  data: { type: 'object' },
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
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_nodes',
        description: 'List all nodes in the project with their state and execution status',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_node_info',
        description: 'Get detailed information about a specific node',
        inputSchema: {
          type: 'object',
          properties: { nodeId: { type: 'string' } },
          required: ['nodeId'],
        },
      },
      {
        name: 'get_node_output',
        description: 'Read the output data from a specific operator/node.',
        inputSchema: {
          type: 'object',
          properties: {
            nodeId: { type: 'string' },
            maxRows: { type: 'number' },
          },
          required: ['nodeId'],
        },
      },
    ]
  }

  private async executeTool(name: string, params: unknown): Promise<ToolResult> {
    const methodMap: Record<string, (params: any) => Promise<ToolResult>> = {
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
    if (!method) return { success: false, error: `Unknown tool: ${name}` }
    return method(params)
  }

  private extractProjectModifications(text: string): ProjectModification[] {
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/g
    const matches = [...text.matchAll(jsonBlockRegex)]

    for (const match of matches) {
      try {
        const json = JSON.parse(match[1])
        const modifications = parseModifications(json)
        if (modifications?.length) return modifications
      } catch {
        // skip invalid blocks
      }
    }
    return []
  }
}
