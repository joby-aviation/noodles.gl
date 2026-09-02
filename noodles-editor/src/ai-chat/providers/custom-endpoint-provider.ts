import type { ProjectModification } from '../../noodles/hooks/use-project-modifications'
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

// OpenAI-compatible API types
interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

interface ChatCompletionRequest {
  model: string
  messages: ChatCompletionMessage[]
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }>
  tool_choice?: 'auto' | 'none'
  max_tokens?: number
  temperature?: number
}

interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: ChatCompletionMessage
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export class CustomEndpointProvider implements AIProvider {
  readonly name = 'custom'
  readonly displayName: string
  readonly tier = 'free' as const // User manages their own billing
  readonly supportsStreaming = false // Can be enabled if endpoint supports it
  readonly supportsFunctionCalling = true

  private baseUrl: string
  private apiKey: string
  private model: string
  private tools: MCPTools
  private readonly MAX_TOKENS = 8192
  private readonly MAX_CONVERSATION_HISTORY = 10

  constructor(
    tools: MCPTools,
    config: {
      baseUrl: string
      apiKey: string
      model: string
      displayName?: string
    }
  ) {
    this.tools = tools
    this.baseUrl = config.baseUrl.replace(/\/$/, '') // Remove trailing slash
    this.apiKey = config.apiKey
    this.model = config.model
    this.displayName = config.displayName || `Custom (${this.model})`

    if (!this.baseUrl || !this.apiKey || !this.model) {
      throw new ProviderError(
        'Custom endpoint requires baseUrl, apiKey, and model',
        'custom',
        'MISSING_CONFIG'
      )
    }
  }

  async initialize(): Promise<void> {
    // Validate endpoint by making a test request
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
    } catch (error) {
      console.warn('Could not validate custom endpoint (models endpoint may not exist):', error)
      // Don't fail initialization - some endpoints don't have /models
    }
  }

  getRateLimit(): RateLimitInfo | null {
    // Custom endpoints don't report rate limits in a standard way
    return null
  }

  async sendMessage(params: MessageParams): Promise<AIResponse> {
    const { message, conversationHistory = [] } = params

    // Limit conversation history
    const limitedHistory = conversationHistory.slice(-this.MAX_CONVERSATION_HISTORY)

    const systemPrompt = systemPromptTemplate

    // Format messages for OpenAI-compatible API
    const messages: ChatCompletionMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...limitedHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: this.stripImages(m.content),
      })),
      {
        role: 'user' as const,
        content: message,
      },
    ]

    // Convert tools to OpenAI format
    const tools = this.getToolsOpenAIFormat()

    console.log(`Sending to custom endpoint (${this.baseUrl}):`, {
      messageCount: messages.length,
      systemPromptLength: systemPrompt.length,
      conversationHistoryLength: limitedHistory.length,
      model: this.model,
    })

    // Send to custom endpoint
    let response: ChatCompletionResponse
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          max_tokens: this.MAX_TOKENS,
          temperature: 0.7,
        } as ChatCompletionRequest),
      })

      if (!res.ok) {
        const errorText = await res.text()
        if (res.status === 401 || res.status === 403) {
          throw new ProviderError(
            'Authentication failed. Check your API key.',
            'custom',
            'AUTHENTICATION_ERROR'
          ) as AuthenticationError
        }
        throw new Error(`HTTP ${res.status}: ${errorText}`)
      }

      response = await res.json()
    } catch (error) {
      console.error('Custom endpoint API error:', error)
      if (error instanceof ProviderError) {
        throw error
      }
      throw new ProviderError(
        error instanceof Error ? error.message : 'Unknown error',
        'custom',
        'API_ERROR'
      )
    }

    const toolCalls: Array<{
      name: string
      params: Record<string, unknown>
      result: ToolResult
    }> = []
    let finalText = ''
    const collectedModifications: ProjectModification[] = []

    // Handle tool use loop
    const choice = response.choices[0]
    if (!choice) {
      throw new ProviderError('No response from endpoint', 'custom', 'EMPTY_RESPONSE')
    }

    const assistantMessage = choice.message

    // Check for tool calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Handle tool calls
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name
        const toolParams = JSON.parse(toolCall.function.arguments)

        let result: ToolResult
        try {
          result = await this.executeTool(toolName, toolParams)
          toolCalls.push({
            name: toolName,
            params: toolParams,
            result,
          })

          // Collect modifications
          if (
            toolName === 'apply_modifications' &&
            result.success &&
            result.data &&
            typeof result.data === 'object' &&
            'modifications' in result.data &&
            Array.isArray((result.data as { modifications: unknown }).modifications)
          ) {
            const mods = (result.data as { modifications: ProjectModification[] }).modifications
            collectedModifications.push(...mods)
          }
        } catch (error) {
          console.error('Error executing tool:', toolName, error)
          result = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
          toolCalls.push({
            name: toolName,
            params: toolParams,
            result,
          })
        }
      }

      // Make follow-up request with tool results
      const toolResultMessages: ChatCompletionMessage[] = [
        ...messages,
        {
          role: 'assistant',
          content: assistantMessage.content || '',
          tool_calls: assistantMessage.tool_calls,
        },
        ...assistantMessage.tool_calls.map(toolCall => {
          const matchingResult = toolCalls.find(tc => tc.name === toolCall.function.name)
          return {
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: JSON.stringify(matchingResult?.result || { success: false, error: 'No result' }),
          }
        }),
      ]

      const followUpRes = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: toolResultMessages,
          max_tokens: this.MAX_TOKENS,
          temperature: 0.7,
        } as ChatCompletionRequest),
      })

      const followUpResponse: ChatCompletionResponse = await followUpRes.json()
      const followUpChoice = followUpResponse.choices[0]
      if (followUpChoice?.message.content) {
        finalText = followUpChoice.message.content
      }
    } else if (assistantMessage.content) {
      finalText = assistantMessage.content
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

  // Strip images from message content
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

  // Convert tool definitions to OpenAI format
  private getToolsOpenAIFormat(): Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }> {
    return toolDefinitions
      .filter(def => def.exposeToChat !== false)
      .map(def => ({
        type: 'function' as const,
        function: {
          name: def.name,
          description: def.description,
          parameters: def.inputSchema as unknown as Record<string, unknown>,
        },
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
