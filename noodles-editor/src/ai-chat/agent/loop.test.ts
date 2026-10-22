import { describe, expect, it, vi } from 'vitest'
import type { MCPTools } from '../mcp-tools'
import { claimsAnEdit, isReadOnly, maxStepsFor, runAgent, UNVERIFIED_EDIT_NOTE } from './loop'
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
  onEvent?: (event: AgentEvent) => void
}) {
  return runAgent({
    provider: params.provider,
    tools: params.tools ?? fakeTools(),
    router: params.router ?? new ToolRouter(params.provider.contextWindow),
    systemPrompt: 'test prompt',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxSteps: params.maxSteps,
    signal: params.signal,
    onEvent: params.onEvent,
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
      Array.from({ length: 20 }, (_, i) => ({
        tools: [{ name: 'get_node_info', input: { nodeId: `/n${i}` } }],
      }))
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

describe('runAgent repeated calls', () => {
  const lookup = { name: 'get_node_info', input: { nodeId: '/threshold' } }

  it('answers an identical call with the earlier outcome instead of running it', async () => {
    const getNodeInfo = vi.fn(async () => ({ success: false, error: 'Node not found: /threshold' }))
    const events: AgentEvent[] = []
    const provider = fakeProvider([{ tools: [lookup] }, { tools: [lookup] }, { text: 'gave up' }])

    const result = await runAgent({
      provider,
      tools: fakeTools({ getNodeInfo }),
      router: new ToolRouter(CLAUDE_WINDOW),
      systemPrompt: 'test prompt',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      onEvent: event => events.push(event),
    })

    expect(getNodeInfo).toHaveBeenCalledTimes(1)
    expect(result.toolCalls[1].result).toMatchObject({
      success: false,
      error: expect.stringMatching(/already called get_node_info.*Node not found/),
    })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'diagnostic', kind: 'repeated_tool_call' })
    )
  })

  it('ends the run on the third identical call', async () => {
    const provider = fakeProvider(Array.from({ length: 10 }, () => ({ tools: [lookup] })))

    const result = await run({ provider })

    expect(result.steps).toBe(3)
  })

  it('does not queue the same modifications twice', async () => {
    const edit = {
      name: 'apply_modifications',
      input: { modifications: [{ type: 'delete_node', data: { id: '/a' } }] },
    }
    const provider = fakeProvider([{ tools: [edit] }, { tools: [edit] }, { text: 'done' }])

    const result = await run({ provider })

    expect(result.modifications).toHaveLength(1)
  })

  it('lets a read run again after a successful write', async () => {
    const getNodeInfo = vi.fn(async () => ({ success: true, data: { id: '/a' } }))
    const edit = {
      name: 'apply_modifications',
      input: { modifications: [{ type: 'delete_node', data: { id: '/b' } }] },
    }
    const provider = fakeProvider([{ tools: [lookup] }, { tools: [edit] }, { tools: [lookup] }])

    await run({ provider, tools: fakeTools({ getNodeInfo }) })

    expect(getNodeInfo).toHaveBeenCalledTimes(2)
  })

  it('lets an earlier write run again once a different write has replaced it', async () => {
    const setPlaybackPosition = vi.fn(async () => ({ success: true, data: {} }))
    const seek = (position: number) => ({ name: 'set_playback_position', input: { position } })
    const provider = fakeProvider([
      { tools: [seek(0)] },
      { tools: [seek(5)] },
      { tools: [seek(0)] },
      { text: 'back at the start' },
    ])

    await run({ provider, tools: fakeTools({ setPlaybackPosition }) })

    expect(setPlaybackPosition).toHaveBeenCalledTimes(3)
  })

  it('judges a batch against history as its calls run, not as it arrived', async () => {
    const setPlaybackPosition = vi.fn(async () => ({ success: true, data: {} }))
    const seek = (position: number) => ({ name: 'set_playback_position', input: { position } })
    const provider = fakeProvider([{ tools: [seek(0)] }, { tools: [seek(5), seek(0)] }, {}])

    await run({ provider, tools: fakeTools({ setPlaybackPosition }) })

    // The 5 cleared the earlier 0, so the batch's own 0 runs and the playhead ends there
    expect(setPlaybackPosition).toHaveBeenCalledTimes(3)
  })

  it('runs an edit once when a batch repeats it', async () => {
    const edit = {
      name: 'apply_modifications',
      input: { modifications: [{ type: 'delete_node', data: { id: '/a' } }] },
    }
    const provider = fakeProvider([{ tools: [edit, edit] }, { text: 'done' }])

    const result = await run({ provider })

    expect(result.modifications).toHaveLength(1)
    expect(result.toolCalls[1].result.error).toMatch(/already called apply_modifications/)
  })

  it('runs a read once when a parallel batch repeats it', async () => {
    const listNodes = vi.fn(async () => ({ success: true, data: { nodes: [] } }))
    const provider = fakeProvider([
      { tools: [{ name: 'list_nodes' }, { name: 'list_nodes' }] },
      { text: 'done' },
    ])

    const result = await run({ provider, tools: fakeTools({ listNodes }) })

    expect(listNodes).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toHaveLength(2)
  })

  it('treats arguments in a different key order as the same call', async () => {
    const getNodeInfo = vi.fn(async () => ({ success: true, data: { id: '/a' } }))
    const provider = fakeProvider([
      { tools: [{ name: 'get_node_info', input: { nodeId: '/a', fields: ['x'] } }] },
      { tools: [{ name: 'get_node_info', input: { fields: ['x'], nodeId: '/a' } }] },
      { text: 'done' },
    ])

    await run({ provider, tools: fakeTools({ getNodeInfo }) })

    expect(getNodeInfo).toHaveBeenCalledTimes(1)
  })

  it('runs a read again when a write ahead of it in the same batch can change it', async () => {
    const getTimeline = vi.fn(async () => ({ success: true, data: { keyframes: [] } }))
    const setKeyframe = vi.fn(async () => ({ success: true, data: {} }))
    const timeline = { name: 'get_timeline', input: {} }
    const keyframe = { name: 'set_keyframe', input: { trackId: 'fade / opacity', value: 1 } }
    const provider = fakeProvider([
      { tools: [timeline] },
      { tools: [keyframe, timeline] },
      { text: 'done' },
    ])

    const result = await run({ provider, tools: fakeTools({ getTimeline, setKeyframe }) })

    expect(getTimeline).toHaveBeenCalledTimes(2)
    expect(result.toolCalls.at(-1)?.result.success).toBe(true)
  })

  it('still refuses a repeated read that comes before the write in its batch', async () => {
    const getTimeline = vi.fn(async () => ({ success: true, data: { keyframes: [] } }))
    const timeline = { name: 'get_timeline', input: {} }
    const keyframe = { name: 'set_keyframe', input: { trackId: 'fade / opacity', value: 1 } }
    const provider = fakeProvider([
      { tools: [timeline] },
      { tools: [timeline, keyframe] },
      { text: 'done' },
    ])

    await run({
      provider,
      tools: fakeTools({ getTimeline, setKeyframe: async () => ({ success: true, data: {} }) }),
    })

    expect(getTimeline).toHaveBeenCalledTimes(1)
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

describe('runAgent unverified edit claims', () => {
  const diagnostics = (events: AgentEvent[]) =>
    events.filter(e => e.type === 'diagnostic').map(e => e.kind)

  it('flags a reply that announces an edit no tool made', async () => {
    const events: AgentEvent[] = []
    const provider = fakeProvider([{ text: 'The point radius has been set to 10.' }])

    const result = await run({ provider, onEvent: e => events.push(e) })

    expect(diagnostics(events)).toEqual(['unverified_edit_claim'])
    expect(result.text).toContain(UNVERIFIED_EDIT_NOTE)
    expect(result.modifications).toEqual([])
  })

  it('says nothing when the edit really was applied', async () => {
    const events: AgentEvent[] = []
    const provider = fakeProvider([
      {
        tools: [
          {
            name: 'apply_modifications',
            input: { modifications: [{ type: 'delete_node', data: { id: '/stale' } }] },
          },
        ],
      },
      { text: 'I have deleted /stale.' },
    ])

    const result = await run({ provider, onEvent: e => events.push(e) })

    expect(diagnostics(events)).toEqual([])
    expect(result.text).not.toContain(UNVERIFIED_EDIT_NOTE)
  })

  it('still flags when the only mutating call failed', async () => {
    const events: AgentEvent[] = []
    const applyModifications = async () => ({ success: false, error: 'Node not found: /ghost' })
    const provider = fakeProvider([
      {
        tools: [
          {
            name: 'apply_modifications',
            input: { modifications: [{ type: 'delete_node', data: { id: '/ghost' } }] },
          },
        ],
      },
      { text: 'I have deleted /ghost.' },
    ])

    const result = await run({
      provider,
      tools: fakeTools({ applyModifications }),
      onEvent: e => events.push(e),
    })

    expect(diagnostics(events)).toEqual(['unverified_edit_claim'])
    expect(result.text).toContain(UNVERIFIED_EDIT_NOTE)
  })

  it('flags a claim after run_code that only read a value', async () => {
    const events: AgentEvent[] = []
    // A calculation succeeds without changing anything; changedFieldValues is
    // what says a field was set
    const runCode = async () => ({ success: true, data: { value: 42 } })
    const provider = fakeProvider([
      { tools: [{ name: 'run_code', input: { code: 'return 42' } }] },
      { text: 'I have set the radius to 42.' },
    ])

    const result = await run({
      provider,
      tools: fakeTools({ runCode }),
      onEvent: e => events.push(e),
    })

    expect(diagnostics(events)).toEqual(['unverified_edit_claim'])
    expect(result.text).toContain(UNVERIFIED_EDIT_NOTE)
  })

  it('leaves an answer that only describes the graph alone', async () => {
    const events: AgentEvent[] = []
    const provider = fakeProvider([{ text: 'The /pickup ColorOp is currently set to `#8d12af`.' }])

    const result = await run({ provider, onEvent: e => events.push(e) })

    expect(diagnostics(events)).toEqual([])
    expect(result.text).not.toContain(UNVERIFIED_EDIT_NOTE)
  })
})

describe('claimsAnEdit', () => {
  it('reads past and perfect aspect as a claim', () => {
    expect(claimsAnEdit('The radius has been set to 10.')).toBe(true)
    expect(claimsAnEdit("I've added a ScatterplotLayerOp and wired it to /deck.")).toBe(true)
    expect(claimsAnEdit('The issue was fixed by connecting the data node.')).toBe(true)
    expect(claimsAnEdit('The layer is now connected to /deck.')).toBe(true)
  })

  it('finds a claim that follows a description', () => {
    expect(claimsAnEdit('The color is currently set to purple. I have changed it to red.')).toBe(
      true
    )
  })

  it('reads a description, an instruction or a refusal as no claim', () => {
    expect(claimsAnEdit('The /pickup ColorOp is currently set to `#8d12af`.')).toBe(false)
    expect(claimsAnEdit('Set the radius to 10 yourself in the inspector.')).toBe(false)
    expect(claimsAnEdit('I cannot change the color scheme; tell me the node id.')).toBe(false)
    expect(claimsAnEdit('Should I set the radius to 10?')).toBe(false)
  })
})
