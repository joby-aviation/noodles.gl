import { act, cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { AUTH_MESSAGE_TYPE } from '../noodles/openrouter-oauth'
import { useAgentModelStore } from './agent/model-store'
import { DEFAULT_OPENROUTER_MODEL, resetOpenRouterCatalogue } from './agent/providers/openrouter'
import { ChatPanel } from './chat-panel'
import { globalContextManager } from './global-context-manager'
import type { NoodlesProject } from './types'

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
