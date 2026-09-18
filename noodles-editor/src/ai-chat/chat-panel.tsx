// ChatPanel - Main UI component for Claude AI integration

import { useReactFlow } from '@xyflow/react'
import { type FC, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { applySerializedFieldValue, type Field } from '../noodles/fields'
import type { CustomEndpointConfig, ProviderPreference } from '../noodles/keys-store'
import { useKeysStore } from '../noodles/keys-store'
import { getOp, useUIStore } from '../noodles/store'
import { useOpenRouterConnect } from '../noodles/use-openrouter-connect'
import { fireGraphMutation } from '../noodles/utils/graph-history'
import { captureOperatorInputs } from '../noodles/utils/property-history'
import { analytics } from '../utils/analytics'
import { debugAiChat } from '../utils/debug'
import { useAgentModelStore } from './agent/model-store'
import { type Credentials, isProviderReady, resolveProviderId } from './agent/provider-selection'
import { ANTHROPIC_MODELS, AnthropicProvider } from './agent/providers/anthropic'
import { CHROME_MODELS, chromeAvailability, createChromeProvider } from './agent/providers/chrome'
import { CustomProvider } from './agent/providers/custom'
import {
  cachedOpenRouterFreeModels,
  defaultFreeModel,
  fetchOpenRouterFreeModels,
  OPENROUTER_MODELS,
  type OpenRouterModel,
  OpenRouterProvider,
} from './agent/providers/openrouter'
import { createWebLLMProvider, WEBLLM_MODELS, webgpuAvailable } from './agent/providers/webllm'
import { AgentSession } from './agent/session'
import type { AgentProvider, AgentUsage, DownloadProgress, ProviderId } from './agent/types'
import { webSearchConfigFor } from './agent/web-search'
import styles from './chat-panel.module.css'
import { loadConversation, saveConversation } from './conversation-history'
import { ConversationHistoryPanel } from './conversation-history-panel'
import { globalContextManager } from './global-context-manager'
import { MCPTools } from './mcp-tools'
import { type ModificationProposal, validateProjectModifications } from './modification-proposal'
import type { Message, NoodlesProject } from './types'

interface ChatPanelProps {
  project: NoodlesProject
  onClose: () => void
  isVisible: boolean
  initialMessage?: string
}

export const ChatPanel: FC<ChatPanelProps> = ({ project, onClose, isVisible, initialMessage }) => {
  // Get ReactFlow state for the modification hook
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextLoading, setContextLoading] = useState(true)
  const [session, setSession] = useState<AgentSession | null>(null)
  const [mcpTools, setMcpTools] = useState<MCPTools | null>(null)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [contextProgress, setContextProgress] = useState<string>('')
  // Text of the turn in flight, so the reply appears as it is generated rather
  // than all at once when the whole multi-step run finishes
  const [streamingText, setStreamingText] = useState('')
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [lastUsage, setLastUsage] = useState<AgentUsage | null>(null)
  // Whether this browser has a usable built-in model. Only knowable
  // asynchronously, so it starts false and the option stays disabled until then.
  const [chromeAvailable, setChromeAvailable] = useState(false)
  // Whether a local model could run here at all. Same shape as chromeAvailable:
  // asking for a WebGPU adapter is async, so the answer arrives after first paint.
  const [webgpuReady, setWebgpuReady] = useState(false)
  // Only the two on-device providers report one, and only on the first run of a
  // given machine
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  // A provider that would not start. Distinct from a failed message: nothing can
  // be sent at all, so it replaces the panel rather than appearing in it.
  const [providerError, setProviderError] = useState<string | null>(null)
  const [providerSupportsImages, setProviderSupportsImages] = useState(false)
  const [pendingScreenshot, setPendingScreenshot] = useState<{
    data: string
    format: 'png' | 'jpeg'
  } | null>(null)
  const [pendingProposal, setPendingProposal] = useState<ModificationProposal | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Get API keys directly from store (reactive)
  const apiKey = useKeysStore(state => state.getKey('anthropic'))
  const openRouterKey = useKeysStore(state => state.getKey('openrouter'))
  const customEndpoint = useKeysStore(state => state.getCustomEndpoint())

  // Shared with the settings dialog, so the two cannot disagree about which
  // provider is in use
  const preference = useKeysStore(state => state.getProviderPreference())
  const setPreference = useKeysStore(state => state.setProviderPreference)
  const setStoredModel = useAgentModelStore(state => state.setModel)
  const storedOpenRouterModel = useAgentModelStore(state => state.models.openrouter)
  // WebLLM is the one provider whose readiness depends on a model having been
  // chosen, which is what keeps 'automatic' from starting a multi-gigabyte download
  const storedWebLLMModel = useAgentModelStore(state => state.models.webllm)

  const credentials: Credentials = {
    anthropicKey: apiKey,
    openRouterKey,
    customEndpoint,
    webllmModel: storedWebLLMModel,
    webgpuReady,
    chromeAvailable,
  }

  // Anthropic unless only another credential is configured, or the user picked
  // otherwise. Falls back when the chosen provider's key has since been cleared.
  const providerId: ProviderId = resolveProviderId({ ...credentials, preference })
  const providerKey = providerId === 'anthropic' ? apiKey : openRouterKey
  // The on-device providers need no key and a custom endpoint carries its own, so
  // readiness is not the same question as "has a key"
  const providerReady = isProviderReady(providerId, credentials)
  // Free tool-calling models, read from OpenRouter's catalogue rather than a
  // hard-coded list, since which models are free changes month to month
  const [freeModels, setFreeModels] = useState<OpenRouterModel[]>(cachedOpenRouterFreeModels)
  const connect = useOpenRouterConnect()

  // undefined leaves the provider on its own default
  const model = useAgentModelStore(state => state.getModel(providerId))
  const modelGroups = modelGroupsFor(providerId, customEndpoint, freeModels)
  const modelChoices = modelGroups.flatMap(group => group.models)

  // Get the function to open settings dialog
  const setSettingsDialogOpen = useUIStore(state => state.setSettingsDialogOpen)

  // Deep-links into the tab that configures providers, rather than the one that
  // happened to be open last
  const openProviderSettings = () => {
    window.location.hash = 'ai-provider'
    setSettingsDialogOpen(true)
  }

  // Opens settings dialog to the specific configuration screen for a provider
  const openProviderConfiguration = (providerId: ProviderId) => {
    // Save the preference first so provider switches automatically after config
    setPreference(providerId)

    switch (providerId) {
      case 'anthropic':
        window.location.hash = 'api-keys:anthropic'
        break
      case 'openrouter':
        window.location.hash = 'api-keys:openrouter'
        break
      case 'custom':
        window.location.hash = 'ai-provider'
        break
      case 'webllm':
        window.location.hash = 'ai-provider'
        break
      case 'chrome':
        // Chrome requires no config and preference is already set above
        return
    }
    setSettingsDialogOpen(true)
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Subscribe to context loading progress
  useEffect(() => {
    const unsubscribe = globalContextManager.subscribe(state => {
      if (state.status === 'loading') {
        setContextProgress(`Loading ${state.progress.stage}...`)
      } else {
        setContextProgress('')
      }
    })

    return unsubscribe
  }, [])

  // Ask once whether this browser can run a model locally, either way it can.
  // 'downloadable' counts for Chrome: create() then downloads it, which is a wait
  // rather than a failure.
  useEffect(() => {
    let current = true
    chromeAvailability().then(availability => {
      if (current) setChromeAvailable(availability !== 'unavailable')
    })
    webgpuAvailable().then(available => {
      if (current) setWebgpuReady(available)
    })
    return () => {
      current = false
    }
  }, [])

  // Load the free-model list when it could matter: either OpenRouter is in use, or
  // nothing is configured yet and the empty state is about to offer it. Cached for
  // the session, so this is one request at most.
  const needFreeModels = providerId === 'openrouter' || !providerReady
  useEffect(() => {
    if (!needFreeModels) return
    let current = true
    fetchOpenRouterFreeModels().then(models => {
      if (current && models.length > 0) setFreeModels(models)
    })
    return () => {
      current = false
    }
  }, [needFreeModels])

  // A just-connected account has no credit, so leaving the model on the paid
  // default would greet the user with a billing error. Only fills a gap: a model
  // the user picked before is left alone.
  useEffect(() => {
    if (connect.status !== 'connected' || storedOpenRouterModel) return
    setStoredModel('openrouter', defaultFreeModel(freeModels))
  }, [connect.status, storedOpenRouterModel, freeModels, setStoredModel])

  // Build the session whenever the provider, model, or key changes
  useEffect(() => {
    if (!providerReady) {
      setContextLoading(false)
      setProviderSupportsImages(false)
      return
    }

    // Providers can own resources that outlive a turn — Chrome's holds an
    // on-device session carrying the transcript — so a session this effect built
    // has to be disposed whether it was ever handed to the UI or was superseded
    // while still being built
    let built: AgentSession | null = null
    let cancelled = false

    const init = async () => {
      setContextLoading(true)
      setProviderError(null)
      try {
        // Wait for context to be ready (should be instant if already loaded)
        const loader = await globalContextManager.waitForReady()

        const tools = new MCPTools(loader)
        const provider: AgentProvider = await createProvider({
          providerId,
          apiKey: providerKey,
          model,
          customEndpoint,
          onDownloadProgress: setDownloadProgress,
        })

        built = new AgentSession(provider, tools, {
          webSearch: webSearchConfigFor({
            providerId,
            model: provider.model,
            anthropicKey: apiKey,
            openRouterKey,
          }),
        })

        if (cancelled) {
          built.dispose()
          return
        }

        setMcpTools(tools)
        setSession(built)
        setProviderSupportsImages(provider.supportsImages)
        analytics.track('ai_provider_load', {
          provider: providerId,
          model: provider.model,
          outcome: 'success',
        })
      } catch (error) {
        debugAiChat('Failed to initialize the assistant:', error)
        setSession(null)
        setProviderSupportsImages(false)
        setProviderError(error instanceof Error ? error.message : String(error))
        analytics.track('ai_provider_load', {
          provider: providerId,
          model: model ?? 'default',
          outcome: 'failed',
        })
      } finally {
        setDownloadProgress(null)
        setContextLoading(false)
      }
    }

    init()

    return () => {
      cancelled = true
      built?.dispose()
    }
  }, [providerId, providerKey, providerReady, model, apiKey, openRouterKey, customEndpoint])

  // Update MCPTools with current project whenever it changes
  useEffect(() => {
    if (mcpTools && project) {
      mcpTools.setProject(project)
    }
  }, [mcpTools, project])

  // Handle initial message from quick start modal
  useEffect(() => {
    if (initialMessage && isVisible && messages.length === 0) {
      setInput(initialMessage)
    }
  }, [initialMessage, isVisible, messages.length])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleSend = async () => {
    if (!input.trim() || !session || !project) return

    const userMessage: Message = {
      role: 'user',
      content: input,
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setStreamingText('')
    setActiveTools([])

    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = performance.now()

    try {
      const response = await session.send({
        message: input,
        screenshot: pendingScreenshot?.data,
        screenshotFormat: pendingScreenshot?.format,
        conversationHistory: messages,
        signal: controller.signal,
        onEvent: event => {
          if (event.type === 'text_delta') setStreamingText(prev => prev + event.text)
          if (event.type === 'tool_call') setActiveTools(prev => [...prev, event.name])
          if (event.type === 'usage') setLastUsage(event.usage)
        },
      })
      setPendingScreenshot(null)

      // An aborted run still returns whatever it had produced, which is worth
      // keeping — the user stopped it, they did not undo it
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.message || '(stopped)',
        // Kept so the next turn can answer "why did you do that?" — see
        // MessageToolUse for why the results themselves are not kept
        toolUses: response.toolCalls?.map(call => ({
          name: call.name,
          params: call.params,
          ok: call.result.success,
        })),
      }

      setMessages(prev => [...prev, assistantMessage])
      analytics.track('ai_completion', {
        provider: providerId,
        model: model ?? 'default',
        latencyMs: Math.round(performance.now() - startedAt),
        outcome: 'success',
      })

      // Graph edits are proposals until the user accepts the normalized diff.
      if (response.projectModifications && response.projectModifications.length > 0) {
        const registry = globalContextManager.getLoader()?.getOperatorRegistry()
        const validation = registry
          ? validateProjectModifications(
              { nodes: getNodes(), edges: getEdges() },
              response.projectModifications,
              registry
            )
          : null
        if (!validation?.success) {
          const detail =
            validation && !validation.success ? validation.errors.join('; ') : 'context unavailable'
          const errorMessage = `The proposed graph update could not be validated: ${detail}`
          debugAiChat(errorMessage)
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              content: errorMessage,
            },
          ])
        } else {
          setPendingProposal(validation.proposal)
          analytics.track('ai_modification_proposed', {
            provider: providerId,
            model: model ?? 'default',
            modificationCount: validation.proposal.modifications.length,
            validationOutcome: 'valid',
          })
        }
      }
    } catch (error) {
      debugAiChat('Error sending message:', error)
      analytics.track('ai_completion', {
        provider: providerId,
        model: model ?? 'default',
        latencyMs: Math.round(performance.now() - startedAt),
        outcome: 'failed',
      })

      // Check error type and provide helpful messages
      const errorStr = error instanceof Error ? error.message : String(error)
      const errorName = error instanceof Error ? error.name : ''

      const isAuthError =
        errorStr.includes('authentication') ||
        errorStr.includes('401') ||
        errorStr.includes('invalid_api_key') ||
        errorStr.includes('api_key')

      const isChromeError =
        errorName.startsWith('k') || errorStr.includes('kError') || errorStr.includes('Chrome')

      if (isAuthError) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content:
              'Authentication Error: Your API key is invalid. Please check your API key in Settings > API Keys.',
          },
        ])
      } else if (isChromeError) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content:
              '⚠️ Chrome AI encountered an error. Try these steps:\n\n' +
              '1. Check chrome://components for "Optimization Guide On Device Model" - ensure it\'s up to date\n' +
              "2. Verify you're on Chrome 127+ with the Prompt API enabled\n" +
              '3. Restart Chrome and try again\n' +
              '4. Switch to Anthropic or OpenRouter in Settings → AI Provider\n\n' +
              `Technical details: ${errorName ? `${errorName}: ` : ''}${errorStr}`,
          },
        ])
      } else {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: `Error: ${errorStr}`,
          },
        ])
      }
    } finally {
      setLoading(false)
      setStreamingText('')
      setActiveTools([])
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const acceptProposal = () => {
    if (!pendingProposal) return
    const registry = globalContextManager.getLoader()?.getOperatorRegistry()
    const validation = registry
      ? validateProjectModifications(
          { nodes: getNodes(), edges: getEdges() },
          pendingProposal.modifications,
          registry
        )
      : null
    if (!validation?.success) {
      const detail =
        validation && !validation.success ? validation.errors.join('; ') : 'context unavailable'
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `That proposal is stale and was not applied: ${detail}` },
      ])
      setPendingProposal(null)
      return
    }

    const before = {
      nodes: structuredClone(getNodes()),
      edges: structuredClone(getEdges()),
      operatorState: captureOperatorInputs() ?? undefined,
    }
    for (const modification of validation.proposal.modifications) {
      if (modification.type !== 'update_node') continue
      const op = getOp(modification.data.id)
      const inputs = modification.data.data?.inputs
      if (!op || typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) continue
      for (const [name, value] of Object.entries(inputs)) {
        const field = (op.inputs as unknown as Record<string, Field>)[name]
        if (!field) continue
        applySerializedFieldValue(field, value)
        op.showField(name)
      }
    }
    setNodes(validation.proposal.nextSnapshot.nodes)
    setEdges(validation.proposal.nextSnapshot.edges)
    fireGraphMutation('Apply assistant proposal', before, {
      nodes: structuredClone(validation.proposal.nextSnapshot.nodes),
      edges: structuredClone(validation.proposal.nextSnapshot.edges),
      operatorState: captureOperatorInputs() ?? undefined,
    })
    analytics.track('ai_modification_proposal_resolved', {
      provider: providerId,
      model: model ?? 'default',
      outcome: 'accepted',
      modificationCount: validation.proposal.modifications.length,
    })
    setPendingProposal(null)
  }

  const rejectProposal = () => {
    if (!pendingProposal) return
    analytics.track('ai_modification_proposal_resolved', {
      provider: providerId,
      model: model ?? 'default',
      outcome: 'rejected',
      modificationCount: pendingProposal.modifications.length,
    })
    setPendingProposal(null)
  }

  const handleManualCapture = async () => {
    if (!mcpTools) return

    const result = await mcpTools.captureVisualization({})
    if (result.success) {
      const data = result.data as { screenshot?: unknown; format?: unknown }
      if (typeof data.screenshot !== 'string') {
        alert('Failed to capture screenshot: no image data was returned.')
        return
      }
      setPendingScreenshot({
        data: data.screenshot,
        format: data.format === 'png' ? 'png' : 'jpeg',
      })
    } else {
      alert(`Failed to capture screenshot: ${result.error}`)
    }
  }

  const startNewConversation = () => {
    // Auto-save current conversation if it has messages
    if (messages.length > 0 && !currentConversationId) {
      try {
        const id = saveConversation(messages)
        debugAiChat('Auto-saved conversation:', id)
      } catch (error) {
        debugAiChat('Failed to auto-save conversation:', error)
      }
    }

    // Start fresh
    setMessages([])
    setPendingProposal(null)
    setCurrentConversationId(null)
    setShowHistory(false)
  }

  const handleClose = () => {
    // Closing with a turn in flight should not leave it billing in the background
    abortRef.current?.abort()

    // Auto-save current conversation if it has messages and hasn't been saved yet
    if (messages.length > 0 && !currentConversationId) {
      try {
        const id = saveConversation(messages)
        setCurrentConversationId(id) // prevent duplicate saves on repeated close
        console.log('Auto-saved conversation on close:', id)
      } catch (error) {
        console.warn('Failed to auto-save conversation on close:', error)
      }
    }

    onClose()
  }

  const loadConversationById = (id: string) => {
    // Auto-save current conversation if it has messages and hasn't been saved
    if (messages.length > 0 && !currentConversationId) {
      try {
        saveConversation(messages)
      } catch (error) {
        debugAiChat('Failed to auto-save before loading:', error)
      }
    }

    const conversation = loadConversation(id)
    if (conversation) {
      setMessages(conversation.messages)
      setCurrentConversationId(id)
      setShowHistory(false)
    } else {
      alert('Failed to load conversation')
    }
  }

  if (!isVisible) return null

  // Check if a usable key is missing
  if (!providerReady && !contextLoading) {
    return (
      <div className={styles.chatPanel}>
        <div className={styles.chatPanelLoading}>
          <h3>Connect the assistant</h3>
          <p>
            Sign in with OpenRouter and the assistant works straight away — nothing to copy, no
            credit card. It starts on a free model
            {freeModels.length > 0 && ` (${freeModels[0].label})`}; the free tier is limited to
            roughly 50 messages a day, and adding credit later lifts that without changing anything
            here.
          </p>
          <div className={styles.connectActions}>
            <button
              type="button"
              onClick={connect.connect}
              className={styles.chatSendBtn}
              disabled={connect.status === 'connecting'}
            >
              {connect.status === 'connecting' ? 'Waiting for OpenRouter…' : 'Connect OpenRouter'}
            </button>
            {/* Second, not hidden: it needs no account at all, and it is the only
                option for someone who will not send their data anywhere. Goes to
                Settings rather than starting here, because which model — and so how
                large a download — is a choice worth making deliberately. */}
            {webgpuReady && (
              <button
                type="button"
                onClick={openProviderSettings}
                className={styles.chatPanelActionBtn}
              >
                Run a model locally
              </button>
            )}
            <button type="button" onClick={handleClose} className={styles.chatPanelActionBtn}>
              Close
            </button>
          </div>
          {connect.blockedUrl && (
            <p className={styles.connectNote}>
              Your browser blocked the sign-in window.{' '}
              <a href={connect.blockedUrl} target="_blank" rel="noopener noreferrer">
                Open it in a new tab
              </a>{' '}
              instead.
            </p>
          )}
          {connect.error && <p className={styles.connectError}>{connect.error}</p>}
          <p className={styles.connectNote}>
            Already have a key? Anthropic, an OpenAI-compatible endpoint and on-device models are
            all in{' '}
            <button type="button" onClick={openProviderSettings} className={styles.linkButton}>
              Settings → AI Provider
            </button>
            .
          </p>
        </div>
      </div>
    )
  }

  if (providerError) {
    return (
      <div className={styles.chatPanel}>
        <div className={styles.chatPanelLoading}>
          <h3>{PROVIDER_LABELS[providerId]} did not start</h3>
          <p>{providerError}</p>
          {providerId === 'chrome' && (
            <p>
              The Prompt API ships in Chrome 148; on an earlier build enable it at{' '}
              <code>chrome://flags/#prompt-api-for-gemini-nano</code>. Either way the model itself
              is a separate ~2GB download — check its status at{' '}
              <code>chrome://on-device-internals</code>. It also needs about 22GB free and either
              4GB of VRAM or 16GB of RAM.
            </p>
          )}
          <div
            style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}
          >
            <button type="button" onClick={openProviderSettings} className={styles.chatSendBtn}>
              Provider settings
            </button>
            {providerId === 'webllm' && model === 'Qwen3.5-4B-q4f16_1-MLC' && (
              <button
                type="button"
                onClick={() => setStoredModel('webllm', 'Qwen3.5-2B-q4f16_1-MLC')}
                className={styles.chatPanelActionBtn}
              >
                Try Local Fast (1.08GB)
              </button>
            )}
            {providerId === 'webllm' && (
              <button
                type="button"
                onClick={() => (openRouterKey ? setPreference('openrouter') : connect.connect())}
                className={styles.chatPanelActionBtn}
              >
                {openRouterKey ? 'Use OpenRouter' : 'Connect OpenRouter'}
              </button>
            )}
            <button type="button" onClick={handleClose} className={styles.chatPanelActionBtn}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (contextLoading) {
    return (
      <div className={styles.chatPanel}>
        <div className={styles.chatPanelLoading}>
          <div className={styles.spinner} />
          <p>
            {downloadProgress ? 'Downloading the model…' : contextProgress || 'Loading context…'}
          </p>
          {downloadProgress && (
            <>
              <progress
                className={styles.downloadProgress}
                value={downloadProgress.loaded}
                max={downloadProgress.total}
              />
              <p className={styles.downloadNote}>
                {formatPercent(downloadProgress)} — {downloadNoteFor(providerId, model)}
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatPanelHeader}>
        <h3>Noodles Assistant</h3>
        <div className={styles.chatPanelActions}>
          <button
            type="button"
            className={styles.chatPanelActionBtn}
            onClick={startNewConversation}
            title="Start New Conversation"
          >
            ➕
          </button>
          <button
            type="button"
            className={styles.chatPanelActionBtn}
            onClick={() => setShowHistory(!showHistory)}
            title="Conversation History"
          >
            📋
          </button>
          <button
            type="button"
            className={styles.chatPanelActionBtn}
            onClick={handleClose}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className={styles.chatPanelOptions}>
        <div className={styles.modelPicker}>
          <select
            value={providerId}
            onChange={e => {
              const newProvider = e.target.value as ProviderPreference
              const credentials = {
                anthropicKey: apiKey,
                openRouterKey,
                customEndpoint,
                chromeAvailable,
              }

              // If provider isn't ready, open config flow instead of switching
              if (newProvider !== 'automatic' && !isProviderReady(newProvider, credentials)) {
                openProviderConfiguration(newProvider)
              } else {
                setPreference(newProvider)
              }
            }}
            className={styles.modelSelect}
            title="Which API the assistant talks to"
          >
            <option value="anthropic">Anthropic{!apiKey && ' - configure key'}</option>
            <option value="openrouter">OpenRouter{!openRouterKey && ' - configure key'}</option>
            <option value="custom">
              {customEndpoint?.displayName ?? 'Custom endpoint'}
              {!customEndpoint && ' - configure'}
            </option>
            <option
              value="webllm"
              // Picking it opens Settings to the model picker, so the panel doesn't
              // start a multi-gigabyte download on its own
              title="Free, private, no key. Runs on this machine's GPU after a one-time download of a gigabyte or more."
            >
              Local model (on-device)
              {!webgpuReady ? ' - unavailable' : !storedWebLLMModel && ' - choose model'}
            </option>
            <option
              value="chrome"
              // A ~3B on-device model. Saying what it is good for is more use than
              // implying it is a smaller version of the others.
              title="Free, private, no key. Good for single-step edits and questions about the graph; too small to build one."
            >
              Chrome (on-device){!chromeAvailable && ' - unavailable'}
            </option>
          </select>
          <select
            value={model ?? modelChoices[0].id}
            onChange={e => setStoredModel(providerId, e.target.value)}
            className={styles.modelSelect}
            // Chrome exposes one model, so there is nothing to choose between
            disabled={modelChoices.length < 2}
            title="Model for this conversation"
          >
            {modelGroups.map(group =>
              group.label ? (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map(choice => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </optgroup>
              ) : (
                group.models.map(choice => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))
              )
            )}
          </select>
          <button
            type="button"
            onClick={openProviderSettings}
            className={styles.settingsGear}
            title="Configure AI provider settings"
          >
            ⚙️
          </button>
          {lastUsage && <span className={styles.usageReadout}>{formatUsage(lastUsage)}</span>}
        </div>
        {providerSupportsImages && (
          <button
            type="button"
            onClick={handleManualCapture}
            className={styles.captureBtn}
            title="Capture current visualization"
          >
            {pendingScreenshot ? '📸 Attached' : '📸 Capture'}
          </button>
        )}
      </div>

      <div className={styles.chatPanelMessages}>
        {messages.length === 0 && (
          <div className={styles.chatPanelWelcome}>
            <h4>Welcome to Noodles.gl AI Assistant!</h4>
            <p>I can help you:</p>
            <ul>
              <li>Create visualizations from scratch</li>
              <li>Modify existing nodes and connections</li>
              <li>Debug issues in your project</li>
              <li>Suggest operators and patterns</li>
              <li>Analyze data and create queries</li>
            </ul>
            <p>Try asking: "Create a heatmap showing density of taxi pickups in NYC"</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={`msg-${idx}-${msg.role}`}
            className={`${styles.chatMessage} ${msg.role === 'user' ? styles.chatMessageUser : styles.chatMessageAssistant}`}
          >
            <div className={styles.chatMessageRole}>
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div className={styles.chatMessageContent}>
              <MessageContent
                content={Array.isArray(msg.content) ? msg.content.join('\n') : msg.content}
              />
            </div>
          </div>
        ))}

        {loading && (
          <div className={`${styles.chatMessage} ${styles.chatMessageAssistant}`}>
            <div className={styles.chatMessageRole}>Assistant</div>
            <div className={styles.chatMessageContent}>
              {activeTools.length > 0 && (
                <div className={styles.toolTrace}>
                  {activeTools.map((name, idx) => (
                    <span key={`${name}-${idx}`} className={styles.toolTraceRow}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
              {streamingText ? (
                <MessageContent content={streamingText} />
              ) : (
                <div className={styles.typingIndicator}>
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
          </div>
        )}

        {pendingProposal && (
          <div className={styles.proposalCard} data-testid="modification-proposal">
            <div className={styles.proposalTitle}>Review graph update</div>
            <p>No graph changes have been made yet.</p>
            <ul className={styles.proposalDiff}>
              {proposalLines(pendingProposal).map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className={styles.proposalActions}>
              <button type="button" className={styles.chatSendBtn} onClick={acceptProposal}>
                Accept
              </button>
              <button type="button" className={styles.chatPanelActionBtn} onClick={rejectProposal}>
                Reject
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className={styles.chatPanelInput}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Ask for help..."
          disabled={loading}
          rows={3}
        />
        {loading ? (
          <button type="button" onClick={handleStop} className={styles.chatStopBtn}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim()}
            className={styles.chatSendBtn}
          >
            Send
          </button>
        )}
      </div>

      {showHistory && (
        <ConversationHistoryPanel
          onLoadConversation={loadConversationById}
          onClose={() => setShowHistory(false)}
          currentConversationId={currentConversationId}
        />
      )}
    </div>
  )
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  custom: 'The custom endpoint',
  webllm: 'The local model',
  chrome: 'Chrome’s built-in model',
}

interface ModelGroup {
  // Omitted for a provider whose models need no grouping, which renders the
  // options bare rather than inside a one-group optgroup
  label?: string
  models: readonly { id: string; label: string }[]
}

// OpenRouter is the only provider with two kinds of model worth separating: the
// free tier a newly connected account can actually use, and the paid shortlist.
// Free comes first because that is what a fresh connection lands on.
function modelGroupsFor(
  providerId: ProviderId,
  customEndpoint: CustomEndpointConfig | undefined,
  freeModels: readonly OpenRouterModel[]
): ModelGroup[] {
  switch (providerId) {
    case 'anthropic':
      return [{ models: ANTHROPIC_MODELS }]
    case 'openrouter':
      if (freeModels.length === 0) return [{ models: OPENROUTER_MODELS }]
      return [
        { label: 'Free', models: freeModels.map(({ id, label }) => ({ id, label })) },
        { label: 'Paid', models: OPENROUTER_MODELS },
      ]
    case 'chrome':
      return [{ models: CHROME_MODELS }]
    // Labelled with their download size, since that is the decision the user is
    // actually making
    case 'webllm':
      return [
        {
          label: 'Recommended',
          models: WEBLLM_MODELS.filter(model => model.tier !== 'compatibility').map(
            ({ id, label }) => ({ id, label })
          ),
        },
        {
          label: 'Advanced compatibility',
          models: WEBLLM_MODELS.filter(model => model.tier === 'compatibility').map(
            ({ id, label }) => ({ id, label })
          ),
        },
      ]
    // A custom endpoint's model is part of its saved config, so the picker shows
    // it rather than offering a choice this app cannot enumerate
    case 'custom':
      return [
        {
          models: customEndpoint
            ? [
                {
                  id: customEndpoint.model,
                  label: customEndpoint.displayName ?? customEndpoint.model,
                },
              ]
            : [{ id: '', label: 'Not configured' }],
        },
      ]
  }
}

interface CreateProviderOptions {
  providerId: ProviderId
  apiKey: string | undefined
  model: string | undefined
  customEndpoint: CustomEndpointConfig | undefined
  onDownloadProgress: (progress: DownloadProgress) => void
}

// The on-device providers are the ones whose construction is async: the model has
// to be resident before the first request, and that is also where the download
// happens, so both report progress while they build.
async function createProvider(options: CreateProviderOptions): Promise<AgentProvider> {
  const { providerId, apiKey, model, customEndpoint } = options
  switch (providerId) {
    case 'chrome':
      return createChromeProvider({ onDownloadProgress: options.onDownloadProgress })
    case 'webllm':
      return createWebLLMProvider({ model, onDownloadProgress: options.onDownloadProgress })
    case 'openrouter':
      return new OpenRouterProvider({ apiKey: apiKey ?? '', model })
    case 'anthropic':
      return new AnthropicProvider({ apiKey: apiKey ?? '', model })
    case 'custom':
      if (!customEndpoint) throw new Error('No custom endpoint is configured')
      return new CustomProvider({
        baseUrl: customEndpoint.baseUrl,
        apiKey: customEndpoint.apiKey,
        model: customEndpoint.model,
      })
  }
}

// Both on-device providers download once per machine, but they differ by an order
// of magnitude in size, and a WebLLM model's size is known exactly.
function downloadNoteFor(providerId: ProviderId, model: string | undefined): string {
  if (providerId !== 'webllm') {
    return 'Chrome downloads about 2GB the first time, and only once.'
  }
  const metadata = WEBLLM_MODELS.find(option => option.id === model)
  const size = metadata ? `${(metadata.downloadMb / 1000).toFixed(2)}GB` : 'a few gigabytes'
  const memory = metadata ? `${(metadata.vramMb / 1000).toFixed(2)}GB GPU memory` : 'GPU memory'
  return `${size} once, cached afterward; requires about ${memory}.`
}

function proposalLines(proposal: ModificationProposal): string[] {
  const lines: string[] = []
  for (const modification of proposal.modifications) {
    switch (modification.type) {
      case 'add_node':
        lines.push(`Add ${modification.data.type} ${modification.data.id}`)
        break
      case 'update_node':
        lines.push(`Update ${modification.data.id}`)
        break
      case 'delete_node':
        lines.push(`Delete node ${modification.data.id}`)
        break
      case 'add_edge':
        lines.push(
          `Connect ${modification.data.source}.${modification.data.sourceHandle} → ${modification.data.target}.${modification.data.targetHandle}`
        )
        break
      case 'delete_edge':
        lines.push(`Delete connection ${modification.data.id}`)
        break
    }
  }
  return lines
}

function formatPercent(progress: DownloadProgress): string {
  if (!progress.total) return ''
  return `${Math.round((progress.loaded / progress.total) * 100)}%`
}

function formatUsage(usage: AgentUsage): string {
  const tokens = `${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`
  // Only OpenRouter reports a price; Anthropic leaves it to us to look up
  if (usage.costUsd === undefined) return tokens
  return `${tokens} · $${usage.costUsd.toFixed(4)}`
}

function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}

// Render message content with full markdown support
const MessageContent: FC<{ content: string }> = ({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: props => {
          const { children, className, ...rest } = props
          // className is undefined for inline code, defined (even if empty) for code blocks
          const isInline = className === undefined
          return isInline ? (
            <code className={styles.inlineCode} {...rest}>
              {children}
            </code>
          ) : (
            <code className={styles.codeBlock} {...rest}>
              {children}
            </code>
          )
        },
        pre: ({ children }) => <pre className={styles.pre}>{children}</pre>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className={styles.link}>
            {children}
          </a>
        ),
        // Disable images to prevent tracking via remote image requests
        img: () => null,
        table: ({ children }) => (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className={styles.thead}>{children}</thead>,
        tbody: ({ children }) => <tbody className={styles.tbody}>{children}</tbody>,
        tr: ({ children }) => <tr className={styles.tr}>{children}</tr>,
        th: ({ children }) => <th className={styles.th}>{children}</th>,
        td: ({ children }) => <td className={styles.td}>{children}</td>,
        ul: ({ children }) => <ul className={styles.list}>{children}</ul>,
        ol: ({ children }) => <ol className={styles.orderedList}>{children}</ol>,
        li: ({ children }) => <li className={styles.listItem}>{children}</li>,
        h1: ({ children }) => <h1 className={styles.h1}>{children}</h1>,
        h2: ({ children }) => <h2 className={styles.h2}>{children}</h2>,
        h3: ({ children }) => <h3 className={styles.h3}>{children}</h3>,
        p: ({ children }) => <p className={styles.paragraph}>{children}</p>,
        strong: ({ children }) => <strong className={styles.bold}>{children}</strong>,
        em: ({ children }) => <em className={styles.italic}>{children}</em>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
