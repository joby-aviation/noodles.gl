import { describe, expect, it, vi } from 'vitest'
import type { MCPTools } from '../mcp-tools'
import { runAgent } from './loop'
import { createDelegateTool, DELEGATE_NAME, toolsetTools } from './subagent'
import { ToolRouter } from './tool-router'
import type { AgentEvent, AgentProvider, AgentRequest, StopReason } from './types'

// Anything the child produces and the parent must never see
const CHILD_ONLY = 'SOURCE_LINES_THE_PARENT_MUST_NOT_SEE'

interface ScriptedTurn {
  text?: string
  tools?: Array<{ name: string; input?: Record<string, unknown> }>
  stopReason?: StopReason
}

// One provider serves both loops. Parent and child turns run strictly in order —
// parent step 1, then the whole child run, then parent step 2 — so a flat script
// is unambiguous.
function fakeProvider(turns: ScriptedTurn[]): AgentProvider & { requests: AgentRequest[] } {
  let turnIndex = 0
  const requests: AgentRequest[] = []

  return {
    id: 'anthropic',
    model: 'fake',
    supportsNativeTools: true,
    supportsImages: true,
    contextWindow: 200_000,
    requests,

    async *stream(request: AgentRequest): AsyncIterable<AgentEvent> {
      requests.push(request)
      const turn = turns[turnIndex++] ?? {}

      if (turn.text) yield { type: 'text_delta', text: turn.text }

      for (const [index, tool] of (turn.tools ?? []).entries()) {
        yield {
          type: 'tool_call',
          id: `call-${turnIndex}-${index}`,
          name: tool.name,
          input: tool.input ?? {},
        }
      }

      yield {
        type: 'stop',
        reason: turn.stopReason ?? (turn.tools?.length ? 'tool_use' : 'end_turn'),
      }
    },
  }
}

function fakeTools(overrides: Partial<Record<string, unknown>> = {}): MCPTools {
  return {
    getProject: () => ({ nodes: [], edges: [] }),
    listNodes: async () => ({ success: true, data: { nodes: [], nodeCount: 0 } }),
    searchCode: async () => ({
      success: true,
      data: { matches: [{ file: 'src/a.ts', line: 1, context: [CHILD_ONLY] }] },
    }),
    applyModifications: async (params: { modifications: unknown[] }) => ({
      success: true,
      data: {
        modifications: params.modifications,
        modificationsCount: params.modifications.length,
      },
    }),
    ...overrides,
  } as unknown as MCPTools
}

// The parent conversation, with delegate registered the way AgentSession does it
function runParent(params: { provider: AgentProvider; tools: MCPTools }) {
  const delegate = createDelegateTool({ provider: params.provider, tools: params.tools })
  const router = new ToolRouter(params.provider.contextWindow, [delegate])

  return runAgent({
    provider: params.provider,
    tools: params.tools,
    router,
    systemPrompt: 'parent prompt',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'find the arc example' }] }],
  })
}

// Child requests carry the sub-agent prompt; the parent's carries ours
function parentRequests(provider: { requests: AgentRequest[] }): AgentRequest[] {
  return provider.requests.filter(request => request.system === 'parent prompt')
}

