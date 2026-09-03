import Anthropic from '@anthropic-ai/sdk'
import type { ProjectModification } from '../../noodles/hooks/use-project-modifications'
import { debugAiChat } from '../../utils/debug'
import {
  compactConversation,
  estimateConversationTokens,
  shouldCompact,
} from '../conversation-compaction'
import type { MCPTools } from '../mcp-tools'
import systemPromptTemplate from '../system-prompt.md?raw'
import { getToolDefinition, toolDefinitions } from '../tool-definitions'
import type { Message, ToolResult } from '../types'
import { parseModifications } from '../types'
import type {
  AIProvider,
  AIResponse,
  AuthenticationError,
  MessageParams,
  RateLimitInfo,
} from './ai-provider-interface'
import { ProviderError } from './ai-provider-interface'

// Type guards for ToolResult data
interface ScreenshotData {
  screenshot: string
  format?: 'png' | 'jpeg'
  width?: number
  height?: number
  originalWidth?: number
  originalHeight?: number
  timestamp?: number
  pixelRatio?: number
}

interface ModificationsData {
  modifications: ProjectModification[]
  modificationsCount?: number
  message?: string
}

function isScreenshotData(data: unknown): data is ScreenshotData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'screenshot' in data &&
    typeof (data as ScreenshotData).screenshot === 'string'
  )
}

