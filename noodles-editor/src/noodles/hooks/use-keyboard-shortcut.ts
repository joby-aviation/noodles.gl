import { useEffect } from 'react'
import { keyboardManager } from '../utils/keyboard-manager'

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
