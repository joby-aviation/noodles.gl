import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from './keys-store'
import { AUTH_MESSAGE_TYPE } from './openrouter-oauth'
import { useOpenRouterConnect } from './use-openrouter-connect'

const VERIFIER_KEY = 'noodles-openrouter-verifier'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sessionStorage.removeItem(VERIFIER_KEY)
  getKeysStore().clearBrowserKey('openrouter')
  getKeysStore().setProviderPreference('automatic')
})

// First call is blocked, as the browser does when the click's user activation
// has lapsed by the time the async challenge is ready; later calls open.
function stubBlockedThenOpen() {
  const popup = { closed: false } as Window
  const open = vi.fn().mockReturnValueOnce(null).mockReturnValue(popup)
  vi.stubGlobal('open', open)
  return { open, popup }
}

async function connectBlocked() {
  const hook = renderHook(() => useOpenRouterConnect())
  act(() => hook.result.current.connect())
  await vi.waitFor(() => expect(hook.result.current.blockedUrl).not.toBeNull())
  return hook
}

describe('useOpenRouterConnect after a blocked popup', () => {
  it('retries in a popup that keeps the opener and the verifier', async () => {
    const { open } = stubBlockedThenOpen()
    const { result } = await connectBlocked()
    const blockedUrl = result.current.blockedUrl
    const verifier = sessionStorage.getItem(VERIFIER_KEY)

    act(() => result.current.retryPopup())

    expect(open).toHaveBeenCalledTimes(2)
    const [url, name, features] = open.mock.calls[1] as [string, string, string]
    expect(url).toBe(blockedUrl)
    expect(name).toBe('openrouter-auth')
    // noopener would leave the callback with no opener and no copy of the verifier
    expect(features).not.toMatch(/noopener|noreferrer/)
    // Same flow, so the verifier the challenge was derived from is still there
    expect(sessionStorage.getItem(VERIFIER_KEY)).toBe(verifier)
    expect(result.current.blockedUrl).toBeNull()
    expect(result.current.status).toBe('connecting')
  })

  it('adopts the key the retried popup posts back', async () => {
    stubBlockedThenOpen()
    const { result } = await connectBlocked()
    act(() => result.current.retryPopup())

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: AUTH_MESSAGE_TYPE, key: 'sk-or-v1-test' },
        })
      )
    })

    expect(result.current.status).toBe('connected')
    expect(getKeysStore().getKey('openrouter')).toBe('sk-or-v1-test')
  })

  it('notices when the retried popup is closed without finishing', async () => {
    const { popup } = stubBlockedThenOpen()
    const { result } = await connectBlocked()
    act(() => result.current.retryPopup())

    Object.assign(popup, { closed: true })
    await act(() => vi.advanceTimersByTimeAsync(500))

    expect(result.current.status).toBe('error')
  })

  it('keeps offering the retry if the browser blocks it too', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => null)
    )
    const { result } = await connectBlocked()
    const blockedUrl = result.current.blockedUrl

    act(() => result.current.retryPopup())

    expect(result.current.blockedUrl).toBe(blockedUrl)
  })
})
