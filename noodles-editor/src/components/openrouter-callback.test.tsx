import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_MESSAGE_TYPE } from '../noodles/openrouter-oauth'
import { OpenRouterCallback } from './openrouter-callback'

const KEY = 'sk-or-v1-secret-test-key'
const CODE = 'secret-auth-code'

// Partial mock so the message contract (AUTH_MESSAGE_TYPE) stays the real one
vi.mock('../noodles/openrouter-oauth', async importOriginal => ({
  ...(await importOriginal<typeof import('../noodles/openrouter-oauth')>()),
  adoptOpenRouterKey: vi.fn(),
  completeOpenRouterAuth: vi.fn(async () => ({ ok: true, key: KEY })),
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
      { type: AUTH_MESSAGE_TYPE, key: KEY },
      window.location.origin
    )
  })
})
