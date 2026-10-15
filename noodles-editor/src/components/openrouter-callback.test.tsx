import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenRouterCallback } from './openrouter-callback'

const KEY = 'sk-or-v1-secret-test-key'
const CODE = 'secret-auth-code'

vi.mock('../noodles/openrouter-oauth', () => ({
  AUTH_MESSAGE_TYPE: 'noodles-openrouter-auth',
  adoptOpenRouterKey: vi.fn(),
  callbackUrl: () => 'http://localhost/openrouter/callback',
  completeOpenRouterAuth: vi.fn(async () => ({ ok: true, key: KEY })),
  takeReturnPath: () => '/',
}))

describe('OpenRouterCallback', () => {
  const originalUrl = window.location.href
  const originalOpener = window.opener

  beforeEach(() => {
    window.history.replaceState({}, '', `?code=${CODE}`)
    // With an opener the page posts the key back instead of navigating the test page away
    window.opener = { postMessage: vi.fn() }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.opener = originalOpener
    window.history.replaceState({}, '', originalUrl)
  })

  it('never logs the authorization code or the API key', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<OpenRouterCallback />)
    // Timers are faked globally, so flush the exchange instead of polling with findBy*
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('Connected. You can close this window.')).toBeTruthy()

    const logged = JSON.stringify([...log.mock.calls, ...error.mock.calls])
    expect(logged).not.toContain(KEY)
    expect(logged).not.toContain(CODE)
    expect(window.opener.postMessage).toHaveBeenCalledWith(
      { type: 'noodles-openrouter-auth', key: KEY },
      window.location.origin
    )
  })
})
