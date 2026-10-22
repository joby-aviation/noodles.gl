import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { AUTH_MESSAGE_TYPE } from '../noodles/openrouter-oauth'
import { useAgentModelStore } from './agent/model-store'
import { DEFAULT_OPENROUTER_MODEL, resetOpenRouterCatalogue } from './agent/providers/openrouter'
import { AgentSession } from './agent/session'
import type { AgentProvider } from './agent/types'
import { ChatPanel } from './chat-panel'
import type { ContextLoader } from './context-loader'
import { globalContextManager } from './global-context-manager'
import type { ClaudeResponse, NoodlesProject } from './types'

// The session is built for real; only the provider behind it is a stand-in
vi.mock('./agent/provider-factory', () => ({
  createProvider: vi.fn(
    async (): Promise<AgentProvider> => ({
      id: 'anthropic',
      model: 'test-model',
      supportsNativeTools: true,
      supportsImages: true,
      contextWindow: 200_000,
      async *stream() {},
    })
  ),
}))

const FREE_MODEL = 'z-ai/glm-4.5-air:free'

function catalogueResponse(): Response {
  const data = [
    {
      id: FREE_MODEL,
      name: 'GLM 4.5 Air (free)',
      context_length: 131072,
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['tools'],
    },
  ]
  return new Response(JSON.stringify({ data }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// Holds the catalogue request open until the test lets it through
function stubSlowCatalogue() {
  let release: () => void = () => {}
  const arrived = new Promise<void>(resolve => {
    release = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://openrouter.ai/api/v1/models')) {
        await arrived
        return catalogueResponse()
      }
      return new Response('', { status: 404 })
    })
  )
  return release
}

function postKeyFromPopup() {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: AUTH_MESSAGE_TYPE, key: 'sk-or-v1-test' },
    })
  )
}

const storedOpenRouterModel = () => useAgentModelStore.getState().models.openrouter

beforeEach(() => {
  resetOpenRouterCatalogue()
  useAgentModelStore.getState().setModel('openrouter', undefined)
  // The session build is not under test, and the docs load it waits on is slow
  vi.spyOn(globalContextManager, 'waitForReady').mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetOpenRouterCatalogue()
  useAgentModelStore.getState().setModel('openrouter', undefined)
  getKeysStore().clearBrowserKey('openrouter')
  getKeysStore().setProviderPreference('automatic')
})

describe('ChatPanel after connecting OpenRouter', () => {
  it('waits for the free-model catalogue before storing a model', async () => {
    const releaseCatalogue = stubSlowCatalogue()
    render(
      <ReactFlowProvider>
        <ChatPanel
          project={{ nodes: [], edges: [] } as NoodlesProject}
          onClose={() => {}}
          isVisible={false}
        />
      </ReactFlowProvider>
    )

    // OAuth finishes while the catalogue request is still in flight
    act(() => postKeyFromPopup())
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(getKeysStore().getKey('openrouter')).toBe('sk-or-v1-test')
    expect(storedOpenRouterModel()).toBeUndefined()

    await act(async () => releaseCatalogue())
    await vi.waitFor(() => expect(storedOpenRouterModel()).toBe(FREE_MODEL))
    expect(storedOpenRouterModel()).not.toBe(DEFAULT_OPENROUTER_MODEL)
  })
})

describe('ChatPanel graph-edit proposals', () => {
  const proposalResponse: ClaudeResponse = {
    message: 'I set the value to 2.',
    projectModifications: [
      { type: 'update_node', data: { id: '/number', data: { inputs: { value: 2 } } } },
    ],
    toolCalls: [],
  }

  beforeEach(() => {
    getKeysStore().setBrowserKey('anthropic', 'sk-ant-test')
    vi.spyOn(globalContextManager, 'waitForReady').mockResolvedValue({} as ContextLoader)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    getKeysStore().clearBrowserKey('anthropic')
  })

  async function renderReadyPanel() {
    render(
      <ReactFlowProvider>
        <ChatPanel
          project={{ nodes: [], edges: [] } as NoodlesProject}
          onClose={() => {}}
          isVisible
        />
      </ReactFlowProvider>
    )
    await vi.waitFor(() => expect(screen.getByPlaceholderText('Ask for help...')).toBeTruthy())
  }

  async function send(text: string) {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
  }

  it('blocks sending until a pending proposal is accepted or rejected', async () => {
    const sendSpy = vi.spyOn(AgentSession.prototype, 'send').mockResolvedValue(proposalResponse)
    await renderReadyPanel()

    await send('Set /number to 2')
    await vi.waitFor(() => expect(screen.getByLabelText('Proposed graph update')).toBeTruthy())
    expect(screen.getByText('Set value on /number')).toBeTruthy()

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    expect(textarea.placeholder).toBe('Accept or reject the graph update to continue')
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)

    // Enter goes through the same handler as the button, and must be refused too
    fireEvent.change(textarea, { target: { value: 'And make it 3' } })
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter' })
    })
    expect(sendSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(screen.queryByLabelText('Proposed graph update')).toBeNull()
    expect(screen.getByText('Proposal rejected. The graph was not changed.')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false)

    await send('And make it 3')
    expect(sendSpy).toHaveBeenCalledTimes(2)
  })

  it('unblocks sending once the proposal is accepted', async () => {
    vi.spyOn(AgentSession.prototype, 'send').mockResolvedValue({
      ...proposalResponse,
      projectModifications: [
        {
          type: 'add_node',
          data: { id: '/number', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
        },
      ],
    })
    await renderReadyPanel()

    await send('Add a number')
    await vi.waitFor(() => expect(screen.getByText('Add NumberOp /number')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(screen.queryByLabelText('Proposed graph update')).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('drops a pending proposal when a new conversation starts', async () => {
    vi.spyOn(AgentSession.prototype, 'send').mockResolvedValue(proposalResponse)
    await renderReadyPanel()

    await send('Set /number to 2')
    await vi.waitFor(() => expect(screen.getByLabelText('Proposed graph update')).toBeTruthy())

    fireEvent.click(screen.getByTitle('Start New Conversation'))

    expect(screen.queryByLabelText('Proposed graph update')).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false)
  })
})
