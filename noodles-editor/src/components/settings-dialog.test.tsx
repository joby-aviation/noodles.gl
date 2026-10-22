import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getKeysStore, useKeysStore } from '../noodles/keys-store'
import { getGitSettings } from '../noodles/utils/git-settings'
import { SettingsDialog } from './settings-dialog'

describe('SettingsDialog API keys', () => {
  beforeEach(() => {
    localStorage.clear()
    useKeysStore.setState({
      browserKeys: {},
      saveInProject: false,
      projectKeys: undefined,
      ignoredProjectKeys: [],
    })
  })

  afterEach(() => {
    cleanup()
  })

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

    expect(screen.getByText('project-mapbox')).toBeTruthy()
    expect(screen.queryByText('project-anthropic')).toBeNull()
  })

  it('should say when the project file had an AI key that was ignored', () => {
    getKeysStore().setProjectKeys({ anthropic: 'project-anthropic' })
    openApiKeysTab()

    expect(screen.getByText(/This project file included an Anthropic key/)).toBeTruthy()
    expect(screen.queryByText(/This project file included an OpenRouter key/)).toBeNull()
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
