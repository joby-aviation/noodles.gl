import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shouldBlockKeyboardShortcut } from './input-detection'

describe('shouldBlockKeyboardShortcut', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it('should block shortcuts in INPUT elements', () => {
    const input = document.createElement('input')
    container.appendChild(input)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    input.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should block shortcuts in TEXTAREA elements', () => {
    const textarea = document.createElement('textarea')
    container.appendChild(textarea)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    textarea.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should block shortcuts in SELECT elements', () => {
    const select = document.createElement('select')
    container.appendChild(select)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    select.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should block shortcuts in contenteditable elements', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    container.appendChild(div)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    div.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should block shortcuts in .nokey containers', () => {
    const nokeyContainer = document.createElement('div')
    nokeyContainer.className = 'nokey'
    const button = document.createElement('button')
    nokeyContainer.appendChild(button)
    container.appendChild(nokeyContainer)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    button.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should block shortcuts in nested .nokey containers', () => {
    const nokeyContainer = document.createElement('div')
    nokeyContainer.className = 'nokey'
    const inner = document.createElement('div')
    const button = document.createElement('button')
    inner.appendChild(button)
    nokeyContainer.appendChild(inner)
    container.appendChild(nokeyContainer)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    button.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should allow shortcuts in regular elements', () => {
    const button = document.createElement('button')
    container.appendChild(button)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    button.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(false)
  })

  it('should allow shortcuts on document body', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    document.body.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(false)
  })

  it('should handle events with composedPath', () => {
    const input = document.createElement('input')
    container.appendChild(input)

    // Create event with composedPath
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true })
    Object.defineProperty(event, 'composedPath', {
      value: () => [input, container, document.body, document, window],
    })
    input.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should fallback to event.target when composedPath unavailable', () => {
    const input = document.createElement('input')
    container.appendChild(input)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    // Remove composedPath to test fallback
    Object.defineProperty(event, 'composedPath', { value: undefined })
    input.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should handle modifier key combinations', () => {
    const input = document.createElement('input')
    container.appendChild(input)

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
    })
    input.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should block Cmd+Z in textarea', () => {
    const textarea = document.createElement('textarea')
    container.appendChild(textarea)

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
    })
    textarea.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should allow space bar in regular context', () => {
    const button = document.createElement('button')
    container.appendChild(button)

    const event = new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    button.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(false)
  })

  it('should block space bar in input', () => {
    const input = document.createElement('input')
    container.appendChild(input)

    const event = new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    input.dispatchEvent(event)

    expect(shouldBlockKeyboardShortcut(event)).toBe(true)
  })

  it('should handle non-element targets gracefully', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    Object.defineProperty(event, 'target', { value: null })

    expect(shouldBlockKeyboardShortcut(event)).toBe(false)
  })

  it('should handle text nodes gracefully', () => {
    const textNode = document.createTextNode('text')
    container.appendChild(textNode)

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true })
    Object.defineProperty(event, 'target', { value: textNode })

    expect(shouldBlockKeyboardShortcut(event)).toBe(false)
  })
})
