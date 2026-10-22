import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissOnDeviceNotice, OnDeviceNotice, onDeviceNoticeDismissed } from './on-device-notice'

describe('OnDeviceNotice', () => {
  afterEach(() => {
    cleanup()
    localStorage.removeItem('noodles-on-device-notice-dismissed')
  })

  it('offers setup when no hosted provider is ready', () => {
    const onUseCloud = vi.fn()
    render(<OnDeviceNotice variant="banner" cloudLabel={null} onUseCloud={onUseCloud} />)

    fireEvent.click(screen.getByRole('button', { name: 'Set up a cloud model' }))

    expect(onUseCloud).toHaveBeenCalledOnce()
    expect(screen.getByRole('note').textContent).toContain('Too slow?')
  })

  // A key is already saved, so the one click should be the whole fix
  it('offers a switch when a hosted provider is ready', () => {
    render(<OnDeviceNotice variant="banner" cloudLabel="OpenRouter" onUseCloud={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Switch to OpenRouter' })).toBeTruthy()
  })

  it('can be dismissed only where a dismiss handler is given', () => {
    const onDismiss = vi.fn()
    render(
      <OnDeviceNotice
        variant="banner"
        cloudLabel={null}
        onUseCloud={vi.fn()}
        onDismiss={onDismiss}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()

    cleanup()
    render(<OnDeviceNotice variant="slow-reply" cloudLabel={null} onUseCloud={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it('remembers a dismissal', () => {
    expect(onDeviceNoticeDismissed()).toBe(false)
    dismissOnDeviceNotice()
    expect(onDeviceNoticeDismissed()).toBe(true)
  })
})
