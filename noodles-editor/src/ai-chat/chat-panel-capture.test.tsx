import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { createProvider } from './agent/provider-factory'
import { OpenRouterProvider, resetOpenRouterCatalogue } from './agent/providers/openrouter'
import { AgentSession } from './agent/session'
import type { AgentProvider } from './agent/types'
import { ChatPanel } from './chat-panel'
import type { ContextLoader } from './context-loader'
import { globalContextManager } from './global-context-manager'
import { MCPTools } from './mcp-tools'

vi.mock('./agent/provider-factory', async importOriginal => ({
  ...(await importOriginal<typeof import('./agent/provider-factory')>()),
  createProvider: vi.fn(),
}))

function fakeProvider(supportsImages: boolean): AgentProvider {
  return {
    id: 'anthropic',
    model: 'test-model',
    supportsNativeTools: true,
    supportsImages,
    contextWindow: 200_000,
    async *stream() {},
  }
}

async function renderReadyPanel() {
  render(
    <ReactFlowProvider>
      <ChatPanel onClose={() => {}} isVisible />
    </ReactFlowProvider>
  )
  await vi.waitFor(() => expect(screen.getByPlaceholderText('Ask for help...')).toBeTruthy())
}

beforeEach(() => {
  getKeysStore().setBrowserKey('anthropic', 'sk-ant-test')
  vi.spyOn(globalContextManager, 'waitForReady').mockResolvedValue({} as ContextLoader)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  getKeysStore().clearBrowserKey('anthropic')
})

describe('ChatPanel screenshot capture', () => {
  it('hides Capture when the model cannot take images', async () => {
    vi.mocked(createProvider).mockResolvedValue(fakeProvider(false))
    await renderReadyPanel()

    expect(screen.queryByTitle('Capture current visualization')).toBeNull()
  })

  it('attaches a capture to the next message, then clears it', async () => {
    vi.mocked(createProvider).mockResolvedValue(fakeProvider(true))
    vi.spyOn(MCPTools.prototype, 'captureVisualization').mockResolvedValue({
      success: true,
      data: { screenshot: 'base64-image', format: 'png' },
    })
    const sendSpy = vi
      .spyOn(AgentSession.prototype, 'send')
      .mockResolvedValue({ message: 'It shows points.', toolCalls: [] })
    await renderReadyPanel()

    await act(async () => {
      fireEvent.click(screen.getByTitle('Capture current visualization'))
    })
    expect(screen.getByText('📸 Attached')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'What do you see?' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ screenshot: 'base64-image', screenshotFormat: 'png' })
    )
    await vi.waitFor(() => expect(screen.getByText('📸 Capture')).toBeTruthy())
  })

  it('keeps a capture taken while the previous reply streams', async () => {
    vi.mocked(createProvider).mockResolvedValue(fakeProvider(true))
    const capture = vi.spyOn(MCPTools.prototype, 'captureVisualization').mockResolvedValue({
      success: true,
      data: { screenshot: 'first-image', format: 'png' },
    })
    let finishReply: (value: { message: string; toolCalls: [] }) => void = () => {}
    const sendSpy = vi.spyOn(AgentSession.prototype, 'send').mockImplementation(
      () =>
        new Promise(resolve => {
          finishReply = resolve
        })
    )
    await renderReadyPanel()

    await act(async () => {
      fireEvent.click(screen.getByTitle('Capture current visualization'))
    })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'What do you see?' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ screenshot: 'first-image' }))
    // Consumed as soon as it was sent
    expect(screen.getByText('📸 Capture')).toBeTruthy()

    // Captured for the next message while the reply is still streaming
    capture.mockResolvedValue({
      success: true,
      data: { screenshot: 'second-image', format: 'png' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTitle('Capture current visualization'))
    })
    expect(screen.getByText('📸 Attached')).toBeTruthy()

    await act(async () => {
      finishReply({ message: 'It shows points.', toolCalls: [] })
    })
    await vi.waitFor(() => expect(screen.getByText('It shows points.')).toBeTruthy())
    expect(screen.getByText('📸 Attached')).toBeTruthy()
  })
})

describe('ChatPanel screenshot capture on OpenRouter', () => {
  beforeEach(() => {
    getKeysStore().setBrowserKey('openrouter', 'sk-or-test')
    getKeysStore().setProviderPreference('openrouter')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetOpenRouterCatalogue()
    getKeysStore().clearBrowserKey('openrouter')
    getKeysStore().setProviderPreference('automatic')
  })

  it('shows Capture once the catalogue says a restored model takes images', async () => {
    let deliverCatalogue: () => void = () => {}
    const catalogue = new Promise<Response>(resolve => {
      deliverCatalogue = () =>
        resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'vendor/vision',
                  name: 'Vendor Vision',
                  context_length: 64_000,
                  pricing: { prompt: '0', completion: '0' },
                  supported_parameters: ['tools'],
                  architecture: { input_modalities: ['text', 'image'] },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => catalogue)
    )
    // Built before the catalogue lands, as a restored model is
    vi.mocked(createProvider).mockImplementation(
      async () => new OpenRouterProvider({ apiKey: 'sk-or-test', model: 'vendor/vision' })
    )
    await renderReadyPanel()

    expect(screen.queryByTitle('Capture current visualization')).toBeNull()

    await act(async () => {
      deliverCatalogue()
    })
    await vi.waitFor(() => expect(screen.getByTitle('Capture current visualization')).toBeTruthy())
  })
})
