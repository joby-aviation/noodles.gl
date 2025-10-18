// ChatPanel - Main UI component for Claude AI integration

import { useEffect, useRef, useState, type FC } from 'react'

import { ClaudeClient } from './claude-client'
import { ContextLoader } from './context-loader'
import { MCPTools } from './mcp-tools'
import type { Message } from './types'
import {
  saveConversation,
  loadConversation,
} from './conversation-history'
import { ConversationHistoryPanel } from './conversation-history-panel'
import styles from './chat-panel.module.css'

interface ChatPanelProps {
  project: any
  onProjectUpdate: (project: any) => void
  onClose?: () => void
  isPopout?: boolean
}

export const ChatPanel: FC<ChatPanelProps> = ({
  project,
  onProjectUpdate,
  onClose,
  isPopout = false
}) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextLoading, setContextLoading] = useState(true)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [claudeClient, setClaudeClient] = useState<ClaudeClient | null>(null)
  const [mcpTools, setMcpTools] = useState<MCPTools | null>(null)
  const [autoCapture, setAutoCapture] = useState(true)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const init = async () => {
      const apiKey = localStorage.getItem('noodles-claude-api-key') ||
                     sessionStorage.getItem('noodles-claude-api-key') ||
                     import.meta.env.VITE_CLAUDE_API_KEY

      if (!apiKey) {
        setShowApiKeyModal(true)
        setContextLoading(false)
        return
      }

      try {
        const loader = new ContextLoader()
        const tools = new MCPTools(loader)
        const client = new ClaudeClient(apiKey.trim(), tools)

        setMcpTools(tools)
        setClaudeClient(client)
        setContextLoading(false)

        loader.load((progress) => {
          console.log('Loading context:', progress.stage, `${progress.loaded}/${progress.total}`)
        }).catch(error => {
          console.warn('Context loading failed:', error)
        })
      } catch (error) {
        console.error('Failed to initialize Claude:', error)
        setContextLoading(false)
      }
    }

    init()
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || !claudeClient || !project) return

    const userMessage: Message = {
      role: 'user',
      content: input
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await claudeClient.sendMessage({
        message: input,
        project,
        autoCapture,
        conversationHistory: messages
      })

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.message
      }

      setMessages(prev => [...prev, assistantMessage])

      // Apply project modifications if any
      if (response.projectModifications && response.projectModifications.length > 0) {
        applyProjectModifications(response.projectModifications)
      }
    } catch (error) {
      console.error('Error sending message:', error)

      // Check if this is an authentication error
      const errorStr = error instanceof Error ? error.message : String(error)
      const isAuthError = errorStr.includes('authentication') ||
                          errorStr.includes('401') ||
                          errorStr.includes('invalid_api_key') ||
                          errorStr.includes('api_key')

      if (isAuthError) {
        localStorage.removeItem('noodles-claude-api-key')
        sessionStorage.removeItem('noodles-claude-api-key')
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Authentication Error: Your API key is invalid. Please enter a valid API key.'
        }])
        setShowApiKeyModal(true)
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${errorStr}`
        }])
      }
    } finally {
      setLoading(false)
    }
  }

  const applyProjectModifications = (modifications: any[]) => {
    const updatedProject = { ...project }

    modifications.forEach(mod => {
      switch (mod.type) {
        case 'add_node':
          updatedProject.nodes = [...(updatedProject.nodes || []), mod.data]
          break
        case 'update_node':
          updatedProject.nodes = (updatedProject.nodes || []).map((node: any) =>
            node.id === mod.data.id ? { ...node, ...mod.data } : node
          )
          break
        case 'delete_node':
          updatedProject.nodes = (updatedProject.nodes || []).filter(
            (node: any) => node.id !== mod.data.id
          )
          break
        case 'add_edge':
          updatedProject.edges = [...(updatedProject.edges || []), mod.data]
          break
        case 'delete_edge':
          updatedProject.edges = (updatedProject.edges || []).filter(
            (edge: any) => edge.id !== mod.data.id
          )
          break
      }
    })

    onProjectUpdate(updatedProject)
  }

  const handleApiKeySubmit = async (key: string, remember: boolean) => {
    if (remember) {
      localStorage.setItem('noodles-claude-api-key', key)
      sessionStorage.removeItem('noodles-claude-api-key')
    } else {
      sessionStorage.setItem('noodles-claude-api-key', key)
      localStorage.removeItem('noodles-claude-api-key')
    }

    setShowApiKeyModal(false)

    try {
      const loader = new ContextLoader()
      await loader.load((progress) => {
        console.log('Loading context:', progress.stage, `${progress.loaded}/${progress.total}`)
      })

      const tools = new MCPTools(loader)
      const client = new ClaudeClient(key, tools)

      setMcpTools(tools)
      setClaudeClient(client)
    } catch (error) {
      console.error('Failed to reinitialize Claude:', error)
    }
  }

  const handleManualCapture = async () => {
    if (!mcpTools) return

    const result = await mcpTools.captureVisualization({})
    if (result.success) {
      alert('Screenshot captured! It will be included with your next message.')
    } else {
      alert('Failed to capture screenshot: ' + result.error)
    }
  }

  const startNewConversation = () => {
    // Auto-save current conversation if it has messages
    if (messages.length > 0 && !currentConversationId) {
      try {
        const id = saveConversation(messages)
        console.log('Auto-saved conversation:', id)
      } catch (error) {
        console.warn('Failed to auto-save conversation:', error)
      }
    }

    // Start fresh
    setMessages([])
    setCurrentConversationId(null)
    setShowHistory(false)
  }

  const saveCurrentConversation = () => {
    if (messages.length === 0) {
      alert('No messages to save')
      return
    }

    try {
      const id = saveConversation(messages)
      setCurrentConversationId(id)
      alert('Conversation saved!')
    } catch (error) {
      alert('Failed to save conversation: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const loadConversationById = (id: string) => {
    // Auto-save current conversation if it has messages and hasn't been saved
    if (messages.length > 0 && !currentConversationId) {
      try {
        saveConversation(messages)
      } catch (error) {
        console.warn('Failed to auto-save before loading:', error)
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

  if (showApiKeyModal) {
    return <ApiKeyModal onSubmit={handleApiKeySubmit} />
  }

  if (contextLoading) {
    return (
      <div className={styles.chatPanel}>
        <div className={styles.chatPanelLoading}>
          <div className={styles.spinner} />
          <p>Loading context...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.chatPanel} ${isPopout ? styles.chatPanelPopout : ''}`}>
      <div className={styles.chatPanelContent}>
      <div className={styles.chatPanelHeader}>
        <h3>Noodles Assistant</h3>
        <div className={styles.chatPanelActions}>
          <button
            className={styles.chatPanelActionBtn}
            onClick={startNewConversation}
            title="Start New Conversation"
          >
            ➕
          </button>
          <button
            className={styles.chatPanelActionBtn}
            onClick={() => setShowHistory(!showHistory)}
            title="Conversation History"
          >
            📋
          </button>
          <button
            className={styles.chatPanelActionBtn}
            onClick={() => setShowApiKeyModal(true)}
            title="Change API Key"
          >
            ⚙
          </button>
          {onClose && (
            <button
              className={styles.chatPanelActionBtn}
              onClick={onClose}
              title="Close"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className={styles.chatPanelOptions}>
        <label className={styles.chatOption}>
          <input
            type="checkbox"
            checked={autoCapture}
            onChange={(e) => setAutoCapture(e.target.checked)}
          />
          <span>Auto-capture screenshots</span>
        </label>
        <button
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
            <p>Try asking: "Create a heatmap showing density"</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`${styles.chatMessage} ${msg.role === 'user' ? styles.chatMessageUser : styles.chatMessageAssistant}`}>
            <div className={styles.chatMessageRole}>
              {msg.role === 'user' ? 'You' : 'Claude'}
            </div>
            <div className={styles.chatMessageContent}>
              <MessageContent content={msg.content} />
            </div>
          </div>
        ))}

        {loading && (
          <div className={`${styles.chatMessage} ${styles.chatMessageAssistant}`}>
            <div className={styles.chatMessageRole}>Claude</div>
            <div className={styles.chatMessageContent}>
              <div className={styles.typingIndicator}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className={styles.chatPanelInput}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
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
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className={styles.chatSendBtn}
        >
          Send
        </button>
      </div>
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
      if (part.startsWith('```')) {
        const code = part.replace(/```(\w+)?\n?/, '').replace(/```$/, '')
        return (
          <pre key={idx}>
            <code>{code}</code>
          </pre>
        )
      }
      return <p key={idx}>{part}</p>
    })
  }

  return <div>{renderContent()}</div>
}

