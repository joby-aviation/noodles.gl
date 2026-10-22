import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { AUTH_MESSAGE_TYPE } from '../noodles/openrouter-oauth'
import { useAgentModelStore } from './agent/model-store'
import { DEFAULT_OPENROUTER_MODEL, resetOpenRouterCatalogue } from './agent/providers/openrouter'
import { WEBLLM_MODELS } from './agent/providers/webllm'
import { ChatPanel } from './chat-panel'
import type { ContextLoader } from './context-loader'
import { globalContextManager } from './global-context-manager'
import type { NoodlesProject } from './types'

// The picker only shows once a session has started, and starting a real local model
// means a download
const createProvider = vi.hoisted(() =>
  vi.fn(async () => ({ model: 'stub', supportsNativeTools: false, contextWindow: 4096 }))
)
vi.mock('./agent/provider-factory', () => ({ createProvider }))

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
