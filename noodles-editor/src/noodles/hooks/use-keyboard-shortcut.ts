import { useEffect } from 'react'
import { keyboardManager } from '../utils/keyboard-manager'

/**
 * React hook for registering keyboard shortcuts
 *
 * @param key - The key to listen for (case-insensitive)
 * @param handler - The handler function. Return false to prevent further handlers.
 * @param deps - React dependencies array
 *
 * @example
 * useKeyboardShortcut('v', () => {
 *   createViewer()
 * }, [createViewer])
 */
export function useKeyboardShortcut(
  key: string,
  handler: (e: KeyboardEvent) => undefined | boolean,
  deps: React.DependencyList
) {
  useEffect(() => {
    const unregister = keyboardManager.register(key, handler)
    return unregister
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps array is passed as parameter
  }, deps)
}
