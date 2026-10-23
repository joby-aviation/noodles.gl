import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Component, type ReactNode, Suspense } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StaleChunkPrompt } from '../components/stale-chunk-prompt'
import { analytics } from './analytics'
import {
  createStaleChunkHandler,
  installStaleChunkHandler,
  isStaleChunkError,
  lazyWithReload,
  RELOAD_GUARD_MS,
} from './stale-chunk'

const chromeError = () =>
  new TypeError(
    'Failed to fetch dynamically imported module: https://noodles.gl/app/assets/chat-panel-aio6f2W7.js'
  )

class Catch extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? <span>caught {this.state.error.message}</span> : this.props.children
  }
}

describe('isStaleChunkError', () => {
  it('matches each browser and the Vite CSS preload error', () => {
    expect(isStaleChunkError(chromeError())).toBe(true)
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: x'))).toBe(
      true
    )
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new Error('Unable to preload CSS for /app/assets/a.css'))).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isStaleChunkError(undefined)).toBe(false)
  })
})

describe('createStaleChunkHandler', () => {
  let reload: ReturnType<typeof vi.fn>
  let track: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    sessionStorage.clear()
    reload = vi.fn()
    track = vi.spyOn(analytics, 'track').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    sessionStorage.clear()
  })

  it('reloads once when there is no unsaved work', () => {
    const handler = createStaleChunkHandler({ reload })
    expect(handler.handle()).toBe('reloaded')
    expect(handler.handle()).toBe('reloaded')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('stale_chunk_reload', { action: 'reloaded' })
  })

  it('does not reload again within the guard window', () => {
    createStaleChunkHandler({ reload }).handle()
    // The page after the reload gets a fresh handler but the same sessionStorage
    vi.advanceTimersByTime(RELOAD_GUARD_MS - 1)
    const afterReload = createStaleChunkHandler({ reload })
    expect(afterReload.handle()).toBe('skipped')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenLastCalledWith('stale_chunk_reload', { action: 'skipped' })

    vi.advanceTimersByTime(1)
    expect(createStaleChunkHandler({ reload }).handle()).toBe('reloaded')
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('prompts instead of reloading when there is unsaved work', () => {
    const handler = createStaleChunkHandler({ reload })
    const listener = vi.fn()
    handler.subscribe(listener)
    handler.setUnsavedWork(true)

    expect(handler.handle()).toBe('prompted')
    expect(reload).not.toHaveBeenCalled()
    expect(handler.isPromptVisible()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('stale_chunk_reload', { action: 'prompted' })
  })

  it('still reloads when storage is unavailable', () => {
    const storage = () => {
      throw new Error('SecurityError')
    }
    expect(createStaleChunkHandler({ reload, storage }).handle()).toBe('reloaded')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('handles the vite:preloadError event without preventing its default', () => {
    const handler = createStaleChunkHandler({ reload })
    installStaleChunkHandler(handler)
    const event = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(event)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })

  describe('lazyWithReload', () => {
    const renderLazy = (
      factory: () => Promise<{ default: () => ReactNode }>,
      handler = createStaleChunkHandler({ reload })
    ) => {
      const Lazy = lazyWithReload(factory, handler)
      return render(
        <Suspense fallback={<span>loading</span>}>
          <Lazy />
        </Suspense>
      )
    }

    it('keeps the fallback up while the page reloads', async () => {
      renderLazy(() => Promise.reject(chromeError()))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(reload).toHaveBeenCalledTimes(1)
      expect(screen.getByText('loading')).toBeTruthy()
    })

    it('renders nothing and shows the prompt when there is unsaved work', async () => {
      const handler = createStaleChunkHandler({ reload })
      handler.setUnsavedWork(true)
      render(<StaleChunkPrompt handler={handler} />)
      const { container } = renderLazy(() => Promise.reject(chromeError()), handler)
      await act(() => vi.advanceTimersByTimeAsync(0))

      expect(container.textContent).toBe('')
      expect(screen.getByRole('status').textContent).toContain(
        'A new version of Noodles.gl is available'
      )

      fireEvent.click(screen.getByText('Reload'))
      expect(reload).toHaveBeenCalledTimes(1)
      // The manual reload arms the loop guard too
      expect(createStaleChunkHandler({ reload }).handle()).toBe('skipped')
    })

    it('hides the prompt when dismissed', async () => {
      const handler = createStaleChunkHandler({ reload })
      handler.setUnsavedWork(true)
      render(<StaleChunkPrompt handler={handler} />)
      act(() => {
        handler.handle()
      })
      fireEvent.click(screen.getByText('Dismiss'))
      expect(screen.queryByRole('status')).toBeNull()
    })

    it('rethrows errors that are not stale chunks', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const Lazy = lazyWithReload(
        () => Promise.reject(new Error('boom')),
        createStaleChunkHandler({ reload })
      )
      render(
        <Catch>
          <Suspense fallback={null}>
            <Lazy />
          </Suspense>
        </Catch>
      )
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByText('caught boom')).toBeTruthy()
      expect(reload).not.toHaveBeenCalled()
      expect(track).not.toHaveBeenCalled()
    })
  })
})
