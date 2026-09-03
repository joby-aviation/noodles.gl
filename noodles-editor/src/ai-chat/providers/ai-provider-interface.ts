import type { ProjectModification } from '../../noodles/hooks/use-project-modifications'
import type { Message, NoodlesProject, ToolCall } from '../types'

// Common interface for all AI providers (Anthropic, Groq, OpenRouter, etc.)
export interface AIProvider {
  // Provider identification
  readonly name: string // Internal name (e.g., 'anthropic', 'groq')
  readonly displayName: string // User-facing name (e.g., 'Claude', 'Free AI (Groq)')
  readonly tier: 'free' | 'premium' // Service tier

  // Capabilities
  readonly supportsStreaming: boolean
  readonly supportsFunctionCalling: boolean

  // Lifecycle
  initialize(onProgress?: (message: string) => void): Promise<void>

  // Core functionality
  sendMessage(params: MessageParams): Promise<AIResponse>

  // Rate limiting (optional, null if not applicable)
  getRateLimit(): RateLimitInfo | null
}

// Parameters for sending a message
export interface MessageParams {
  message: string
  project: NoodlesProject
  screenshot?: string
  screenshotFormat?: 'png' | 'jpeg'
  autoCapture?: boolean
  conversationHistory?: Message[]
}

// Response from AI provider
export interface AIResponse {
  message: string
  projectModifications: ProjectModification[]
  toolCalls: ToolCall[]
}

// Rate limit information
export interface RateLimitInfo {
  remaining: number
  limit: number
  resetAt?: Date
  windowDescription?: string // e.g., "per day", "per hour"
}

// Error types
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class RateLimitError extends ProviderError {
  constructor(message: string, provider: string) {
    super(message, provider, 'RATE_LIMIT_EXCEEDED')
    this.name = 'RateLimitError'
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message: string, provider: string) {
    super(message, provider, 'AUTHENTICATION_ERROR')
    this.name = 'AuthenticationError'
  }
}
