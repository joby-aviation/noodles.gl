// ChatPanel - Main UI component for Claude AI integration

import { useReactFlow } from '@xyflow/react'
import { type FC, useEffect, useRef, useState } from 'react'
import {
  type ProjectModification,
  useProjectModifications,
} from '../noodles/hooks/use-project-modifications'
import { useKeysStore } from '../noodles/keys-store'
import { useUIStore } from '../noodles/store'
import { debugAiChat } from '../utils/debug'
import styles from './chat-panel.module.css'
import { loadConversation, saveConversation } from './conversation-history'
import { ConversationHistoryPanel } from './conversation-history-panel'
import { globalContextManager } from './global-context-manager'
import { MCPTools } from './mcp-tools'
import type { AIProvider } from './providers/ai-provider-interface'
import { getProviderRegistry } from './providers/provider-registry'
import type { Message, NoodlesProject } from './types'
import type { ProviderPreference } from '../noodles/keys-store'

interface ProviderOption {
  value: ProviderPreference
  displayName: string
  description: string
  requiresKey?: boolean
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: 'automatic',
    displayName: 'Automatic',
    description: 'Use best available provider',
  },
  {
    value: 'anthropic',
    displayName: 'Claude',
    description: 'Anthropic Claude API',
    requiresKey: true,
  },
  {
    value: 'custom',
    displayName: 'Custom Endpoint',
    description: 'OpenAI, Groq, or custom',
  },
  {
    value: 'chrome-ai',
    displayName: 'Chrome Built-in AI',
    description: 'Free, runs locally',
  },
]

interface ChatPanelProps {
  project: NoodlesProject
  onClose: () => void
  isVisible: boolean
  initialMessage?: string
}

