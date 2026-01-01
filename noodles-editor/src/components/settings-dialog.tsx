import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { analytics } from '../utils/analytics'
import {
  type KeysConfig,
  useKeysStore,
  getEnvKeys,
  maskKey,
} from '../noodles/keys-store'
import s from './settings-dialog.module.css'

interface SettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
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

  // Local state for inputs (to avoid focus loss during typing)
  const [localKeys, setLocalKeys] = useState<KeysConfig>({})
  const [editingKeys, setEditingKeys] = useState<Record<string, boolean>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  // Sync local keys with store when dialog opens
  useEffect(() => {
    if (open) {
      const consent = analytics.getConsent()
      setAnalyticsEnabled(consent?.enabled ?? false)
      setLocalKeys(browserKeys)
    }
  }, [open, browserKeys])

  const handleAnalyticsToggle = (enabled: boolean) => {
    setAnalyticsEnabled(enabled)
    analytics.setConsent(enabled)

    if (enabled) {
      analytics.track('analytics_enabled_in_settings')
    }
  }

  const handleKeyChange = (key: keyof KeysConfig, value: string) => {
    setLocalKeys(prev => ({ ...prev, [key]: value }))
  }

  const handleKeyBlur = (key: keyof KeysConfig) => {
    const value = localKeys[key]
    setBrowserKey(key, value)
  }

  const handleSaveInProjectToggle = (enabled: boolean) => {
    setSaveInProjectAction(enabled)

    if (enabled) {
      analytics.track('keys_save_in_project_enabled')
    }
  }

  const toggleShowKey = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleClearKey = (key: keyof KeysConfig) => {
    setLocalKeys(prev => {
      const updated = { ...prev }
      delete updated[key]
      return updated
    })
    setBrowserKey(key, undefined)
    analytics.track('key_cleared', { key })
  }

  // Check if a specific source is active for a key
  const isSourceActive = (key: keyof KeysConfig, source: 'browser' | 'project' | 'env'): boolean => {
    return getActiveSource(key) === source
  }

  // Helper component for rendering browser key inputs
  interface KeyInputProps {
    keyType: keyof KeysConfig
    label: string
    description: string
    placeholder: string
  }

  const BrowserKeyInput = ({ keyType, label, description, placeholder }: KeyInputProps) => {
    const isActive = isSourceActive(keyType, 'browser')
    const isEditing = editingKeys[keyType]
    const value = localKeys[keyType] || ''

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
            onChange={e => {
              if (isEditing) {
                handleKeyChange(keyType, e.target.value)
              }
            }}
            onFocus={() => {
              setEditingKeys(prev => ({ ...prev, [keyType]: true }))
            }}
            onBlur={() => {
              setEditingKeys(prev => ({ ...prev, [keyType]: false }))
              handleKeyBlur(keyType)
            }}
            placeholder={placeholder}
            className={s.input}
            onKeyDown={e => {
              e.stopPropagation()
            }}
            onKeyUp={e => {
              e.stopPropagation()
            }}
          />
          {localKeys[keyType] && (
            <button
              type="button"
              onClick={() => handleClearKey(keyType)}
              className={s.clearButton}
            >
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
    showKeyId: string
  }

  const ReadOnlyKeyDisplay = ({ label, value, isActive, showKeyId }: ReadOnlyKeyDisplayProps) => {
    const showKey = showKeys[showKeyId]

    return (
      <div className={s.keyDisplay}>
        <div className={s.keyLabelRow}>
          <div className={s.keyLabel}>{label}</div>
          {isActive && <span className={s.activeBadge}>Active</span>}
        </div>

        {value ? (
          <div className={s.inputGroup}>
            <div className={`${s.input} ${s.readOnly}`}>
              {showKey ? value : maskKey(value)}
            </div>
            <button
              type="button"
              onClick={() => toggleShowKey(showKeyId)}
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

  const ProjectKeyDisplay = ({ keyType, label }: { keyType: keyof KeysConfig, label: string }) => {
    return (
      <ReadOnlyKeyDisplay
        label={label}
        value={projectKeys[keyType]}
        isActive={isSourceActive(keyType, 'project')}
        showKeyId={`project-${keyType}`}
      />
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          className={`${s.content} nokey`}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
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

            {/* Browser Keys */}
            <div className={s.subsection}>
              <h4 className={s.subsectionTitle}>Browser Keys</h4>
              <div className={s.subsectionDescription}>
                Stored locally in your browser, not shared with others
              </div>

              <div className={s.keysGroup}>
                <BrowserKeyInput
                  keyType="mapbox"
                  label="Mapbox Access Token"
                  description="Required for Mapbox basemaps and directions"
                  placeholder="pk.eyJ1..."
                />

                <BrowserKeyInput
                  keyType="googleMaps"
                  label="Google Maps API Key"
                  description="Required for Google Maps transit directions"
                  placeholder="AIza..."
                />

                <BrowserKeyInput
                  keyType="anthropic"
                  label="Anthropic API Key"
                  description="Required for Claude AI assistant features"
                  placeholder="sk-ant-..."
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
                    <ProjectKeyDisplay keyType="mapbox" label="Mapbox Access Token" />
                  )}

                  {projectKeys.googleMaps && (
                    <ProjectKeyDisplay keyType="googleMaps" label="Google Maps API Key" />
                  )}

                  {projectKeys.anthropic && (
                    <ProjectKeyDisplay keyType="anthropic" label="Anthropic API Key" />
                  )}
                </div>
              </div>
            )}

            {/* Environment Keys */}
            {(envKeys.mapbox || envKeys.googleMaps || envKeys.anthropic) && (
              <div className={s.subsection}>
                <h4 className={s.subsectionTitle}>Environment Keys (Read-Only)</h4>
                <div className={s.subsectionDescription}>
                  Fallback keys from .env files
                </div>

                <div className={s.keysGroup}>
                  {envKeys.mapbox && (
                    <ReadOnlyKeyDisplay
                      label="Mapbox"
                      value={envKeys.mapbox}
                      isActive={isSourceActive('mapbox', 'env')}
                      showKeyId="env-mapbox"
                    />
                  )}
                  {envKeys.googleMaps && (
                    <ReadOnlyKeyDisplay
                      label="Google Maps"
                      value={envKeys.googleMaps}
                      isActive={isSourceActive('googleMaps', 'env')}
                      showKeyId="env-googleMaps"
                    />
                  )}
                  {envKeys.anthropic && (
                    <ReadOnlyKeyDisplay
                      label="Anthropic"
                      value={envKeys.anthropic}
                      isActive={isSourceActive('anthropic', 'env')}
                      showKeyId="env-anthropic"
                    />
                  )}
                </div>
              </div>
            )}

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
                    Include your browser keys in the project file when saving. Only enable this if you
                    want to share your keys with collaborators. Keys are stored in plain text.
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
