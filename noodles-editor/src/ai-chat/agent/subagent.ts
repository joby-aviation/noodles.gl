// The delegate tool: run a nested agent loop and return only its answer.
//
// This is a context play, not a capability one. "Which example animates arcs"
// costs several search_code results — each one an array of source-line context —
// to answer, and two lines to report. Answering it in a child loop keeps every
// one of those results out of the parent transcript; only the final text comes
// back. The child also gets a narrowed tool surface, so a research question
// cannot end up editing the graph.

import { debugAiChat } from '../../utils/debug'
import type { MCPTools } from '../mcp-tools'
import type { ToolResult } from '../types'
import { runAgent } from './loop'
import { type HarnessTool, type HarnessToolContext, ToolRouter } from './tool-router'
import type { AgentProvider } from './types'

export const DELEGATE_NAME = 'delegate'

// A sub-agent may not spawn its own. One level buys the whole context win, and a
// browser tab cannot afford recursive fan-out.
export const MAX_DEPTH = 1

const SUBAGENT_MAX_STEPS = 8
const SUBAGENT_MAX_TOKENS = 4096

export type Toolset = 'research' | 'inspect' | 'build'

// Named tool subsets rather than "all tools minus a deny list": a new mutating
// tool should not silently become available to a research agent.
const TOOLSETS: Record<Toolset, readonly string[]> = {
  research: [
    'search_code',
    'get_source_code',
    'find_symbol',
    'get_documentation',
    'get_operator_schema',
    'list_operators',
    'list_examples',
    'get_example',
    'web_search',
  ],
  inspect: [
    'list_nodes',
    'get_node_info',
    'get_node_output',
    'get_current_project',
    'analyze_project',
    'get_console_errors',
    'get_render_stats',
    'inspect_layer',
    'capture_visualization',
    'get_timeline',
  ],
  build: [
    'list_nodes',
    'get_node_info',
    'get_node_output',
    'get_operator_schema',
    'get_documentation',
    'search_code',
    'get_timeline',
    'apply_modifications',
    'set_keyframe',
    'delete_keyframe',
  ],
}

const BASE_PROMPT = `You are a sub-agent working inside Noodles.gl, a node-based editor for geospatial visualizations. Another agent has handed you one task and is waiting on the answer.

Use your tools to settle the question, then reply with the answer alone: no preamble, no restatement of the task, no offer to do more. Be concrete — node ids, operator names, file paths, field names. Stay under 200 words; the agent that called you pays for every one of them. If you cannot answer, say what you tried and what was missing.`

const PROMPTS: Record<Toolset, string> = {
  research: `${BASE_PROMPT}

Your tools read the codebase, the operator registry, the documentation, and the example projects. You cannot see or change the user's project, so answer in general terms the caller can apply.`,
  inspect: `${BASE_PROMPT}

Your tools read the user's live project and the running visualization. You cannot change anything — report what you find, including which node is at fault when something is broken.`,
  build: `${BASE_PROMPT}

Your tools can change the user's project. Make the smallest set of changes that accomplishes the task, verify handle names with get_operator_schema before wiring edges, and report exactly what you changed.`,
}

const DESCRIPTION = `Hand a self-contained sub-task to a fresh agent and get back only its conclusion. Use this when answering something would take several large tool results that you do not need to keep — searching the codebase, hunting through example projects, or auditing a big graph. Pick a toolset: "research" (code, docs, operator schemas, examples — cannot see the user's project), "inspect" (read the live project and rendering, cannot change it), or "build" (read and modify the project). State the task in full; the sub-agent sees nothing of this conversation.`

const INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    task: {
      type: 'string',
      description:
        'The complete task, self-contained. The sub-agent has none of your context, so name the nodes, files, or operators involved.',
    },
    toolset: {
      type: 'string',
      enum: ['research', 'inspect', 'build'],
      description: 'Which tools the sub-agent gets. Defaults to research.',
    },
  },
  required: ['task'],
}

export interface DelegateOptions {
  // The parent's provider by default; a cheaper one is a config change, not new
  // plumbing
  provider: AgentProvider
  tools: MCPTools
  // Harness tools the child may use, e.g. web_search. delegate is deliberately
  // not among them — MAX_DEPTH refuses it anyway, and not offering it is clearer.
  harnessTools?: HarnessTool[]
}

export function createDelegateTool(options: DelegateOptions): HarnessTool {
  return {
    name: DELEGATE_NAME,
    description: DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    // The build toolset can mutate, so this never batches in parallel with
    // anything else
    readOnly: false,
    execute: (input, context) => runDelegate(options, input, context),
  }
}

async function runDelegate(
  options: DelegateOptions,
  input: Record<string, unknown>,
  context: HarnessToolContext
): Promise<ToolResult> {
  if (context.depth >= MAX_DEPTH) {
    return { success: false, error: 'delegate is not available to a sub-agent' }
  }

  const task = typeof input.task === 'string' ? input.task.trim() : ''
  if (!task) return { success: false, error: 'delegate requires a task' }

  const toolset = parseToolset(input.toolset)
  if (!toolset) {
    return { success: false, error: 'toolset must be one of: research, inspect, build' }
  }

  const router = new ToolRouter(options.provider.contextWindow, options.harnessTools ?? [], {
    allow: TOOLSETS[toolset],
  })

  const result = await runAgent({
    provider: options.provider,
    tools: options.tools,
    router,
    systemPrompt: PROMPTS[toolset],
    // A fresh transcript is the whole point: none of the parent's history, and
    // none of the child's tool results ever go back to the parent
    messages: [{ role: 'user', content: [{ type: 'text', text: task }] }],
    maxSteps: SUBAGENT_MAX_STEPS,
    maxTokens: SUBAGENT_MAX_TOKENS,
    depth: context.depth + 1,
    signal: context.signal,
  })

  debugAiChat(
    '[delegate] %s: %d step(s), %d tool call(s), %d chars back',
    toolset,
    result.steps,
    result.toolCalls.length,
    result.text.length
  )

  if (result.stopReason === 'aborted') {
    return { success: false, error: 'Sub-agent was cancelled' }
  }

  const report = result.text.trim()
  if (!report) {
    return { success: false, error: 'Sub-agent finished without an answer' }
  }

  return {
    success: true,
    data: {
      toolset,
      report,
      // Names only. The results themselves are what the parent is paying not to
      // see, but knowing which tools ran tells it whether the answer is grounded.
      toolsUsed: result.toolCalls.map(call => call.name),
      // The parent loop collects these and the UI applies them, so a build
      // sub-agent's edits reach the graph exactly like a direct call's would
      ...(result.modifications.length > 0 ? { modifications: result.modifications } : {}),
    },
  }
}

function parseToolset(value: unknown): Toolset | null {
  if (value === undefined || value === null) return 'research'
  return typeof value === 'string' && value in TOOLSETS ? (value as Toolset) : null
}

// Exported so the tests can assert the narrowing rather than restate it
export function toolsetTools(toolset: Toolset): readonly string[] {
  return TOOLSETS[toolset]
}
