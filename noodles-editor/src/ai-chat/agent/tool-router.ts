// Progressive tool disclosure.
//
// Sending every tool schema on every request costs tokens the small-model
// providers cannot spare, but hiding tools outright (the old `exposeToChat:
// false` flag) meant the chat could never reach the docs, examples, or code
// search tools at all. Instead the model always gets a small always-on tier
// plus `find_tools`, which it calls to unlock the rest on demand.
//
// `find_tools` is harness machinery rather than a Noodles capability, so it is
// defined here and not in tool-definitions.ts — external MCP clients do their
// own tool discovery and keep seeing the full surface via src/webmcp.

import { type ToolDefinition, type ToolInputSchema, toolDefinitions } from '../tool-definitions'
import type { ToolResult } from '../types'

export const FIND_TOOLS_NAME = 'find_tools'

// Always sent. Enough to inspect the graph and act on it without a lookup, so
// the common "change this node" request needs no discovery round-trip.
export const TIER0_TOOL_NAMES: readonly string[] = [
  'list_nodes',
  'get_node_info',
  'get_node_output',
  'apply_modifications',
  FIND_TOOLS_NAME,
]

// Below this the model cannot afford many schemas at once, so the unlocked set
// is kept to a couple of tools and older unlocks are evicted.
const SMALL_CONTEXT_TOKENS = 16_000
const MEDIUM_CONTEXT_TOKENS = 100_000

const SMALL_MAX_UNLOCKED = 2
const MEDIUM_MAX_UNLOCKED = 6

export const FIND_TOOLS_DEFINITION: {
  name: string
  description: string
  inputSchema: ToolInputSchema
} = {
  name: FIND_TOOLS_NAME,
  description:
    'Look up additional tools by capability and unlock them for use. Returns full input schemas for the best matches. Use this before saying a capability is unavailable — tools exist for searching source code, reading documentation, listing and fetching example projects, reading operator schemas, capturing screenshots, reading console errors, and editing the animation timeline.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What you need to do, in a few words (e.g. "read the docs", "search source code", "animation keyframes", "screenshot").',
      },
      limit: { type: 'number', description: 'Maximum tools to return (default 3, max 8)' },
    },
    required: ['query'],
  },
}

// How many non-tier-0 tools may be unlocked at once for a given window size
export function maxUnlockedTools(contextWindowTokens: number): number {
  if (contextWindowTokens < SMALL_CONTEXT_TOKENS) return SMALL_MAX_UNLOCKED
  if (contextWindowTokens < MEDIUM_CONTEXT_TOKENS) return MEDIUM_MAX_UNLOCKED
  return Number.POSITIVE_INFINITY
}

export interface RoutedTool {
  name: string
  description: string
  inputSchema: ToolInputSchema
}

// A tool the harness owns rather than MCPTools: it needs something the tool
// definitions have no access to, like the provider or an API key. web_search is
// the first. Discoverable and unlockable exactly like the rest, so the model
// cannot tell the difference.
export interface HarnessTool extends RoutedTool {
  readOnly: boolean
  execute: (input: Record<string, unknown>) => Promise<ToolResult> | ToolResult
}

// Per-conversation tool selection state. One router instance lives as long as
// the conversation, so tools unlocked on an earlier turn stay available.
export class ToolRouter {
  // Insertion-ordered so eviction is FIFO
  private unlocked = new Set<string>()
  private harnessTools: Map<string, HarnessTool>

  constructor(
    private contextWindowTokens: number,
    harnessTools: HarnessTool[] = []
  ) {
    this.harnessTools = new Map(harnessTools.map(tool => [tool.name, tool]))
  }

  // The tool list to send with the next request
  getTools(): RoutedTool[] {
    const tools: RoutedTool[] = []
    for (const name of TIER0_TOOL_NAMES) {
      if (name === FIND_TOOLS_NAME) {
        tools.push(FIND_TOOLS_DEFINITION)
        continue
      }
      const tool = this.lookup(name)
      if (tool) tools.push(tool)
    }
    for (const name of this.unlocked) {
      const tool = this.lookup(name)
      if (tool) tools.push(tool)
    }
    return tools
  }

  isCallable(name: string): boolean {
    return name === FIND_TOOLS_NAME || TIER0_TOOL_NAMES.includes(name) || this.unlocked.has(name)
  }

  // The loop dispatches to this before consulting the tool definitions
  getHarnessTool(name: string): HarnessTool | undefined {
    return this.harnessTools.get(name)
  }

