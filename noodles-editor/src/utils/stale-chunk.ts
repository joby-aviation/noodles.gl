// Recovery for code-split chunks that disappear after a deploy. A tab opened before the deploy
// still asks for the old hashed files, which Cloudflare Pages no longer serves, so a lazy import
// fails. Reloading loads the new build. When a reload would discard work (the editor's
// beforeunload guard is armed) or could loop (the reload guard cannot be stored), a prompt asks
// the user to save and reload instead.
import { type ComponentType, lazy } from 'react'
import { analytics } from './analytics'

export type StaleChunkAction = 'reloaded' | 'prompted' | 'skipped'

const RELOAD_KEY = 'noodles-stale-chunk-reload'
// A chunk still missing this soon after a reload is not stale, so reloading again would loop
export const RELOAD_GUARD_MS = 10_000

// Chrome, Firefox and Safari word a failed dynamic import differently. The last one is Vite's
// error for a CSS file a dynamic import depends on.
const STALE_CHUNK_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return STALE_CHUNK_RE.test(message)
}

interface StaleChunkOptions {
  reload?: () => void
  storage?: () => Storage
}

export function createStaleChunkHandler({
  reload = () => window.location.reload(),
  storage = () => window.sessionStorage,
}: StaleChunkOptions = {}) {
  let action: StaleChunkAction | null = null
  let unsavedWork = false
  let promptVisible = false
  const listeners = new Set<() => void>()

  const setPromptVisible = (visible: boolean) => {
    promptVisible = visible
    for (const listener of listeners) listener()
  }

  const reloadedRecently = () => {
    try {
      const last = Number(storage().getItem(RELOAD_KEY))
      return last > 0 && Date.now() - last < RELOAD_GUARD_MS
    } catch {
      return false
    }
  }

  // Records the reload so the next page load can tell a stale chunk from a missing one
  const storeGuard = () => {
    try {
      storage().setItem(RELOAD_KEY, String(Date.now()))
      return true
    } catch {
      return false
    }
  }

  // The user chose to reload, so it goes ahead even if the guard could not be stored
  const reloadNow = () => {
    storeGuard()
    reload()
  }

  return {
    // Mirrors the editor's beforeunload guard, which would otherwise block an automatic reload
    setUnsavedWork(value: boolean) {
      unsavedWork = value
    },

    // Decides once per page load. A failing chunk is often requested many times; a later
    // failure only brings back a prompt the user dismissed.
    handle(): StaleChunkAction {
      if (action) {
        if (action === 'prompted' && !promptVisible) setPromptVisible(true)
        return action
      }
      if (unsavedWork) action = 'prompted'
      else if (reloadedRecently()) action = 'skipped'
      // Without a stored guard a chunk that stays missing would reload the page forever
      else if (!storeGuard()) action = 'prompted'
      else action = 'reloaded'

      analytics.track('stale_chunk_reload', { action })
      if (action === 'prompted') setPromptVisible(true)
      if (action === 'reloaded') reload()
      return action
    },

    reloadNow,
    dismissPrompt: () => setPromptVisible(false),
    isPromptVisible: () => promptVisible,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type StaleChunkHandler = ReturnType<typeof createStaleChunkHandler>

export const staleChunk = createStaleChunkHandler()

// Vite fires this when a dynamic import or one of its CSS files fails to load (in builds only).
// It covers dynamic imports outside React.lazy. The default is not prevented, so the import
// still rejects and callers see the original error.
export function installStaleChunkHandler(handler: StaleChunkHandler = staleChunk) {
  window.addEventListener('vite:preloadError', () => handler.handle())
}

// React.lazy that survives a stale chunk. While the page reloads the Suspense fallback stays up,
// and when the user is prompted the component renders nothing instead of crashing the editor.
// biome-ignore lint/suspicious/noExplicitAny: matches React.lazy's own constraint
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  handler: StaleChunkHandler = staleChunk
) {
  return lazy(() =>
    factory().catch(error => {
      if (!isStaleChunkError(error)) throw error
      const action = handler.handle()
      if (action === 'reloaded') return new Promise<never>(() => {})
      if (action === 'prompted') return { default: (() => null) as unknown as T }
      throw error
    })
  )
}
