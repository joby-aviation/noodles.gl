import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { HostedTierError, resetHostedStatus, useHostedUsageStore } from './agent/providers/hosted'
import { AgentSession } from './agent/session'
import type { AgentProvider } from './agent/types'
import { ChatPanel } from './chat-panel'
import type { ContextLoader } from './context-loader'
import { globalContextManager } from './global-context-manager'
import type { NoodlesProject } from './types'

// The session is built for real; only the provider behind it is a stand-in
const createProvider = vi.hoisted(() =>
  vi.fn(
    async (options: { providerId: string }): Promise<AgentProvider> => ({
      id: options.providerId as AgentProvider['id'],
      model: 'openai/gpt-oss-120b',
      supportsNativeTools: true,
      supportsImages: false,
      contextWindow: 8192,
      async *stream() {},
    })
  )
)
vi.mock('./agent/provider-factory', async importOriginal => ({
  ...(await importOriginal<typeof import('./agent/provider-factory')>()),
  createProvider,
}))

const STATUS = {
  available: true,
  model: 'openai/gpt-oss-120b',
  providerName: 'Groq',
  contextWindow: 8192,
  freeMessages: 2,
}

function stubStatus() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/llm/status') {
        return new Response(JSON.stringify(STATUS), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('', { status: 404 })
    })
  )
}

function renderPanel(initialMessage?: string) {
  return render(
    <ReactFlowProvider>
      <ChatPanel
        project={{ nodes: [], edges: [] } as NoodlesProject}
        onClose={() => {}}
        isVisible
        initialMessage={initialMessage}
      />
    </ReactFlowProvider>
  )
}

async function send(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  })
}

beforeEach(() => {
  // A key from .env.local or CI would win over the free tier
  vi.stubEnv('VITE_CLAUDE_API_KEY', '')
  vi.stubEnv('VITE_OPENROUTER_API_KEY', '')
  resetHostedStatus()
  useHostedUsageStore.setState({ used: 0, exhausted: false })
  stubStatus()
  vi.spyOn(globalContextManager, 'waitForReady').mockResolvedValue({} as ContextLoader)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  createProvider.mockClear()
  resetHostedStatus()
  useHostedUsageStore.setState({ used: 0, exhausted: false })
  getKeysStore().clearBrowserKey('anthropic')
})

describe('ChatPanel on the free tier', () => {
  it('answers with no setup and says how many messages are left', async () => {
    renderPanel()

    await vi.waitFor(() => expect(screen.getByText(/2 of 2 messages left/)).toBeTruthy())
    expect(screen.getByText(/Free tier on Groq/)).toBeTruthy()
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'hosted' }))
  })

  it('sends the quick start question without waiting for Send', async () => {
    const sendSpy = vi
      .spyOn(AgentSession.prototype, 'send')
      .mockResolvedValue({ message: 'Here is a heatmap.', toolCalls: [] })

    renderPanel('Show pickups as a heatmap')

    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledOnce())
    expect(sendSpy.mock.calls[0][0].message).toBe('Show pickups as a heatmap')
    await vi.waitFor(() => expect(screen.getByText(/1 of 2 messages left/)).toBeTruthy())
  })

  it('keeps the conversation after the last free message and offers setup', async () => {
    useHostedUsageStore.setState({ used: 1 })
    vi.spyOn(AgentSession.prototype, 'send').mockResolvedValue({ message: 'Done.', toolCalls: [] })
    renderPanel()
    await vi.waitFor(() => expect(screen.getByPlaceholderText('Ask for help...')).toBeTruthy())

    await send('Make the arcs red')

    await vi.waitFor(() => expect(screen.getByText('Done.')).toBeTruthy())
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    expect(textarea.placeholder).toBe('Connect a provider to keep going')

    fireEvent.click(screen.getByRole('button', { name: 'Connect a provider' }))
    expect(screen.getByText('Connect an AI provider')).toBeTruthy()
    expect(screen.getByText(/You've used the 2 free messages/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))
    expect(screen.getByText('Done.')).toBeTruthy()
  })

  it('opens setup straight away when the free messages are already used', async () => {
    useHostedUsageStore.setState({ used: 2 })
    renderPanel('Show pickups as a heatmap')

    await vi.waitFor(() => expect(screen.getByText(/You've used the 2 free messages/)).toBeTruthy())
    // The question is kept for whichever provider comes next
    expect(screen.getByText('Show pickups as a heatmap')).toBeTruthy()
  })

  it('stops offering the free tier when the proxy says it is used up', async () => {
    vi.spyOn(AgentSession.prototype, 'send').mockRejectedValue(
      new HostedTierError('free_limit', 'The free tier covers 2 messages per conversation')
    )
    renderPanel()
    await vi.waitFor(() => expect(screen.getByPlaceholderText('Ask for help...')).toBeTruthy())

    await send('Make the arcs red')

    await vi.waitFor(() => expect(screen.getByText(/end of the free tier/)).toBeTruthy())
    expect(useHostedUsageStore.getState().exhausted).toBe(true)
  })

  it('does not spend a message when the tier is busy', async () => {
    vi.spyOn(AgentSession.prototype, 'send').mockRejectedValue(
      new HostedTierError('busy', 'The free tier is busy right now')
    )
    renderPanel()
    await vi.waitFor(() => expect(screen.getByPlaceholderText('Ask for help...')).toBeTruthy())

    await send('Make the arcs red')

    await vi.waitFor(() => expect(screen.getByText(/free tier is busy/)).toBeTruthy())
    expect(useHostedUsageStore.getState().used).toBe(0)
    expect(screen.getByText(/2 of 2 messages left/)).toBeTruthy()
  })

  it('steps aside for a provider the user set up', async () => {
    getKeysStore().setBrowserKey('anthropic', 'sk-ant-test')
    renderPanel()

    await vi.waitFor(() => expect(screen.getByPlaceholderText('Ask for help...')).toBeTruthy())
    expect(screen.queryByText(/messages left/)).toBeNull()
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'anthropic' })
    )
  })
})
