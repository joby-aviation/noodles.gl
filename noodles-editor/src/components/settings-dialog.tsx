import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { analytics } from '../utils/analytics'
import {
  type SecretsConfig,
  getSecretsFromStorage,
  saveSecretsToStorage,
} from '../utils/secrets-manager'
import s from './settings-dialog.module.css'

interface SettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
}

export function SettingsDialog({ open, setOpen }: SettingsDialogProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [secrets, setSecrets] = useState<SecretsConfig>({})
  const [saveInProject, setSaveInProject] = useState(false)
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const consent = analytics.getConsent()
    setAnalyticsEnabled(consent?.enabled ?? false)

    const stored = getSecretsFromStorage()
    setSecrets(stored.secrets)
    setSaveInProject(stored.saveInProject)
  }, [])

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabled(enabled)
    analytics.setConsent(enabled)

    if (enabled) {
      analytics.track('analytics_enabled_in_settings')
    }
  }

  const handleSecretChange = (key: keyof SecretsConfig, value: string) => {
    const newSecrets = { ...secrets, [key]: value }
    setSecrets(newSecrets)
    saveSecretsToStorage(newSecrets, saveInProject)
  }

  const handleSaveInProjectToggle = (enabled: boolean) => {
    setSaveInProject(enabled)
    saveSecretsToStorage(secrets, enabled)

    if (enabled) {
      analytics.track('secrets_save_in_project_enabled')
    }
  }

  const toggleShowSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }))
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

          {/* API Keys & Secrets Section */}
          <div className={s.section}>
            <h3 className={s.sectionTitle}>API Keys & Secrets</h3>

            <div className={s.settingItem}>
              <div className={s.settingContent}>
                <div className={s.settingName}>Mapbox Access Token</div>
                <div className={s.settingDescription}>
                  Required for Mapbox basemaps and directions API
                </div>
                <div className={s.inputGroup}>
                  <input
                    type={showSecrets.mapbox ? 'text' : 'password'}
                    value={secrets.mapbox || ''}
                    onChange={e => handleSecretChange('mapbox', e.target.value)}
                    placeholder="pk.eyJ1..."
                    className={s.input}
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowSecret('mapbox')}
                    className={s.toggleButton}
                    aria-label={showSecrets.mapbox ? 'Hide' : 'Show'}
                  >
                    {showSecrets.mapbox ? 'Hide' : 'Show'}
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
                    type={showSecrets.googleMaps ? 'text' : 'password'}
                    value={secrets.googleMaps || ''}
                    onChange={e => handleSecretChange('googleMaps', e.target.value)}
                    placeholder="AIza..."
                    className={s.input}
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowSecret('googleMaps')}
                    className={s.toggleButton}
                    aria-label={showSecrets.googleMaps ? 'Hide' : 'Show'}
                  >
                    {showSecrets.googleMaps ? 'Hide' : 'Show'}
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
                    type={showSecrets.anthropic ? 'text' : 'password'}
                    value={secrets.anthropic || ''}
                    onChange={e => handleSecretChange('anthropic', e.target.value)}
                    placeholder="sk-ant-..."
                    className={s.input}
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowSecret('anthropic')}
                    className={s.toggleButton}
                    aria-label={showSecrets.anthropic ? 'Hide' : 'Show'}
                  >
                    {showSecrets.anthropic ? 'Hide' : 'Show'}
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
                  <div className={s.settingName}>Save secrets in project file</div>
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
