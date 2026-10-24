import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useEffect, useRef, useState } from 'react'
import { useAgentModelStore } from '../ai-chat/agent/model-store'
import { validateCustomEndpoint } from '../ai-chat/agent/providers/custom'
import { ENDPOINT_PRESETS, type EndpointPreset } from '../ai-chat/agent/providers/endpoint-presets'
import { WEBLLM_MODELS, webgpuAvailable, webllmModelLabel } from '../ai-chat/agent/providers/webllm'
import type { KeySource, KeyType, ProviderPreference } from '../noodles/keys-store'
import { getEnvKeys, useKeysStore } from '../noodles/keys-store'
import { useOpenRouterConnect } from '../noodles/use-openrouter-connect'
import { getGitSettings, saveGitSettings, useGitSettings } from '../noodles/utils/git-settings'
import { analytics } from '../utils/analytics'
import { getLoadedGoogleMapsKey } from '../utils/geocoding'
import s from './settings-dialog.module.css'

type EndpointStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'saved' }
  | { state: 'failed'; message: string }

interface SettingsDialogProps {
  open: boolean
  setOpen: (open: boolean) => void
  // Saved project whose version control settings the dialog edits; null when there is none
  projectName?: string | null
}

// Component that groups all sources (project, browser, env) for a single key type
interface KeyGroupProps {
  label: string
  description: string
  placeholder: string
  browserValue: string
  // Undefined for AI keys, which have no project slot
  projectValue?: string
  envValue?: string
  activeSource: KeySource | null
  onBrowserChange: (value: string) => void
  onBrowserClear: () => void
  onProjectChange?: (value: string) => void
  onProjectClear?: () => void
  // Picks which key the project uses. Only offered while the project has a key of its own.
  onUse?: (source: KeySource) => void
  notice?: React.ReactNode
  inputRef?: React.RefObject<HTMLInputElement>
}

