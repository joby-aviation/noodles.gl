// Adapted from React Flow's keyboard handling approach
// https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/dom.ts

import { shouldBlockKeyboardShortcut } from './input-detection'

type ShortcutHandler = (e: KeyboardEvent) => undefined | boolean

interface ShortcutRegistration {
  key: string
  handler: ShortcutHandler
  id: symbol
}

class KeyboardManager {
  private registrations: ShortcutRegistration[] = []
  private initialized = false

  private handleKeyUp = (e: KeyboardEvent) => {
    if (shouldBlockKeyboardShortcut(e)) return

    const key = e.key.toLowerCase()

    for (const registration of this.registrations) {
      if (registration.key === key) {
        const result = registration.handler(e)
        if (result === false) {
          break
        }
      }
    }
  }

  register(key: string, handler: ShortcutHandler): () => void {
    const id = Symbol('shortcut')
    const registration: ShortcutRegistration = {
      key: key.toLowerCase(),
      handler,
      id,
    }
    this.registrations.push(registration)

    return () => {
      const index = this.registrations.findIndex(r => r.id === id)
      if (index > -1) {
        this.registrations.splice(index, 1)
      }
    }
  }

  init() {
    if (this.initialized) {
      console.warn('KeyboardManager already initialized')
      return
    }
    document.addEventListener('keyup', this.handleKeyUp)
    this.initialized = true
  }

  cleanup() {
    document.removeEventListener('keyup', this.handleKeyUp)
    this.initialized = false
    this.registrations = []
  }
}

export const keyboardManager = new KeyboardManager()
