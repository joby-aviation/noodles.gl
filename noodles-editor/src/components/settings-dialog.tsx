import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { analytics } from '../utils/analytics'
import {
  type KeysConfig,
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
    const browserKeys = keysManager.getBrowserKeys()
    setKeys(browserKeys)
    setSaveInProject(keysManager.getSaveInProject())

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

  // Helper component for rendering browser key inputs
  interface KeyInputProps {
    keyType: keyof KeysConfig
    label: string
    description: string
    placeholder: string
  }

  const BrowserKeyInput = ({ keyType, label, description, placeholder }: KeyInputProps) => {
    const isActive = isSourceActive(keyType, 'browser')

    return (
      <div className={s.keyInput}>
        <div className={s.keyLabelRow}>
          <div className={s.keyLabel}>{label}</div>
          {isActive && <span className={s.activeBadge}>Active</span>}
        </div>
        <div className={s.keyDescription}>{description}</div>

        <div className={s.inputGroup}>
          <input
            type={showKeys[keyType] ? 'text' : 'password'}
            value={keys[keyType] || ''}
            onChange={e => handleKeyChange(keyType, e.target.value)}
            placeholder={placeholder}
            className={s.input}
          />
          <button
            type="button"
            onClick={() => toggleShowKey(keyType)}
            className={s.toggleButton}
            aria-label={showKeys[keyType] ? 'Hide' : 'Show'}
          >
            {showKeys[keyType] ? 'Hide' : 'Show'}
          </button>
          {keys[keyType] && (
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

  const ProjectKeyDisplay = ({ keyType, label }: { keyType: keyof KeysConfig, label: string }) => {
    const projectKey = projectKeys[keyType]
    const isActive = isSourceActive(keyType, 'project')
    const activeSource = getActiveSource(keyType)

    return (
      <div className={s.keyDisplay}>
        <div className={s.keyLabelRow}>
          <div className={s.keyLabel}>{label}</div>
          {isActive && <span className={s.activeBadge}>Active</span>}
        </div>

        {projectKey ? (
          <>
            <div className={s.inputGroup}>
              <input
                type={showKeys[`project-${keyType}`] ? 'text' : 'password'}
                value={projectKey}
                readOnly
                className={`${s.input} ${s.readOnly}`}
              />
              <button
                type="button"
                onClick={() => toggleShowKey(`project-${keyType}`)}
                className={s.toggleButton}
                aria-label={showKeys[`project-${keyType}`] ? 'Hide' : 'Show'}
              >
                {showKeys[`project-${keyType}`] ? 'Hide' : 'Show'}
              </button>
            </div>
            {!isActive && activeSource === 'browser' && (
              <div className={s.inactiveNote}>Browser key is active</div>
            )}
          </>
        ) : (
          <div className={s.notSet}>Not set in project</div>
        )}
      </div>
    )
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
                    <div className={s.keyDisplay}>
                      <div className={s.keyLabelRow}>
                        <div className={s.keyLabel}>Mapbox</div>
                        {isSourceActive('mapbox', 'env') && <span className={s.activeBadge}>Active</span>}
                      </div>
                      <div className={s.keyValue}>{maskKey(envKeys.mapbox)}</div>
                      {!isSourceActive('mapbox', 'env') && (
                        <div className={s.inactiveNote}>
                          {getActiveSource('mapbox') === 'browser' && 'Browser key is active'}
                          {getActiveSource('mapbox') === 'project' && 'Project key is active'}
                        </div>
                      )}
                    </div>
                  )}
                  {envKeys.googleMaps && (
                    <div className={s.keyDisplay}>
                      <div className={s.keyLabelRow}>
                        <div className={s.keyLabel}>Google Maps</div>
                        {isSourceActive('googleMaps', 'env') && <span className={s.activeBadge}>Active</span>}
                      </div>
                      <div className={s.keyValue}>{maskKey(envKeys.googleMaps)}</div>
                      {!isSourceActive('googleMaps', 'env') && (
                        <div className={s.inactiveNote}>
                          {getActiveSource('googleMaps') === 'browser' && 'Browser key is active'}
                          {getActiveSource('googleMaps') === 'project' && 'Project key is active'}
                        </div>
                      )}
                    </div>
                  )}
                  {envKeys.anthropic && (
                    <div className={s.keyDisplay}>
                      <div className={s.keyLabelRow}>
                        <div className={s.keyLabel}>Anthropic</div>
                        {isSourceActive('anthropic', 'env') && <span className={s.activeBadge}>Active</span>}
                      </div>
                      <div className={s.keyValue}>{maskKey(envKeys.anthropic)}</div>
                      {!isSourceActive('anthropic', 'env') && (
                        <div className={s.inactiveNote}>
                          {getActiveSource('anthropic') === 'browser' && 'Browser key is active'}
                          {getActiveSource('anthropic') === 'project' && 'Project key is active'}
                        </div>
                      )}
                    </div>
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
