/**
 * Centralized keyboard shortcut manager
 *
 * Provides a single event listener for all keyboard shortcuts to avoid
 * multiple event listeners and ensure consistent input element filtering.
 */

type ShortcutHandler = (e: KeyboardEvent) => undefined | boolean

interface ShortcutRegistration {
  key: string
  handler: ShortcutHandler
  id: symbol
}

class KeyboardManager {
  private registrations: ShortcutRegistration[] = []
  private initialized = false

  /**
   * Check if the event target is an input element where we should NOT handle shortcuts
   */
  private isInputElement(target: EventTarget | null): boolean {
    if (!target) return false
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
  }

  /**
   * Handle keyup events and dispatch to registered handlers
   */
  private handleKeyUp = (e: KeyboardEvent) => {
    // Don't handle shortcuts when typing in input fields
    if (this.isInputElement(e.target)) return

    const key = e.key.toLowerCase()

    // Execute all handlers for this key
    // Handlers can return false to prevent further handlers from running
    for (const registration of this.registrations) {
      if (registration.key === key) {
        const result = registration.handler(e)
        if (result === false) {
          break
        }
      }
    }
  }

  /**
   * Register a keyboard shortcut handler
   * @param key - The key to listen for (case-insensitive)
   * @param handler - The handler function. Return false to prevent further handlers.
   * @returns Unregister function to remove the handler
   */
  register(key: string, handler: ShortcutHandler): () => void {
    const id = Symbol('shortcut')
    const registration: ShortcutRegistration = {
      key: key.toLowerCase(),
      handler,
      id,
    }
    this.registrations.push(registration)

    // Return unregister function
    return () => {
      const index = this.registrations.findIndex(r => r.id === id)
      if (index > -1) {
        this.registrations.splice(index, 1)
      }
    }
  }

  /**
   * Initialize the keyboard manager by adding the global event listener
   */
  init() {
    if (this.initialized) {
      console.warn('KeyboardManager already initialized')
      return
    }
    document.addEventListener('keyup', this.handleKeyUp)
    this.initialized = true
  }

  /**
   * Cleanup and remove all registrations
   */
  cleanup() {
    document.removeEventListener('keyup', this.handleKeyUp)
    this.initialized = false
    this.registrations = []
  }
}

// Export singleton instance
export const keyboardManager = new KeyboardManager()
