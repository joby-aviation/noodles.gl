type ShortcutHandler = (e: KeyboardEvent) => undefined | boolean

interface ShortcutRegistration {
  key: string
  handler: ShortcutHandler
  id: symbol
}

class KeyboardManager {
  private registrations: ShortcutRegistration[] = []
  private initialized = false

  private isInputElement(target: EventTarget | null): boolean {
    if (!target) return false
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
  }

  private handleKeyUp = (e: KeyboardEvent) => {
    if (this.isInputElement(e.target)) return

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
