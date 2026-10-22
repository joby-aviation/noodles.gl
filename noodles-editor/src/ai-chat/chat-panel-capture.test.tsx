import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from '../noodles/keys-store'
import { createProvider } from './agent/provider-factory'
import { AgentSession } from './agent/session'
import type { AgentProvider } from './agent/types'
import { ChatPanel } from './chat-panel'
import type { ContextLoader } from './context-loader'
import { globalContextManager } from './global-context-manager'
import { MCPTools } from './mcp-tools'
import type { NoodlesProject } from './types'

vi.mock('./agent/provider-factory', () => ({ createProvider: vi.fn() }))

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
      <ChatPanel
        project={{ nodes: [], edges: [] } as NoodlesProject}
        onClose={() => {}}
        isVisible
      />
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
})
