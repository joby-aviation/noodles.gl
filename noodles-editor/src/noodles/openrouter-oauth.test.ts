import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore } from './keys-store'
import {
  adoptOpenRouterKey,
  beginOpenRouterAuth,
  callbackUrl,
  codeChallenge,
  completeOpenRouterAuth,
  takeReturnPath,
} from './openrouter-oauth'

const VERIFIER_KEY = 'noodles-openrouter-verifier'
const RETURN_KEY = 'noodles-openrouter-return'

beforeEach(() => {
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(RETURN_KEY)
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(RETURN_KEY)
  getKeysStore().clearBrowserKey('openrouter')
  getKeysStore().setProviderPreference('automatic')
})

// The challenge computed the way a server would, so the test does not just
// re-run the implementation.
async function expectedChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function stubOpen() {
  const popup = { closed: false } as Window
  const open = vi.fn(() => popup)
  vi.stubGlobal('open', open)
  return { open, popup }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('codeChallenge', () => {
  it('is the base64url-encoded SHA-256 of the verifier', async () => {
    expect(await codeChallenge('abc')).toBe(await expectedChallenge('abc'))
  })

  it('produces no base64 padding or URL-unsafe characters', async () => {
    // One verifier per iteration to shake out the +, / and = cases, which only
    // appear for some digests.
    for (let i = 0; i < 32; i++) {
      expect(await codeChallenge(`verifier-${i}`)).toMatch(/^[A-Za-z0-9\-_]+$/)
    }
  })
})

describe('beginOpenRouterAuth', () => {
  it('opens a popup whose challenge matches the stored verifier', async () => {
    const { open, popup } = stubOpen()

    const attempt = await beginOpenRouterAuth()

    expect(attempt.popup).toBe(popup)
    expect(open).toHaveBeenCalledOnce()

    const verifier = sessionStorage.getItem(VERIFIER_KEY)
    expect(verifier).toBeTruthy()
    // 43-128 characters per RFC 7636; 64 random bytes base64url is 86
    expect(verifier).toHaveLength(86)

    const url = new URL(attempt.url)
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('callback_url')).toBe(callbackUrl())
    expect(url.searchParams.get('code_challenge')).toBe(await expectedChallenge(verifier as string))
  })

  it('uses a fresh verifier for every attempt', async () => {
    stubOpen()

    await beginOpenRouterAuth()
    const first = sessionStorage.getItem(VERIFIER_KEY)
    await beginOpenRouterAuth()

    expect(sessionStorage.getItem(VERIFIER_KEY)).not.toBe(first)
  })

  it('still returns the authorization URL when the popup was blocked', async () => {
    vi.stubGlobal(
      'open',
      vi.fn(() => null)
    )

    const attempt = await beginOpenRouterAuth()

    expect(attempt.popup).toBeNull()
    expect(attempt.url).toContain('code_challenge=')
  })
})

describe('completeOpenRouterAuth', () => {
  it('posts the stored verifier and returns the key', async () => {
    sessionStorage.setItem(VERIFIER_KEY, 'stored-verifier')
    const fetchMock = vi.fn(async () => jsonResponse({ key: 'sk-or-v1-test' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeOpenRouterAuth('the-code')

    expect(result).toEqual({ ok: true, key: 'sk-or-v1-test' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/auth/keys')
    expect(JSON.parse(init.body as string)).toEqual({
      code: 'the-code',
      code_verifier: 'stored-verifier',
      code_challenge_method: 'S256',
    })
  })

  it('consumes the verifier, since a code cannot be redeemed twice', async () => {
    sessionStorage.setItem(VERIFIER_KEY, 'stored-verifier')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ key: 'sk-or-v1-test' }))
    )

    await completeOpenRouterAuth('the-code')

    expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull()
  })

  it('fails without contacting OpenRouter when no verifier was stored', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await completeOpenRouterAuth('the-code')

    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the server-supplied reason for a rejected code', async () => {
    sessionStorage.setItem(VERIFIER_KEY, 'stored-verifier')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'Invalid code' } }, 400))
    )

    const result = await completeOpenRouterAuth('spent-code')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('Invalid code')
  })

  it('reports a network failure as a reason rather than throwing', async () => {
    sessionStorage.setItem(VERIFIER_KEY, 'stored-verifier')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )

    const result = await completeOpenRouterAuth('the-code')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/could not reach openrouter/i)
  })

  it('rejects a 200 that carries no key', async () => {
    sessionStorage.setItem(VERIFIER_KEY, 'stored-verifier')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}))
    )

    const result = await completeOpenRouterAuth('the-code')

    expect(result.ok).toBe(false)
  })
})

describe('adoptOpenRouterKey', () => {
  it('stores the key as a browser key and selects the provider', () => {
    adoptOpenRouterKey('sk-or-v1-adopted')

    const store = getKeysStore()
    expect(store.getKey('openrouter')).toBe('sk-or-v1-adopted')
    expect(store.getActiveSource('openrouter')).toBe('browser')
    expect(store.getProviderPreference()).toBe('openrouter')
  })
})

describe('takeReturnPath', () => {
  it('returns the stored path once and then forgets it', () => {
    sessionStorage.setItem(RETURN_KEY, '/examples/nyc-taxis')

    expect(takeReturnPath()).toBe('/examples/nyc-taxis')
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull()
  })

  it('falls back to the app root rather than the callback route', () => {
    expect(takeReturnPath()).not.toContain('/auth/openrouter')
  })
})
