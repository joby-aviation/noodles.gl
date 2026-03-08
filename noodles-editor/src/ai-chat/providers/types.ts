/**
 * Provider-agnostic types for the AI chat system.
 *
 * Any LLM provider (Anthropic, OpenAI, OpenRouter, local) implements
 * the `AIProvider` interface and can be swapped transparently.
 */

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | AIContentBlock[]
}

export type AIContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: AIImageSource }

export interface AIImageSource {
  type: 'base64'
  mediaType: string
  data: string
}

export interface AIToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AIToolCall {
  id: string
  name: string
  input: unknown
}

export interface AIToolResult {
  toolCallId: string
  content: string
}

export interface AIResponse {
  /** Final text content from the model */
  text: string
  /** Tool calls requested by the model (if stop reason is tool_use) */
  toolCalls: AIToolCall[]
  /** Why the model stopped generating */
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'unknown'
  /** Token usage (provider-dependent) */
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

export interface AISendParams {
  system: string
  messages: AIMessage[]
  tools?: AIToolDefinition[]
  maxTokens?: number
}

/**
 * Common interface for all LLM providers.
 */
export interface AIProvider {
  /** Human-readable name for UI display */
  readonly name: string
  /** Provider identifier */
  readonly id: 'anthropic' | 'openai'
  /** Model being used */
  readonly model: string

  /** Send a message and get a complete response */
  send(params: AISendParams): Promise<AIResponse>
}

/**
 * Configuration for provider selection.
 * Priority: user-selected > first available key.
 */
export type ProviderPreference = 'anthropic' | 'openai' | 'auto'
