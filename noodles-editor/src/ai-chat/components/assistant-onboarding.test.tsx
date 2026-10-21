import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantOnboarding } from './assistant-onboarding'

afterEach(() => {
  cleanup()
})

function renderBlocked() {
  const retryPopup = vi.fn()
  const view = render(
    <AssistantOnboarding
      connect={{
        status: 'connecting',
        error: null,
        blockedUrl: 'https://openrouter.ai/auth?code_challenge=abc',
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
