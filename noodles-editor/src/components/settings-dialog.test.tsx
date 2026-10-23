import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore, useKeysStore } from '../noodles/keys-store'
import { getGitSettings } from '../noodles/utils/git-settings'
import { getLoadedGoogleMapsKey } from '../utils/geocoding'
import { SettingsDialog } from './settings-dialog'

vi.mock('../utils/geocoding', () => ({ getLoadedGoogleMapsKey: vi.fn(() => null) }))

describe('SettingsDialog API keys', () => {
  beforeEach(() => {
    localStorage.clear()
    useKeysStore.setState({
      browserKeys: {},
      keyOverrides: {},
      projectKeys: undefined,
      projectId: undefined,
      projectKeyEdits: 0,
      ignoredProjectKeys: [],
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  // The label sits in the group's header
  function keyGroup(label: string) {
    return screen.getByText(label).parentElement!.parentElement!
  }

  function openApiKeysTab() {
    render(<SettingsDialog open setOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'API Keys' }))
  }

  it('should show a project map key but never a project AI key', () => {
    // Bypasses setProjectKeys so the dialog's own handling is what is tested
    useKeysStore.setState({
      projectKeys: { mapbox: 'project-mapbox', anthropic: 'project-anthropic' },
    })
    openApiKeysTab()

    expect(screen.getByDisplayValue('project-mapbox')).toBeTruthy()
    expect(screen.queryByDisplayValue('project-anthropic')).toBeNull()
    expect(screen.queryByRole('textbox', { name: /Anthropic.*\(project\)/ })).toBeNull()
  })

  it('should say when the project file had an AI key that was ignored', () => {
    getKeysStore().setProjectKeys({ anthropic: 'project-anthropic' })
    openApiKeysTab()

    expect(screen.getByText(/This project file included an Anthropic key/)).toBeTruthy()
    expect(screen.queryByText(/This project file included an OpenRouter key/)).toBeNull()
  })

  it('should edit the project key', () => {
    getKeysStore().setProjectKeys(undefined, 'project-a')
    openApiKeysTab()
    fireEvent.change(screen.getByRole('textbox', { name: 'Google Maps API Key (project)' }), {
      target: { value: 'project-google' },
    })

    expect(getKeysStore().projectKeys).toEqual({ googleMaps: 'project-google' })
    expect(getKeysStore().projectKeyEdits).toBe(1)
  })

  it('should switch between the project key and the browser key', () => {
    vi.stubEnv('VITE_CESIUM_ACCESS_TOKEN', '')
    getKeysStore().setProjectKeys({ cesium: 'project-cesium' }, 'project-a')
    getKeysStore().setBrowserKey('cesium', 'browser-cesium')
    openApiKeysTab()

    const group = keyGroup('Cesium Ion Access Token')
    fireEvent.click(within(group).getByRole('button', { name: 'Use' }))
    expect(getKeysStore().getKey('cesium')).toBe('browser-cesium')
    expect(within(group).getByText(/Using your browser key for this project/)).toBeTruthy()

    fireEvent.click(within(group).getByRole('button', { name: 'Use' }))
    expect(getKeysStore().getKey('cesium')).toBe('project-cesium')
    expect(within(group).queryByText(/Using your browser key/)).toBeNull()
  })

  it('should ask for a reload when Google Maps loaded with another key', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    vi.mocked(getLoadedGoogleMapsKey).mockReturnValue('project-google')
    getKeysStore().setProjectKeys({ googleMaps: 'project-google' }, '/projects/a')
    getKeysStore().setBrowserKey('googleMaps', 'browser-google')
    openApiKeysTab()

    const group = keyGroup('Google Maps API Key')
    expect(within(group).queryByRole('button', { name: 'Reload to apply' })).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Use' }))
    expect(within(group).getByRole('button', { name: 'Reload to apply' })).toBeTruthy()
    vi.mocked(getLoadedGoogleMapsKey).mockReturnValue(null)
  })

  it('should not offer a choice without a project key', () => {
    vi.stubEnv('VITE_CESIUM_ACCESS_TOKEN', 'env-cesium')
    getKeysStore().setProjectKeys(undefined, 'project-a')
    getKeysStore().setBrowserKey('cesium', 'browser-cesium')
    openApiKeysTab()

    const group = keyGroup('Cesium Ion Access Token')
    expect(within(group).queryByRole('button', { name: 'Use' })).toBeNull()
  })

  it('should not offer to save browser keys in the project file', () => {
    openApiKeysTab()

    expect(screen.queryByText(/Save browser keys in project file/)).toBeNull()
  })

  it('should not mention ignored keys for a project without AI keys', () => {
    getKeysStore().setProjectKeys({ mapbox: 'project-mapbox' })
    openApiKeysTab()

    expect(screen.queryByText(/This project file included/)).toBeNull()
  })
})

describe('SettingsDialog version control', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  function openVersionControlTab(projectName: string | null) {
    render(<SettingsDialog open setOpen={() => {}} projectName={projectName} />)
    fireEvent.click(screen.getByRole('button', { name: 'Version Control' }))
  }

  it('should change settings for the open project only', () => {
    openVersionControlTab('project-a')
    const enable = screen.getByRole('checkbox', { name: /Enable version control/ })
    fireEvent.click(enable)

    expect((enable as HTMLInputElement).checked).toBe(false)
    expect(getGitSettings('project-a').enabled).toBe(false)
    expect(getGitSettings('project-b').enabled).toBe(true)
  })

  it('should not offer project settings without a saved project', () => {
    openVersionControlTab(null)
    const enable = screen.getByRole('checkbox', { name: /Enable version control/ })

    expect((enable as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/Save the project to a folder/)).toBeTruthy()
  })
})
