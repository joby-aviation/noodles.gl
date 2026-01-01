import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { analytics } from '../utils/analytics'
import {
  type KeysConfig,
  getKeysFromStorage,
  saveKeysToStorage,
  keysManager,
  maskKey,
} from '../utils/keys-manager'
import s from './settings-dialog.module.css'

interface SettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
}

export function SettingsDialog({ open, setOpen }: SettingsDialogProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [keys, setKeys] = useState<KeysConfig>({})
  const [saveInProject, setSaveInProject] = useState(false)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [projectKeys, setProjectKeys] = useState<KeysConfig>({})
  const [envKeys, setEnvKeys] = useState<KeysConfig>({})

  useEffect(() => {
    if (!open) return // Skip if dialog is closed

    // Analytics consent
    const consent = analytics.getConsent()
    setAnalyticsEnabled(consent?.enabled ?? false)

    // localStorage keys
    const stored = getKeysFromStorage()
    setKeys(stored.keys)
    setSaveInProject(stored.saveInProject)

    // Project keys
    const projectKeysFromManager = keysManager.getProjectKeys() || {}
    setProjectKeys(projectKeysFromManager)

    // Environment keys
    const envKeysFound = keysManager.getEnvKeys()
    setEnvKeys(envKeysFound)
  }, [open])

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabled(enabled)
    analytics.setConsent(enabled)

    if (enabled) {
      analytics.track('analytics_enabled_in_settings')
    }
  }

  const handleKeyChange = (key: keyof KeysConfig, value: string) => {
    const newKeys = { ...keys, [key]: value }
    setKeys(newKeys)
    saveKeysToStorage(newKeys, saveInProject)
  }

  const handleSaveInProjectToggle = (enabled: boolean) => {
    setSaveInProject(enabled)
    saveKeysToStorage(keys, enabled)

    if (enabled) {
      analytics.track('keys_save_in_project_enabled')
    }
  }

  const toggleShowKey = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleClearKey = (key: keyof KeysConfig) => {
    const newKeys = { ...keys }
    delete newKeys[key]
    setKeys(newKeys)
    saveKeysToStorage(newKeys, saveInProject)

    analytics.track('key_cleared', { key })
  }

  // Get active source for a key
  const getActiveSource = (key: keyof KeysConfig): 'browser' | 'project' | 'env' | null => {
    if (keys[key]) return 'browser'
    if (projectKeys[key]) return 'project'
    if (envKeys[key]) return 'env'
    return null
  }

  // Check if a specific source is active for a key
  const isSourceActive = (key: keyof KeysConfig, source: 'browser' | 'project' | 'env'): boolean => {
    return getActiveSource(key) === source
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          <Dialog.Title className={s.title}>App Settings</Dialog.Title>

          {/* Privacy & Analytics Section */}
          <div className={s.section}>
            <h3 className={s.sectionTitle}>Privacy & Analytics</h3>

            <div className={s.settingItem}>
              <label className={s.settingLabel}>
                <input
                  type="checkbox"
                  checked={analyticsEnabled}
                  onChange={e => handleAnalyticsToggle(e.target.checked)}
                  className={s.checkbox}
                />
                <div className={s.settingContent}>
                  <div className={s.settingName}>Share anonymous usage data</div>
                  <div className={s.settingDescription}>
                    Help improve Noodles.gl by sharing anonymous feature usage data. We never
                    collect your project data, node content, API keys, or personal information.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* API Keys Section */}
          <div className={s.section}>
            <h3 className={s.sectionTitle}>API Keys</h3>

            <div className={s.privacyNote}>
              Your API key will be stored in localStorage and persist across sessions. Keys are
              never sent to Noodles.gl servers.
            </div>

            <div className={s.settingItem}>
              <div className={s.settingContent}>
                <div className={s.settingName}>Mapbox Access Token</div>
                <div className={s.settingDescription}>
                  Required for Mapbox basemaps and directions API
                </div>
                <div className={s.inputGroup}>
                  <input
                    type={showKeys.mapbox ? 'text' : 'password'}
                    value={keys.mapbox || ''}
                    onChange={e => handleKeyChange('mapbox', e.target.value)}
                    placeholder="pk.eyJ1..."
                    className={s.input}
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowKey('mapbox')}
                    className={s.toggleButton}
                    aria-label={showKeys.mapbox ? 'Hide' : 'Show'}
                  >
                    {showKeys.mapbox ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>

            <div className={s.settingItem}>
              <div className={s.settingContent}>
                <div className={s.settingName}>Google Maps API Key</div>
                <div className={s.settingDescription}>Required for Google Maps transit directions</div>
                <div className={s.inputGroup}>
                  <input
                    type={showKeys.googleMaps ? 'text' : 'password'}
                    value={keys.googleMaps || ''}
                    onChange={e => handleKeyChange('googleMaps', e.target.value)}
                    placeholder="AIza..."
                    className={s.input}
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowKey('googleMaps')}
                    className={s.toggleButton}
                    aria-label={showKeys.googleMaps ? 'Hide' : 'Show'}
                  >
                    {showKeys.googleMaps ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>

            <div className={s.settingItem}>
              <div className={s.settingContent}>
                <div className={s.settingName}>Anthropic API Key</div>
                <div className={s.settingDescription}>Required for Claude AI assistant features</div>
                <div className={s.inputGroup}>
                  <input
                    type={showKeys.anthropic ? 'text' : 'password'}
                    value={keys.anthropic || ''}
                    onChange={e => handleKeyChange('anthropic', e.target.value)}
                    placeholder="sk-ant-..."
                    className={s.input}
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowKey('anthropic')}
                    className={s.toggleButton}
                    aria-label={showKeys.anthropic ? 'Hide' : 'Show'}
                  >
                    {showKeys.anthropic ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            </div>

            <div className={s.settingItem}>
              <label className={s.settingLabel}>
                <input
                  type="checkbox"
                  checked={saveInProject}
                  onChange={e => handleSaveInProjectToggle(e.target.checked)}
                  className={s.checkbox}
                />
                <div className={s.settingContent}>
                  <div className={s.settingName}>Save API keys in project file</div>
                  <div className={s.settingDescription}>
                    Include API keys in the project file when saving. Only enable this if you want
                    to share your keys with collaborators or use them on other machines. Keys are
                    stored in plain text in the project file.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className={s.footer}>
            <Dialog.Close asChild>
              <button type="button" className={s.closeButton}>
                Close
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Close asChild>
            <button type="button" className={s.iconButton} aria-label="Close">
              <Cross2Icon width={20} height={20} />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
