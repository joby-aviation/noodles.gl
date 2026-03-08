/**
 * Anthropic provider — wraps the existing @anthropic-ai/sdk.
 *
 * Supports prompt caching (ephemeral system blocks) for reduced costs.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  AIProvider,
  AIResponse,
  AISendParams,
  AIToolCall,
  AIToolDefinition,
} from './types'

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
const DEFAULT_MAX_TOKENS = 8192

export class AnthropicProvider implements AIProvider {
  readonly name = 'Anthropic'
  readonly id = 'anthropic' as const
  readonly model: string

  private client: Anthropic

  constructor(apiKey: string, model?: string) {
    this.model = model ?? DEFAULT_MODEL
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  }

  async send(params: AISendParams): Promise<AIResponse> {
    const { system, messages, tools, maxTokens = DEFAULT_MAX_TOKENS } = params

    // Convert generic messages to Anthropic format
    const anthropicMessages: Anthropic.MessageParam[] = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(block => {
              if (block.type === 'text') return { type: 'text' as const, text: block.text }
              if (block.type === 'image') {
                return {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: block.source.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                    data: block.source.data,
                  },
                }
              }
              return { type: 'text' as const, text: '' }
            }),
      }))

    // Convert generic tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] | undefined = tools?.map(toAnthropicTool)

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: [
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: anthropicMessages,
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    })

    return parseAnthropicResponse(response)
  }
}

function toAnthropicTool(tool: AIToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
  }
}

function parseAnthropicResponse(response: Anthropic.Message): AIResponse {
  let text = ''
  const toolCalls: AIToolCall[] = []

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input,
      })
    }
  }

  const stopReason =
    response.stop_reason === 'tool_use'
      ? 'tool_use'
      : response.stop_reason === 'end_turn'
        ? 'end'
        : response.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : 'unknown'

  return {
    text,
    toolCalls,
    stopReason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: (response.usage as unknown as Record<string, number>).cache_read_input_tokens,
      cacheWriteTokens: (response.usage as unknown as Record<string, number>).cache_creation_input_tokens,
    },
  }
}
