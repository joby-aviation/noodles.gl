import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getKeysStore, useKeysStore } from '../noodles/keys-store'
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
