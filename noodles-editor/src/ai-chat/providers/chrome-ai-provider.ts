import type { ProjectModification } from '../../noodles/hooks/use-project-modifications'
import { getOpStore } from '../../noodles/store'
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
    monitor?: (monitor: {
      addEventListener: (type: string, callback: (e: DownloadProgressEvent) => void) => void
    }) => void
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
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
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
      onProgress?.('Triggering AI model download...')
    } else if (availability === 'downloading') {
      // Model is already downloading in background
      debugAiChat('Model is downloading, this should complete soon or timeout after 10 minutes')
      onProgress?.('Waiting for AI model download to complete...')
    } else if (availability === 'available') {
      debugAiChat('Model is already available, creating session immediately')
      onProgress?.('Initializing AI session...')
    } else {
      debugAiChat('Unknown availability state:', availability)
      onProgress?.('Creating AI session...')
    }

    // Create session with system prompt (with timeout and progress monitoring)
    try {
      debugAiChat('Creating Chrome AI session with options:', {
        availability,
        hasProgress: !!onProgress,
      })

      // Create options with expectedOutputs to satisfy Chrome AI requirements
      const createOptions = {
        systemPrompt: this.getSimplifiedSystemPrompt(),
        temperature: 0.7,
        topK: 40,
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        monitor: (m: any) => {
          debugAiChat('Monitor callback fired, monitor object:', m)
          debugAiChat('Monitor addEventListener type:', typeof m.addEventListener)

          if (m && typeof m.addEventListener === 'function') {
            debugAiChat('Setting up downloadprogress event listener')
            m.addEventListener('downloadprogress', (e: any) => {
              const percent = Math.round((e.loaded / e.total) * 100)
              debugAiChat(`Download progress event: ${percent}% (${e.loaded}/${e.total})`)
              onProgress?.(`Downloading AI model: ${percent}%`)
            })
            debugAiChat('Event listener registered')
          } else {
            debugAiChat('WARNING: Monitor does not have addEventListener method!')
          }
        },
      }
      debugAiChat('Calling LanguageModel.create() with:', Object.keys(createOptions))
      onProgress?.('Creating Chrome AI session...')

      // Log the actual call to create
      debugAiChat('About to call LanguageModel.create()...')
      const startTime = Date.now()
      const createSessionPromise = (LanguageModel as any).create(createOptions)
      debugAiChat('LanguageModel.create() returned a promise')

      // Check if the promise resolves or rejects quickly
      createSessionPromise.then(
        (session: any) => {
          const elapsed = Date.now() - startTime
          debugAiChat(`Promise resolved after ${elapsed}ms`)
        },
        (error: any) => {
          const elapsed = Date.now() - startTime
          debugAiChat(`Promise rejected after ${elapsed}ms:`, error)
        }
      )

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

      debugAiChat(`Waiting for session creation with ${timeoutMs}ms timeout...`)

      // Add a heartbeat to detect if we're actually stuck
      const heartbeat = setInterval(() => {
        debugAiChat('Still waiting for session... (heartbeat)')
      }, 5000)

      try {
        this.session = await withTimeout(createSessionPromise, timeoutMs, timeoutMessage)
        clearInterval(heartbeat)
        debugAiChat('Session created successfully!')
      } catch (error) {
        clearInterval(heartbeat)
        debugAiChat('Session creation failed or timed out:', error)
        throw error
      }

      // Check context window usage
      if ('contextWindow' in this.session && 'contextUsage' in this.session) {
        const usage = (this.session as any).contextUsage
        const window = (this.session as any).contextWindow
        debugAiChat(
          `Chrome AI context usage: ${usage}/${window} tokens (${Math.round((usage / window) * 100)}%)`
        )

        if (usage > window * 0.8) {
          debugAiChat(
            'WARNING: System prompt uses >80% of context window. May cause issues with longer conversations.'
          )
        }
      }

      debugAiChat('Chrome AI session created successfully')
      onProgress?.('AI session ready')
    } catch (error) {
      debugAiChat('Chrome AI initialization error:', error)

      if (error instanceof TimeoutError) {
        throw new ProviderError(error.message, 'chrome-ai', 'TIMEOUT')
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
      throw new ProviderError('Chrome AI session not initialized', 'chrome-ai', 'NOT_INITIALIZED')
    }

    // Build conversation context (Chrome AI doesn't maintain history)
    // Keep it short since context window is smaller (~4K tokens)
    const recentHistory = conversationHistory.slice(-4)
    const contextMessages = recentHistory
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${this.stripImages(m.content)}`)
      .join('\n\n')

    // Inject current project context (Chrome AI can't call tools to discover this)
    const projectContext = this.buildProjectContext()

    const fullPrompt = contextMessages
      ? `${contextMessages}${projectContext}\n\nUser: ${message}\n\nAssistant:`
      : `${projectContext}\n\nUser: ${message}\n\nAssistant:`

    debugAiChat('Sending to Chrome Built-in AI:', {
      messageLength: message.length,
      historyLength: recentHistory.length,
      projectContextLength: projectContext.length,
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
    return `You are an AI assistant for Noodles.gl. When asked to change the project, COPY this format EXACTLY:

TEMPLATE (copy this):
\`\`\`json
[{"type":"update_node","data":{"id":"/node-name","data":{"inputs":{"paramName":"value"}}}}]
\`\`\`

Field names you MUST use: "type", "data", "id", "inputs"
Never use: "Op", "Name", "Color", "operation", "node", "property"

EXAMPLE 1:
Request: Change color to red
Response: Changing color:
\`\`\`json
[{"type":"update_node","data":{"id":"/pickup-color","data":{"inputs":{"color":"#ff0000"}}}}]
\`\`\`

EXAMPLE 2:
Request: Set radius to 50
Response: Setting radius:
\`\`\`json
[{"type":"update_node","data":{"id":"/layer","data":{"inputs":{"radius":50}}}}]
\`\`\`

WRONG - DO NOT USE:
\`\`\`json
[{"Op":"ColorOp","Name":"/pickup","Color":"#ff0000"}]
\`\`\`

Always include text before the JSON block.`
  }

  // Build concise project context summary for Chrome AI
  private buildProjectContext(): string {
    const project = this.tools.getProject()
    if (!project || !project.nodes || project.nodes.length === 0) {
      return ''
    }

    const opStore = getOpStore()
    const nodeDescriptions: string[] = []

    // Limit to 30 nodes to avoid context overflow
    const maxNodes = 30
    const nodes = project.nodes.slice(0, maxNodes)

    for (const node of nodes) {
      const op = opStore.getOp(node.id)
      if (!op) continue

      // Basic node info
      let desc = `- ${node.id} (${node.type})`

      // Add brief description based on type
      if (node.type === 'FileOp') {
        const url = op.inputs.url?.value
        if (url) {
          const filename = typeof url === 'string' ? url.split('/').pop() : url
          desc += ` - loads ${filename}`
        }
      } else if (node.type.includes('LayerOp')) {
        desc += ' - visualization layer'
      } else if (node.type === 'DeckRendererOp') {
        desc += ' - main output'
      } else if (node.type === 'MaplibreBasemapOp') {
        desc += ' - base map'
      } else if (node.type === 'ColorOp') {
        const color = op.inputs.color?.value
        if (color) desc += ` - color: ${color}`
      } else if (node.type === 'AccessorOp') {
        desc += ' - data accessor'
      } else if (node.type === 'CodeOp') {
        desc += ' - custom code'
      } else if (node.type === 'DuckDbOp') {
        desc += ' - SQL query'
      }

      // Add incoming connections for layers (most important for context)
      if (node.type.includes('LayerOp')) {
        const edges = project.edges?.filter(e => e.target === node.id)
        if (edges && edges.length > 0) {
          const connections = edges
            .slice(0, 5) // Limit connections shown
            .map(e => {
              const fieldName = e.targetHandle?.replace('par.', '') || 'input'
              return `${fieldName} from ${e.source}`
            })
            .join(', ')
          desc += `, connected: ${connections}`
        }
      }

      nodeDescriptions.push(desc)
    }

    let context = '\n\n--- PROJECT GRAPH (for reference) ---\n' + nodeDescriptions.join('\n')

    // Add truncation note if needed
    if (project.nodes.length > maxNodes) {
      context += `\n... and ${project.nodes.length - maxNodes} more nodes`
    }

    context += '\n--- END PROJECT GRAPH ---\n'

    return context
  }

  private extractProjectModifications(text: string): ProjectModification[] {
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/g
    const matches = [...text.matchAll(jsonBlockRegex)]

    for (const match of matches) {
      try {
        const json = JSON.parse(match[1])
        debugAiChat('Chrome AI JSON parsed:', json)
        const modifications = parseModifications(json)
        if (modifications && modifications.length > 0) {
          debugAiChat('Chrome AI extracted modifications:', modifications)
          return modifications as ProjectModification[]
        } else {
          debugAiChat(
            'Chrome AI: parseModifications returned no valid modifications. JSON may be in wrong format:',
            json
          )
        }
      } catch (e) {
        debugAiChat('Chrome AI: Failed to parse JSON from code block:', match[1], e)
      }
    }

    if (matches.length === 0) {
      debugAiChat('Chrome AI: No JSON code blocks found in response')
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
