// ConversationHistoryPanel - UI for browsing and managing conversation history

import React, { useState, useEffect } from 'react'
import {
  loadMetadata,
  deleteConversation,
  clearAllHistory,
  type ConversationMetadata
} from './conversation-history'
import styles from './conversation-history-panel.module.css'

interface ConversationHistoryPanelProps {
  onLoadConversation: (id: string) => void
  onClose: () => void
  currentConversationId: string | null
}

export const ConversationHistoryPanel: React.FC<ConversationHistoryPanelProps> = ({
  onLoadConversation,
  onClose,
  currentConversationId
}) => {
  const [conversations, setConversations] = useState<ConversationMetadata[]>([])

  useEffect(() => {
    loadConversations()
  }, [])

  const loadConversations = () => {
    const metadata = loadMetadata()
    setConversations(metadata)
  }

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()

    if (confirm('Delete this conversation?')) {
      deleteConversation(id)
      loadConversations()
    }
  }

  const handleClearAll = () => {
    if (confirm('Delete all conversation history? This cannot be undone.')) {
      clearAllHistory()
      setConversations([])
    }
  }

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return date.toLocaleDateString()
  }

  return (
    <div className={styles.historyPanel}>
      <div className={styles.historyHeader}>
        <h3>Conversation History</h3>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          title="Close"
        >
          ✕
        </button>
      </div>

      {conversations.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No saved conversations yet</p>
          <p className={styles.emptyStateHint}>
            Conversations are automatically saved when you start a new chat
          </p>
        </div>
      ) : (
        <>
          <div className={styles.conversationList}>
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`${styles.conversationItem} ${
                  conv.id === currentConversationId ? styles.conversationItemActive : ''
                }`}
                onClick={() => onLoadConversation(conv.id)}
              >
                <div className={styles.conversationHeader}>
                  <div className={styles.conversationTitle}>{conv.title}</div>
                  <button
                    className={styles.deleteBtn}
                    onClick={(e) => handleDelete(conv.id, e)}
                    title="Delete conversation"
                  >
                    🗑
                  </button>
                </div>
                <div className={styles.conversationPreview}>{conv.preview}</div>
                <div className={styles.conversationMeta}>
                  {formatTimestamp(conv.timestamp)} · {conv.messageCount} messages
                </div>
              </div>
            ))}
          </div>

          <div className={styles.historyFooter}>
            <button
              className={styles.clearAllBtn}
              onClick={handleClearAll}
            >
              Clear All History
            </button>
          </div>
        </>
      )}
    </div>
  )
}
