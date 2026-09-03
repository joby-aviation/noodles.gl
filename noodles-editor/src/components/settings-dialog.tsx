import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { validateCustomEndpoint } from '../ai-chat/agent/providers/custom'
import type { ProviderPreference } from '../noodles/keys-store'
import { getEnvKeys, useKeysStore } from '../noodles/keys-store'
import { analytics } from '../utils/analytics'
import s from './settings-dialog.module.css'

type EndpointStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'saved' }
  | { state: 'failed'; message: string }

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
  onProjectRemove?: () => void
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
  onProjectRemove,
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
            {onProjectRemove && (
              <button type="button" onClick={onProjectRemove} className={s.clearButton}>
                Remove
              </button>
            )}
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

type TabName = 'general' | 'ai-provider' | 'api-keys'

export function SettingsDialog({ open, setOpen }: SettingsDialogProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [errorCaptureEnabled, setErrorCaptureEnabled] = useState(true)
  const [activeTab, setActiveTab] = useState<TabName>('general')

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
  const removeProjectKey = useKeysStore(state => state.removeProjectKey)

  // Custom endpoint state (local form state)
  const [endpointBaseUrl, setEndpointBaseUrl] = useState(customEndpoint?.baseUrl || '')
  const [endpointApiKey, setEndpointApiKey] = useState(customEndpoint?.apiKey || '')
  const [endpointModel, setEndpointModel] = useState(customEndpoint?.model || '')
  const [endpointDisplayName, setEndpointDisplayName] = useState(customEndpoint?.displayName || '')
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus>({ state: 'idle' })

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

      // Check for deep link in URL hash
      const hash = window.location.hash.slice(1)
      if (hash === 'ai-provider' || hash === 'api-keys') {
        setActiveTab(hash as TabName)
      }
    }
  }, [open, customEndpoint])

  // Clear hash when dialog closes
  useEffect(() => {
    if (!open && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
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

  const handleProviderPreferenceChange = (preference: ProviderPreference) => {
    setProviderPreference(preference)
    analytics.track('ai_provider_preference_changed', { preference })
  }

  // Checks the endpoint before saving it. A typo'd base URL is the commonest
  // mistake here and it would otherwise only surface as a failed chat message,
  // which is a much worse place to learn about it.
  const handleSaveCustomEndpoint = async () => {
    if (!endpointBaseUrl || !endpointApiKey || !endpointModel) return

    setEndpointStatus({ state: 'checking' })
    const result = await validateCustomEndpoint(endpointBaseUrl, endpointApiKey)

    if (!result.ok) {
      setEndpointStatus({
        state: 'failed',
        message: result.error ?? 'The endpoint did not respond',
      })
      analytics.track('custom_endpoint_validation_failed')
      return
    }

    // The server answered but does not serve the model that was typed. Saving
    // anyway would be worse than saying so: nothing would work.
    if (result.models && !result.models.includes(endpointModel)) {
      setEndpointStatus({
        state: 'failed',
        message: `The endpoint works, but does not list “${endpointModel}”. Available: ${result.models.slice(0, 8).join(', ')}`,
      })
      analytics.track('custom_endpoint_validation_failed')
      return
    }

    setCustomEndpoint({
      baseUrl: endpointBaseUrl,
      apiKey: endpointApiKey,
      model: endpointModel,
      displayName: endpointDisplayName || undefined,
    })
    setEndpointStatus({ state: 'saved' })
    analytics.track('custom_endpoint_saved')
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
          <div className={s.header}>
            <Dialog.Title className={s.title}>App Settings</Dialog.Title>

            {/* Tab Navigation */}
            <div className={s.tabs}>
              <button
                type="button"
                className={`${s.tab} ${activeTab === 'general' ? s.tabActive : ''}`}
                onClick={() => setActiveTab('general')}
              >
                General
              </button>
              <button
                type="button"
                className={`${s.tab} ${activeTab === 'ai-provider' ? s.tabActive : ''}`}
                onClick={() => setActiveTab('ai-provider')}
              >
                AI Provider
              </button>
              <button
                type="button"
                className={`${s.tab} ${activeTab === 'api-keys' ? s.tabActive : ''}`}
                onClick={() => setActiveTab('api-keys')}
              >
                API Keys
              </button>
            </div>
          </div>

          <div className={s.scrollContent}>
            {/* General Tab */}
            {activeTab === 'general' && (
              <>
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
                          collect your project data, node content, API keys, or personal
                          information.
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
              </>
            )}

            {/* AI Provider Tab */}
            {activeTab === 'ai-provider' && (
              <>
                {/* AI Provider Section */}
                <div className={s.section}>
                  <h3 className={s.sectionTitle}>Choose AI Provider</h3>
                  <div className={s.settingDescription} style={{ marginBottom: '16px' }}>
                    Select which AI service powers the Noodles Assistant.
                  </div>

                  <div className={s.providerOptions}>
                    <label
                      className={`${s.providerOption} ${providerPreference === 'automatic' ? s.providerOptionSelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="providerPreference"
                        value="automatic"
                        checked={providerPreference === 'automatic'}
                        onChange={e =>
                          handleProviderPreferenceChange(e.target.value as ProviderPreference)
                        }
                        className={s.providerRadio}
                      />
                      <div className={s.providerOptionContent}>
                        <div className={s.providerOptionTitle}>Automatic (recommended)</div>
                        <div className={s.providerOptionDescription}>
                          Uses Claude if you have a key, otherwise falls back to custom endpoint or
                          Chrome Built-in AI
                        </div>
                      </div>
                    </label>

                    <label
                      className={`${s.providerOption} ${providerPreference === 'anthropic' ? s.providerOptionSelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="providerPreference"
                        value="anthropic"
                        checked={providerPreference === 'anthropic'}
                        onChange={e =>
                          handleProviderPreferenceChange(e.target.value as ProviderPreference)
                        }
                        className={s.providerRadio}
                      />
                      <div className={s.providerOptionContent}>
                        <div className={s.providerOptionTitle}>Always use Claude</div>
                        <div className={s.providerOptionDescription}>
                          Premium quality (requires Anthropic API key below)
                        </div>
                      </div>
                    </label>

                    <label
                      className={`${s.providerOption} ${providerPreference === 'openrouter' ? s.providerOptionSelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="providerPreference"
                        value="openrouter"
                        checked={providerPreference === 'openrouter'}
                        onChange={e =>
                          handleProviderPreferenceChange(e.target.value as ProviderPreference)
                        }
                        className={s.providerRadio}
                      />
                      <div className={s.providerOptionContent}>
                        <div className={s.providerOptionTitle}>Always use OpenRouter</div>
                        <div className={s.providerOptionDescription}>
                          Gemini, GPT, Claude and others behind one key, billed by OpenRouter
                          (requires OpenRouter API key below)
                        </div>
                      </div>
                    </label>

                    <label
                      className={`${s.providerOption} ${providerPreference === 'custom' ? s.providerOptionSelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="providerPreference"
                        value="custom"
                        checked={providerPreference === 'custom'}
                        onChange={e =>
                          handleProviderPreferenceChange(e.target.value as ProviderPreference)
                        }
                        className={s.providerRadio}
                      />
                      <div className={s.providerOptionContent}>
                        <div className={s.providerOptionTitle}>Custom endpoint</div>
                        <div className={s.providerOptionDescription}>
                          Use Groq, OpenRouter, OpenAI, or self-hosted (configure below)
                        </div>
                      </div>
                    </label>

                    <label
                      className={`${s.providerOption} ${providerPreference === 'chrome' ? s.providerOptionSelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="providerPreference"
                        value="chrome"
                        checked={providerPreference === 'chrome'}
                        onChange={e =>
                          handleProviderPreferenceChange(e.target.value as ProviderPreference)
                        }
                        className={s.providerRadio}
                      />
                      <div className={s.providerOptionContent}>
                        <div className={s.providerOptionTitle}>Chrome Built-in AI</div>
                        <div className={s.providerOptionDescription}>
                          Free, runs locally, no API key (Chrome 127+ required)
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Custom Endpoint Configuration */}
                <div className={s.settingItem} style={{ marginTop: '16px' }}>
                  <div className={s.settingContent} style={{ width: '100%' }}>
                    <div className={s.settingName}>Custom Endpoint Configuration</div>
                    <div className={s.settingDescription}>
                      Configure an OpenAI-compatible API endpoint. Use presets for popular
                      providers.
                    </div>

                    {/* Preset buttons */}
                    <div className={s.presetButtonContainer}>
                      <button
                        type="button"
                        onClick={() => applyPreset('groq')}
                        className={s.presetButton}
                      >
                        Groq (Free)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset('openrouter')}
                        className={s.presetButton}
                      >
                        OpenRouter
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset('openai')}
                        className={s.presetButton}
                      >
                        OpenAI
                      </button>
                    </div>

                    {/* Form fields */}
                    <div className={s.endpointFormFields}>
                      <div>
                        <label className={s.formLabel}>
                          <div className={s.formLabelText}>Base URL</div>
                          <input
                            type="text"
                            value={endpointBaseUrl}
                            onChange={e => setEndpointBaseUrl(e.target.value)}
                            placeholder="https://api.groq.com/openai/v1"
                            className={`${s.input} ${s.fullWidthInput}`}
                          />
                        </label>
                      </div>
                      <div>
                        <label className={s.formLabel}>
                          <div className={s.formLabelText}>API Key</div>
                          <input
                            type="password"
                            value={endpointApiKey}
                            onChange={e => setEndpointApiKey(e.target.value)}
                            placeholder="Your API key"
                            className={`${s.input} ${s.fullWidthInput}`}
                          />
                        </label>
                      </div>
                      <div>
                        <label className={s.formLabel}>
                          <div className={s.formLabelText}>Model</div>
                          <input
                            type="text"
                            value={endpointModel}
                            onChange={e => setEndpointModel(e.target.value)}
                            placeholder="llama-3.1-70b-versatile"
                            className={`${s.input} ${s.fullWidthInput}`}
                          />
                        </label>
                      </div>
                      <div>
                        <label className={s.formLabel}>
                          <div className={s.formLabelText}>Display Name (optional)</div>
                          <input
                            type="text"
                            value={endpointDisplayName}
                            onChange={e => setEndpointDisplayName(e.target.value)}
                            placeholder="My Custom AI"
                            className={`${s.input} ${s.fullWidthInput}`}
                          />
                        </label>
                      </div>

                      {endpointStatus.state === 'failed' && (
                        <div className={s.endpointError}>{endpointStatus.message}</div>
                      )}
                      {endpointStatus.state === 'saved' && (
                        <div className={s.endpointOk}>Endpoint reachable and saved.</div>
                      )}

                      <div className={s.actionButtonContainer}>
                        <button
                          type="button"
                          onClick={handleSaveCustomEndpoint}
                          disabled={
                            !endpointBaseUrl ||
                            !endpointApiKey ||
                            !endpointModel ||
                            endpointStatus.state === 'checking'
                          }
                          className={s.primaryButton}
                        >
                          {endpointStatus.state === 'checking' ? 'Checking…' : 'Test and Save'}
                        </button>
                        {customEndpoint && (
                          <button
                            type="button"
                            onClick={handleClearCustomEndpoint}
                            className={s.secondaryButton}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* API Keys Tab */}
            {activeTab === 'api-keys' && (
              <>
                {/* API Keys Section */}
                <div className={s.section}>
                  <h3 className={s.sectionTitle}>API Keys</h3>

                  <div className={s.privacyNote}>
                    Your API keys are never sent to Noodles.gl servers. Keys can be stored in your
                    browser or in project files.
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
                      onProjectRemove={() => {
                        removeProjectKey('mapbox')
                        analytics.track('project_key_removed', { key: 'mapbox' })
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
                      onProjectRemove={() => {
                        removeProjectKey('googleMaps')
                        analytics.track('project_key_removed', { key: 'googleMaps' })
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
                      onProjectRemove={() => {
                        removeProjectKey('cesium')
                        analytics.track('project_key_removed', { key: 'cesium' })
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
                      onProjectRemove={() => {
                        removeProjectKey('anthropic')
                        analytics.track('project_key_removed', { key: 'anthropic' })
                      }}
                    />

                    <KeyGroup
                      label="OpenRouter API Key"
                      description="Optional alternative to the Anthropic key. Lets the AI assistant run on Gemini, GPT, or any other model OpenRouter hosts, billed through OpenRouter."
                      placeholder="sk-or-v1-..."
                      browserValue={browserKeys.openrouter || ''}
                      projectValue={projectKeys.openrouter}
                      envValue={envKeys.openrouter}
                      activeSource={getActiveSource('openrouter')}
                      onBrowserChange={value => setBrowserKey('openrouter', value)}
                      onBrowserClear={() => {
                        setBrowserKey('openrouter', undefined)
                        analytics.track('key_cleared', { key: 'openrouter' })
                      }}
                      onProjectRemove={() => {
                        removeProjectKey('openrouter')
                        analytics.track('project_key_removed', { key: 'openrouter' })
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
                      onProjectRemove={() => {
                        removeProjectKey('overpass')
                        analytics.track('project_key_removed', { key: 'overpass' })
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
                          Include your browser keys in the project file when saving. Only enable
                          this if you want to share your keys with collaborators. Keys are stored in
                          plain text.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              </>
            )}
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
