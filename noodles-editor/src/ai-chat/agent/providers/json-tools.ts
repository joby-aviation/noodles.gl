// Tool calling emulated through constrained JSON, for providers that cannot do it
// natively. Two of them now — Chrome's Prompt API (`responseConstraint`) and
// WebLLM (`response_format: {type: 'json_object', schema}`) — which is why the
// prompt, the schema and the parser live here rather than in either provider.
//
// The bargain: every turn asks for one JSON object naming at most one tool, and
// the provider turns that into the same tool_call event a native provider emits.
// The loop never learns the difference.
//
// Both hosts enforce the schema with a grammar, so malformed output is rare — but
// not impossible, since a model can also ignore a constraint the host declined to
// apply. parseAction treats unparseable output as an ordinary reply rather than an
// error, because a small model's plain-text answer is still an answer.

import type { AgentEvent, AgentMessage, AgentRequest, AgentTool } from '../types'

// Sentinel for "no tool this turn". An enum of strings is the most widely
// supported constraint shape there is; a nullable object property is not.
export const NO_TOOL = 'none'

// The constraint: one flat object. Nesting the tool input under the action would
// be tidier, but a flat enum plus a free-form object is the shape small models
// fill in correctly.
//
// `input` comes last. The grammar follows property order, and with `reply`
// required after it a model that has closed `input` and wants to write `}` is
// only allowed `,` or whitespace — so it pads with whitespace until max_tokens.
// Last, the next legal token after `input` is the `}` it was reaching for.
export function responseSchema(tools: AgentTool[]): object {
  return {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        enum: [NO_TOOL, ...tools.map(tool => tool.name)],
      },
      reply: { type: 'string' },
      input: { type: 'object' },
    },
    required: ['tool', 'reply'],
  }
}

export interface ParsedAction {
  tool: string | null
  input: Record<string, unknown>
  reply: string
  // Set when the action is a recovery rather than what the model meant to send
  fallback?: 'json_parse_fallback' | 'json_repaired' | 'unknown_tool'
  // The name the model asked for, when it was not one it was offered
  requestedTool?: string
}

// Exported for tests: everything about these providers that can go wrong at
// runtime goes wrong here.
export function parseAction(raw: string, tools: AgentTool[]): ParsedAction {
  const text = withoutThinking(raw)
  const unfenced = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  let parsed = parseJson(unfenced)
  let repaired = false
  if (!parsed) {
    // Output cut off by max_tokens: the tool and its input are usually complete
    // and only the closing braces are missing
    const closed = closeTruncated(unfenced)
    parsed = closed ? parseJson(closed) : null
    repaired = parsed !== null
  }
  if (!parsed) {
    // Constraint ignored, which happens. The text is still an answer.
    return { tool: null, input: {}, reply: text, fallback: 'json_parse_fallback' }
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply : ''
  const name = typeof parsed.tool === 'string' ? parsed.tool : NO_TOOL
  const recovered = repaired ? { fallback: 'json_repaired' as const } : {}

  // A name the model invented would come back from the loop as "Unknown tool",
  // costing a whole round-trip of a window this small to learn nothing
  if (name === NO_TOOL) return { tool: null, input: {}, reply, ...recovered }
  const known = tools.some(tool => tool.name === name)
  if (!known) return { tool: null, input: {}, reply, fallback: 'unknown_tool', requestedTool: name }

  return { tool: name, input: asRecord(parsed.input), reply, ...recovered }
}

// A reasoning model reaches for a thinking block whether or not there is room for
// one in the schema, and when the host applied no grammar there is nothing
// stopping it. Stripped before parsing and before falling back to the raw text,
// because a thought is not the answer either way.
export function diagnosticFor(action: ParsedAction): AgentEvent | null {
  if (!action.fallback) return null
  return { type: 'diagnostic', kind: action.fallback, detail: action.requestedTool }
}

function withoutThinking(raw: string): string {
  return raw.replace(/^\s*<think>[\s\S]*?<\/think>/, '').trim()
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

// Closes the strings, objects and arrays a truncated object left open. Null when
// nothing is open, because then the text is malformed some other way and closing
// it would only invent structure.
export function closeTruncated(text: string): string | null {
  const closers: string[] = []
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') closers.push('}')
    else if (ch === '[') closers.push(']')
    else if (ch === '}' || ch === ']') {
      if (closers.pop() !== ch) return null
    }
  }
  if (closers.length === 0) return null

  const closed = (inString ? `${text}"` : text.trimEnd())
    // A key with no value yet: a string after { or , rather than after :
    .replace(/([{,])\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, '$1')
    .replace(/,\s*$/, '')
  return closed + closers.reverse().join('')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// Everything the model needs that a native provider would get as structured
// fields: the tool schemas, and how to answer.
export function preamble(request: AgentRequest): string {
  const tools = request.tools
    .map(
      tool =>
        `- ${tool.name}: ${tool.description}\n  input: ${JSON.stringify(tool.inputSchema.properties)}`
    )
    .join('\n')

  return `${request.system}

You answer with a single JSON object and nothing else:
{"tool": "<tool name or ${NO_TOOL}>", "reply": "<what to say>", "input": {<arguments>}}

Call one tool at a time. Set "tool" to "${NO_TOOL}" once you have what you need, and put the answer in "reply". When you do call a tool, "reply" should say briefly what you are checking.

Tools:
${tools}`
}

// One AgentMessage as a single line of plain text. Neither host takes structured
// tool blocks, so a tool call and its result have to read as narration. Used by
// Chrome as the identity of a message when diffing a transcript against what its
// session already holds, so it has to stay a pure function of the message.
export function serializeMessage(message: AgentMessage): string {
  const lines: string[] = []

  for (const part of message.content) {
    switch (part.type) {
      case 'text':
        lines.push(part.text)
        break
      case 'tool_use':
        lines.push(`Called ${part.name} with ${JSON.stringify(part.input)}`)
        break
      case 'tool_result':
        lines.push(`Result${part.isError ? ' (error)' : ''}: ${part.content}`)
        break
      // Images cannot be sent, and a provider_block from another provider is
      // meaningless here
      default:
        break
    }
  }

  return lines.join('\n')
}

// Keeps the first user turn (the task) and the most recent exchanges, dropping
// the middle — the same shape as compaction, minus the summary, because
// summarising costs another round-trip through the model that just ran out of room.
export function trimTranscript(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= 3) return messages.slice(-1)
  return [messages[0], ...messages.slice(-2)]
}