const SOURCE_NAMES: Record<KeySource, string> = {
  project: 'Project',
  browser: 'Browser',
  env: 'Environment',
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
  onProjectChange,
  onProjectClear,
  onUse,
  notice,
  inputRef,
}: KeyGroupProps) => {
  const handleCopy = (value: string, source: KeySource) => {
    navigator.clipboard.writeText(value)
    analytics.track('key_copied', { source })
  }

  const sourceLabel = (source: KeySource, value: string | undefined) => (
    <div className={s.keySourceLabel}>
      <span className={s.sourceText}>{SOURCE_NAMES[source]}</span>
      {activeSource === source && <span className={s.activeBadge}>Active</span>}
      {onUse && projectValue && value && activeSource !== source && (
        <button type="button" onClick={() => onUse(source)} className={s.copyButton}>
          Use
        </button>
      )}
    </div>
  )

  const overridden = projectValue && activeSource && activeSource !== 'project'

  return (
    <div className={s.keyGroup}>
      <div className={s.keyGroupHeader}>
        <div className={s.keyLabel}>{label}</div>
        <div className={s.keyDescription}>{description}</div>
      </div>

      <div className={s.keySourcesList}>
        {/* Project key, saved in noodles.json */}
        {onProjectChange && (
          <div className={s.keySource}>
            {sourceLabel('project', projectValue)}
            <input
              type="text"
              value={projectValue ?? ''}
              onChange={e => onProjectChange(e.target.value)}
              placeholder="Saved in the project file"
              aria-label={`${label} (project)`}
              className={s.input}
            />
            {projectValue && (
              <>
                <button
                  type="button"
                  onClick={() => handleCopy(projectValue, 'project')}
                  className={s.copyButton}
                >
                  Copy
                </button>
                <button type="button" onClick={onProjectClear} className={s.clearButton}>
                  Clear
                </button>
              </>
            )}
          </div>
        )}

        {/* Browser key input */}
        <div className={s.keySource}>
          {sourceLabel('browser', browserValue)}
          <input
            ref={inputRef}
            type="text"
            value={browserValue}
            onChange={e => onBrowserChange(e.target.value)}
            placeholder={placeholder}
            aria-label={`${label} (browser)`}
            className={s.input}
          />
          {browserValue && (
            <button type="button" onClick={onBrowserClear} className={s.clearButton}>
              Clear
            </button>
          )}
        </div>

        {/* Environment key (read-only) */}
        {envValue && (
          <div className={s.keySource}>
            {sourceLabel('env', envValue)}
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

        {overridden && (
          <div className={s.keyDescription}>
            Using your {activeSource === 'env' ? 'environment' : 'browser'} key for this project
            instead of the project's key.
          </div>
        )}
        {notice && <div className={s.keyDescription}>{notice}</div>}
      </div>
    </div>
  )
}

// An AI key in a project file is dropped on load, so the user is told rather than
// left wondering why the chat does not use it
const ignoredProjectKeyNotice = (keyName: string) =>
  `This project file included ${keyName} key. It isn't used, and saving removes it from the file.`

type TabName = 'general' | 'ai-provider' | 'api-keys' | 'version-control'

export function SettingsDialog({ open, setOpen, projectName = null }: SettingsDialogProps) {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [errorCaptureEnabled, setErrorCaptureEnabled] = useState(true)
  const [activeTab, setActiveTab] = useState<TabName>('general')

  // Store subscriptions
  const browserKeys = useKeysStore(state => state.browserKeys)
  // Subscribed so the Active badges follow override changes
  useKeysStore(state => state.keyOverrides)
  const projectKeys = useKeysStore(state => state.projectKeys || {})
  const savedProjectKeys = useKeysStore(state => state.savedProjectKeys)
  const ignoredProjectKeys = useKeysStore(state => state.ignoredProjectKeys)
  const providerPreference = useKeysStore(state => state.getProviderPreference())
  const customEndpoint = useKeysStore(state => state.getCustomEndpoint())
  const setBrowserKey = useKeysStore(state => state.setBrowserKey)
  const setProjectKey = useKeysStore(state => state.setProjectKey)
  const setKeyOverride = useKeysStore(state => state.setKeyOverride)
  const setProviderPreference = useKeysStore(state => state.setProviderPreference)
  const setCustomEndpoint = useKeysStore(state => state.setCustomEndpoint)
  const getActiveSource = useKeysStore(state => state.getActiveSource)
  const getKey = useKeysStore(state => state.getKey)
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

  // Version control settings belong to the open project; the author is shared
  const {
    enabled: gitEnabled,
    autoCommit: gitAutoCommit,
    autoCommitDelay: gitAutoCommitDelay,
    useExistingRepo: gitUseExistingRepo,
  } = useGitSettings(projectName)
  const [gitAuthorName, setGitAuthorName] = useState('Noodles User')
  const [gitAuthorEmail, setGitAuthorEmail] = useState('user@noodles.local')

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

      const { author } = getGitSettings()
      setGitAuthorName(author.name)
      setGitAuthorEmail(author.email)

      // Check for deep link in URL hash (supports "api-keys:anthropic" format)
      const hash = window.location.hash.slice(1)
      const [tabName, targetField] = hash.split(':')
      if (tabName === 'ai-provider' || tabName === 'api-keys' || tabName === 'version-control') {
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
      return () => {
        clearTimeout(timeoutId)
        // Clear stale focus target if dialog closes during delay
        setFocusedField(null)
      }
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

  // The Maps JavaScript API keeps the key it loaded with, so a change needs a reload
  const googleMapsReloadNotice = () => {
    const loadedKey = getLoadedGoogleMapsKey()
    if (!loadedKey || loadedKey === getKey('googleMaps')) return undefined
    // Project keys aren't kept in the browser, so reloading before saving would bring back the old one
    if (projectKeys.googleMaps !== savedProjectKeys?.googleMaps) {
      return 'Place search and directions still use the previous key. Save the project, then reload the page to apply it.'
    }
    return (
      <>
        Place search and directions still use the previous key.{' '}
        <button type="button" onClick={() => window.location.reload()} className={s.copyButton}>
          Reload to apply
        </button>
      </>
    )
  }

  // Props for a key that has project, browser and env slots
  const slotProps = (key: Exclude<KeyType, 'anthropic' | 'openrouter'>) => ({
    browserValue: browserKeys[key] || '',
    projectValue: projectKeys[key],
    envValue: envKeys[key],
    activeSource: getActiveSource(key),
    onBrowserChange: (value: string) => setBrowserKey(key, value),
    onBrowserClear: () => {
      setBrowserKey(key, undefined)
      analytics.track('key_cleared', { key })
    },
    onProjectChange: (value: string) => setProjectKey(key, value),
    onProjectClear: () => {
      setProjectKey(key, undefined)
      analytics.track('project_key_removed', { key })
    },
    onUse: (source: KeySource) => {
      setKeyOverride(key, source === 'project' ? null : source)
      analytics.track('key_source_chosen', { key, source })
    },
  })

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

  // Git settings handlers
  const handleGitEnabledToggle = (enabled: boolean) => {
    saveGitSettings({ enabled }, projectName)
    analytics.track(enabled ? 'git_versioning_enabled' : 'git_versioning_disabled')
  }

  const handleGitAutoCommitToggle = (enabled: boolean) => {
    saveGitSettings({ autoCommit: enabled }, projectName)
  }

  const handleGitAutoCommitDelayChange = (delay: number) => {
    saveGitSettings({ autoCommitDelay: delay }, projectName)
  }

  const handleGitUseExistingRepoToggle = (useExistingRepo: boolean) => {
    saveGitSettings({ useExistingRepo }, projectName)
    analytics.track(useExistingRepo ? 'git_existing_repo_enabled' : 'git_existing_repo_disabled')
  }

  const handleGitAuthorSave = () => {
    saveGitSettings({
      author: { name: gitAuthorName, email: gitAuthorEmail },
    })
    analytics.track('git_author_changed')
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
              <button
                type="button"
                className={`${s.tab} ${activeTab === 'version-control' ? s.tabActive : ''}`}
                onClick={() => setActiveTab('version-control')}
              >
                Version Control
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
                            <button
                              type="button"
                              onClick={openRouterConnect.retryPopup}
                              className={s.linkButton}
                            >
                              Open it again
                            </button>
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
                        <div className={s.providerOptionDescription}>
                          Slower: 10 seconds to a minute per answer, and best at questions and small
                          edits. The hosted providers above answer in seconds.
                        </div>
                        {webgpuReady === false ? (
                          <div className={s.providerOptionDescription}>
                            Unavailable: this browser does not offer WebGPU. Chrome and Edge do.
                          </div>
                        ) : (
                          <>
                            {/* Choosing a model is what arms this provider, and the sizes in
                                each label are the decision actually being made. Nothing
                                downloads until the chat next opens a session. */}
                            <select
                              className={s.select}
                              value={webllmModel ?? ''}
                              onChange={e => handleWebLLMModelChange(e.target.value)}
                            >
                              <option value="">Choose a model…</option>
                              <optgroup label="Recommended">
                                {WEBLLM_MODELS.filter(
                                  option => option.tier !== 'compatibility'
                                ).map(option => (
                                  <option key={option.id} value={option.id}>
                                    {webllmModelLabel(option, { memory: true })}
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="Advanced compatibility">
                                {WEBLLM_MODELS.filter(
                                  option => option.tier === 'compatibility'
                                ).map(option => (
                                  <option key={option.id} value={option.id}>
                                    {webllmModelLabel(option)}
                                  </option>
                                ))}
                              </optgroup>
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
                        <div className={s.providerOptionTitle}>
                          Chrome Built-in AI (experimental)
                        </div>
                        <div className={s.providerOptionDescription}>
                          Free, runs locally, no API key (Chrome 127+ required). Never picked
                          automatically: its tool use and instruction following are unreliable.
                        </div>
                        <div className={s.providerOptionDescription}>
                          Slower than a hosted provider, and best at questions and single edits.
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
                    Your API keys are never sent to Noodles.gl servers. A key in the project file is
                    saved in plain text and used by everyone who opens the project, unless they
                    choose their own key. AI provider keys are never read from or saved to project
                    files.
                  </div>

                  <div className={s.keysGroup}>
                    <KeyGroup
                      label="Mapbox Access Token"
                      description="Enables Mapbox basemaps and high-quality driving directions. Without it, directions fall back to OSRM (free, OpenStreetMap-based) and place search falls back to Photon."
                      placeholder="pk.eyJ1..."
                      {...slotProps('mapbox')}
                    />

                    <KeyGroup
                      label="Google Maps API Key"
                      description="Enables traffic-aware driving, transit directions, and higher-quality place search. Enable the Maps JavaScript API, Routes API, and Places API in Google Cloud."
                      placeholder="AIza..."
                      {...slotProps('googleMaps')}
                      notice={googleMapsReloadNotice()}
                    />

                    <KeyGroup
                      label="Cesium Ion Access Token"
                      description="Required for Cesium Ion 3D tile datasets. Not needed if you use custom 3D tile URLs directly."
                      placeholder="eyJhb..."
                      {...slotProps('cesium')}
                    />

                    <KeyGroup
                      label="Anthropic API Key (Claude)"
                      description="Claude models directly from Anthropic. Get your API key at console.anthropic.com/settings/keys"
                      placeholder="sk-ant-..."
                      browserValue={browserKeys.anthropic || ''}
                      envValue={envKeys.anthropic}
                      activeSource={getActiveSource('anthropic')}
                      onBrowserChange={value => setBrowserKey('anthropic', value)}
                      onBrowserClear={() => {
                        setBrowserKey('anthropic', undefined)
                        analytics.track('key_cleared', { key: 'anthropic' })
                      }}
                      notice={
                        ignoredProjectKeys.includes('anthropic')
                          ? ignoredProjectKeyNotice('an Anthropic')
                          : undefined
                      }
                      inputRef={anthropicInputRef}
                    />

                    <KeyGroup
                      label="OpenRouter API Key"
                      description="Access to multiple AI providers with unified billing. Get your API key at openrouter.ai/keys"
                      placeholder="sk-or-v1-..."
                      browserValue={browserKeys.openrouter || ''}
                      envValue={envKeys.openrouter}
                      activeSource={getActiveSource('openrouter')}
                      onBrowserChange={value => setBrowserKey('openrouter', value)}
                      onBrowserClear={() => {
                        setBrowserKey('openrouter', undefined)
                        analytics.track('key_cleared', { key: 'openrouter' })
                      }}
                      notice={
                        ignoredProjectKeys.includes('openrouter')
                          ? ignoredProjectKeyNotice('an OpenRouter')
                          : undefined
                      }
                      inputRef={openRouterInputRef}
                    />

                    <KeyGroup
                      label="Overpass API Endpoint"
                      description="Used by the Overpass operator to query OpenStreetMap data. Defaults to overpass.openstreetmap.fr (France mirror with reliable CORS)."
                      placeholder="https://overpass.openstreetmap.fr/api/interpreter"
                      {...slotProps('overpass')}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Version Control Tab */}
            {activeTab === 'version-control' && (
              <div className={s.section}>
                <h3 className={s.sectionTitle}>Git Version Control</h3>
                <p className={s.sectionDescription}>
                  Automatically track project history with git. Each save creates a commit, allowing
                  you to restore to previous versions.
                </p>
                {!projectName && (
                  <p className={s.sectionDescription}>
                    Save the project to a folder to change its version control settings.
                  </p>
                )}

                {/* Enable Git */}
                <div className={s.settingItem}>
                  <label className={s.settingLabel}>
                    <input
                      type="checkbox"
                      checked={gitEnabled}
                      onChange={e => handleGitEnabledToggle(e.target.checked)}
                      className={s.checkbox}
                      disabled={!projectName}
                    />
                    <div className={s.settingContent}>
                      <div className={s.settingName}>Enable version control</div>
                      <div className={s.settingDescription}>
                        Track changes and create git commits automatically for this project.
                      </div>
                    </div>
                  </label>
                </div>

                {/* Existing repository */}
                <div className={s.settingItem}>
                  <label className={s.settingLabel}>
                    <input
                      type="checkbox"
                      checked={gitUseExistingRepo}
                      onChange={e => handleGitUseExistingRepoToggle(e.target.checked)}
                      className={s.checkbox}
                      disabled={!projectName || !gitEnabled}
                    />
                    <div className={s.settingContent}>
                      <div className={s.settingName}>Commit to an existing repository</div>
                      <div className={s.settingDescription}>
                        If the project folder already had a git repository, Noodles leaves it alone.
                        Turn this on to commit every save into that repository, including any other
                        files in the folder.
                      </div>
                    </div>
                  </label>
                </div>

                {/* Autosave */}
                <div className={s.settingItem}>
                  <label className={s.settingLabel}>
                    <input
                      type="checkbox"
                      checked={gitAutoCommit}
                      onChange={e => handleGitAutoCommitToggle(e.target.checked)}
                      className={s.checkbox}
                      disabled={!projectName || !gitEnabled}
                    />
                    <div className={s.settingContent}>
                      <div className={s.settingName}>Autosave</div>
                      <div className={s.settingDescription}>
                        Automatically save and commit changes after a period of inactivity. Manual
                        saves (Cmd+S) always create commits immediately.
                      </div>
                    </div>
                  </label>
                </div>

                {/* Autosave Delay */}
                {projectName && gitEnabled && gitAutoCommit && (
                  <div className={s.settingItem}>
                    <div className={s.settingContent}>
                      <div className={s.settingName}>Autosave delay</div>
                      <div className={s.settingDescription}>
                        Time to wait after last change before automatically saving
                      </div>
                      <div className={s.delayOptions}>
                        {[15000, 30000, 60000].map(delay => (
                          <label key={delay} className={s.radioLabel}>
                            <input
                              type="radio"
                              name="autoCommitDelay"
                              checked={gitAutoCommitDelay === delay}
                              onChange={() => handleGitAutoCommitDelayChange(delay)}
                              className={s.radio}
                            />
                            <span>{delay / 1000}s</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Author Settings */}
                {gitEnabled && (
                  <div className={s.settingItem}>
                    <div className={s.settingContent}>
                      <div className={s.settingName}>Commit author</div>
                      <div className={s.settingDescription}>
                        Your name and email for git commits, used in every project
                      </div>
                      <div className={s.authorFields}>
                        <input
                          type="text"
                          value={gitAuthorName}
                          onChange={e => setGitAuthorName(e.target.value)}
                          placeholder="Your name"
                          className={s.input}
                        />
                        <input
                          type="email"
                          value={gitAuthorEmail}
                          onChange={e => setGitAuthorEmail(e.target.value)}
                          placeholder="your.email@example.com"
                          className={s.input}
                        />
                        <button
                          type="button"
                          onClick={handleGitAuthorSave}
                          className={s.saveAuthorButton}
                        >
                          Save Author
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Keyboard Shortcut Info */}
                <div className={s.settingItem}>
                  <div className={s.settingContent}>
                    <div className={s.settingName}>View history</div>
                    <div className={s.settingDescription}>
                      Press <kbd className={s.kbd}>Cmd+Shift+H</kbd> to open the version history
                      panel and restore to previous commits.
                    </div>
                  </div>
                </div>
              </div>
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
