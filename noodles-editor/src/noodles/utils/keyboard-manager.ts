// Adapted from React Flow's keyboard handling approach
// https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/dom.ts

type ShortcutHandler = (e: KeyboardEvent) => undefined | boolean

interface ShortcutRegistration {
  key: string
  handler: ShortcutHandler
  id: symbol
}

const inputTags = ['INPUT', 'SELECT', 'TEXTAREA']

class KeyboardManager {
  private registrations: ShortcutRegistration[] = []
  private initialized = false

  private isInputDOMNode(event: KeyboardEvent): boolean {
    const target = (event.composedPath?.()?.[0] || event.target) as Element | null
    if (target?.nodeType !== 1) return false

    const isInput = inputTags.includes(target.nodeName) || target.hasAttribute('contenteditable')
    return isInput || !!target.closest('.nokey')
  }

  private handleKeyUp = (e: KeyboardEvent) => {
    if (this.isInputDOMNode(e)) return

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
