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
import { useAgentModelStore } from './agent/model-store'
import { ANTHROPIC_MODELS, AnthropicProvider } from './agent/providers/anthropic'
import { OPENROUTER_MODELS, OpenRouterProvider } from './agent/providers/openrouter'
import { AgentSession } from './agent/session'
import type { AgentProvider, AgentUsage, ProviderId } from './agent/types'
import { webSearchConfigFor } from './agent/web-search'
import styles from './chat-panel.module.css'
import { loadConversation, saveConversation } from './conversation-history'
import { ConversationHistoryPanel } from './conversation-history-panel'
import { globalContextManager } from './global-context-manager'
import { MCPTools } from './mcp-tools'
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
  const abortRef = useRef<AbortController | null>(null)

  // Get API keys directly from store (reactive)
  const apiKey = useKeysStore(state => state.getKey('anthropic'))
  const openRouterKey = useKeysStore(state => state.getKey('openrouter'))

  const storedProvider = useAgentModelStore(state => state.provider)
  const setStoredProvider = useAgentModelStore(state => state.setProvider)
  const setStoredModel = useAgentModelStore(state => state.setModel)

  // Anthropic unless only the OpenRouter key is configured, or the user picked
  // otherwise. Falls back when the chosen provider's key has since been cleared.
  const providerId: ProviderId = resolveProviderId(storedProvider, apiKey, openRouterKey)
  const providerKey = providerId === 'anthropic' ? apiKey : openRouterKey
  // undefined leaves the provider on its own default
  const model = useAgentModelStore(state => state.getModel(providerId))
  const modelChoices = providerId === 'anthropic' ? ANTHROPIC_MODELS : OPENROUTER_MODELS

  // Get the function to open settings dialog
  const setSettingsDialogOpen = useUIStore(state => state.setSettingsDialogOpen)

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

  // Build the session whenever the provider, model, or key changes
  useEffect(() => {
    if (!providerKey) {
      setContextLoading(false)
      return
    }

    const init = async () => {
      setContextLoading(true)
      try {
        // Wait for context to be ready (should be instant if already loaded)
        const loader = await globalContextManager.waitForReady()

        const tools = new MCPTools(loader)
        const provider: AgentProvider =
          providerId === 'anthropic'
            ? new AnthropicProvider({ apiKey: providerKey, model })
            : new OpenRouterProvider({ apiKey: providerKey, model })

        setMcpTools(tools)
        setSession(
          new AgentSession(provider, tools, {
            webSearch: webSearchConfigFor({
              providerId,
              model: provider.model,
              anthropicKey: apiKey,
              openRouterKey,
            }),
          })
        )
      } catch (error) {
        debugAiChat('Failed to initialize the assistant:', error)
      } finally {
        setContextLoading(false)
      }
    }

    init()
  }, [providerId, providerKey, model, apiKey, openRouterKey])

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

    try {
      const response = await session.send({
        message: input,
        conversationHistory: messages,
        signal: controller.signal,
        onEvent: event => {
          if (event.type === 'text_delta') setStreamingText(prev => prev + event.text)
          if (event.type === 'tool_call') setActiveTools(prev => [...prev, event.name])
          if (event.type === 'usage') setLastUsage(event.usage)
        },
      })

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
      setStreamingText('')
      setActiveTools([])
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
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
  if (!providerKey && !contextLoading) {
    return (
      <div className={styles.chatPanel}>
        <div className={styles.chatPanelLoading}>
          <h3>API Key Required</h3>
          <p>
            To use the Noodles assistant, you need an Anthropic or OpenRouter API key in{' '}
            <button
              type="button"
              onClick={() => setSettingsDialogOpen(true)}
              className={styles.linkButton}
            >
              Settings
            </button>{' '}
            (top menu).
          </p>
          <p>
            Get one from the{' '}
            <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">
              Anthropic Console
            </a>{' '}
            or{' '}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
              OpenRouter
            </a>
            , then add it in <strong>Settings → API Keys</strong>.
          </p>
          <div
            style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}
          >
            <button type="button" onClick={handleClose} className={styles.chatSendBtn}>
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
          <p>{contextProgress || 'Loading context...'}</p>
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
            onChange={e => setStoredProvider(e.target.value as ProviderId)}
            className={styles.modelSelect}
            title="Which API the assistant talks to"
          >
            <option value="anthropic" disabled={!apiKey}>
              Anthropic
            </option>
            <option value="openrouter" disabled={!openRouterKey}>
              OpenRouter
            </option>
          </select>
          <select
            value={model ?? modelChoices[0].id}
            onChange={e => setStoredModel(providerId, e.target.value)}
            className={styles.modelSelect}
            title="Model for this conversation"
          >
            {modelChoices.map(choice => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          {lastUsage && <span className={styles.usageReadout}>{formatUsage(lastUsage)}</span>}
        </div>
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

// The stored choice wins, but only while its key is still configured — clearing a
// key in Settings should not leave the chat pointed at a provider it cannot reach.
function resolveProviderId(
  stored: ProviderId | undefined,
  anthropicKey: string | undefined,
  openRouterKey: string | undefined
): ProviderId {
  if (stored === 'anthropic' && anthropicKey) return 'anthropic'
  if (stored === 'openrouter' && openRouterKey) return 'openrouter'
  if (anthropicKey) return 'anthropic'
  if (openRouterKey) return 'openrouter'
  return 'anthropic'
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
