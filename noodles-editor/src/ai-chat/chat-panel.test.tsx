import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { AUTH_MESSAGE_TYPE } from '../noodles/openrouter-oauth'
import { analytics } from '../utils/analytics'
import { useAgentModelStore } from './agent/model-store'
import { DEFAULT_ANTHROPIC_MODEL } from './agent/providers/anthropic'
import { DEFAULT_OPENROUTER_MODEL, resetOpenRouterCatalogue } from './agent/providers/openrouter'
import { WEBLLM_MODELS } from './agent/providers/webllm'
import { AgentSession } from './agent/session'
import type { AgentProvider } from './agent/types'
import { ChatPanel } from './chat-panel'
import type { ContextLoader } from './context-loader'
import { globalContextManager } from './global-context-manager'
import type { ClaudeResponse, NoodlesProject } from './types'

// The session is built for real; only the provider behind it is a stand-in. The
// picker only shows once a session has started, and starting a real local model
// means a download
const createProvider = vi.hoisted(() =>
  vi.fn(
    async (): Promise<AgentProvider> => ({
      id: 'anthropic',
      model: 'test-model',
      supportsNativeTools: true,
      supportsImages: true,
      contextWindow: 200_000,
      async *stream() {},
    })
  )
)
vi.mock('./agent/provider-factory', async importOriginal => ({
  ...(await importOriginal<typeof import('./agent/provider-factory')>()),
  createProvider,
}))

