import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { keyboardManager } from './keyboard-manager'

describe('KeyboardManager', () => {
	beforeEach(() => {
		keyboardManager.cleanup()
		keyboardManager.init()
	})

	afterEach(() => {
		keyboardManager.cleanup()
	})

	it('should register and trigger a keyboard shortcut', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		const event = new KeyboardEvent('keyup', { key: 'a' })
		document.dispatchEvent(event)

		expect(handler).toHaveBeenCalledTimes(1)
		expect(handler).toHaveBeenCalledWith(event)
	})

	it('should handle case-insensitive keys', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		const eventLower = new KeyboardEvent('keyup', { key: 'a' })
		document.dispatchEvent(eventLower)

		const eventUpper = new KeyboardEvent('keyup', { key: 'A' })
		document.dispatchEvent(eventUpper)

		expect(handler).toHaveBeenCalledTimes(2)
	})

	it('should unregister shortcuts', () => {
		const handler = vi.fn()
		const unregister = keyboardManager.register('a', handler)

		unregister()

		const event = new KeyboardEvent('keyup', { key: 'a' })
		document.dispatchEvent(event)

		expect(handler).not.toHaveBeenCalled()
	})

	it('should support multiple handlers for the same key', () => {
		const handler1 = vi.fn()
		const handler2 = vi.fn()
		keyboardManager.register('a', handler1)
		keyboardManager.register('a', handler2)

		const event = new KeyboardEvent('keyup', { key: 'a' })
		document.dispatchEvent(event)

		expect(handler1).toHaveBeenCalledTimes(1)
		expect(handler2).toHaveBeenCalledTimes(1)
	})

	it('should stop propagation when handler returns false', () => {
		const handler1 = vi.fn(() => false)
		const handler2 = vi.fn()
		keyboardManager.register('a', handler1)
		keyboardManager.register('a', handler2)

		const event = new KeyboardEvent('keyup', { key: 'a' })
		document.dispatchEvent(event)

		expect(handler1).toHaveBeenCalledTimes(1)
		expect(handler2).not.toHaveBeenCalled()
	})

	it('should not trigger shortcuts when typing in input fields', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		const input = document.createElement('input')
		document.body.appendChild(input)

		const event = new KeyboardEvent('keyup', { key: 'a', bubbles: true })
		input.dispatchEvent(event)

		expect(handler).not.toHaveBeenCalled()

		document.body.removeChild(input)
	})

	it('should not trigger shortcuts when typing in textarea', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		const textarea = document.createElement('textarea')
		document.body.appendChild(textarea)

		const event = new KeyboardEvent('keyup', { key: 'a', bubbles: true })
		textarea.dispatchEvent(event)

		expect(handler).not.toHaveBeenCalled()

		document.body.removeChild(textarea)
	})

	it('should not trigger shortcuts when typing in select', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		const select = document.createElement('select')
		document.body.appendChild(select)

		const event = new KeyboardEvent('keyup', { key: 'a', bubbles: true })
		select.dispatchEvent(event)

		expect(handler).not.toHaveBeenCalled()

		document.body.removeChild(select)
	})

	it('should not trigger shortcuts when typing in contenteditable', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		const div = document.createElement('div')
		div.setAttribute('contenteditable', 'true')
		document.body.appendChild(div)

		const event = new KeyboardEvent('keyup', { key: 'a', bubbles: true })
		div.dispatchEvent(event)

		expect(handler).not.toHaveBeenCalled()

		document.body.removeChild(div)
	})

	it('should not trigger shortcuts inside .nokey elements', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		const container = document.createElement('div')
		container.className = 'nokey'
		const button = document.createElement('button')
		container.appendChild(button)
		document.body.appendChild(container)

		const event = new KeyboardEvent('keyup', { key: 'a', bubbles: true })
		button.dispatchEvent(event)

		expect(handler).not.toHaveBeenCalled()

		document.body.removeChild(container)
	})

	it('should trigger shortcuts from regular elements', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		const button = document.createElement('button')
		document.body.appendChild(button)

		const event = new KeyboardEvent('keyup', { key: 'a', bubbles: true })
		button.dispatchEvent(event)

		expect(handler).toHaveBeenCalledTimes(1)

		document.body.removeChild(button)
	})

	it('should warn when initializing twice', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

		keyboardManager.init()

		expect(warnSpy).toHaveBeenCalledWith('KeyboardManager already initialized')

		warnSpy.mockRestore()
	})

	it('should clean up all registrations on cleanup', () => {
		const handler = vi.fn()
		keyboardManager.register('a', handler)

		keyboardManager.cleanup()
		keyboardManager.init()

		const event = new KeyboardEvent('keyup', { key: 'a' })
		document.dispatchEvent(event)

		expect(handler).not.toHaveBeenCalled()
	})
})