export const ChatPanel: FC<ChatPanelProps> = ({ project, onClose, isVisible, initialMessage }) => {
  // Get ReactFlow state for the modification hook
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow()

  // Use project modifications hook with ReactFlow state
  const { applyModifications } = useProjectModifications({
    getNodes,
    getEdges,
    setNodes,
    setEdges,
  })
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextLoading, setContextLoading] = useState(true)
  const [aiProvider, setAiProvider] = useState<AIProvider | null>(null)
  const [mcpTools, setMcpTools] = useState<MCPTools | null>(null)
  const [autoCapture, setAutoCapture] = useState(true)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [contextProgress, setContextProgress] = useState<string>('')
  const [providerProgress, setProviderProgress] = useState<string>('')
  const [providerError, setProviderError] = useState<string | null>(null)
  const [, setContextUpdateTrigger] = useState(0)
  const [downloadProgress, setDownloadProgress] = useState<{
    loaded: number
    total: number
  } | null>(null)
  const [showProviderDropdown, setShowProviderDropdown] = useState(false)

  // Get API keys and config from store (reactive) - watch for changes to trigger provider refresh
  const anthropicKey = useKeysStore(state => state.getKey('anthropic'))
  const customEndpoint = useKeysStore(state => state.getCustomEndpoint())
  const providerPreference = useKeysStore(state => state.getProviderPreference())

  // Get the function to open settings dialog
  const setSettingsDialogOpen = useUIStore(state => state.setSettingsDialogOpen)

  // Open settings and navigate to AI Provider tab
  const openAIProviderSettings = () => {
    window.location.hash = 'ai-provider'
    setSettingsDialogOpen(true)
  }

  // Handle provider change from dropdown
  const handleProviderChange = (preference: ProviderPreference) => {
    useKeysStore.getState().setProviderPreference(preference)
    // Provider re-initialization happens automatically via useEffect (line 139)
    setShowProviderDropdown(false)
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const providerDropdownRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close provider dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        providerDropdownRef.current &&
        !providerDropdownRef.current.contains(event.target as Node)
      ) {
        setShowProviderDropdown(false)
      }
    }

    if (showProviderDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showProviderDropdown])

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

  // Initialize AI provider when keys or preference change
  // biome-ignore lint/correctness/useExhaustiveDependencies: keys are used indirectly via provider registry
  useEffect(() => {
    const init = async () => {
      setContextLoading(true)
      setProviderError(null)
      setProviderProgress('Loading documentation...')
      try {
        // Wait for context to be ready (should be instant if already loaded)
        const loader = await globalContextManager.waitForReady()

        setProviderProgress('Initializing AI provider...')

        const tools = new MCPTools(loader)
        const registry = getProviderRegistry()
        registry.setTools(tools)
        registry.setPreference(providerPreference)

        // Get appropriate provider based on available keys and preference
        // Pass progress callback to track provider initialization
        const provider = await registry.getProvider(msg => {
          setProviderProgress(msg)

          // Parse download progress from Chrome AI messages
          const downloadMatch = msg.match(/Downloading AI model: (\d+)%/)
          if (downloadMatch) {
            const percentage = Number.parseInt(downloadMatch[1], 10)
            // Estimate total size as ~2GB (rough Chrome AI model size)
            const estimatedTotal = 2 * 1024 * 1024 * 1024
            const loaded = Math.round((percentage / 100) * estimatedTotal)
            setDownloadProgress({ loaded, total: estimatedTotal })
          } else {
            setDownloadProgress(null)
          }
        })

        setMcpTools(tools)
        setAiProvider(provider)
        debugAiChat(`Initialized ${provider.displayName} (${provider.tier})`)
      } catch (error) {
        debugAiChat('Failed to initialize AI provider:', error)
        setProviderError(
          error instanceof Error ? error.message : 'Failed to initialize AI provider'
        )
      } finally {
        setContextLoading(false)
      }
    }

    init()
  }, [providerPreference, anthropicKey, customEndpoint])

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
    if (!input.trim() || !aiProvider || !project) return

    const userMessage: Message = {
      role: 'user',
      content: input,
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await aiProvider.sendMessage({
        message: input,
        project,
        autoCapture,
        conversationHistory: messages,
      })

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.message,
      }

      setMessages(prev => [...prev, assistantMessage])

      // Trigger context window update
      setContextUpdateTrigger(prev => prev + 1)

      // Apply project modifications if any
      if (response.projectModifications && response.projectModifications.length > 0) {
        debugAiChat('Applying project modifications:', response.projectModifications)
        const result = applyModifications(response.projectModifications as ProjectModification[])

        if (!result.success) {
          // Surface validation errors back to the user and AI
          const errorMessage = `Failed to apply modifications: ${result.error}`
          debugAiChat(errorMessage)
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              content: errorMessage,
            },
          ])
        } else if (result.warnings && result.warnings.length > 0) {
          // Show warnings in console and chat
          debugAiChat('Modification warnings:', result.warnings)
          const warningMessage = `⚠️ Modifications applied with warnings:\n${result.warnings.map(w => `• ${w}`).join('\n')}`
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              content: warningMessage,
            },
          ])
        }
      }
    } catch (error) {
      debugAiChat('Error sending message:', error)

      // Check if this is an authentication error
      const errorStr = error instanceof Error ? error.message : String(error)
      const isAuthError =
        errorStr.includes('authentication') ||
        errorStr.includes('401') ||
        errorStr.includes('invalid_api_key') ||
        errorStr.includes('api_key')

      if (isAuthError) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content:
              'Authentication Error: Your API key is invalid. Please check your API key in Settings > API Keys.',
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
    }
  }

  const handleManualCapture = async () => {
    if (!mcpTools) return

    const result = await mcpTools.captureVisualization({})
    if (result.success) {
      alert('Screenshot captured! It will be included with your next message.')
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
    setCurrentConversationId(null)
    setShowHistory(false)
  }

  const handleClose = () => {
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

  // Show error if provider initialization failed
  if (providerError && !contextLoading) {
    // Only show Chrome AI flag instructions if the error is specifically about it not being available
    const showChromeAIInstructions =
      providerError.includes('not available') && providerError.includes('Chrome Built-in AI')

    return (
      <div className={styles.chatPanel}>
        <div className={styles.chatPanelLoading}>
          <h3>AI Provider Required</h3>
          <p style={{ color: '#ff6b6b', marginBottom: '1.5rem', whiteSpace: 'pre-wrap' }}>
            {providerError}
          </p>
          <div style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={openAIProviderSettings}
              className={styles.chatSendBtn}
              style={{ fontSize: '14px', padding: '10px 20px' }}
            >
              Configure API Keys (Anthropic, OpenAI, etc.)
            </button>
          </div>
          {showChromeAIInstructions && (
            <p style={{ fontSize: '12px', color: '#aaa', marginBottom: '0.5rem' }}>
              Or enable Chrome Built-in AI at{' '}
              <code style={{ background: '#333', padding: '2px 6px', borderRadius: '3px' }}>
                chrome://flags/#prompt-api-for-gemini-nano
              </code>
            </p>
          )}
          <div
            style={{
              marginTop: '1.5rem',
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'center',
            }}
          >
            <button type="button" onClick={handleClose} className={styles.linkButton}>
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
          {downloadProgress ? (
            <>
              <p>Downloading AI model...</p>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressBarFill}
                  style={{
                    width: `${Math.round((downloadProgress.loaded / downloadProgress.total) * 100)}%`,
                  }}
                />
              </div>
              <p className={styles.progressText}>
                {Math.round((downloadProgress.loaded / downloadProgress.total) * 100)}% (
                {(downloadProgress.loaded / 1024 / 1024 / 1024).toFixed(1)} GB /{' '}
                {(downloadProgress.total / 1024 / 1024 / 1024).toFixed(1)} GB)
              </p>
            </>
          ) : (
            <p>{providerProgress || contextProgress || 'Loading context...'}</p>
          )}
        </div>
      </div>
    )
  }

  // Get rate limit info if available
  const rateLimit = aiProvider?.getRateLimit()
  const rateLimitWarning = rateLimit && rateLimit.remaining < rateLimit.limit * 0.2

  // Get context window info if available
  const contextWindow = aiProvider?.getContextWindow()

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatPanelHeader}>
        <div>
          <h3>Noodles Assistant</h3>
          {aiProvider && (
            <div ref={providerDropdownRef} className={styles.providerSelector}>
              <button
                type="button"
                className={styles.providerName}
                onClick={() => setShowProviderDropdown(!showProviderDropdown)}
              >
                {aiProvider.displayName}
                <svg
                  className={styles.dropdownIcon}
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-label="Dropdown arrow"
                >
                  <title>Dropdown arrow</title>
                  <path d="M2 4l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" />
                </svg>
              </button>
              <button
                type="button"
                className={styles.settingsGear}
                onClick={openAIProviderSettings}
                title="AI Settings"
              >
                ⚙️
              </button>
              {rateLimit && (
                <span
                  style={{
                    marginLeft: '8px',
                    color: rateLimitWarning ? '#ff6b6b' : 'inherit',
                  }}
                >
                  ({rateLimit.remaining.toLocaleString()}/{rateLimit.limit.toLocaleString()}{' '}
                  {rateLimit.windowDescription})
                </span>
              )}

              {showProviderDropdown && (
                <div className={styles.providerDropdown}>
                  {PROVIDER_OPTIONS.map(option => {
                    const isActive = providerPreference === option.value
                    const isDisabled = option.requiresKey && !anthropicKey

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`${styles.providerOption} ${isActive ? styles.providerOptionActive : ''} ${isDisabled ? styles.providerOptionDisabled : ''}`}
                        onClick={() => !isDisabled && handleProviderChange(option.value)}
                        disabled={isDisabled}
                      >
                        <div className={styles.providerOptionName}>
                          {option.displayName}
                          {isActive && <span className={styles.activeCheckmark}>✓</span>}
                        </div>
                        <div className={styles.providerOptionDesc}>{option.description}</div>
                        {isDisabled && (
                          <div className={styles.providerOptionWarning}>Requires API key</div>
                        )}
                      </button>
                    )
                  })}
                  <div className={styles.providerDropdownDivider} />
                  <button
                    type="button"
                    className={styles.providerOption}
                    onClick={openAIProviderSettings}
                  >
                    <div className={styles.providerOptionName}>More Settings...</div>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className={styles.chatPanelActions}>
          {contextWindow && (
            <div
              className={styles.contextIndicator}
              title={`Context: ${contextWindow.used.toLocaleString()} / ${contextWindow.total.toLocaleString()} tokens`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" role="img">
                <title>Context Window Usage</title>
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.1)"
                  strokeWidth="2"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke={contextWindow.percentage > 80 ? '#ff6b6b' : '#4a9eff'}
                  strokeWidth="2"
                  strokeDasharray={`${(contextWindow.percentage / 100) * 56.5} 56.5`}
                  strokeLinecap="round"
                  transform="rotate(-90 12 12)"
                />
                <text
                  x="12"
                  y="12"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="7"
                  fill="currentColor"
                >
                  {contextWindow.percentage}%
                </text>
              </svg>
            </div>
          )}
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
        <label className={styles.chatOption}>
          <input
            type="checkbox"
            checked={autoCapture}
            onChange={e => setAutoCapture(e.target.checked)}
          />
          <span>Auto-capture screenshots</span>
        </label>
        <button
          type="button"
          onClick={handleManualCapture}
          className={styles.captureBtn}
          title="Capture current visualization"
        >
          📸 Capture
        </button>
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
            <div className={styles.chatMessageRole}>{msg.role === 'user' ? 'You' : 'Agent'}</div>
            <div className={styles.chatMessageContent}>
              <MessageContent
                content={Array.isArray(msg.content) ? msg.content.join('\n') : msg.content}
              />
            </div>
          </div>
        ))}

        {loading && (
          <div className={`${styles.chatMessage} ${styles.chatMessageAssistant}`}>
            <div className={styles.chatMessageRole}>Claude</div>
            <div className={styles.chatMessageContent}>
              <div className={styles.typingIndicator}>
                <span />
                <span />
                <span />
              </div>
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
          placeholder="Ask Claude for help..."
          disabled={loading}
          rows={3}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className={styles.chatSendBtn}
        >
          Send
        </button>
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

// Render message content with basic markdown support
const MessageContent: FC<{ content: string }> = ({ content }) => {
  const renderContent = () => {
    const parts = content.split(/(```[\s\S]*?```)/g)
    return parts.map((part, idx) => {
      // Use combination of index and content snippet for stable key
      const key = `${idx}-${part.substring(0, 20)}`
      if (part.startsWith('```')) {
        const code = part.replace(/```(\w+)?\n?/, '').replace(/```$/, '')
        return (
          <pre key={key}>
            <code>{code}</code>
          </pre>
        )
      }
      return <p key={key}>{part}</p>
    })
  }

  return <div>{renderContent()}</div>
}
