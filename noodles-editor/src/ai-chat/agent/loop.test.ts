import { describe, expect, it, vi } from 'vitest'
import type { MCPTools } from '../mcp-tools'
import { isReadOnly, maxStepsFor, runAgent } from './loop'
import { ToolRouter } from './tool-router'
import type { AgentEvent, AgentProvider, AgentRequest, StopReason } from './types'

const CLAUDE_WINDOW = 200_000
const NANO_WINDOW = 6144

// One scripted model turn. `tools` names the tools the model asks for; an empty
// array ends the run.
interface ScriptedTurn {
  text?: string
  tools?: Array<{ name: string; input?: Record<string, unknown> }>
  stopReason?: StopReason
}

function fakeProvider(
  turns: ScriptedTurn[],
  overrides: Partial<AgentProvider> = {}
): AgentProvider & { requests: AgentRequest[] } {
  let turnIndex = 0
  const requests: AgentRequest[] = []

  return {
    id: 'anthropic',
    model: 'fake',
    supportsNativeTools: true,
    supportsImages: true,
    contextWindow: CLAUDE_WINDOW,
    requests,
    ...overrides,

    async *stream(request: AgentRequest): AsyncIterable<AgentEvent> {
      requests.push(request)
      // Past the end of the script the model just stops, which is what a real
      // provider does once it has nothing left to ask for
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

      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } }
      yield {
        type: 'stop',
        reason: turn.stopReason ?? (turn.tools?.length ? 'tool_use' : 'end_turn'),
      }
    },
  }
}

// Enough of MCPTools for the tools these tests call. The real class needs a loaded
// context bundle, which is not what the loop is being tested for.
function fakeTools(overrides: Partial<Record<string, unknown>> = {}): MCPTools {
  return {
    getProject: () => ({ nodes: [], edges: [] }),
    listNodes: async () => ({ success: true, data: { nodes: [], nodeCount: 0 } }),
    getNodeInfo: async () => ({ success: true, data: { id: '/a' } }),
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

function run(params: {
  provider: AgentProvider
  tools?: MCPTools
  maxSteps?: number
  signal?: AbortSignal
  router?: ToolRouter
}) {
  return runAgent({
    provider: params.provider,
    tools: params.tools ?? fakeTools(),
    router: params.router ?? new ToolRouter(params.provider.contextWindow),
    systemPrompt: 'test prompt',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxSteps: params.maxSteps,
    signal: params.signal,
  })
}

describe('runAgent', () => {
  it('returns the text of a turn that asks for no tools', async () => {
    const result = await run({ provider: fakeProvider([{ text: 'no tools needed' }]) })

    expect(result.text).toBe('no tools needed')
    expect(result.steps).toBe(1)
    expect(result.stopReason).toBe('end_turn')
    expect(result.toolCalls).toEqual([])
  })

  it('runs a tool then continues to a final answer', async () => {
    const provider = fakeProvider([
      { text: 'checking', tools: [{ name: 'list_nodes' }] },
      { text: 'all done' },
    ])

    const result = await run({ provider })

    expect(result.steps).toBe(2)
    expect(result.toolCalls.map(c => c.name)).toEqual(['list_nodes'])
    expect(result.text).toBe('checkingall done')
    expect(result.stopReason).toBe('end_turn')
  })

  it('feeds the tool result back as a user turn carrying the tool_use id', async () => {
    const provider = fakeProvider([{ tools: [{ name: 'list_nodes' }] }, { text: 'done' }])

    const result = await run({ provider })

    // The second request has to contain the assistant tool_use and the matching
    // tool_result, or the provider rejects it
    const second = provider.requests[1]
    const assistantTurn = second.messages[1]
    const resultTurn = second.messages[2]

    expect(assistantTurn.role).toBe('assistant')
    expect(assistantTurn.content).toContainEqual(
      expect.objectContaining({ type: 'tool_use', name: 'list_nodes' })
    )
    expect(resultTurn.role).toBe('user')
    expect(resultTurn.content[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: (assistantTurn.content[0] as { id: string }).id,
    })
    // The returned transcript also carries the closing assistant turn, which the
    // second request could not have contained
    expect(result.messages.at(-1)).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
    })
  })

  it('stops at maxSteps when the model keeps asking for tools', async () => {
    // A provider that never runs out of tool requests
    const provider = fakeProvider(
      Array.from({ length: 20 }, () => ({ tools: [{ name: 'list_nodes' }] }))
    )

    const result = await run({ provider, maxSteps: 3 })

    expect(result.steps).toBe(3)
    expect(result.toolCalls).toHaveLength(3)
    expect(result.stopReason).toBe('tool_use')
  })

  it('collects modifications returned by apply_modifications', async () => {
    const modification = { type: 'add_node', data: { id: '/new', type: 'NumberOp' } }
    const provider = fakeProvider([
      { tools: [{ name: 'apply_modifications', input: { modifications: [modification] } }] },
      { text: 'added' },
    ])

    const result = await run({ provider })

    expect(result.modifications).toEqual([modification])
  })

  it('picks up modifications the model wrote as a fenced JSON block', async () => {
    const provider = fakeProvider([
      {
        text: [
          'Here you go:',
          '```json',
          '[{"type":"add_node","data":{"id":"/n","type":"NumberOp"}}]',
          '```',
        ].join('\n'),
      },
    ])

    const result = await run({ provider })

    expect(result.modifications).toEqual([
      { type: 'add_node', data: { id: '/n', type: 'NumberOp' } },
    ])
  })

  it('carries provider blocks back ahead of the text, as thinking replay requires', async () => {
    const provider: AgentProvider & { requests: AgentRequest[] } = {
      ...fakeProvider([]),
      async *stream(request: AgentRequest) {
        provider.requests.push(request)
        if (provider.requests.length === 1) {
          yield { type: 'provider_block', provider: 'anthropic', block: { type: 'thinking' } }
          yield { type: 'text_delta', text: 'thought about it' }
          yield { type: 'tool_call', id: 'c1', name: 'list_nodes', input: {} }
          yield { type: 'stop', reason: 'tool_use' }
          return
        }
        yield { type: 'stop', reason: 'end_turn' }
      },
    }

    await run({ provider })

    const assistantTurn = provider.requests[1].messages[1]
    expect(assistantTurn.content[0]).toMatchObject({ type: 'provider_block' })
    expect(assistantTurn.content[1]).toMatchObject({ type: 'text' })
  })
})

