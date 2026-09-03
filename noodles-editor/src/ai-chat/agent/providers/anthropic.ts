// The Anthropic provider: wraps @anthropic-ai/sdk and maps its streaming events
// onto AgentEvent.
//
// This stays the default whenever an anthropic key is present, because it is the
// only provider that can put cache_control on the system prompt — on a long
// conversation the cached prefix is most of the bill.

import Anthropic from '@anthropic-ai/sdk'
import type { AgentContent, AgentEvent, AgentProvider, AgentRequest, StopReason } from '../types'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5'

// Opus 5 and Sonnet 5 both accept 1M tokens, but pricing steps up past 200k and
// the router's disclosure budget should not plan around a window this chat will
// never approach. 200k is the number the budgets are tuned against.
const CONTEXT_WINDOW = 200_000

interface AnthropicProviderOptions {
  apiKey: string
  model?: string
}

// One in-flight content block, keyed by the index the SDK streams deltas under
type BlockAccumulator =
  | { kind: 'text' }
  | { kind: 'tool_use'; id: string; name: string; json: string }
  | { kind: 'thinking'; thinking: string; signature: string }
  | { kind: 'other'; block: Anthropic.ContentBlock }

export class AnthropicProvider implements AgentProvider {
  readonly id = 'anthropic' as const
  readonly model: string
  readonly supportsNativeTools = true
  readonly supportsImages = true
  readonly contextWindow = CONTEXT_WINDOW

  private client: Anthropic

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL
    this.client = new Anthropic({ apiKey: options.apiKey, dangerouslyAllowBrowser: true })
  }

  async *stream(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    let stream: Awaited<ReturnType<typeof this.client.messages.create>>
    try {
      stream = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: request.maxTokens,
          // The prompt is stable across every turn of every conversation, so one
          // breakpoint here is the single highest-value cache placement available
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: request.messages.map(message => toSdkMessage(message)),
          tools: request.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
          })),
          stream: true,
        },
        { signal }
      )
    } catch (error) {
      if (isAbort(error, signal)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      throw error
    }

    const blocks = new Map<number, BlockAccumulator>()
    let stopReason: StopReason = 'end_turn'
    let inputTokens = 0
    let outputTokens = 0
    let cachedInputTokens = 0
    let refusalNote = ''

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start': {
            const usage = event.message.usage
            inputTokens = usage.input_tokens
            cachedInputTokens =
              (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
            break
          }

          case 'content_block_start': {
            const block = event.content_block
            if (block.type === 'tool_use') {
              blocks.set(event.index, {
                kind: 'tool_use',
                id: block.id,
                name: block.name,
                json: '',
              })
            } else if (block.type === 'text') {
              blocks.set(event.index, { kind: 'text' })
            } else if (block.type === 'thinking') {
              blocks.set(event.index, { kind: 'thinking', thinking: '', signature: '' })
            } else {
              // redacted_thinking and anything the SDK adds later arrive whole
              blocks.set(event.index, { kind: 'other', block })
            }
            break
          }

          case 'content_block_delta': {
            const accumulator = blocks.get(event.index)
            const delta = event.delta
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text }
            } else if (delta.type === 'input_json_delta' && accumulator?.kind === 'tool_use') {
              // Arguments arrive as string fragments; parse once, at block stop
              accumulator.json += delta.partial_json
            } else if (delta.type === 'thinking_delta' && accumulator?.kind === 'thinking') {
              accumulator.thinking += delta.thinking
            } else if (delta.type === 'signature_delta' && accumulator?.kind === 'thinking') {
              accumulator.signature += delta.signature
            }
            break
          }

          case 'content_block_stop': {
            const accumulator = blocks.get(event.index)
            blocks.delete(event.index)
            if (!accumulator) break

            if (accumulator.kind === 'tool_use') {
              yield {
                type: 'tool_call',
                id: accumulator.id,
                name: accumulator.name,
                input: parseToolInput(accumulator.json),
              }
            } else if (accumulator.kind === 'thinking') {
              yield {
                type: 'provider_block',
                provider: this.id,
                block: {
                  type: 'thinking',
                  thinking: accumulator.thinking,
                  signature: accumulator.signature,
                },
              }
            } else if (accumulator.kind === 'other') {
              yield { type: 'provider_block', provider: this.id, block: accumulator.block }
            }
            break
          }

          case 'message_delta': {
            stopReason = mapStopReason(event.delta.stop_reason)
            outputTokens = event.usage.output_tokens
            // A policy decline is a 200 with no text, so surface the reason or the
            // user watches an empty bubble and assumes the app broke
            if (event.delta.stop_reason === 'refusal') {
              refusalNote = 'The model declined to answer this request.'
            }
            break
          }
        }
      }
    } catch (error) {
      if (isAbort(error, signal)) {
        yield { type: 'stop', reason: 'aborted' }
        return
      }
      throw error
    }

    if (refusalNote) yield { type: 'text_delta', text: refusalNote }

    yield {
      type: 'usage',
      usage: {
        inputTokens,
        outputTokens,
        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
      },
    }
    yield { type: 'stop', reason: stopReason }
  }
}

function mapStopReason(reason: Anthropic.Message['stop_reason']): StopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'refusal':
      return 'error'
    default:
      return 'end_turn'
  }
}

// A malformed fragment stream would otherwise throw here and lose the whole turn.
// An empty object lets the tool run and report its own validation error, which the
// model can act on.
function parseToolInput(json: string): Record<string, unknown> {
  if (!json.trim()) return {}
  try {
    const parsed = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

function toSdkMessage(message: {
  role: 'user' | 'assistant'
  content: AgentContent[]
}): Anthropic.MessageParam {
  return {
    role: message.role,
    content: message.content.flatMap(part => toSdkBlocks(part)),
  }
}

function toSdkBlocks(part: AgentContent): Anthropic.ContentBlockParam[] {
  switch (part.type) {
    case 'text':
      return [{ type: 'text', text: part.text }]

    case 'image':
      return [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: part.mediaType as 'image/png' | 'image/jpeg',
            data: part.data,
          },
        },
      ]

    case 'tool_use':
      return [{ type: 'tool_use', id: part.id, name: part.name, input: part.input }]

    case 'tool_result':
      return [
        {
          type: 'tool_result',
          tool_use_id: part.toolUseId,
          content: part.content,
          ...(part.isError ? { is_error: true } : {}),
        },
      ]

    case 'provider_block':
      // Another provider's block means the conversation was continued on a
      // different model. Dropping it is correct: thinking blocks are bound to the
      // model that produced them and replaying a foreign one is a 400.
      return part.provider === 'anthropic' ? [part.block as Anthropic.ContentBlockParam] : []
  }
}
