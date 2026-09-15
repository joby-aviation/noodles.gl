// The page OpenRouter redirects to after the user authorizes. Loads this same
// bundle, redeems the code, and hands the key back to whoever started the flow.
//
// Two exits, because a popup is not guaranteed:
//
// - Opened as a popup: post the key to the opener and close. The editor never
//   navigated, so nothing was lost.
// - Opened at the top level (popup blocked and the user followed the link
//   themselves, or they reloaded this URL): store the key here and navigate back
//   to where the flow started.

import { type FC, useEffect, useState } from 'react'
import {
  adoptOpenRouterKey,
  AUTH_MESSAGE_TYPE,
  type AuthMessage,
  completeOpenRouterAuth,
  takeReturnPath,
} from '../noodles/openrouter-oauth'
import s from './openrouter-callback.module.css'

// Long enough to read a failure, short enough not to feel stuck
const CLOSE_DELAY_MS = 400
const ERROR_CLOSE_DELAY_MS = 6000

export const OpenRouterCallback: FC = () => {
  const [status, setStatus] = useState('Finishing sign-in…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      // Clear the code before doing anything with it: a reload of this URL would
      // otherwise retry an exchange whose verifier is already spent.
      window.history.replaceState({}, '', window.location.pathname)

      const result = code
        ? await completeOpenRouterAuth(code)
        : ({
            ok: false,
            error: params.get('error') ?? 'OpenRouter did not return an authorization code.',
          } as const)

      if (cancelled) return

      const opener = window.opener as Window | null
      if (opener) {
        const message: AuthMessage = result.ok
          ? { type: AUTH_MESSAGE_TYPE, key: result.key }
          : { type: AUTH_MESSAGE_TYPE, error: result.error }
        opener.postMessage(message, window.location.origin)
      }

      if (!result.ok) {
        setError(result.error)
        setStatus('Sign-in failed')
        if (opener) window.setTimeout(() => window.close(), ERROR_CLOSE_DELAY_MS)
        return
      }

      setStatus('Connected. You can close this window.')

      if (opener) {
        window.setTimeout(() => window.close(), CLOSE_DELAY_MS)
        return
      }

      // No opener, so this window is the app. Store the key here instead.
      adoptOpenRouterKey(result.key)
      window.location.replace(takeReturnPath())
    }

    run()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={s.page}>
      <h1 className={s.title}>{status}</h1>
      {error && <p className={s.error}>{error}</p>}
    </div>
  )
}