describe('runAgent tool scheduling', () => {
  // Records the order calls start and finish so parallel and serial execution are
  // distinguishable rather than merely asserted about. The yield is microtask-based
  // because setupTests installs fake timers globally, so a real setTimeout never
  // fires here.
  function orderRecordingTools(): { tools: MCPTools; events: string[] } {
    const events: string[] = []

    const recorded =
      (name: string, data: unknown = {}) =>
      async () => {
        events.push(`start:${name}`)
        for (let i = 0; i < 3; i++) await Promise.resolve()
        events.push(`end:${name}`)
        return { success: true, data }
      }

    return {
      events,
      tools: fakeTools({
        listNodes: recorded('list_nodes'),
        getNodeInfo: recorded('get_node_info'),
        applyModifications: recorded('apply_modifications', { modifications: [] }),
      }),
    }
  }

  it('overlaps a batch of read-only calls', async () => {
    const { tools, events } = orderRecordingTools()
    const provider = fakeProvider([
      { tools: [{ name: 'list_nodes' }, { name: 'get_node_info', input: { nodeId: '/a' } }] },
      { text: 'done' },
    ])

    await run({ provider, tools })

    // Both calls are in flight before either finishes
    expect(events.slice(0, 2)).toEqual(['start:list_nodes', 'start:get_node_info'])
    expect(events.indexOf('start:get_node_info')).toBeLessThan(events.indexOf('end:list_nodes'))
  })

  it('serialises a batch once a mutating call is in it', async () => {
    const { tools, events } = orderRecordingTools()
    const provider = fakeProvider([
      {
        tools: [
          { name: 'apply_modifications', input: { modifications: [] } },
          { name: 'list_nodes' },
        ],
      },
      { text: 'done' },
    ])

    await run({ provider, tools })

    expect(events).toEqual([
      'start:apply_modifications',
      'end:apply_modifications',
      'start:list_nodes',
      'end:list_nodes',
    ])
  })

  it('reports a throwing tool back to the model instead of failing the run', async () => {
    const tools = fakeTools({
      listNodes: async () => {
        throw new Error('index unavailable')
      },
    })
    const provider = fakeProvider([{ tools: [{ name: 'list_nodes' }] }, { text: 'recovered' }])

    const result = await run({ provider, tools })

    expect(result.text).toBe('recovered')
    expect(result.toolCalls[0].result).toMatchObject({
      success: false,
      error: 'index unavailable',
    })
  })
})