// API Key Modal
const ApiKeyModal: FC<{ onSubmit: (key: string, remember: boolean) => void }> = ({ onSubmit }) => {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [rememberKey, setRememberKey] = useState(true)

  const handleSubmit = () => {
    if (!key.trim()) {
      setError('API key is required')
      return
    }

    setError('')
    onSubmit(key.trim(), rememberKey)
  }

  return (
    <div className={styles.apiKeyModalOverlay}>
      <div className={styles.apiKeyModal}>
        <h3>Enter Anthropic API Key</h3>
        <p>
          To use the Noodles assistant, you need a Claude API key from{' '}
          <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">
            Anthropic Console
          </a>
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            setError('') // Clear error when user types
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSubmit()
            }
          }}
          placeholder="sk-ant-..."
          className={styles.apiKeyInput}
        />
        {error && <p className={styles.apiKeyError}>{error}</p>}
        <label className={styles.rememberKeyLabel}>
          <input
            type="checkbox"
            checked={rememberKey}
            onChange={(e) => setRememberKey(e.target.checked)}
            className={styles.rememberKeyCheckbox}
          />
          <span>Remember my API key (stored in browser localStorage)</span>
        </label>
        <div className={styles.apiKeyModalActions}>
          <button
            onClick={handleSubmit}
            disabled={!key.trim()}
            className={styles.apiKeySubmitBtn}
          >
            Save
          </button>
        </div>
        <p className={styles.apiKeyNote}>
          {rememberKey
            ? 'Your API key will be stored in localStorage and persist across sessions.'
            : 'Your API key will only be stored for this session and cleared when you close the tab.'}
          {' '}Keys are never sent to Noodles.gl servers.
        </p>
      </div>
    </div>
  )
}
