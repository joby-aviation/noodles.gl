import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore, useKeysStore } from '../noodles/keys-store'
import { getLoadedGoogleMapsKey } from '../utils/geocoding'
import { KeyPrompts } from './key-prompts'

vi.mock('../utils/geocoding', () => ({ getLoadedGoogleMapsKey: vi.fn(() => null) }))

describe('KeyPrompts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    useKeysStore.setState({
      browserKeys: {},
      keyOverrides: {},
      projectKeys: undefined,
      projectId: undefined,
      projectKeyEdits: 0,
      ignoredProjectKeys: [],
      rejectedKeys: {},
    })
    getKeysStore().setProjectKeys({ googleMaps: 'project-google' }, '/projects/a')
    getKeysStore().setBrowserKey('googleMaps', 'browser-google')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.mocked(getLoadedGoogleMapsKey).mockReturnValue(null)
  })

  it('should keep the project key and not ask again', () => {
    render(<KeyPrompts />)
    expect(
      screen.getByText('This project uses its own Google Maps key instead of yours.')
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(getKeysStore().getKey('googleMaps')).toBe('project-google')
  })

  it('should switch to the user key and offer the project key back', () => {
    render(<KeyPrompts />)
    fireEvent.click(screen.getByRole('button', { name: 'Use mine' }))

    expect(getKeysStore().getKey('googleMaps')).toBe('browser-google')
    expect(screen.getByText('Using your browser Google Maps key for this project.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Use project key' }))
    expect(getKeysStore().getKey('googleMaps')).toBe('project-google')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('should offer the user key when Google rejects the project key', () => {
    getKeysStore().setKeyOverride('googleMaps', 'project')
    getKeysStore().reportKeyRejected('googleMaps', 'project-google')
    vi.mocked(getLoadedGoogleMapsKey).mockReturnValue('project-google')
    render(<KeyPrompts />)

    expect(
      screen.getByText("Google rejected the project's Google Maps key on this site.")
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use my browser key' }))
    expect(getKeysStore().getKey('googleMaps')).toBe('browser-google')
    expect(screen.getByText(/Reload the page to apply it/)).toBeTruthy()
  })

  it('should hide a dismissed prompt without recording a choice', () => {
    render(<KeyPrompts />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).toBeNull()
    expect(getKeysStore().keyOverrides).toEqual({})
  })
})
