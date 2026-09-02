import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import type { ProviderPreference } from '../noodles/keys-store'
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
  const providerPreference = useKeysStore(state => state.getProviderPreference())
  const customEndpoint = useKeysStore(state => state.getCustomEndpoint())
  const setBrowserKey = useKeysStore(state => state.setBrowserKey)
  const setSaveInProjectAction = useKeysStore(state => state.setSaveInProject)
  const setProviderPreference = useKeysStore(state => state.setProviderPreference)
  const setCustomEndpoint = useKeysStore(state => state.setCustomEndpoint)
  const getActiveSource = useKeysStore(state => state.getActiveSource)

  // Custom endpoint state (local form state)
  const [endpointBaseUrl, setEndpointBaseUrl] = useState(customEndpoint?.baseUrl || '')
  const [endpointApiKey, setEndpointApiKey] = useState(customEndpoint?.apiKey || '')
  const [endpointModel, setEndpointModel] = useState(customEndpoint?.model || '')
  const [endpointDisplayName, setEndpointDisplayName] = useState(customEndpoint?.displayName || '')

  // Environment keys (static)
  const envKeys = getEnvKeys()

  // Sync settings when dialog opens
  useEffect(() => {
    if (open) {
      const consent = analytics.getConsent()
      setAnalyticsEnabled(consent?.enabled ?? false)
      setErrorCaptureEnabled(analytics.getErrorCaptureEnabled())

      // Sync custom endpoint from store
      const endpoint = customEndpoint
      setEndpointBaseUrl(endpoint?.baseUrl || '')
      setEndpointApiKey(endpoint?.apiKey || '')
      setEndpointModel(endpoint?.model || '')
      setEndpointDisplayName(endpoint?.displayName || '')
    }
  }, [open, customEndpoint])

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

  const handleProviderPreferenceChange = (preference: ProviderPreference) => {
    setProviderPreference(preference)
    analytics.track('ai_provider_preference_changed', { preference })
  }

  const handleSaveCustomEndpoint = () => {
    if (endpointBaseUrl && endpointApiKey && endpointModel) {
      setCustomEndpoint({
        baseUrl: endpointBaseUrl,
        apiKey: endpointApiKey,
        model: endpointModel,
        displayName: endpointDisplayName || undefined,
      })
      analytics.track('custom_endpoint_saved')
    }
  }

  const handleClearCustomEndpoint = () => {
    setCustomEndpoint(undefined)
    setEndpointBaseUrl('')
    setEndpointApiKey('')
    setEndpointModel('')
    setEndpointDisplayName('')
    analytics.track('custom_endpoint_cleared')
  }

  // Preset configurations for popular providers
  const applyPreset = (preset: 'groq' | 'openrouter' | 'openai') => {
    switch (preset) {
      case 'groq':
        setEndpointBaseUrl('https://api.groq.com/openai/v1')
        setEndpointModel('llama-3.1-70b-versatile')
        setEndpointDisplayName('Groq (Llama 3.1 70B)')
        break
      case 'openrouter':
        setEndpointBaseUrl('https://openrouter.ai/api/v1')
        setEndpointModel('meta-llama/llama-3.1-70b-instruct')
        setEndpointDisplayName('OpenRouter (Llama 3.1 70B)')
        break
      case 'openai':
        setEndpointBaseUrl('https://api.openai.com/v1')
        setEndpointModel('gpt-4o')
        setEndpointDisplayName('OpenAI (GPT-4o)')
        break
    }
    analytics.track('custom_endpoint_preset_applied', { preset })
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

          {/* AI Provider Section */}
          <div className={s.section}>
            <h3 className={s.sectionTitle}>AI Provider</h3>

            <div className={s.settingItem}>
              <div className={s.settingContent} style={{ width: '100%' }}>
                <div className={s.settingName}>Choose AI Provider</div>
                <div className={s.settingDescription}>
                  Select which AI service powers the Noodles Assistant.
                </div>
                <div
                  style={{
                    marginTop: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="providerPreference"
                      value="automatic"
                      checked={providerPreference === 'automatic'}
                      onChange={e =>
                        handleProviderPreferenceChange(e.target.value as ProviderPreference)
                      }
                    />
                    <div>
                      <strong>Automatic (recommended)</strong> — Uses Claude if you have a key,
                      otherwise falls back to custom endpoint or Chrome Built-in AI
                    </div>
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="providerPreference"
                      value="anthropic"
                      checked={providerPreference === 'anthropic'}
                      onChange={e =>
                        handleProviderPreferenceChange(e.target.value as ProviderPreference)
                      }
                    />
                    <div>
                      <strong>Always use Claude</strong> — Premium quality (requires API key below)
                    </div>
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="providerPreference"
                      value="custom"
                      checked={providerPreference === 'custom'}
                      onChange={e =>
                        handleProviderPreferenceChange(e.target.value as ProviderPreference)
                      }
                    />
                    <div>
                      <strong>Custom endpoint</strong> — Use Groq, OpenRouter, OpenAI, or
                      self-hosted (configure below)
                    </div>
                  </label>
                  <label
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name="providerPreference"
                      value="chrome-ai"
                      checked={providerPreference === 'chrome-ai'}
                      onChange={e =>
                        handleProviderPreferenceChange(e.target.value as ProviderPreference)
                      }
                    />
                    <div>
                      <strong>Chrome Built-in AI</strong> — Free, local, no API key (Chrome 127+
                      required)
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Custom Endpoint Configuration */}
            <div className={s.settingItem} style={{ marginTop: '16px' }}>
              <div className={s.settingContent} style={{ width: '100%' }}>
                <div className={s.settingName}>Custom Endpoint Configuration</div>
                <div className={s.settingDescription}>
                  Configure an OpenAI-compatible API endpoint. Use presets for popular providers.
                </div>

                {/* Preset buttons */}
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => applyPreset('groq')}
                    style={{
                      padding: '6px 12px',
                      fontSize: '13px',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      background: '#2a2a2a',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    Groq (Free)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('openrouter')}
                    style={{
                      padding: '6px 12px',
                      fontSize: '13px',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      background: '#2a2a2a',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    OpenRouter
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('openai')}
                    style={{
                      padding: '6px 12px',
                      fontSize: '13px',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      background: '#2a2a2a',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    OpenAI
                  </button>
                </div>

                {/* Form fields */}
                <div
                  style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}
                >
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                      Base URL
                    </label>
                    <input
                      type="text"
                      value={endpointBaseUrl}
                      onChange={e => setEndpointBaseUrl(e.target.value)}
                      placeholder="https://api.groq.com/openai/v1"
                      className={s.input}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                      API Key
                    </label>
                    <input
                      type="password"
                      value={endpointApiKey}
                      onChange={e => setEndpointApiKey(e.target.value)}
                      placeholder="Your API key"
                      className={s.input}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                      Model
                    </label>
                    <input
                      type="text"
                      value={endpointModel}
                      onChange={e => setEndpointModel(e.target.value)}
                      placeholder="llama-3.1-70b-versatile"
                      className={s.input}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
                      Display Name (optional)
                    </label>
                    <input
                      type="text"
                      value={endpointDisplayName}
                      onChange={e => setEndpointDisplayName(e.target.value)}
                      placeholder="My Custom AI"
                      className={s.input}
                      style={{ width: '100%' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={handleSaveCustomEndpoint}
                      disabled={!endpointBaseUrl || !endpointApiKey || !endpointModel}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        border: 'none',
                        borderRadius: '4px',
                        background: '#3b82f6',
                        color: 'white',
                        cursor:
                          !endpointBaseUrl || !endpointApiKey || !endpointModel
                            ? 'not-allowed'
                            : 'pointer',
                        opacity: !endpointBaseUrl || !endpointApiKey || !endpointModel ? 0.5 : 1,
                      }}
                    >
                      Save Endpoint
                    </button>
                    {customEndpoint && (
                      <button
                        type="button"
                        onClick={handleClearCustomEndpoint}
                        style={{
                          padding: '8px 16px',
                          fontSize: '13px',
                          border: '1px solid #444',
                          borderRadius: '4px',
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
                description="Enables Mapbox basemaps and high-quality driving directions. Without it, directions fall back to OSRM (free, OpenStreetMap-based) and place search falls back to Photon."
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
                description="Enables transit directions and higher-quality place search. Optional — place search works without it via Photon (OpenStreetMap)."
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
                label="Cesium Ion Access Token"
                description="Required for Cesium Ion 3D tile datasets. Not needed if you use custom 3D tile URLs directly."
                placeholder="eyJhb..."
                browserValue={browserKeys.cesium || ''}
                projectValue={projectKeys.cesium}
                envValue={envKeys.cesium}
                activeSource={getActiveSource('cesium')}
                onBrowserChange={value => setBrowserKey('cesium', value)}
                onBrowserClear={() => {
                  setBrowserKey('cesium', undefined)
                  analytics.track('key_cleared', { key: 'cesium' })
                }}
              />

              <KeyGroup
                label="Anthropic API Key (Claude)"
                description="Premium AI provider with best quality. Optional — the assistant works without it using custom endpoint or Chrome Built-in AI. Get your key from console.anthropic.com"
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

              <KeyGroup
                label="Overpass API Endpoint"
                description="Used by the Overpass operator to query OpenStreetMap data. Defaults to overpass.openstreetmap.fr (France mirror with reliable CORS)."
                placeholder="https://overpass.openstreetmap.fr/api/interpreter"
                browserValue={browserKeys.overpass || ''}
                projectValue={projectKeys.overpass}
                envValue={envKeys.overpass}
                activeSource={getActiveSource('overpass')}
                onBrowserChange={value => setBrowserKey('overpass', value)}
                onBrowserClear={() => {
                  setBrowserKey('overpass', undefined)
                  analytics.track('key_cleared', { key: 'overpass' })
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
