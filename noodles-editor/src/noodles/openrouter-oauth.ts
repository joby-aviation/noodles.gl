// OpenRouter's OAuth PKCE flow: the one way this app can get a working AI
// credential without the user visiting a console, generating a key, and pasting
// it into Settings.
//
// PKCE exists so a client that cannot keep a secret can still do OAuth, which is
// exactly this app's situation — a static bundle with no backend. There is no
// client id and no client secret: the proof is that whoever redeems the code also
// knows the verifier whose hash was sent when the flow started.
//
// Two things here are load-bearing:
//
// - The flow runs in a popup, not a top-level redirect. The editor holds unsaved
//   graph state, and navigating away from it to authorize a chat provider would
//   throw that away. The popup lands on /auth/openrouter, which loads this same
//   bundle, finishes the exchange, and posts the key back to the opener.
// - The verifier lives in sessionStorage rather than in memory, because the popup
//   is a different window with a different module instance. sessionStorage is
//   per-origin-per-tab; the popup opened from this tab shares it.

import { debugAiChat } from '../utils/debug'
import { getKeysStore } from './keys-store'

const AUTH_URL = 'https://openrouter.ai/auth'
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys'

// Where the popup lands. Must be an exact match for what was sent as
// callback_url, so both sides derive it from the same function.
const CALLBACK_PATH = '/auth/openrouter'

const VERIFIER_KEY = 'noodles-openrouter-verifier'
const RETURN_KEY = 'noodles-openrouter-return'

// Message the popup posts to its opener. Checked on the receiving side along with
// the origin, since any page can postMessage to a window it has a handle on.
export const AUTH_MESSAGE_TYPE = 'noodles:openrouter-auth'

export interface AuthMessage {
  type: typeof AUTH_MESSAGE_TYPE
  key?: string
  error?: string
}

const POPUP_WIDTH = 560
const POPUP_HEIGHT = 760

export function callbackUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
  return `${location.origin}${base}${CALLBACK_PATH}`
}

export interface AuthAttempt {
  // The authorization URL. Returned alongside the popup so a caller whose popup
  // was blocked can offer it as a link — a click is a user gesture, which is not
  // blocked — rather than dead-ending.
  url: string
  popup: Window | null
}

// Stores a fresh verifier and opens the authorization popup.
export async function beginOpenRouterAuth(): Promise<AuthAttempt> {
  const verifier = randomVerifier()
  const challenge = await codeChallenge(verifier)

  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(RETURN_KEY, location.pathname + location.search)

  const url = new URL(AUTH_URL)
  const callbackUrlValue = callbackUrl()

  url.searchParams.set('response_type', 'code')
  url.searchParams.set('callback_url', callbackUrlValue)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  debugAiChat('[openrouter-oauth] starting flow')
  debugAiChat('[openrouter-oauth] callback URL: %s', callbackUrlValue)
  debugAiChat('[openrouter-oauth] full auth URL: %s', url.toString())
  debugAiChat(
    '[openrouter-oauth] verifier length: %d, challenge length: %d',
    verifier.length,
    challenge.length
  )

  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - POPUP_WIDTH) / 2))
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - POPUP_HEIGHT) / 3))
  const popup = window.open(
    url.toString(),
    'openrouter-auth',
    `popup=1,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`
  )

  return { url: url.toString(), popup }
}

export type ExchangeResult = { ok: true; key: string } | { ok: false; error: string }

// Redeems the code for an API key. Runs in the popup, where the code is.
//
// The verifier is consumed whether or not the exchange succeeds: a code is
// single-use, so a retry needs a whole new flow rather than a second attempt
// against the same challenge.
export async function completeOpenRouterAuth(code: string): Promise<ExchangeResult> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)

  if (!verifier) {
    return {
      ok: false,
      error:
        'This sign-in did not start in this tab, so it cannot be completed here. Try connecting again.',
    }
  }

  let response: Response
  try {
    response = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
    })
  } catch (error) {
    return { ok: false, error: `Could not reach OpenRouter: ${describe(error)}` }
  }

  if (!response.ok) {
    return { ok: false, error: await describeFailure(response) }
  }

  let key: unknown
  try {
    key = ((await response.json()) as { key?: unknown }).key
  } catch {
    return { ok: false, error: 'OpenRouter returned a response this app could not read.' }
  }

  if (typeof key !== 'string' || !key) {
    return { ok: false, error: 'OpenRouter did not return an API key.' }
  }

  debugAiChat('[openrouter-oauth] exchange succeeded')
  return { ok: true, key }
}

// Stores the key and points the assistant at it. Runs in whichever window ends up
// holding the key — the opener when the popup could post back, the popup itself
// when it could not.
export function adoptOpenRouterKey(key: string) {
  const store = getKeysStore()
  store.setBrowserKey('openrouter', key)
  store.setProviderPreference('openrouter')
}

// Where to send the user after a flow that had to fall back to a full-page
// redirect. Defaults to the app root rather than the callback route, which would
// re-run the exchange against a spent code.
export function takeReturnPath(): string {
  const stored = sessionStorage.getItem(RETURN_KEY)
  sessionStorage.removeItem(RETURN_KEY)
  return stored || import.meta.env.BASE_URL
}

// 64 random bytes, base64url. The spec allows 43–128 characters; this lands at 86.
function randomVerifier(): string {
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

// base64url: base64 with the URL-unsafe characters swapped and the padding
// dropped, which is what OAuth wants and what btoa does not produce.
function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function describeFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    const message = parsed.error?.message ?? parsed.message
    if (message) return `OpenRouter ${response.status}: ${message}`
  } catch {
    // Not JSON; the status line is all there is
  }
  return `OpenRouter ${response.status} ${response.statusText}`
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|load failed|networkerror/i.test(message)) {
    return 'the request was blocked or the network is unavailable'
  }
  return message
}
