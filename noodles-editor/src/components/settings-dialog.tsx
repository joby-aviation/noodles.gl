import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { getEnvKeys, maskKey, useKeysStore } from '../noodles/keys-store'
import { analytics } from '../utils/analytics'
import s from './settings-dialog.module.css'

interface SettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
}

// Helper component for rendering browser key inputs
interface KeyInputProps {
  label: string
  description: string
  placeholder: string
  value: string
  isActive: boolean
  onChange: (value: string) => void
  onClear: () => void
}

const BrowserKeyInput = ({
  label,
  description,
  placeholder,
  value,
  isActive,
  onChange,
  onClear,
}: KeyInputProps) => {
  const [isEditing, setIsEditing] = useState(false)

  return (
    <div className={s.keyInput}>
      <div className={s.keyLabelRow}>
        <div className={s.keyLabel}>{label}</div>
        {isActive && <span className={s.activeBadge}>Active</span>}
      </div>
      <div className={s.keyDescription}>{description}</div>

      <div className={s.inputGroup}>
        <input
          type="text"
          value={isEditing || !value ? value : maskKey(value)}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={() => setIsEditing(false)}
          placeholder={placeholder}
          className={s.input}
          onKeyDown={e => e.stopPropagation()}
          onKeyUp={e => e.stopPropagation()}
        />
        {value && (
          <button type="button" onClick={onClear} className={s.clearButton}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// Shared component for read-only key display (project and env keys)
interface ReadOnlyKeyDisplayProps {
  label: string
  value: string | undefined
  isActive: boolean
}

const ReadOnlyKeyDisplay = ({ label, value, isActive }: ReadOnlyKeyDisplayProps) => {
  const [showKey, setShowKey] = useState(false)

  return (
    <div className={s.keyDisplay}>
      <div className={s.keyLabelRow}>
        <div className={s.keyLabel}>{label}</div>
        {isActive && <span className={s.activeBadge}>Active</span>}
      </div>

      {value ? (
        <div className={s.inputGroup}>
          <div className={`${s.input} ${s.readOnly}`}>{showKey ? value : maskKey(value)}</div>
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className={s.toggleButton}
            aria-label={showKey ? 'Hide' : 'Show'}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      ) : (
        <div className={s.notSet}>Not set in project</div>
      )}
    </div>
  )
}

export function SettingsDialog({ open, setOpen }: SettingsDialogProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)

  // Store subscriptions
  const browserKeys = useKeysStore(state => state.browserKeys)
  const saveInProject = useKeysStore(state => state.saveInProject)
  const projectKeys = useKeysStore(state => state.projectKeys || {})
  const setBrowserKey = useKeysStore(state => state.setBrowserKey)
  const setSaveInProjectAction = useKeysStore(state => state.setSaveInProject)
  const getActiveSource = useKeysStore(state => state.getActiveSource)

  // Environment keys (static)
  const envKeys = getEnvKeys()

  // Sync analytics setting when dialog opens
  useEffect(() => {
    if (open) {
      const consent = analytics.getConsent()
      setAnalyticsEnabled(consent?.enabled ?? false)
    }
  }, [open])

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabled(enabled)
    analytics.setConsent(enabled)

    if (enabled) {
      analytics.track('analytics_enabled_in_settings')
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
        <Dialog.Content className={`${s.content} nokey`} onOpenAutoFocus={e => e.preventDefault()}>
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
              Your API keys are never sent to Noodles.gl servers. Keys can be stored in your browser
              or in project files.
            </div>

            <div className={s.subsectionsGrid}>
              {/* Browser Keys */}
              <div className={s.subsection}>
                <h4 className={s.subsectionTitle}>Browser Keys</h4>
                <div className={s.subsectionDescription}>
                  Stored locally in your browser, not shared with others
                </div>

                <div className={s.keysGroup}>
                  <BrowserKeyInput
                    label="Mapbox Access Token"
                    description="Required for Mapbox basemaps and directions"
                    placeholder="pk.eyJ1..."
                    value={browserKeys.mapbox || ''}
                    isActive={getActiveSource('mapbox') === 'browser'}
                    onChange={value => setBrowserKey('mapbox', value)}
                    onClear={() => {
                      setBrowserKey('mapbox', undefined)
                      analytics.track('key_cleared', { key: 'mapbox' })
                    }}
                  />

                  <BrowserKeyInput
                    label="Google Maps API Key"
                    description="Required for Google Maps transit directions"
                    placeholder="AIza..."
                    value={browserKeys.googleMaps || ''}
                    isActive={getActiveSource('googleMaps') === 'browser'}
                    onChange={value => setBrowserKey('googleMaps', value)}
                    onClear={() => {
                      setBrowserKey('googleMaps', undefined)
                      analytics.track('key_cleared', { key: 'googleMaps' })
                    }}
                  />

                  <BrowserKeyInput
                    label="Anthropic API Key"
                    description="Required for Claude AI assistant features"
                    placeholder="sk-ant-..."
                    value={browserKeys.anthropic || ''}
                    isActive={getActiveSource('anthropic') === 'browser'}
                    onChange={value => setBrowserKey('anthropic', value)}
                    onClear={() => {
                      setBrowserKey('anthropic', undefined)
                      analytics.track('key_cleared', { key: 'anthropic' })
                    }}
                  />
                </div>
              </div>

              {/* Project Keys */}
              {(projectKeys.mapbox || projectKeys.googleMaps || projectKeys.anthropic) && (
                <div className={s.subsection}>
                  <h4 className={s.subsectionTitle}>Project Keys (Read-Only)</h4>
                  <div className={s.subsectionDescription}>
                    Keys saved in the project file, shared when project is shared
                  </div>

                  <div className={s.keysGroup}>
                    {projectKeys.mapbox && (
                      <ReadOnlyKeyDisplay
                        label="Mapbox Access Token"
                        value={projectKeys.mapbox}
                        isActive={getActiveSource('mapbox') === 'project'}
                      />
                    )}

                    {projectKeys.googleMaps && (
                      <ReadOnlyKeyDisplay
                        label="Google Maps API Key"
                        value={projectKeys.googleMaps}
                        isActive={getActiveSource('googleMaps') === 'project'}
                      />
                    )}

                    {projectKeys.anthropic && (
                      <ReadOnlyKeyDisplay
                        label="Anthropic API Key"
                        value={projectKeys.anthropic}
                        isActive={getActiveSource('anthropic') === 'project'}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Environment Keys */}
              {(envKeys.mapbox || envKeys.googleMaps || envKeys.anthropic) && (
                <div className={s.subsection}>
                  <h4 className={s.subsectionTitle}>Environment Keys (Read-Only)</h4>
                  <div className={s.subsectionDescription}>Fallback keys from .env files</div>

                  <div className={s.keysGroup}>
                    {envKeys.mapbox && (
                      <ReadOnlyKeyDisplay
                        label="Mapbox"
                        value={envKeys.mapbox}
                        isActive={getActiveSource('mapbox') === 'env'}
                      />
                    )}
                    {envKeys.googleMaps && (
                      <ReadOnlyKeyDisplay
                        label="Google Maps"
                        value={envKeys.googleMaps}
                        isActive={getActiveSource('googleMaps') === 'env'}
                      />
                    )}
                    {envKeys.anthropic && (
                      <ReadOnlyKeyDisplay
                        label="Anthropic"
                        value={envKeys.anthropic}
                        isActive={getActiveSource('anthropic') === 'env'}
                      />
                    )}
                  </div>
                </div>
              )}
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
