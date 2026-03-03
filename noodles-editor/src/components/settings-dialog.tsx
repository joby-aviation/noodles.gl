import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { getEnvKeys, useKeysStore } from '../noodles/keys-store'
import { analytics } from '../utils/analytics'
import s from './settings-dialog.module.css'

interface SettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
}

// Component that groups all sources (browser, project, env) for a single key type
interface KeyGroupProps {
  label: string
  description: string
  placeholder: string
  browserValue: string
  projectValue?: string
  envValue?: string
  activeSource: 'browser' | 'project' | 'env' | null
  onBrowserChange: (value: string) => void
  onBrowserClear: () => void
}

const KeyGroup = ({
  label,
  description,
  placeholder,
  browserValue,
  projectValue,
  envValue,
  activeSource,
  onBrowserChange,
  onBrowserClear,
}: KeyGroupProps) => {
  const handleCopy = (value: string, source: 'project' | 'env') => {
    navigator.clipboard.writeText(value)
    analytics.track('key_copied', { source })
  }

  return (
    <div className={s.keyGroup}>
      <div className={s.keyGroupHeader}>
        <div className={s.keyLabel}>{label}</div>
        <div className={s.keyDescription}>{description}</div>
      </div>

      <div className={s.keySourcesList}>
        {/* Browser key input */}
        <div className={s.keySource}>
          <div className={s.keySourceLabel}>
            <span className={s.sourceText}>Browser</span>
            {activeSource === 'browser' && <span className={s.activeBadge}>Active</span>}
          </div>
          <input
            type="text"
            value={browserValue}
            onChange={e => onBrowserChange(e.target.value)}
            placeholder={placeholder}
            className={s.input}
          />
          {browserValue && (
            <button type="button" onClick={onBrowserClear} className={s.clearButton}>
              Clear
            </button>
          )}
        </div>

        {/* Project key (read-only) */}
        {projectValue && (
          <div className={s.keySource}>
            <div className={s.keySourceLabel}>
              <span className={s.sourceText}>Project</span>
              {activeSource === 'project' && <span className={s.activeBadge}>Active</span>}
            </div>
            <div className={s.keyPreview}>{projectValue}</div>
            <button
              type="button"
              onClick={() => handleCopy(projectValue, 'project')}
              className={s.copyButton}
            >
              Copy
            </button>
          </div>
        )}

        {/* Environment key (read-only) */}
        {envValue && (
          <div className={s.keySource}>
            <div className={s.keySourceLabel}>
              <span className={s.sourceText}>Environment</span>
              {activeSource === 'env' && <span className={s.activeBadge}>Active</span>}
            </div>
            <div className={s.keyPreview}>{envValue}</div>
            <button
              type="button"
              onClick={() => handleCopy(envValue, 'env')}
              className={s.copyButton}
            >
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsDialog({ open, setOpen }: SettingsDialogProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [errorCaptureEnabled, setErrorCaptureEnabled] = useState(true)

  // Store subscriptions
  const browserKeys = useKeysStore(state => state.browserKeys)
  const saveInProject = useKeysStore(state => state.saveInProject)
  const projectKeys = useKeysStore(state => state.projectKeys || {})
  const setBrowserKey = useKeysStore(state => state.setBrowserKey)
  const setSaveInProjectAction = useKeysStore(state => state.setSaveInProject)
  const getActiveSource = useKeysStore(state => state.getActiveSource)

  // Environment keys (static)
  const envKeys = getEnvKeys()

  // Sync analytics settings when dialog opens
  useEffect(() => {
    if (open) {
      const consent = analytics.getConsent()
      setAnalyticsEnabled(consent?.enabled ?? false)
      setErrorCaptureEnabled(analytics.getErrorCaptureEnabled())
    }
  }, [open])

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabled(enabled)
    analytics.setConsent(enabled)

    if (enabled) {
      analytics.track('analytics_enabled_in_settings')
    }
  }

  const handleErrorCaptureToggle = (enabled: boolean) => {
    setErrorCaptureEnabled(enabled)
    analytics.setErrorCaptureConsent(enabled)

    if (enabled) {
      analytics.track('error_capture_enabled_in_settings')
    }
  }

  const handleSaveInProjectToggle = (enabled: boolean) => {
    setSaveInProjectAction(enabled)

    if (enabled) {
      analytics.track('keys_save_in_project_enabled')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={`${s.content} nokey`}>
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

            <div className={s.settingItem}>
              <label className={s.settingLabel}>
                <input
                  type="checkbox"
                  checked={errorCaptureEnabled}
                  onChange={e => handleErrorCaptureToggle(e.target.checked)}
                  className={s.checkbox}
                />
                <div className={s.settingContent}>
                  <div className={s.settingName}>Send error reports (recommended)</div>
                  <div className={s.settingDescription}>
                    Automatically send error reports when something goes wrong. This helps us
                    identify and fix bugs. No personal data is included in error reports.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* API Keys Section */}
          <div className={s.section}>
            <h3 className={s.sectionTitle}>API Keys</h3>

            <div className={s.privacyNote}>
              Your API keys are never sent to Noodles.gl servers. Keys can be stored in your browser
              or in project files.
            </div>

            <div className={s.keysGroup}>
              <KeyGroup
                label="Mapbox Access Token"
                description="Required for Mapbox basemaps and directions"
                placeholder="pk.eyJ1..."
                browserValue={browserKeys.mapbox || ''}
                projectValue={projectKeys.mapbox}
                envValue={envKeys.mapbox}
                activeSource={getActiveSource('mapbox')}
                onBrowserChange={value => setBrowserKey('mapbox', value)}
                onBrowserClear={() => {
                  setBrowserKey('mapbox', undefined)
                  analytics.track('key_cleared', { key: 'mapbox' })
                }}
              />

              <KeyGroup
                label="Google Maps API Key"
                description="Required for Google Maps transit directions"
                placeholder="AIza..."
                browserValue={browserKeys.googleMaps || ''}
                projectValue={projectKeys.googleMaps}
                envValue={envKeys.googleMaps}
                activeSource={getActiveSource('googleMaps')}
                onBrowserChange={value => setBrowserKey('googleMaps', value)}
                onBrowserClear={() => {
                  setBrowserKey('googleMaps', undefined)
                  analytics.track('key_cleared', { key: 'googleMaps' })
                }}
              />

              <KeyGroup
                label="Anthropic API Key"
                description="Required for Claude AI assistant features"
                placeholder="sk-ant-..."
                browserValue={browserKeys.anthropic || ''}
                projectValue={projectKeys.anthropic}
                envValue={envKeys.anthropic}
                activeSource={getActiveSource('anthropic')}
                onBrowserChange={value => setBrowserKey('anthropic', value)}
                onBrowserClear={() => {
                  setBrowserKey('anthropic', undefined)
                  analytics.track('key_cleared', { key: 'anthropic' })
                }}
              />
            </div>

            {/* Save in project checkbox */}
            <div className={s.settingItem}>
              <label className={s.settingLabel}>
                <input
                  type="checkbox"
                  checked={saveInProject}
                  onChange={e => handleSaveInProjectToggle(e.target.checked)}
                  className={s.checkbox}
                />
                <div className={s.settingContent}>
                  <div className={s.settingName}>Save browser keys in project file</div>
                  <div className={s.settingDescription}>
                    Include your browser keys in the project file when saving. Only enable this if
                    you want to share your keys with collaborators. Keys are stored in plain text.
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
