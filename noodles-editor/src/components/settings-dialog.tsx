import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useRef, useState } from 'react'
import { useAgentModelStore } from '../ai-chat/agent/model-store'
import { validateCustomEndpoint } from '../ai-chat/agent/providers/custom'
import { ENDPOINT_PRESETS, type EndpointPreset } from '../ai-chat/agent/providers/endpoint-presets'
import { WEBLLM_MODELS, webgpuAvailable } from '../ai-chat/agent/providers/webllm'
import type { ProviderPreference } from '../noodles/keys-store'
import { getEnvKeys, useKeysStore } from '../noodles/keys-store'
import { useOpenRouterConnect } from '../noodles/use-openrouter-connect'
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
  inputRef?: React.RefObject<HTMLInputElement>
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
  inputRef,
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
            ref={inputRef}
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
  const clearBrowserKey = useKeysStore(state => state.clearBrowserKey)

  // OpenRouter sign-in. A key the OAuth flow minted is stored as a browser key,
  // so that source is also what tells us there is something to disconnect.
  const openRouterConnect = useOpenRouterConnect()
  const openRouterConnected = getActiveSource('openrouter') === 'browser'

  // The local-model option. Picking a model is what arms it: until then the chat
  // treats WebLLM as unconfigured, so 'automatic' cannot start a download nobody
  // asked for.
  const webllmModel = useAgentModelStore(state => state.models.webllm)
  const setModel = useAgentModelStore(state => state.setModel)
  const [webgpuReady, setWebgpuReady] = useState<boolean | null>(null)

  // Custom endpoint state (local form state)
  const [endpointBaseUrl, setEndpointBaseUrl] = useState(customEndpoint?.baseUrl || '')
  const [endpointApiKey, setEndpointApiKey] = useState(customEndpoint?.apiKey || '')
  const [endpointModel, setEndpointModel] = useState(customEndpoint?.model || '')
  const [endpointDisplayName, setEndpointDisplayName] = useState(customEndpoint?.displayName || '')
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus>({ state: 'idle' })
  // Model ids the endpoint reported, so a mistyped model becomes a pick from a list
  const [endpointModels, setEndpointModels] = useState<string[]>([])
  // Which preset the form currently matches, so the "get a key" link points at the
  // console the typed base URL actually belongs to
  const activePreset = ENDPOINT_PRESETS.find(
    preset => preset.baseUrl === endpointBaseUrl.trim().replace(/\/+$/, '')
  )

  // Refs for input focusing from deep links
  const anthropicInputRef = useRef<HTMLInputElement>(null)
  const openRouterInputRef = useRef<HTMLInputElement>(null)
  const [focusedField, setFocusedField] = useState<string | null>(null)

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

      // Check for deep link in URL hash (supports "api-keys:anthropic" format)
      const hash = window.location.hash.slice(1)
      const [tabName, targetField] = hash.split(':')
      if (tabName === 'ai-provider' || tabName === 'api-keys') {
        setActiveTab(tabName as TabName)
        if (targetField) {
          setFocusedField(targetField)
        }
      }
    }
  }, [open, customEndpoint])

  // Asked once the dialog is open rather than on mount: requesting a GPU adapter
  // is not free, and nothing outside this tab needs the answer.
  useEffect(() => {
    if (!open || webgpuReady !== null) return
    let current = true
    webgpuAvailable().then(available => {
      if (current) setWebgpuReady(available)
    })
    return () => {
      current = false
    }
  }, [open, webgpuReady])

  // Clear hash when dialog closes
  useEffect(() => {
    if (!open && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [open])

  // Focus input when targeted by deep link
  useEffect(() => {
    if (focusedField && open) {
      // Small delay to ensure the tab has switched and DOM is ready
      const timeoutId = setTimeout(() => {
        if (focusedField === 'anthropic' && anthropicInputRef.current) {
          anthropicInputRef.current.focus()
          anthropicInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else if (focusedField === 'openrouter' && openRouterInputRef.current) {
          openRouterInputRef.current.focus()
          openRouterInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        setFocusedField(null)
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [focusedField, open])

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

  const handleDisconnectOpenRouter = () => {
    clearBrowserKey('openrouter')
    openRouterConnect.reset()
    analytics.track('openrouter_disconnected')
  }

  const handleProviderPreferenceChange = (preference: ProviderPreference) => {
    setProviderPreference(preference)
    analytics.track('ai_provider_preference_changed', { preference })
  }

  // The model id is one of a handful of public WebLLM slugs, so it is a feature
  // choice rather than anything about the user
  const handleWebLLMModelChange = (model: string) => {
    setModel('webllm', model || undefined)
    if (model) analytics.track('webllm_model_selected', { model })
  }

  // Checks the endpoint before saving it. A typo'd base URL is the commonest
  // mistake here and it would otherwise only surface as a failed chat message,
  // which is a much worse place to learn about it.
  const handleSaveCustomEndpoint = async () => {
    // The key is optional: a llama.cpp or LM Studio server on the LAN issues none
    // and wants no Authorization header at all
    if (!endpointBaseUrl || !endpointModel) return

    setEndpointStatus({ state: 'checking' })
    const result = await validateCustomEndpoint(endpointBaseUrl, endpointApiKey)
    setEndpointModels(result.models ?? [])

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
        message: `The endpoint works, but does not list “${endpointModel}”. Pick one of: ${result.models.slice(0, 8).join(', ')}`,
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
    setEndpointModels([])
    setEndpointStatus({ state: 'idle' })
    analytics.track('custom_endpoint_cleared')
  }

  // Fills the form; the user still presses Test and Save, so a preset can never
  // save a configuration that does not work. The preset id is a public provider
  // name, which is a feature choice rather than anything about the user.
  const applyPreset = (preset: EndpointPreset) => {
    setEndpointBaseUrl(preset.baseUrl)
    setEndpointModel(preset.model)
    setEndpointDisplayName(preset.displayName)
    setEndpointModels([])
    setEndpointStatus({ state: 'idle' })
    // A key from a previous preset is worse than none: it would be sent to a host
    // that never issued it
    setEndpointApiKey('')
    analytics.track('custom_endpoint_preset_applied', { preset: preset.id })
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
                        <div className={s.providerOptionTitle}>
                          Always use OpenRouter
                          {openRouterConnected && <span className={s.activeBadge}>Connected</span>}
                        </div>
                        <div className={s.providerOptionDescription}>
                          Gemini, GPT, Claude and others behind one key. Sign in and OpenRouter
                          issues the key for you — free models included, no copy-paste.
                        </div>
                        {/* Buttons are interactive content, so clicking one does not
                            also activate the surrounding label's radio. */}
                        <div className={s.connectRow}>
                          {openRouterConnected ? (
                            <button
                              type="button"
                              onClick={handleDisconnectOpenRouter}
                              className={s.secondaryButton}
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={openRouterConnect.connect}
                              disabled={openRouterConnect.status === 'connecting'}
                              className={s.primaryButton}
                            >
                              {openRouterConnect.status === 'connecting'
                                ? 'Waiting for OpenRouter…'
                                : 'Connect OpenRouter'}
                            </button>
                          )}
                        </div>
                        {openRouterConnect.blockedUrl && (
                          <div className={s.providerOptionDescription}>
                            Your browser blocked the sign-in window.{' '}
                            <a href={openRouterConnect.blockedUrl} target="_blank" rel="noreferrer">
                              Open it in a new tab
                            </a>
                            .
                          </div>
                        )}
                        {openRouterConnect.error && (
                          <div className={s.endpointError}>{openRouterConnect.error}</div>
                        )}
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
                      className={`${s.providerOption} ${providerPreference === 'webllm' ? s.providerOptionSelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="providerPreference"
                        value="webllm"
                        checked={providerPreference === 'webllm'}
                        disabled={webgpuReady === false}
                        onChange={e =>
                          handleProviderPreferenceChange(e.target.value as ProviderPreference)
                        }
                        className={s.providerRadio}
                      />
                      <div className={s.providerOptionContent}>
                        <div className={s.providerOptionTitle}>Local model (on-device)</div>
                        <div className={s.providerOptionDescription}>
                          Runs on this machine's GPU. No account, no key, and no prompt ever leaves
                          the browser — in exchange for a one-time download of a gigabyte or more.
                        </div>
                        {webgpuReady === false ? (
                          <div className={s.providerOptionDescription}>
                            Unavailable: this browser does not offer WebGPU. Chrome and Edge do.
                          </div>
                        ) : (
                          <>
                            {/* Choosing a model is what arms this provider, and the size in
                                each label is the decision actually being made. Nothing
                                downloads until the chat next opens a session. */}
                            <select
                              className={s.select}
                              value={webllmModel ?? ''}
                              onChange={e => handleWebLLMModelChange(e.target.value)}
                            >
                              <option value="">Choose a model…</option>
                              {WEBLLM_MODELS.map(option => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            {providerPreference === 'webllm' && !webllmModel && (
                              <div className={s.providerOptionDescription}>
                                Pick a model above to start — nothing downloads until you do.
                              </div>
                            )}
                          </>
                        )}
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

                    {/* Preset buttons. Each fills the form; nothing is saved until
                        Test and Save checks the endpoint actually serves the model. */}
                    <div className={s.presetButtonContainer}>
                      {ENDPOINT_PRESETS.map(preset => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applyPreset(preset)}
                          className={s.presetButton}
                          title={preset.note}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    {activePreset?.signupUrl && (
                      <div className={s.presetHint}>
                        {activePreset.note}{' '}
                        <a href={activePreset.signupUrl} target="_blank" rel="noreferrer">
                          Get a key →
                        </a>
                      </div>
                    )}

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
                          {/* Optional, because a server on the LAN (LM Studio,
                              llama.cpp, Ollama) issues no key and rejects an empty
                              Bearer header */}
                          <input
                            type="password"
                            value={endpointApiKey}
                            onChange={e => setEndpointApiKey(e.target.value)}
                            placeholder="Your API key (blank for a local server)"
                            className={`${s.input} ${s.fullWidthInput}`}
                          />
                        </label>
                      </div>
                      <div>
                        <label className={s.formLabel}>
                          <div className={s.formLabelText}>Model</div>
                          {/* A list rather than a free-text field once the endpoint has
                              told us what it serves: a mistyped model is the commonest
                              way a working endpoint still fails */}
                          <input
                            type="text"
                            list="custom-endpoint-models"
                            value={endpointModel}
                            onChange={e => setEndpointModel(e.target.value)}
                            placeholder="llama-3.3-70b-versatile"
                            className={`${s.input} ${s.fullWidthInput}`}
                          />
                          <datalist id="custom-endpoint-models">
                            {endpointModels.map(model => (
                              <option key={model} value={model} />
                            ))}
                          </datalist>
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
                      description="Claude models directly from Anthropic. Get your API key at console.anthropic.com/settings/keys"
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
                      inputRef={anthropicInputRef}
                    />

                    <KeyGroup
                      label="OpenRouter API Key"
                      description="Access to multiple AI providers with unified billing. Get your API key at openrouter.ai/keys"
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
                      inputRef={openRouterInputRef}
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