describe('runAgent abort', () => {
  it('stops before the first request when already aborted', async () => {
    const provider = fakeProvider([{ text: 'should not run' }])
    const controller = new AbortController()
    controller.abort()

    const result = await run({ provider, signal: controller.signal })

    expect(result.stopReason).toBe('aborted')
    expect(result.steps).toBe(0)
    expect(provider.requests).toHaveLength(0)
  })

  it('stops after a turn the provider reported as aborted', async () => {
    const provider = fakeProvider([
      { text: 'partial', stopReason: 'aborted' },
      { text: 'never reached' },
    ])

    const result = await run({ provider })

    expect(result.stopReason).toBe('aborted')
    expect(result.text).toBe('partial')
    expect(provider.requests).toHaveLength(1)
  })

  it('stops between steps when aborted mid-run', async () => {
    const controller = new AbortController()
    const tools = fakeTools({
      listNodes: async () => {
        controller.abort()
        return { success: true, data: {} }
      },
    })
    const provider = fakeProvider([{ tools: [{ name: 'list_nodes' }] }, { text: 'never reached' }])

    const result = await run({ provider, tools, signal: controller.signal })

    expect(result.stopReason).toBe('aborted')
    expect(provider.requests).toHaveLength(1)
  })
})

describe('maxStepsFor', () => {
  it('gives a small-context model fewer steps', async () => {
    const small = maxStepsFor(fakeProvider([], { contextWindow: NANO_WINDOW }))
    const large = maxStepsFor(fakeProvider([]))

    expect(small).toBeLessThan(large)
    expect(small).toBeGreaterThan(1)
  })
})

describe('isReadOnly', () => {
  it('treats find_tools as read-only, since it only touches router state', () => {
    expect(isReadOnly('find_tools')).toBe(true)
  })

  it('reads the annotation for real tools', () => {
    expect(isReadOnly('list_nodes')).toBe(true)
    expect(isReadOnly('apply_modifications')).toBe(false)
  })

  it('does not claim an unknown tool is safe to parallelise', () => {
    expect(isReadOnly('no_such_tool')).toBe(false)
  })
})

describe('runAgent tool disclosure', () => {
  it('offers only tier 0 on the first request', async () => {
    const provider = fakeProvider([{ text: 'hi' }])

    await run({ provider })

    expect(provider.requests[0].tools.map(t => t.name).sort()).toEqual([
      'apply_modifications',
      'find_tools',
      'get_node_info',
      'get_node_output',
      'list_nodes',
    ])
  })

  it('offers a tool on the next request once find_tools unlocked it', async () => {
    const provider = fakeProvider([
      { tools: [{ name: 'find_tools', input: { query: 'documentation' } }] },
      { text: 'done' },
    ])

    await run({ provider })

    expect(provider.requests[1].tools.map(t => t.name)).toContain('get_documentation')
  })

  it('unlocks a tool the model called without being offered it', async () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const search = vi.fn(async () => ({ success: true, data: { results: [] } }))
    const provider = fakeProvider([
      { tools: [{ name: 'search_code', input: { query: 'getArc' } }] },
      { text: 'done' },
    ])

    await run({ provider, tools: fakeTools({ searchCode: search }), router })

    expect(search).toHaveBeenCalled()
    expect(router.isCallable('search_code')).toBe(true)
  })
})
