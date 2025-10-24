// GlobalContextManager - Singleton for eager context loading
// Loads context bundles immediately on app start and provides cached access

import { ContextLoader } from './context-loader'
import type { LoadProgress } from './types'

export type ContextLoadState =
  | { status: 'idle' }
  | { status: 'loading'; progress: LoadProgress }
  | { status: 'ready'; loader: ContextLoader }
  | { status: 'error'; error: Error }

type Listener = (state: ContextLoadState) => void

class GlobalContextManager {
  private static instance: GlobalContextManager | null = null
  private loader: ContextLoader | null = null
  private state: ContextLoadState = { status: 'idle' }
  private listeners = new Set<Listener>()
  private loadPromise: Promise<void> | null = null

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): GlobalContextManager {
    if (!GlobalContextManager.instance) {
      GlobalContextManager.instance = new GlobalContextManager()
    }
    return GlobalContextManager.instance
  }

  // Start loading context bundles (safe to call multiple times)
  startLoading(): Promise<void> {
    // If already loading or loaded, return existing promise/resolved
    if (this.loadPromise) {
      return this.loadPromise
    }

    if (this.state.status === 'ready') {
      return Promise.resolve()
    }

    this.loadPromise = this.loadInternal()
    return this.loadPromise
  }

  private async loadInternal(): Promise<void> {
    try {
      this.loader = new ContextLoader()

      await this.loader.load((progress) => {
        this.setState({ status: 'loading', progress })
      })

      this.setState({ status: 'ready', loader: this.loader })
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.setState({ status: 'error', error: err })
      throw err
    }
  }

  // Get current loader (or null if not ready)
  getLoader(): ContextLoader | null {
    return this.state.status === 'ready' ? this.state.loader : null
  }

  // Get current state
  getState(): ContextLoadState {
    return this.state
  }

  // Subscribe to state changes
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    // Immediately notify of current state
    listener(this.state)

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(newState: ContextLoadState) {
    this.state = newState
    this.listeners.forEach(listener => listener(newState))
  }

  // Wait for context to be ready
  async waitForReady(): Promise<ContextLoader> {
    const currentState = this.getState()

    if (currentState.status === 'ready') {
      return currentState.loader
    }

    if (currentState.status === 'error') {
      throw currentState.error
    }

    // Start loading if not already started
    await this.startLoading()

    const finalState = this.getState()
    if (finalState.status === 'ready') {
      return finalState.loader
    }

    throw new Error('Failed to load context')
  }
}

// Export singleton instance
export const globalContextManager = GlobalContextManager.getInstance()
