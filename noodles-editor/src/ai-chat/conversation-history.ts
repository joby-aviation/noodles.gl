// ConversationHistory - Manage chat conversation history in localStorage

import type { Message } from './types'

export interface ConversationMetadata {
  id: string
  timestamp: number
  title: string
  preview: string
  messageCount: number
}

export interface Conversation {
  id: string
  timestamp: number
  messages: Message[]
}

const HISTORY_KEY_PREFIX = 'noodles-chat-history-'
const METADATA_KEY = 'noodles-chat-metadata'
const MAX_CONVERSATIONS = 50 // Limit to prevent localStorage overflow

// Generate a conversation title from the first user message
function generateTitle(messages: Message[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user')
  if (!firstUserMessage) return 'New Conversation'

  const content = typeof firstUserMessage.content === 'string'
    ? firstUserMessage.content
    : ''

  // Take first 50 chars or up to first newline
  const title = content.split('\n')[0].slice(0, 50)
  return title || 'New Conversation'
}

// Generate a preview from the conversation
function generatePreview(messages: Message[]): string {
  if (messages.length === 0) return 'Empty conversation'

  const lastMessage = messages[messages.length - 1]
  const content = typeof lastMessage.content === 'string'
    ? lastMessage.content
    : ''

  return content.slice(0, 100)
}

// Save a conversation to localStorage
export function saveConversation(messages: Message[]): string {
  if (messages.length === 0) {
    throw new Error('Cannot save empty conversation')
  }

  const id = crypto.randomUUID()
  const timestamp = Date.now()

  const conversation: Conversation = {
    id,
    timestamp,
    messages
  }

  // Save conversation data
  localStorage.setItem(
    `${HISTORY_KEY_PREFIX}${id}`,
    JSON.stringify(conversation)
  )

  // Update metadata
  const metadata = loadMetadata()
  const newMetadata: ConversationMetadata = {
    id,
    timestamp,
    title: generateTitle(messages),
    preview: generatePreview(messages),
    messageCount: messages.length
  }

  metadata.unshift(newMetadata)

  // Trim to max conversations
  if (metadata.length > MAX_CONVERSATIONS) {
    const removed = metadata.slice(MAX_CONVERSATIONS)
    // Delete old conversations from storage
    removed.forEach(m => {
      localStorage.removeItem(`${HISTORY_KEY_PREFIX}${m.id}`)
    })
    metadata.splice(MAX_CONVERSATIONS)
  }

  saveMetadata(metadata)

  return id
}

// Load a conversation by ID
export function loadConversation(id: string): Conversation | null {
  const data = localStorage.getItem(`${HISTORY_KEY_PREFIX}${id}`)
  if (!data) return null

  try {
    return JSON.parse(data) as Conversation
  } catch {
    return null
  }
}

// Delete a conversation by ID
export function deleteConversation(id: string): void {
  localStorage.removeItem(`${HISTORY_KEY_PREFIX}${id}`)

  const metadata = loadMetadata()
  const filtered = metadata.filter(m => m.id !== id)
  saveMetadata(filtered)
}

// Load all conversation metadata
export function loadMetadata(): ConversationMetadata[] {
  const data = localStorage.getItem(METADATA_KEY)
  if (!data) return []

  try {
    return JSON.parse(data) as ConversationMetadata[]
  } catch {
    return []
  }
}

// Save conversation metadata
function saveMetadata(metadata: ConversationMetadata[]): void {
  localStorage.setItem(METADATA_KEY, JSON.stringify(metadata))
}

// Clear all conversation history
export function clearAllHistory(): void {
  const metadata = loadMetadata()
  metadata.forEach(m => {
    localStorage.removeItem(`${HISTORY_KEY_PREFIX}${m.id}`)
  })
  localStorage.removeItem(METADATA_KEY)
}