describe('delegate', () => {
  it('returns the report to the parent and keeps the child tool results out', async () => {
    const provider = fakeProvider([
      // parent asks
      { tools: [{ name: DELEGATE_NAME, input: { task: 'which example animates arcs?' } }] },
      // child searches
      { tools: [{ name: 'search_code', input: { pattern: 'ArcLayer' } }] },
      // child answers
      { text: 'The flights example uses ArcLayer.' },
      // parent answers
      { text: 'Look at the flights example.' },
    ])

    const result = await runParent({ provider, tools: fakeTools() })

    const transcript = JSON.stringify(parentRequests(provider).at(-1)?.messages)
    expect(transcript).toContain('The flights example uses ArcLayer.')
    expect(transcript).not.toContain(CHILD_ONLY)
    expect(result.text).toBe('Look at the flights example.')
  })

  it('reports which tools the child ran, without their output', async () => {
    const provider = fakeProvider([
      { tools: [{ name: DELEGATE_NAME, input: { task: 'find arcs' } }] },
      { tools: [{ name: 'search_code', input: { pattern: 'ArcLayer' } }] },
      { text: 'found it' },
    ])

    const result = await runParent({ provider, tools: fakeTools() })
    const call = result.toolCalls.find(c => c.name === DELEGATE_NAME)

    expect(call?.result.data).toEqual({
      toolset: 'research',
      report: 'found it',
      toolsUsed: ['search_code'],
    })
  })

  it('refuses to nest: a sub-agent cannot delegate', async () => {
    const provider = fakeProvider([])
    const delegate = createDelegateTool({ provider, tools: fakeTools() })

    const result = await delegate.execute({ task: 'go deeper' }, { depth: 1 })

    expect(result).toEqual({
      success: false,
      error: 'delegate is not available to a sub-agent',
    })
  })

  it('denies the research toolset a mutating tool even when the child asks for it', async () => {
    const applyModifications = vi.fn()
    const provider = fakeProvider([
      { tools: [{ name: DELEGATE_NAME, input: { task: 'look something up' } }] },
      // A model can name a tool it was never offered
      { tools: [{ name: 'apply_modifications', input: { modifications: [] } }] },
      { text: 'could not change anything' },
    ])

    const result = await runParent({ provider, tools: fakeTools({ applyModifications }) })

    expect(applyModifications).not.toHaveBeenCalled()
    expect(result.toolCalls.find(c => c.name === DELEGATE_NAME)?.result.success).toBe(true)
  })

  it('carries a build sub-agent modifications up to the parent', async () => {
    const modification = { type: 'delete_node', data: { id: '/stale' } }
    const provider = fakeProvider([
      { tools: [{ name: DELEGATE_NAME, input: { task: 'remove /stale', toolset: 'build' } }] },
      { tools: [{ name: 'apply_modifications', input: { modifications: [modification] } }] },
      { text: 'deleted /stale' },
    ])

    const result = await runParent({ provider, tools: fakeTools() })

    expect(result.modifications).toEqual([modification])
  })

  it('rejects a missing task or an unknown toolset before spawning anything', async () => {
    const provider = fakeProvider([])
    const delegate = createDelegateTool({ provider, tools: fakeTools() })

    await expect(delegate.execute({ task: '  ' }, { depth: 0 })).resolves.toEqual({
      success: false,
      error: 'delegate requires a task',
    })
    await expect(delegate.execute({ task: 'x', toolset: 'admin' }, { depth: 0 })).resolves.toEqual({
      success: false,
      error: 'toolset must be one of: research, inspect, build',
    })
    expect(provider.requests).toHaveLength(0)
  })

  it('fails rather than reporting nothing when the child produces no text', async () => {
    const provider = fakeProvider([
      { tools: [{ name: DELEGATE_NAME, input: { task: 'anything' } }] },
      { text: '' },
    ])

    const result = await runParent({ provider, tools: fakeTools() })

    expect(result.toolCalls.find(c => c.name === DELEGATE_NAME)?.result).toEqual({
      success: false,
      error: 'Sub-agent finished without an answer',
    })
  })
})

describe('toolsets', () => {
  it('keeps mutating tools out of the read-only sets', () => {
    expect(toolsetTools('research')).not.toContain('apply_modifications')
    expect(toolsetTools('inspect')).not.toContain('apply_modifications')
    expect(toolsetTools('build')).toContain('apply_modifications')
  })

  it('gives research no view of the user project', () => {
    expect(toolsetTools('research')).not.toContain('list_nodes')
    expect(toolsetTools('research')).not.toContain('get_current_project')
  })
})
