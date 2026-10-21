import { describe, expect, it, vi } from 'vitest'
import type { MCPTools } from '../mcp-tools'
import { AgentSession, describeToolUses } from './session'
import type { AgentEvent, AgentProvider } from './types'

// A provider whose one reply waits until the test lets it finish
function heldProvider() {
  let finish = () => {}
  const held = new Promise<void>(resolve => {
    finish = resolve
  })
  const provider: AgentProvider = {
    id: 'webllm',
    model: 'fake',
    supportsNativeTools: false,
    supportsImages: false,
    contextWindow: 200_000,
    dispose: vi.fn(),
    async *stream(): AsyncIterable<AgentEvent> {
      await held
      yield { type: 'text_delta', text: 'done' }
      yield { type: 'stop', reason: 'end_turn' }
    },
  }
  return { provider, finish }
}

function fakeTools() {
  return {
    clearQueuedModifications: vi.fn(),
    getProject: () => ({ nodes: [], edges: [] }),
  } as unknown as MCPTools & { clearQueuedModifications: ReturnType<typeof vi.fn> }
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('AgentSession', () => {
  it('keeps the provider until a reply in flight settles', async () => {
    // WebLLM's dispose terminates its worker, and a request that worker was
    // serving never returns, so disposing mid-reply would hang the chat
    const { provider, finish } = heldProvider()
    const session = new AgentSession(provider, fakeTools())

    const reply = session.send({ message: 'hi' })
    await flush()
    session.dispose()
    expect(provider.dispose).not.toHaveBeenCalled()

    finish()
    await expect(reply).resolves.toMatchObject({ message: 'done' })
    await flush()
    expect(provider.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes at once when nothing is running', () => {
    const { provider } = heldProvider()
    new AgentSession(provider, fakeTools()).dispose()
    expect(provider.dispose).toHaveBeenCalledTimes(1)
  })

  it('starts each run with nothing queued from the last one', async () => {
    const { provider, finish } = heldProvider()
    const tools = fakeTools()
    finish()

    await new AgentSession(provider, tools).send({ message: 'hi' })

    expect(tools.clearQueuedModifications).toHaveBeenCalledTimes(1)
  })
})

describe('describeToolUses', () => {
  it('is empty when the turn used no tools', () => {
    expect(describeToolUses(undefined)).toBe('')
    expect(describeToolUses([])).toBe('')
  })

  it('names each call with its arguments', () => {
    const note = describeToolUses([
      { name: 'get_node_info', params: { nodeId: '/scatterplot' }, ok: true },
      { name: 'apply_modifications', params: { modifications: [] }, ok: true },
    ])

    expect(note).toBe(
      '[tools used: get_node_info(nodeId="/scatterplot"), apply_modifications(modifications=[])]'
    )
  })

  it('marks a failed call, since that is usually what a follow-up is about', () => {
    expect(describeToolUses([{ name: 'get_node_output', ok: false }])).toBe(
      '[tools used: get_node_output() — failed]'
    )
  })

  it('clips a long argument rather than replaying the whole payload', () => {
    const note = describeToolUses([
      { name: 'search_code', params: { pattern: 'x'.repeat(200) }, ok: true },
    ])

    // The point of keeping tool uses is cheap recall, so one call stays one line
    expect(note.length).toBeLessThan(120)
    expect(note).toContain('…')
  })
})
