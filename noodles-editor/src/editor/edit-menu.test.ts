import { afterEach, describe, expect, it } from 'vitest'
import { historyShortcut } from './edit-menu'

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  let step: ReturnType<typeof historyShortcut> = null
  const listen = (e: Event) => {
    step = historyShortcut(e as KeyboardEvent)
  }
  document.addEventListener('keydown', listen)
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  document.removeEventListener('keydown', listen)
  return step
}

describe('historyShortcut', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('undoes on mod+Z and redoes on mod+shift+Z and mod+Y, with Cmd or Ctrl', () => {
    expect(press('z', { metaKey: true })).toBe('undo')
    expect(press('z', { ctrlKey: true })).toBe('undo')
    expect(press('Z', { metaKey: true, shiftKey: true })).toBe('redo')
    expect(press('y', { ctrlKey: true })).toBe('redo')
  })

  it('ignores keys without a modifier, and other keys', () => {
    expect(press('z')).toBeNull()
    expect(press('c', { metaKey: true })).toBeNull()
  })

  it('leaves a text field its own undo', () => {
    const input = document.body.appendChild(document.createElement('input'))
    expect(press('z', { metaKey: true }, input)).toBeNull()
    const editor = document.body.appendChild(document.createElement('div'))
    editor.className = 'cm-editor'
    const line = editor.appendChild(document.createElement('div'))
    expect(press('z', { metaKey: true }, line)).toBeNull()
  })
})
