// A chat session: owns the pieces that outlive one turn — the tool router's
// disclosure state, the history window, compaction — and hands the rest to
// runAgent.
//
// This is what the UI talks to. Swapping providers means constructing a session
// with a different one; nothing else changes.

import { debugAiChat } from '../../utils/debug'
import {
  compactConversation,
  compactionThreshold,
  estimateConversationTokens,
  shouldCompact,
} from '../conversation-compaction'
import type { MCPTools } from '../mcp-tools'
// Only the core prompt is always in context. The workflow walkthroughs live in
// prompts/sections/ and reach the model through get_documentation on demand.
import systemPromptTemplate from '../prompts/core.md?raw'
import type { ClaudeResponse, Message } from '../types'
import { runAgent } from './loop'
import { createDelegateTool } from './subagent'
import { ToolRouter } from './tool-router'
import type { AgentContent, AgentEvent, AgentMessage, AgentProvider } from './types'
import { createWebSearchTool, type WebSearchConfig } from './web-search'

// Turns beyond this are dropped before compaction even looks at the history
const MAX_HISTORY_MESSAGES = 10

const MAX_TOKENS = 8192

export interface SendParams {
  message: string
  // Attached to the outgoing turn only, never replayed into history
  screenshot?: string
  screenshotFormat?: 'png' | 'jpeg'
  conversationHistory?: Message[]
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}

export interface SessionOptions {
  // Enables web_search when the provider supports it. Omitted, the tool is not
  // offered at all, so the model never promises a search it cannot run.
  webSearch?: WebSearchConfig | null
}

export class AgentSession {
  private provider: AgentProvider
  private tools: MCPTools
  // Lives as long as the session so tools unlocked on one turn stay available
  private router: ToolRouter

  constructor(provider: AgentProvider, tools: MCPTools, options: SessionOptions = {}) {
    this.provider = provider
    this.tools = tools

    const webSearch = options.webSearch ? createWebSearchTool(options.webSearch) : null
    const childTools = webSearch ? [webSearch] : []
    // The sub-agent runs on the same provider by default; pointing it at a
    // cheaper one is a change here and nowhere else.
    const delegate = createDelegateTool({ provider, tools, harnessTools: childTools })

    this.router = new ToolRouter(provider.contextWindow, [...childTools, delegate])
  }

  async send(params: SendParams): Promise<ClaudeResponse> {
    const history = await this.prepareHistory(params.conversationHistory ?? [])

    const userContent: AgentContent[] = [{ type: 'text', text: params.message }]
    if (params.screenshot && this.provider.supportsImages) {
      userContent.push({
        type: 'image',
        mediaType: `image/${params.screenshotFormat ?? 'jpeg'}`,
        data: params.screenshot,
      })
    }

    const messages: AgentMessage[] = [
      ...history.map(toAgentMessage),
      { role: 'user', content: userContent },
    ]

    const result = await runAgent({
      provider: this.provider,
      tools: this.tools,
      router: this.router,
      systemPrompt: systemPromptTemplate,
      messages,
      maxTokens: MAX_TOKENS,
      signal: params.signal,
      onEvent: params.onEvent,
    })

    debugAiChat(
      '[session] %d step(s), %d tool call(s), %d in / %d out tokens, stop=%s',
      result.steps,
      result.toolCalls.length,
      result.usage.inputTokens,
      result.usage.outputTokens,
      result.stopReason
    )

    return {
      message: result.text,
      projectModifications: result.modifications,
      toolCalls: result.toolCalls,
      usage: result.usage,
    }
  }

  private async prepareHistory(conversationHistory: Message[]): Promise<Message[]> {
    const limited = conversationHistory.slice(-MAX_HISTORY_MESSAGES)
    const threshold = compactionThreshold(this.provider.contextWindow)

    if (!shouldCompact(limited, threshold)) return limited

    debugAiChat(
      '[session] compacting history at ~%d tokens (threshold %d)',
      estimateConversationTokens(limited),
      threshold
    )

    try {
      return await compactConversation(this.provider, limited, 2)
    } catch (error) {
      debugAiChat('[session] compaction failed, truncating instead: %o', error)
      return conversationHistory.slice(-4)
    }
  }
}

// History replays as plain text, so images and tool plumbing from earlier turns
// never come back — which is the point: re-sending a screenshot every turn was
// the single largest avoidable cost in the old client. What the assistant did
// comes back as a one-line note per call instead of the real blocks, which costs
// tens of tokens rather than the kilobytes the results themselves would.
function toAgentMessage(message: Message): AgentMessage {
  const text = [flattenContent(message.content), describeToolUses(message.toolUses)]
    .filter(Boolean)
    .join('\n')

  return { role: message.role, content: [{ type: 'text', text }] }
}

const MAX_PARAM_CHARS = 60

export function describeToolUses(toolUses: Message['toolUses']): string {
  if (!toolUses || toolUses.length === 0) return ''
  const calls = toolUses.map(
    use => `${use.name}(${describeParams(use.params)})${use.ok ? '' : ' — failed'}`
  )
  return `[tools used: ${calls.join(', ')}]`
}

function describeParams(params: Record<string, unknown> | undefined): string {
  if (!params) return ''
  return Object.entries(params)
    .map(([key, value]) => `${key}=${clip(JSON.stringify(value) ?? String(value))}`)
    .join(', ')
}

function clip(value: string): string {
  return value.length > MAX_PARAM_CHARS ? `${value.slice(0, MAX_PARAM_CHARS)}…` : value
}

function flattenContent(content: Message['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  return content
    .filter(part => part?.type === 'text')
    .map(part => part.text ?? '')
    .join('\n')
}
