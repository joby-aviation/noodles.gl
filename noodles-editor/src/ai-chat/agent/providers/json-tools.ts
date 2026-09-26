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

import type { AgentMessage, AgentRequest, AgentTool } from '../types'

// Sentinel for "no tool this turn". An enum of strings is the most widely
// supported constraint shape there is; a nullable object property is not.
export const NO_TOOL = 'none'

// Each branch binds one tool name to that tool's exact argument schema. This
// prevents a constrained decoder from producing a syntactically valid action
// whose arguments belong to a different tool.
export function responseSchema(tools: AgentTool[]): object {
  return {
    oneOf: [
      {
        type: 'object',
        properties: {
          tool: { const: NO_TOOL },
          reply: { type: 'string' },
        },
        required: ['tool', 'reply'],
        additionalProperties: false,
      },
      ...tools.map(tool => ({
        type: 'object',
        properties: {
          tool: { const: tool.name },
          input: { ...tool.inputSchema, additionalProperties: false },
          reply: { type: 'string' },
        },
        required: ['tool', 'input', 'reply'],
        additionalProperties: false,
      })),
    ],
  }
}

export interface ParsedAction {
  tool: string | null
  input: Record<string, unknown>
  reply: string
}

// Exported for tests: everything about these providers that can go wrong at
// runtime goes wrong here.
export function parseAction(raw: string, tools: AgentTool[]): ParsedAction {
  const text = withoutThinking(raw)
  const parsed = parseJson(text)
  if (!parsed) {
    // Constraint ignored, which happens. The text is still an answer.
    return { tool: null, input: {}, reply: text }
  }

  const reply = typeof parsed.reply === 'string' ? parsed.reply : ''
  const name = typeof parsed.tool === 'string' ? parsed.tool : NO_TOOL

  // A name the model invented would come back from the loop as "Unknown tool",
  // costing a whole round-trip of a window this small to learn nothing
  const known = tools.some(tool => tool.name === name)
  if (name === NO_TOOL || !known) return { tool: null, input: {}, reply }

  return { tool: name, input: asRecord(parsed.input), reply }
}

// A reasoning model reaches for a thinking block whether or not there is room for
// one in the schema, and when the host applied no grammar there is nothing
// stopping it. Stripped before parsing and before falling back to the raw text,
// because a thought is not the answer either way.
function withoutThinking(raw: string): string {
  return raw.replace(/^\s*<think>[\s\S]*?<\/think>/, '').trim()
}

function parseJson(text: string): Record<string, unknown> | null {
  // Some builds wrap constrained output in a fence anyway
  const unfenced = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(unfenced)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
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
{"tool": "<tool name or ${NO_TOOL}>", "input": {<arguments>}, "reply": "<what to say>"}

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