  getUnlocked(): string[] {
    return [...this.unlocked]
  }

  // Handles a find_tools call: scores the full surface, unlocks the winners,
  // and returns their schemas so the model can call them immediately.
  findTools(params: { query?: unknown; limit?: unknown }): ToolResult {
    const query = typeof params.query === 'string' ? params.query.trim() : ''
    if (!query) {
      return { success: false, error: 'find_tools requires a non-empty query' }
    }

    const requested = typeof params.limit === 'number' ? params.limit : 3
    const limit = Math.max(1, Math.min(8, Math.floor(requested)))

    const matches = scoreTools(query, [...this.harnessTools.values()]).slice(0, limit)
    if (matches.length === 0) {
      return {
        success: true,
        data: {
          query,
          matches: [],
          message: 'No tool matches that capability. Work with the tools you already have.',
        },
      }
    }

    for (const match of matches) this.unlock(match.name)

    return {
      success: true,
      data: {
        query,
        unlocked: matches.map(m => m.name),
        tools: matches.map(m => m.tool),
        message: 'These tools are now callable.',
      },
    }
  }

  private lookup(name: string): RoutedTool | undefined {
    const harness = this.harnessTools.get(name)
    if (harness) return toRoutedHarness(harness)
    const definition = findDefinition(name)
    return definition ? toRouted(definition) : undefined
  }

  private unlock(name: string) {
    // Re-inserting refreshes FIFO position
    this.unlocked.delete(name)
    this.unlocked.add(name)

    const max = maxUnlockedTools(this.contextWindowTokens)
    while (this.unlocked.size > max) {
      const oldest = this.unlocked.values().next().value
      if (oldest === undefined) break
      this.unlocked.delete(oldest)
    }
  }
}

export interface ToolMatch {
  name: string
  score: number
  tool: RoutedTool
}

// Keyword scoring over tool names and descriptions. Deliberately not embeddings:
// the surface is ~22 tools with descriptive names, and a lexical match keeps
// this synchronous and dependency-free.
export function scoreTools(query: string, harnessTools: HarnessTool[] = []): ToolMatch[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []

  const candidates: RoutedTool[] = [
    ...toolDefinitions.map(toRouted),
    ...harnessTools.map(toRoutedHarness),
  ]

  const matches: ToolMatch[] = []
  for (const candidate of candidates) {
    // Tier 0 tools are already in the list; returning them wastes the response
    if (TIER0_TOOL_NAMES.includes(candidate.name)) continue

    const name = candidate.name.toLowerCase()
    const nameWords = new Set(tokenize(candidate.name))
    const description = candidate.description.toLowerCase()

    let score = 0
    for (const term of terms) {
      // Prefix matching, not equality, so "keyframes" still counts as a name hit
      // on set_keyframe. Plurals and gerunds are how people phrase these queries,
      // and treating them as near-misses buried the exact tool being asked for.
      if (nameWords.has(term) || [...nameWords].some(word => sharePrefix(word, term))) {
        score += 4
      } else if (name.includes(term)) {
        score += 3
      }
      if (description.includes(term)) score += 1
      // Crude stem match so "documentation" hits "docs" and "searching" hits "search"
      if (
        term.length > 4 &&
        (name.includes(term.slice(0, 4)) || description.includes(term.slice(0, 4)))
      ) {
        score += 1
      }
    }

    if (score > 0) matches.push({ name: candidate.name, score, tool: candidate })
  }

  // Stable tie-break by name so results are deterministic across runs
  return matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'for',
  'in',
  'on',
  'and',
  'or',
  'i',
  'my',
  'me',
  'is',
  'it',
  'how',
  'do',
  'can',
  'get',
  'need',
  'want',
  'with',
  'tool',
  'tools',
])

// True when one word is a prefix of the other and the shared prefix is long
// enough to be meaningful, which covers singular/plural and verb-form pairs
// without pulling in a stemmer.
function sharePrefix(a: string, b: string): boolean {
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  return shorter.length >= 4 && longer.startsWith(shorter)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 1 && !STOP_WORDS.has(term))
}

function findDefinition(name: string): ToolDefinition | undefined {
  return toolDefinitions.find(d => d.name === name)
}

function toRouted(definition: ToolDefinition): RoutedTool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
  }
}

// Drops the executor so what goes over the wire is only ever the schema
function toRoutedHarness(tool: HarnessTool): RoutedTool {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema }
}
