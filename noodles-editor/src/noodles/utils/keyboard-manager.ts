// Adapted from React Flow's keyboard handling approach
// https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/dom.ts

type ShortcutHandler = (e: KeyboardEvent) => undefined | boolean

interface ShortcutDescriptor {
  key: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

interface ShortcutRegistration {
  shortcut: ShortcutDescriptor
  handler: ShortcutHandler
  id: symbol
  useKeyDown: boolean // true for modifier shortcuts, false for single keys
}

const inputTags = ['INPUT', 'SELECT', 'TEXTAREA']

// Parse a shortcut string into a descriptor.
// Supports formats like: "a", "cmd+a", "ctrl+a", "ctrl+shift+s", "meta+a"
// - "cmd" and "meta" both map to metaKey (Cmd on Mac)
// - "ctrl" maps to ctrlKey
// - "shift" maps to shiftKey
// - "alt" and "option" map to altKey
function parseShortcut(shortcut: string): ShortcutDescriptor {
  const parts = shortcut.toLowerCase().split('+')
  const descriptor: ShortcutDescriptor = {
    key: '',
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
  }

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        descriptor.ctrl = true
        break
      case 'cmd':
      case 'meta':
        descriptor.meta = true
        break
      case 'shift':
        descriptor.shift = true
        break
      case 'alt':
      case 'option':
        descriptor.alt = true
        break
      default:
        descriptor.key = part
    }
  }

  return descriptor
}

// Check if a shortcut descriptor has any modifier keys.
function hasModifiers(shortcut: ShortcutDescriptor): boolean {
  return shortcut.ctrl || shortcut.meta || shortcut.shift || shortcut.alt
}

// Check if a keyboard event matches a shortcut descriptor.
function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDescriptor): boolean {
  const key = event.key.toLowerCase()

  // For modifier shortcuts, check exact modifier state
  if (hasModifiers(shortcut)) {
    // Allow either ctrl or meta for cross-platform compatibility
    const modifierMatch =
      shortcut.ctrl === event.ctrlKey &&
      shortcut.meta === event.metaKey &&
      shortcut.shift === event.shiftKey &&
      shortcut.alt === event.altKey

    return key === shortcut.key && modifierMatch
  }

  // For single-key shortcuts, ensure no modifiers are pressed
  return (
    key === shortcut.key && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
  )
}

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

    for (const registration of this.registrations) {
      if (!registration.useKeyDown && matchesShortcut(e, registration.shortcut)) {
        const result = registration.handler(e)
        if (result === false) {
          break
        }
      }
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.isInputDOMNode(e)) return

    for (const registration of this.registrations) {
      if (registration.useKeyDown && matchesShortcut(e, registration.shortcut)) {
        const result = registration.handler(e)
        if (result === false) {
          break
        }
      }
    }
  }

  // Register a keyboard shortcut handler.
  // shortcut: The shortcut string (e.g., "a", "cmd+a", "ctrl+shift+s")
  // handler: The handler function, return false to stop propagation
  // Returns an unregister function
  register(shortcut: string, handler: ShortcutHandler): () => void {
    const id = Symbol('shortcut')
    const parsed = parseShortcut(shortcut)
    const registration: ShortcutRegistration = {
      shortcut: parsed,
      handler,
      id,
      useKeyDown: hasModifiers(parsed), // Use keydown for modifier shortcuts
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
    document.addEventListener('keydown', this.handleKeyDown)
    this.initialized = true
  }

  cleanup() {
    document.removeEventListener('keyup', this.handleKeyUp)
    document.removeEventListener('keydown', this.handleKeyDown)
    this.initialized = false
    this.registrations = []
  }
}

export const keyboardManager = new KeyboardManager()
