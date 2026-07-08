import Anthropic from '@anthropic-ai/sdk'
import {
  compactConversation,
  estimateConversationTokens,
  shouldCompact,
} from './conversation-compaction'
import type { MCPTools } from './mcp-tools'
import systemPromptTemplate from './system-prompt.md?raw'
import { getToolDefinition, toolDefinitions } from './tool-definitions'
import type {
  ClaudeResponse,
  Message,
  NoodlesProject,
  ProjectModification,
  ToolCall,
  ToolResult,
} from './types'
import { parseModifications } from './types'

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
              params: content.input as Record<string, unknown>,
              result,
            })

            // If this was a capture_visualization call, save the screenshot
            // to attach to the next message instead of in the tool result
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
              params: content.input as Record<string, unknown>,
              result,
            })
          }

          // Strip large data (like screenshots) from tool results before sending back to Claude
          // to prevent token overflow. Screenshots are attached as images in the next message.
          let sanitizedResult: ToolResult = result
          if (result.success && result.data && isScreenshotData(result.data)) {
            const { screenshot, ...rest } = result.data
            sanitizedResult = {
              success: true,
              data: {
                ...rest,
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
    // Essential tools for visualization, debugging, and project state manipulation;
    // definitions with exposeToChat: false stay executable but aren't offered here
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

    // params comes from Claude's tool_use with validated schema
    return definition.execute(this.tools, (params ?? {}) as Record<string, unknown>, () =>
      this.tools.getProject()
    )
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
        console.error('[Claude] Failed to parse JSON block:', e)
      }
    }

    console.log('[Claude] No valid modifications found in response')
    return []
  }
}
