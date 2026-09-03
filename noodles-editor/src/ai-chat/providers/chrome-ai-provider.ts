import type { ProjectModification } from '../../noodles/hooks/use-project-modifications'
import { debugAiChat } from '../../utils/debug'
import { TimeoutError, withTimeout } from '../../utils/timeout'
import type { MCPTools } from '../mcp-tools'
import systemPromptTemplate from '../system-prompt.md?raw'
import { getToolDefinition, toolDefinitions } from '../tool-definitions'
import type { Message, ToolResult } from '../types'
import { parseModifications } from '../types'
import type {
  AIProvider,
  AIResponse,
  ContextWindowInfo,
  MessageParams,
  RateLimitInfo,
} from './ai-provider-interface'
import { ProviderError } from './ai-provider-interface'

// Chrome Built-in AI (Gemini Nano) - Prompt API
// https://developer.chrome.com/docs/ai/prompt-api
interface DownloadProgressEvent {
  loaded: number
  total: number
}

interface LanguageModelAvailability {
  availability(options?: {
    expectedOutputs?: Array<{ type: 'text'; languages: string[] }>
  }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>
  create(options?: {
    signal?: AbortSignal
    systemPrompt?: string
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    topK?: number
    temperature?: number
    monitor?: (monitor: { addEventListener: (type: string, callback: (e: DownloadProgressEvent) => void) => void }) => void
    expectedOutputs?: Array<{ type: 'text'; languages: string[] }>
  }): Promise<AILanguageModelSession>
}

interface AILanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>
  destroy(): void
  clone(): AILanguageModelSession
}

declare global {
  const LanguageModel: LanguageModelAvailability
}

export class ChromeAIProvider implements AIProvider {
  readonly name = 'chrome-ai'
  readonly displayName = 'Built-in AI (Chrome)'
  readonly tier = 'free' as const
  readonly supportsStreaming = true
  readonly supportsFunctionCalling = false // Chrome AI doesn't support function calling yet

  private tools: MCPTools
  private session: AILanguageModelSession | null = null

  constructor(tools: MCPTools) {
    this.tools = tools
  }

  async initialize(onProgress?: (message: string) => void): Promise<void> {
    onProgress?.('Checking Chrome AI availability...')

    // Check if Chrome Built-in AI is available
    if (typeof LanguageModel === 'undefined') {
      throw new ProviderError(
        'Chrome Built-in AI is not available.\n\n' +
          '1. Use Chrome 127+ (you have: ' +
          navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] +
          ')\n' +
          '2. Enable flag at chrome://flags/#prompt-api-for-gemini-nano\n' +
          '3. Restart Chrome\n\n' +
          'Or configure an external AI provider instead.',
        'chrome-ai',
        'NOT_AVAILABLE'
      )
    }

    let availability: string
    try {
      // Specify expected outputs when checking availability
      availability = await (LanguageModel as any).availability({
        expectedOutputs: [{ type: 'text', languages: ['en'] }]
      })
      debugAiChat('Chrome AI availability:', availability)
    } catch (error) {
      throw new ProviderError(
        'Chrome Built-in AI check failed. The flag may be enabled but the feature is not ready.\n\n' +
          'Try:\n' +
          '1. Restart Chrome completely\n' +
          '2. Wait a few minutes for the model to download\n' +
          '3. Or configure an external AI provider',
        'chrome-ai',
        'CHECK_FAILED'
      )
    }

    if (availability === 'unavailable') {
      throw new ProviderError(
        'Chrome Built-in AI is not available on this device.\n\n' +
          'This feature requires specific hardware support. ' +
          'Try configuring an external AI provider (Anthropic, OpenAI, etc.) instead.',
        'chrome-ai',
        'NOT_AVAILABLE'
      )
    }

    if (availability === 'downloadable') {
      // Need user activation to trigger download
      if (!navigator.userActivation.isActive) {
        throw new ProviderError(
          'Chrome Built-in AI model needs to download (~2GB).\n\n' +
            'Close this dialog and click the Assistant button again to trigger the download.\n' +
            'Or configure an external AI provider instead.',
          'chrome-ai',
          'NEEDS_ACTIVATION'
        )
      }

      // User activation is present, create session will trigger download
      debugAiChat('Triggering Chrome AI model download...')
      onProgress?.('Downloading AI model...')
    } else if (availability === 'downloading') {
      // Model is already downloading in background, attach to it
      debugAiChat('Attaching to existing Chrome AI download...')
      onProgress?.('Downloading AI model...')
    } else {
      onProgress?.('Creating AI session...')
    }

