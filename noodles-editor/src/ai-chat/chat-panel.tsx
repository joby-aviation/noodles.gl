/**
 * ChatPanel - Main UI component for Claude AI integration
 */

import React, { useState, useEffect, useRef } from 'react'
import { ClaudeClient } from './claude-client'
import { ContextLoader } from './context-loader'
import { MCPTools } from './mcp-tools'
import type { Message } from './types'
import {
  saveConversation,
  loadConversation,
  type Conversation
} from './conversation-history'
import { ConversationHistoryPanel } from './conversation-history-panel'
import styles from './chat-panel.module.css'

interface ChatPanelProps {
  project: any
  onProjectUpdate: (project: any) => void
  onClose?: () => void
  isPopout?: boolean
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  project,
  onProjectUpdate,
  onClose,
  isPopout = false
}) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [contextLoading, setContextLoading] = useState(true)
  const [apiKey, setApiKey] = useState<string>('')
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [claudeClient, setClaudeClient] = useState<ClaudeClient | null>(null)
  const [mcpTools, setMcpTools] = useState<MCPTools | null>(null)
  const [autoCapture, setAutoCapture] = useState(true)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Initialize Claude client (without heavy context loading)
  useEffect(() => {
    const init = async () => {
      // Try to load API key from localStorage first
      let storedKey = localStorage.getItem('noodles-claude-api-key')

      // If not in localStorage, check environment variable
      if (!storedKey) {
        const envKey = import.meta.env.VITE_CLAUDE_API_KEY
        if (envKey && typeof envKey === 'string') {
          storedKey = envKey
        }
      }

      // If still no key, prompt user
      if (!storedKey) {
        setShowApiKeyModal(true)
        setContextLoading(false)
        return
      }

      // Sanitize stored key to remove any non-ASCII characters
      const sanitizedKey = storedKey.replace(/[^\x00-\x7F]/g, '')

      // If sanitized key is invalid, clear and prompt for new key
      if (!sanitizedKey || !sanitizedKey.startsWith('sk-ant-') || sanitizedKey.length < 20) {
        localStorage.removeItem('noodles-claude-api-key')
        setShowApiKeyModal(true)
        setContextLoading(false)
        return
      }

      // If we had to sanitize, save the clean version back to localStorage
      if (sanitizedKey !== storedKey && localStorage.getItem('noodles-claude-api-key')) {
        localStorage.setItem('noodles-claude-api-key', sanitizedKey)
      }

      setApiKey(sanitizedKey)

      try {
        // Initialize with minimal context - load context lazily when needed
        const loader = new ContextLoader()
        const tools = new MCPTools(loader)
        const client = new ClaudeClient(sanitizedKey, tools)

        setMcpTools(tools)
        setClaudeClient(client)
        setContextLoading(false)

        // Load context in background (non-blocking)
        loader.load((progress) => {
          console.log('Loading context:', progress.stage, `${progress.loaded}/${progress.total}`)
        }).catch(error => {
          console.warn('Context loading failed, continuing without advanced features:', error)
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
        // Clear invalid API key and prompt for re-entry
        localStorage.removeItem('noodles-claude-api-key')
        const errorMessage: Message = {
          role: 'assistant',
          content: `Authentication Error: Your API key appears to be invalid. Please enter a valid API key.`
        }
        setMessages(prev => [...prev, errorMessage])
        setShowApiKeyModal(true)
      } else {
        const errorMessage: Message = {
          role: 'assistant',
          content: `Error: ${errorStr}. Please check your API key and try again.`
        }
        setMessages(prev => [...prev, errorMessage])
      }
    } finally {
      setLoading(false)
    }
  }

  const applyProjectModifications = (modifications: any[]) => {
    let updatedProject = { ...project }

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

  const handleApiKeySubmit = async (key: string) => {
    localStorage.setItem('noodles-claude-api-key', key)
    setApiKey(key)
    setShowApiKeyModal(false)

    // Reinitialize Claude client without full page reload
    try {
      // Load context
      const loader = new ContextLoader()
      await loader.load((progress) => {
        console.log('Loading context:', progress.stage, `${progress.loaded}/${progress.total}`)
      })

      // Initialize tools and client with new API key
      const tools = new MCPTools(loader)
      const client = new ClaudeClient(key, tools)

      setMcpTools(tools)
      setClaudeClient(client)
    } catch (error) {
      console.error('Failed to reinitialize Claude:', error)
      // Chat will still work, just without advanced context features
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
const MessageContent: React.FC<{ content: string }> = ({ content }) => {
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
const ApiKeyModal: React.FC<{ onSubmit: (key: string) => void }> = ({ onSubmit }) => {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    const trimmedKey = key.trim()

    if (!trimmedKey) {
      setError('API key is required')
      return
    }

    // Remove any non-ASCII characters that might cause encoding issues
    const sanitizedKey = trimmedKey.replace(/[^\x00-\x7F]/g, '')

    if (sanitizedKey !== trimmedKey) {
      setError('API key contains invalid characters. Please copy it again carefully.')
      return
    }

    if (!sanitizedKey.startsWith('sk-ant-')) {
      setError('API key must start with "sk-ant-"')
      return
    }

    if (sanitizedKey.length < 20) {
      setError('API key appears to be too short')
      return
    }

    setError('')
    onSubmit(sanitizedKey)
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
          Your API key is stored locally in your browser and never sent to Noodles.gl servers.
        </p>
      </div>
    </div>
  )
}
