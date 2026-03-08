/**
 * OpenAI-compatible provider.
 *
 * Works with:
 *  - OpenAI directly (gpt-4o, gpt-4o-mini, o3-mini)
 *  - OpenRouter (any model via openrouter.ai/api, free tier available)
 *  - Any OpenAI-compatible API (Together, Groq, local LLMs via LM Studio / Ollama)
 *
 * Uses the fetch-based API directly to avoid bundling the openai SDK.
 */

import type {
  AIProvider,
  AIResponse,
  AISendParams,
  AIToolCall,
  AIToolDefinition,
} from './types'

const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_MAX_TOKENS = 8192
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export interface OpenAIProviderOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  /** Extra headers (e.g. OpenRouter requires HTTP-Referer) */
  extraHeaders?: Record<string, string>
}

export class OpenAIProvider implements AIProvider {
  readonly name: string
  readonly id = 'openai' as const
  readonly model: string

  private apiKey: string
  private baseUrl: string
  private extraHeaders: Record<string, string>

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey
    this.model = options.model ?? DEFAULT_MODEL
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.extraHeaders = options.extraHeaders ?? {}

    // Friendly display name based on baseUrl
    if (this.baseUrl.includes('openrouter')) {
      this.name = 'OpenRouter'
    } else if (this.baseUrl.includes('openai.com')) {
      this.name = 'OpenAI'
    } else {
      this.name = 'OpenAI-compatible'
    }
  }

  async send(params: AISendParams): Promise<AIResponse> {
    const { system, messages, tools, maxTokens = DEFAULT_MAX_TOKENS } = params

    // Build OpenAI-format messages
    const oaiMessages: OAIMessage[] = [
      { role: 'system', content: system },
      ...messages
        .filter(m => m.role !== 'system')
        .map(m => toOAIMessage(m)),
    ]

    // Build OpenAI-format tools
    const oaiTools: OAITool[] | undefined = tools?.map(toOAITool)

    const body: Record<string, unknown> = {
      model: this.model,
      messages: oaiMessages,
      max_tokens: maxTokens,
    }
    if (oaiTools?.length) {
      body.tools = oaiTools
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`)
    }

    const data = await response.json() as OAICompletionResponse
    return parseOAIResponse(data)
  }
}

// ── OpenAI API types (minimal, no SDK dependency) ─────────────────────────

interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OAIContentPart[] | null
  tool_calls?: OAIToolCall[]
  tool_call_id?: string
}

type OAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }

interface OAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OAICompletionResponse {
  choices: Array<{
    message: {
      role: string
      content: string | null
      tool_calls?: OAIToolCall[]
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// ── Conversion helpers ────────────────────────────────────────────────────

function toOAIMessage(msg: { role: string; content: string | Array<{ type: string; text?: string; source?: { mediaType: string; data: string } }> }): OAIMessage {
  if (typeof msg.content === 'string') {
    return { role: msg.role as OAIMessage['role'], content: msg.content }
  }

  const parts: OAIContentPart[] = msg.content.map(block => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text ?? '' }
    }
    if (block.type === 'image' && block.source) {
      return {
        type: 'image_url' as const,
        image_url: {
          url: `data:${block.source.mediaType};base64,${block.source.data}`,
          detail: 'auto',
        },
      }
    }
    return { type: 'text' as const, text: '' }
  })

  return { role: msg.role as OAIMessage['role'], content: parts }
}

function toOAITool(tool: AIToolDefinition): OAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}

function parseOAIResponse(data: OAICompletionResponse): AIResponse {
  const choice = data.choices[0]
  if (!choice) {
    return { text: '', toolCalls: [], stopReason: 'unknown' }
  }

  const text = choice.message.content ?? ''
  const toolCalls: AIToolCall[] = (choice.message.tool_calls ?? []).map(tc => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments),
  }))

  const stopReason =
    choice.finish_reason === 'tool_calls'
      ? 'tool_use'
      : choice.finish_reason === 'stop'
        ? 'end'
        : choice.finish_reason === 'length'
          ? 'max_tokens'
          : 'unknown'

  return {
    text,
    toolCalls,
    stopReason,
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
        }
      : undefined,
  }
}