    // Create session with system prompt (with timeout and progress monitoring)
    try {
      debugAiChat('Creating Chrome AI session with options:', { availability, hasProgress: !!onProgress })

      // Create options with expectedOutputs to satisfy Chrome AI requirements
      const createOptions = {
        systemPrompt: this.getSimplifiedSystemPrompt(),
        temperature: 0.7,
        topK: 40,
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        monitor: (m: any) => {
          debugAiChat('Monitor callback fired, setting up event listener')
          m.addEventListener('downloadprogress', (e: any) => {
            const percent = Math.round((e.loaded / e.total) * 100)
            debugAiChat(`Download progress: ${percent}% (${e.loaded}/${e.total})`)
            onProgress?.(`Downloading AI model: ${percent}%`)
          })
        },
      }
      debugAiChat('Calling LanguageModel.create() with:', Object.keys(createOptions))

      const createSessionPromise = (LanguageModel as any).create(createOptions)

      // Use longer timeout when downloading (10 minutes), shorter for initialization (60s)
      const isDownloading = availability === 'downloadable' || availability === 'downloading'
      const timeoutMs = isDownloading ? 600000 : 60000
      const timeoutMessage = isDownloading
        ? 'Chrome AI model download timed out after 10 minutes.\n\n' +
          'The model is very large (~2GB). Try:\n' +
          '1. Check your internet connection\n' +
          '2. Check chrome://components/ for "Optimization Guide On Device Model" status\n' +
          '3. Configure an external AI provider (Anthropic, OpenAI) in Settings → AI Provider'
        : 'Chrome AI initialization timed out after 60 seconds.\n\n' +
          'Try:\n' +
          '1. Restart Chrome and try again\n' +
          '2. Check chrome://components/ for "Optimization Guide On Device Model" status\n' +
          '3. Configure an external AI provider (Anthropic, OpenAI) in Settings → AI Provider'

      this.session = await withTimeout(
        createSessionPromise,
        timeoutMs,
        timeoutMessage
      )

      // Check context window usage
      if ('contextWindow' in this.session && 'contextUsage' in this.session) {
        const usage = (this.session as any).contextUsage
        const window = (this.session as any).contextWindow
        debugAiChat(`Chrome AI context usage: ${usage}/${window} tokens (${Math.round((usage / window) * 100)}%)`)

        if (usage > window * 0.8) {
          debugAiChat('WARNING: System prompt uses >80% of context window. May cause issues with longer conversations.')
        }
      }

      debugAiChat('Chrome AI session created successfully')
      onProgress?.('AI session ready')
    } catch (error) {
      debugAiChat('Chrome AI initialization error:', error)

      if (error instanceof TimeoutError) {
        throw new ProviderError(
          error.message,
          'chrome-ai',
          'TIMEOUT'
        )
      }

      // Extract detailed error message
      const errorMessage = error instanceof Error ? error.message : String(error)
      debugAiChat('Chrome AI error message:', errorMessage)

      throw new ProviderError(
        `Failed to create Chrome AI session: ${errorMessage}\n\n` +
          'The flag is enabled but session creation failed. Try:\n' +
          '1. Restart Chrome completely\n' +
          '2. Check chrome://components/ for "Optimization Guide On Device Model" status\n' +
          '3. Configure an external AI provider (Anthropic, OpenAI) in Settings → AI Provider',
        'chrome-ai',
        'INITIALIZATION_FAILED'
      )
    }
  }

  getRateLimit(): RateLimitInfo | null {
    // Chrome Built-in AI has no explicit rate limits (runs locally)
    return null
  }

  getContextWindow(): ContextWindowInfo | null {
    if (!this.session) return null

    // Chrome AI exposes contextWindow and contextUsage properties
    if ('contextWindow' in this.session && 'contextUsage' in this.session) {
      const used = (this.session as any).contextUsage as number
      const total = (this.session as any).contextWindow as number
      const percentage = Math.round((used / total) * 100)

      return { used, total, percentage }
    }

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

    debugAiChat('Sending to Chrome Built-in AI:', {
      messageLength: message.length,
      historyLength: recentHistory.length,
    })

    let response: string
    try {
      response = await this.session.prompt(fullPrompt)
    } catch (error) {
      debugAiChat('Chrome AI error:', error)
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