function isModificationsData(data: unknown): data is ModificationsData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'modifications' in data &&
    Array.isArray((data as ModificationsData).modifications)
  )
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic'
  readonly displayName = 'Claude (Premium)'
  readonly tier = 'premium' as const
  readonly supportsStreaming = true
  readonly supportsFunctionCalling = true

  // Configuration constants
  private static readonly MODEL = 'claude-sonnet-4-5-20250929'
  private static readonly MAX_TOKENS = 8192
  private static readonly MAX_CONVERSATION_HISTORY = 10
  private static readonly COMPACTION_THRESHOLD = 50000

  private client: Anthropic
  private tools: MCPTools

  constructor(apiKey: string, tools: MCPTools) {
    if (!apiKey) {
      throw new ProviderError(
        'Anthropic API key is required',
        'anthropic',
        'MISSING_API_KEY'
      ) as AuthenticationError
    }
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    this.tools = tools
  }

  async initialize(onProgress?: (message: string) => void): Promise<void> {
    // No initialization needed for Anthropic
    onProgress?.('Connecting to Anthropic...')
  }

  getRateLimit(): RateLimitInfo | null {
    // Anthropic doesn't expose rate limits in the same way
    // Rate limits depend on tier and are enforced server-side
    return null
  }

  async sendMessage(params: MessageParams): Promise<AIResponse> {
    const { message, conversationHistory = [] } = params

    // Limit conversation history
    let limitedHistory = conversationHistory.slice(-AnthropicProvider.MAX_CONVERSATION_HISTORY)

    // Check if compaction is needed for long conversations
    if (shouldCompact(limitedHistory, AnthropicProvider.COMPACTION_THRESHOLD)) {
      debugAiChat(
        'Conversation history exceeds threshold, compacting...',
        `(~${estimateConversationTokens(limitedHistory)} tokens)`
      )
      try {
        limitedHistory = await compactConversation(
          this.client,
          limitedHistory,
          AnthropicProvider.MODEL,
          2 // Keep last 2 exchanges intact
        )
        debugAiChat('Compaction complete, new history length:', limitedHistory.length)
      } catch (error) {
        debugAiChat('Compaction failed, using truncated history:', error)
        limitedHistory = conversationHistory.slice(-4)
      }
    }

    // Auto-capture is disabled by default
    const screenshot = params.screenshot
    const screenshotFormat = params.screenshotFormat || 'jpeg'

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

    // Strip images from conversation history to reduce token usage
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

    debugAiChat('Sending to Anthropic:', {
      messageCount: messages.length,
      systemPromptLength: systemPrompt.length,
      hasScreenshot: !!screenshot,
      conversationHistoryLength: limitedHistory.length,
    })

    // Send to Claude with error handling
    let response: Anthropic.Message
    try {
      response = await this.client.messages.create({
        model: AnthropicProvider.MODEL,
        max_tokens: AnthropicProvider.MAX_TOKENS,
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
      debugAiChat('Anthropic API error:', error)
      if (error instanceof Error) {
        if (
          error.message.includes('authentication') ||
          error.message.includes('401') ||
          error.message.includes('invalid_api_key')
        ) {
          throw new ProviderError(
            'Anthropic authentication failed. Check your API key in Settings.',
            'anthropic',
            'AUTHENTICATION_ERROR'
          ) as AuthenticationError
        }
      }
      throw new ProviderError(
        error instanceof Error ? error.message : 'Unknown error',
        'anthropic',
        'API_ERROR'
      )
    }

    const toolCalls: Array<{
      name: string
      params: Record<string, unknown>
      result: ToolResult
    }> = []
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
              params: content.input as Record<string, unknown>,
              result,
            })

            // If this was a capture_visualization call, save the screenshot
            if (
              content.name === 'capture_visualization' &&
              result.success &&
              result.data &&
              isScreenshotData(result.data)
            ) {
              capturedScreenshot = result.data.screenshot
              capturedScreenshotFormat = result.data.format || 'jpeg'
            }

            // If this was an apply_modifications call, collect the modifications
            if (
              content.name === 'apply_modifications' &&
              result.success &&
              result.data &&
              isModificationsData(result.data)
            ) {
              collectedModifications.push(...result.data.modifications)
            }
          } catch (error) {
            debugAiChat('Error executing tool:', content.name, error)
            result = {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error executing tool',
            }
            toolCalls.push({
              name: content.name,
              params: content.input as Record<string, unknown>,
              result,
            })
          }

          // Strip large data from tool results before sending back
          let sanitizedResult: ToolResult = result
          if (result.success && result.data && isScreenshotData(result.data)) {
            const { screenshot, ...rest } = result.data
            sanitizedResult = {
              success: true,
              data: {
                ...rest,
                message: 'Screenshot captured successfully and attached to this message',
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

      // If we captured a screenshot, attach it as an image
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

        capturedScreenshot = null
        capturedScreenshotFormat = 'jpeg'
      } else {
        messages.push(toolResults)
      }

      try {
        response = await this.client.messages.create({
          model: AnthropicProvider.MODEL,
          max_tokens: AnthropicProvider.MAX_TOKENS,
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
        debugAiChat('Anthropic API error in tool use loop:', error)
        throw new ProviderError(
          error instanceof Error ? error.message : 'Unknown error',
          'anthropic',
          'API_ERROR'
        )
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
    const allModifications = [...collectedModifications, ...textModifications]

    return {
      message: finalText,
      projectModifications: allModifications,
      toolCalls,
    }
  }

  // Strip images from message content to reduce token usage
  private stripImages(
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  ): string {
    if (typeof content === 'string') {
      return content
    }
    if (Array.isArray(content)) {
      return content
        .filter(part => part && part.type === 'text')
        .map(part => part.text || '')
        .join('\n')
    }
    return String(content)
  }

  private getTools(): Anthropic.Tool[] {
    return toolDefinitions
      .filter(def => def.exposeToChat !== false)
      .map(def => ({
        name: def.name,
        description: def.description,
        input_schema: def.inputSchema as Anthropic.Tool['input_schema'],
      }))
  }

  private async executeTool(name: string, params: unknown): Promise<ToolResult> {
    const definition = getToolDefinition(name)
    if (!definition) {
      return { success: false, error: `Unknown tool: ${name}` }
    }

    return definition.execute(this.tools, (params ?? {}) as Record<string, unknown>, () =>
      this.tools.getProject()
    )
  }

  private extractProjectModifications(text: string): ProjectModification[] {
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/g
    const matches = [...text.matchAll(jsonBlockRegex)]

    for (const match of matches) {
      try {
        const json = JSON.parse(match[1])
        const modifications = parseModifications(json)
        if (modifications && modifications.length > 0) {
          return modifications as ProjectModification[]
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    return []
  }
}
