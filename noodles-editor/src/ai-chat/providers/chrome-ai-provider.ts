import type { ProjectModification } from '../../noodles/hooks/use-project-modifications'
import type { MCPTools } from '../mcp-tools'
import systemPromptTemplate from '../system-prompt.md?raw'
import { getToolDefinition, toolDefinitions } from '../tool-definitions'
import type { Message, ToolResult } from '../types'
import { parseModifications } from '../types'
import type {
  AIProvider,
  AIResponse,
  MessageParams,
  RateLimitInfo,
} from './ai-provider-interface'
import { ProviderError } from './ai-provider-interface'

// Chrome Built-in AI (Gemini Nano) - window.ai API
// https://github.com/explainers-by-googlers/prompt-api
interface WindowAI {
  canCreateTextSession: () => Promise<'readily' | 'after-download' | 'no'>
  createTextSession: (options?: {
    systemPrompt?: string
    temperature?: number
    topK?: number
  }) => Promise<AITextSession>
  defaultTextSessionOptions: () => Promise<{
    temperature: number
    topK: number
  }>
}

interface AITextSession {
  prompt: (input: string) => Promise<string>
  promptStreaming: (input: string) => ReadableStream<string>
  destroy: () => void
  clone: () => AITextSession
}

declare global {
  interface Window {
    ai?: WindowAI
  }
}

export class ChromeAIProvider implements AIProvider {
  readonly name = 'chrome-ai'
  readonly displayName = 'Built-in AI (Chrome)'
  readonly tier = 'free' as const
  readonly supportsStreaming = true
  readonly supportsFunctionCalling = false // Chrome AI doesn't support function calling yet

  private tools: MCPTools
  private session: AITextSession | null = null

  constructor(tools: MCPTools) {
    this.tools = tools
  }

  async initialize(): Promise<void> {
    // Check if Chrome Built-in AI is available
    if (!window.ai) {
      throw new ProviderError(
        'Chrome Built-in AI is not available. Please use Chrome 127+ and enable the Prompt API. ' +
          'Visit chrome://flags/#prompt-api-for-gemini-nano to enable.',
        'chrome-ai',
        'NOT_AVAILABLE'
      )
    }

    const availability = await window.ai.canCreateTextSession()

    if (availability === 'no') {
      throw new ProviderError(
        'Chrome Built-in AI is not available on this device. Try adding a Groq or Anthropic API key instead.',
        'chrome-ai',
        'NOT_AVAILABLE'
      )
    }

    if (availability === 'after-download') {
      throw new ProviderError(
        'Chrome Built-in AI model is downloading. This may take a few minutes. Please try again later.',
        'chrome-ai',
        'DOWNLOADING'
      )
    }

    // Create session with system prompt
    try {
      this.session = await window.ai.createTextSession({
        systemPrompt: this.getSimplifiedSystemPrompt(),
        temperature: 0.7,
        topK: 40,
      })
    } catch (error) {
      throw new ProviderError(
        `Failed to create Chrome AI session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'chrome-ai',
        'INITIALIZATION_FAILED'
      )
    }
  }

  getRateLimit(): RateLimitInfo | null {
    // Chrome Built-in AI has no explicit rate limits (runs locally)
    return null
  }

  async sendMessage(params: MessageParams): Promise<AIResponse> {
    const { message, conversationHistory = [] } = params

    if (!this.session) {
      throw new ProviderError(
        'Chrome AI session not initialized',
        'chrome-ai',
        'NOT_INITIALIZED'
      )
    }

    // Build conversation context (Chrome AI doesn't maintain history)
    // Keep it short since context window is smaller (~4K tokens)
    const recentHistory = conversationHistory.slice(-4)
    const contextMessages = recentHistory
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${this.stripImages(m.content)}`)
      .join('\n\n')

    const fullPrompt = contextMessages
      ? `${contextMessages}\n\nUser: ${message}\n\nAssistant:`
      : message

    console.log('Sending to Chrome Built-in AI:', {
      messageLength: message.length,
      historyLength: recentHistory.length,
    })

    let response: string
    try {
      response = await this.session.prompt(fullPrompt)
    } catch (error) {
      console.error('Chrome AI error:', error)
      throw new ProviderError(
        error instanceof Error ? error.message : 'Unknown error',
        'chrome-ai',
        'API_ERROR'
      )
    }

    // Chrome AI doesn't support function calling, so we only parse text-based modifications
    const textModifications = this.extractProjectModifications(response)

    return {
      message: response,
      projectModifications: textModifications,
      toolCalls: [], // No tool support in Chrome AI
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

  // Simplified system prompt for Chrome AI (smaller context window)
  private getSimplifiedSystemPrompt(): string {
    return `You are an AI assistant for Noodles.gl, a visual programming tool for geospatial data visualization.

You help users:
- Create and modify visualization operators (nodes)
- Connect data flows between operators
- Debug issues in projects
- Suggest best practices

When suggesting changes, provide JSON modifications in this format:
\`\`\`json
[
  {"type": "add_node", "data": {"id": "/node-name", "type": "OperatorType", "position": {"x": 100, "y": 100}}},
  {"type": "update_node", "data": {"id": "/existing-node", "data": {"inputs": {"param": "value"}}}},
  {"type": "add_edge", "data": {"source": "/source-node", "target": "/target-node", "sourceHandle": "out.data", "targetHandle": "par.input"}}
]
\`\`\`

Be concise and practical. Focus on solving the user's immediate problem.`
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

  // Clean up session on destroy
  destroy(): void {
    if (this.session) {
      this.session.destroy()
      this.session = null
    }
  }
}