// Report a WebGPU adapter so the local model can be ready
vi.mock('./agent/providers/webllm', async importOriginal => ({
  ...(await importOriginal<typeof import('./agent/providers/webllm')>()),
  webgpuAvailable: async () => true,
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
  useAgentModelStore.getState().setModel('webllm', undefined)
  getKeysStore().clearBrowserKey('openrouter')
  getKeysStore().clearBrowserKey('anthropic')
  createProvider.mockClear()
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

  const panel = (projectKey = 1) => (
    <ReactFlowProvider>
      <ChatPanel
        project={{ nodes: [], edges: [] } as NoodlesProject}
        projectKey={projectKey}
        onClose={() => {}}
        isVisible
      />
    </ReactFlowProvider>
  )

  async function renderReadyPanel() {
    const view = render(panel())
    await vi.waitFor(() => expect(screen.getByPlaceholderText('Ask for help...')).toBeTruthy())
    return view
  }

  // A reply the test hands back when it chooses, standing in for a run in flight
  function deferSend() {
    let finish: (response: ClaudeResponse) => void = () => {}
    vi.spyOn(AgentSession.prototype, 'send').mockImplementation(
      () => new Promise(resolve => (finish = resolve))
    )
    return (response: ClaudeResponse) => act(async () => finish(response))
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
    expect(screen.getByText('Set value = 2 on /number')).toBeTruthy()
    expect(screen.getByText('These changes are not applied yet.')).toBeTruthy()

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
    expect(screen.getByText('Proposal rejected. Its changes were not applied.')).toBeTruthy()
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

  it('drops a pending proposal when another project is opened', async () => {
    vi.spyOn(AgentSession.prototype, 'send').mockResolvedValue(proposalResponse)
    const { rerender } = await renderReadyPanel()

    await send('Set /number to 2')
    await vi.waitFor(() => expect(screen.getByLabelText('Proposed graph update')).toBeTruthy())

    rerender(panel(2))

    expect(screen.queryByLabelText('Proposed graph update')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(
      screen.getByText('Another project was opened, so the proposed graph update was not applied.')
    ).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('drops the proposal of a run that finishes after another project is opened', async () => {
    const finish = deferSend()
    const { rerender } = await renderReadyPanel()

    await send('Set /number to 2')
    rerender(panel(2))
    await finish(proposalResponse)

    expect(screen.queryByLabelText('Proposed graph update')).toBeNull()
    expect(screen.queryByText('I set the value to 2.')).toBeNull()
  })

  it('keeps the reply and proposal of a run out of a conversation started after it', async () => {
    const finish = deferSend()
    await renderReadyPanel()

    await send('Set /number to 2')
    fireEvent.click(screen.getByTitle('Start New Conversation'))
    await finish(proposalResponse)

    expect(screen.queryByLabelText('Proposed graph update')).toBeNull()
    expect(screen.queryByText('I set the value to 2.')).toBeNull()
    expect(screen.queryByText('Set /number to 2')).toBeNull()
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

describe('ChatPanel model picker', () => {
  it('switches to a local model that is already set up instead of opening Settings', async () => {
    // Anthropic wins 'automatic', so the local model is a switch away from it
    getKeysStore().setBrowserKey('anthropic', 'sk-ant-test')
    useAgentModelStore.getState().setModel('webllm', WEBLLM_MODELS[0].id)
    vi.spyOn(globalContextManager, 'waitForReady').mockResolvedValue({} as ContextLoader)
    window.location.hash = ''
    render(
      <ReactFlowProvider>
        <ChatPanel
          project={{ nodes: [], edges: [] } as NoodlesProject}
          onClose={() => {}}
          isVisible
        />
      </ReactFlowProvider>
    )
    // Let the WebGPU check and the session start settle
    await act(() => vi.advanceTimersByTimeAsync(0))
    const picker = screen.getByTitle('Which API the assistant talks to') as HTMLSelectElement
    expect(picker.value).toBe('anthropic')
    expect(createProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerId: 'anthropic' })
    )

    fireEvent.change(picker, { target: { value: 'webllm' } })
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(getKeysStore().getProviderPreference()).toBe('webllm')
    expect(window.location.hash).toBe('')
    expect(createProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerId: 'webllm' })
    )
  })
})

describe('ChatPanel load reports', () => {
  it('names the attempted default model when a load fails', async () => {
    getKeysStore().setBrowserKey('anthropic', 'sk-ant-test')
    useAgentModelStore.getState().setModel('anthropic', undefined)
    vi.spyOn(globalContextManager, 'waitForReady').mockResolvedValue({} as ContextLoader)
    createProvider.mockRejectedValueOnce(new Error('load failed'))
    const track = vi.spyOn(analytics, 'track')
    render(
      <ReactFlowProvider>
        <ChatPanel
          project={{ nodes: [], edges: [] } as NoodlesProject}
          onClose={() => {}}
          isVisible
        />
      </ReactFlowProvider>
    )
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(track).toHaveBeenCalledWith('ai_provider_load', {
      provider: 'anthropic',
      model: DEFAULT_ANTHROPIC_MODEL,
      outcome: 'failed',
    })
    track.mockRestore()
  })
})

describe('ChatPanel onboarding with a quick start request', () => {
  const REQUEST = 'Map the bike stations in this file'

  beforeEach(() => {
    vi.spyOn(globalContextManager, 'waitForReady').mockResolvedValue({} as ContextLoader)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).startsWith('https://openrouter.ai/api/v1/models')
          ? catalogueResponse()
          : new Response('', { status: 404 })
      )
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderOnboarding({
    onClose = () => {},
    // null for none: an undefined here would take the default
    request = REQUEST as string | null,
  } = {}) {
    return render(
      <ReactFlowProvider>
        <ChatPanel
          project={{ nodes: [], edges: [] } as NoodlesProject}
          onClose={onClose}
          isVisible
          initialMessage={request ?? undefined}
        />
      </ReactFlowProvider>
    )
  }

  it('shows the request above the onboarding', async () => {
    renderOnboarding()
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(screen.getByText('Connect an AI provider')).toBeTruthy()
    const request = screen.getByRole('region', { name: 'Your request' })
    expect(request.textContent).toContain(REQUEST)
    expect(request.textContent).toContain('it will be waiting in the message box')
  })

  it('leaves out the request block when there is none', async () => {
    renderOnboarding({ request: null })
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(screen.getByText('Connect an AI provider')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Your request' })).toBeNull()
  })

  it('puts the request in the input once OpenRouter connects', async () => {
    renderOnboarding()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('region', { name: 'Your request' })).toBeTruthy()

    act(() => postKeyFromPopup())

    await vi.waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(REQUEST)
    )
    expect(screen.queryByText('Connect an AI provider')).toBeNull()
  })

  it('puts the request in the input once a local model is chosen', async () => {
    renderOnboarding()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('region', { name: 'Your request' })).toBeTruthy()

    // What picking a model in Settings does
    act(() => useAgentModelStore.getState().setModel('webllm', WEBLLM_MODELS[0].id))

    await vi.waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(REQUEST)
    )
  })

  it('reports when onboarding is shown and when it is closed', async () => {
    const track = vi.spyOn(analytics, 'track')
    const onClose = vi.fn()
    renderOnboarding({ onClose })
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(track.mock.calls.filter(([event]) => event === 'assistant_onboarding_shown')).toEqual([
      ['assistant_onboarding_shown', { hasPendingRequest: true }],
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(track).toHaveBeenCalledWith('assistant_onboarding_closed', { hasPendingRequest: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Connected, the user reworks the quick start request, then disconnects
  async function editThenDisconnect(draft: string) {
    getKeysStore().setBrowserKey('openrouter', 'sk-or-v1-test')
    renderOnboarding()
    await vi.waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(REQUEST)
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: draft } })
    act(() => getKeysStore().clearBrowserKey('openrouter'))
    await vi.waitFor(() => expect(screen.getByText('Connect an AI provider')).toBeTruthy())
  }

  it('previews the edited draft after a disconnect, not the original request', async () => {
    const track = vi.spyOn(analytics, 'track')
    await editThenDisconnect('Map only the stations in Brooklyn')

    const request = screen.getByRole('region', { name: 'Your request' })
    expect(request.textContent).toContain('Map only the stations in Brooklyn')
    expect(request.textContent).not.toContain(REQUEST)
    expect(track).toHaveBeenLastCalledWith('assistant_onboarding_shown', {
      hasPendingRequest: true,
    })
  })

  it('leaves out the request block after a disconnect when the draft was cleared', async () => {
    const track = vi.spyOn(analytics, 'track')
    await editThenDisconnect('')

    expect(screen.queryByRole('region', { name: 'Your request' })).toBeNull()
    expect(track).toHaveBeenLastCalledWith('assistant_onboarding_shown', {
      hasPendingRequest: false,
    })
  })

  it('reports a shown onboarding with no request', async () => {
    const track = vi.spyOn(analytics, 'track')
    renderOnboarding({ request: null })
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(track).toHaveBeenCalledWith('assistant_onboarding_shown', { hasPendingRequest: false })
  })
})
