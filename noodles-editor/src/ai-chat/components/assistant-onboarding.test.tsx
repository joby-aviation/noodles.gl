import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import agentPrompt from '../../../../website/static/agent-prompt.txt?raw'
import claudeCodePrompt from '../../../../website/static/claude-code-prompt.txt?raw'
import { analytics } from '../../utils/analytics'
import { AssistantOnboarding } from './assistant-onboarding'

vi.mock('../../utils/analytics', () => ({
  analytics: { track: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(analytics.track).mockClear()
})

function renderOnboarding(blockedUrl: string | null = null) {
  const retryPopup = vi.fn()
  const view = render(
    <AssistantOnboarding
      connect={{
        status: blockedUrl ? 'connecting' : 'idle',
        error: null,
        blockedUrl,
        connect: vi.fn(),
        retryPopup,
      }}
      webgpuReady={false}
      openProviderSettings={vi.fn()}
      onClose={vi.fn()}
      freeModels={[]}
    />
  )
  return { ...view, retryPopup }
}

function renderBlocked() {
  return renderOnboarding('https://openrouter.ai/auth?code_challenge=abc')
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(writeText) } })
  return navigator.clipboard.writeText as ReturnType<typeof vi.fn>
}

describe('AssistantOnboarding with a blocked popup', () => {
  it('retries the popup from the click', () => {
    const { retryPopup } = renderBlocked()

    fireEvent.click(screen.getByRole('button', { name: 'Open it again' }))

    expect(retryPopup).toHaveBeenCalledOnce()
  })

  it('does not offer a link, whose tab could not finish the sign-in', () => {
    const { container } = renderBlocked()

    expect(container.querySelector('a[href*="openrouter.ai/auth"]')).toBeNull()
  })
})

describe('AssistantOnboarding coding agent card', () => {
  it('copies the shared quick start prompt and tracks the copy', async () => {
    const writeText = stubClipboard(() => Promise.resolve())
    renderOnboarding()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy Claude Code prompt' }))
    })

    expect(writeText).toHaveBeenCalledWith(claudeCodePrompt)
    expect(claudeCodePrompt).toContain('noodles-live')
    expect(screen.getByRole('button', { name: 'Copied. Paste it into Claude Code' })).toBeTruthy()
    expect(analytics.track).toHaveBeenCalledWith('agent_prompt_copied', {
      agent: 'claude_code',
      source: 'assistant_onboarding',
    })
  })

  it('copies the prompt for other agents', async () => {
    const writeText = stubClipboard(() => Promise.resolve())
    renderOnboarding()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy the prompt for other agents' }))
    })

    expect(writeText).toHaveBeenCalledWith(agentPrompt)
    expect(agentPrompt).toContain('codex mcp add webmcp')
    expect(screen.getByRole('button', { name: 'Copied. Paste it into your agent' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy Claude Code prompt' })).toBeTruthy()
    expect(analytics.track).toHaveBeenCalledWith('agent_prompt_copied', {
      agent: 'other',
      source: 'assistant_onboarding',
    })
  })

  it('links to the prompt when the browser blocks the copy', async () => {
    stubClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    const { container } = renderOnboarding()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy Claude Code prompt' }))
    })

    expect(container.querySelector('a[href$="/claude-code-prompt.txt"]')).toBeTruthy()
    expect(analytics.track).not.toHaveBeenCalled()
  })
})
