// Drives the OpenRouter sign-in from the UI. Two callers — the chat panel's
// empty state and the settings dialog — so the popup lifecycle lives here rather
// than twice.
//
// The awkward part is knowing when the flow failed silently: a popup the user
// closes without authorizing sends nothing, so the only signal is `popup.closed`
// going true without a message having arrived. Hence the poll.

import { useCallback, useEffect, useRef, useState } from 'react'
import { analytics } from '../utils/analytics'
import { debugAiChat } from '../utils/debug'
import {
  AUTH_MESSAGE_TYPE,
  adoptOpenRouterKey,
  beginOpenRouterAuth,
  openAuthPopup,
} from './openrouter-oauth'

const POPUP_POLL_MS = 500

export type ConnectStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface OpenRouterConnect {
  status: ConnectStatus
  error: string | null
  // Set when the browser blocked the popup, so the caller can offer a button the
  // user clicks themselves
  blockedUrl: string | null
  connect: () => void
  // Reopens the blocked popup. Call it straight from a click handler: the click
  // is the user gesture that gets the popup past the blocker.
  retryPopup: () => void
  reset: () => void
}

export function useOpenRouterConnect(): OpenRouterConnect {
  const [status, setStatus] = useState<ConnectStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null)
  const popupRef = useRef<Window | null>(null)
  const settledRef = useRef(false)

  const reset = useCallback(() => {
    setStatus('idle')
    setError(null)
    setBlockedUrl(null)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; key?: string; error?: string } | null
      if (data?.type !== AUTH_MESSAGE_TYPE) return

      settledRef.current = true
      popupRef.current = null

      if (data.key) {
        adoptOpenRouterKey(data.key)
        setStatus('connected')
        setError(null)
        analytics.track('openrouter_oauth_completed', { outcome: 'success' })
        debugAiChat('[openrouter-oauth] key adopted from the popup')
        return
      }

      setStatus('error')
      setError(data.error ?? 'Sign-in did not complete.')
      analytics.track('openrouter_oauth_completed', { outcome: 'failed' })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Notices a popup the user dismissed. Without this the button stays in
  // "Connecting…" forever.
  useEffect(() => {
    if (status !== 'connecting') return

    const timer = window.setInterval(() => {
      if (!popupRef.current?.closed || settledRef.current) return

      popupRef.current = null
      setStatus('error')
      setError('The sign-in window closed before it finished. Try again.')
      analytics.track('openrouter_oauth_completed', { outcome: 'dismissed' })
    }, POPUP_POLL_MS)

    return () => window.clearInterval(timer)
  }, [status])

  const connect = useCallback(() => {
    settledRef.current = false
    setError(null)
    setBlockedUrl(null)
    setStatus('connecting')
    analytics.track('openrouter_oauth_started')

    beginOpenRouterAuth()
      .then(({ url, popup }) => {
        popupRef.current = popup
        if (!popup) {
          // Not an error yet: the link below will still work
          setBlockedUrl(url)
        }
      })
      .catch((cause: unknown) => {
        setStatus('error')
        setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [])

  // Same flow, same verifier: only the window failed to open. A plain link would
  // not do, since a new tab opened from one has no opener to post the key to and
  // no copy of the sessionStorage that holds the verifier.
  const retryPopup = useCallback(() => {
    if (!blockedUrl) return
    const popup = openAuthPopup(blockedUrl)
    if (!popup) return
    popupRef.current = popup
    setBlockedUrl(null)
  }, [blockedUrl])

  return { status, error, blockedUrl, connect, retryPopup, reset }
}
