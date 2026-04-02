import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllHistory,
  deleteConversation,
  loadConversation,
  loadMetadata,
  saveConversation,
} from './conversation-history'
import type { Message } from './types'

const makeLocalStorageMock = () => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
}

describe('conversation-history', () => {
  const localStorageMock = makeLocalStorageMock()

  beforeAll(() => {
    vi.stubGlobal('localStorage', localStorageMock)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    localStorageMock.clear()
  })

  describe('saveConversation', () => {
    it('saves a conversation to localStorage', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]

      const id = saveConversation(messages)

      expect(id).toBeDefined()

      const saved = loadConversation(id)
      expect(saved).toBeDefined()
      expect(saved?.messages).toEqual(messages)
    })

    it('throws error when saving empty conversation', () => {
      expect(() => saveConversation([])).toThrow('Cannot save empty conversation')
    })

    it('generates metadata with title and preview', () => {
      const messages: Message[] = [
        { role: 'user', content: 'What is the weather?' },
        { role: 'assistant', content: 'The weather is sunny today.' },
      ]

      const id = saveConversation(messages)
      const metadata = loadMetadata()

      expect(metadata).toHaveLength(1)
      expect(metadata[0].id).toBe(id)
      expect(metadata[0].title).toBe('What is the weather?')
      expect(metadata[0].preview).toBe('The weather is sunny today.')
      expect(metadata[0].messageCount).toBe(2)
    })

    it('truncates long titles', () => {
      const longMessage = 'A'.repeat(100)
      const messages: Message[] = [{ role: 'user', content: longMessage }]

      saveConversation(messages)
      const metadata = loadMetadata()

      expect(metadata[0].title.length).toBeLessThanOrEqual(50)
    })

    it('handles multiline messages in title', () => {
      const messages: Message[] = [{ role: 'user', content: 'First line\nSecond line\nThird line' }]

      saveConversation(messages)
      const metadata = loadMetadata()

      expect(metadata[0].title).toBe('First line')
    })
  })

  describe('loadConversation', () => {
    it('loads a saved conversation', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ]

      const id = saveConversation(messages)
      const loaded = loadConversation(id)

      expect(loaded).toBeDefined()
      expect(loaded?.id).toBe(id)
      expect(loaded?.messages).toEqual(messages)
    })

    it('returns null for non-existent conversation', () => {
      const loaded = loadConversation('non-existent-id')
      expect(loaded).toBeNull()
    })
  })

  describe('deleteConversation', () => {
    it('deletes a conversation', () => {
      const messages: Message[] = [{ role: 'user', content: 'Test' }]
      const id = saveConversation(messages)

      expect(loadConversation(id)).toBeDefined()
      expect(loadMetadata()).toHaveLength(1)

      deleteConversation(id)

      expect(loadConversation(id)).toBeNull()
      expect(loadMetadata()).toHaveLength(0)
    })
  })

  describe('loadMetadata', () => {
    it('returns empty array when no conversations', () => {
      const metadata = loadMetadata()
      expect(metadata).toEqual([])
    })

    it('returns metadata for saved conversations', () => {
      const messages1: Message[] = [{ role: 'user', content: 'First' }]
      const messages2: Message[] = [{ role: 'user', content: 'Second' }]

      const id1 = saveConversation(messages1)
      const id2 = saveConversation(messages2)

      const metadata = loadMetadata()

      expect(metadata).toHaveLength(2)
      expect(metadata[0].id).toBe(id2) // Most recent first
      expect(metadata[1].id).toBe(id1)
    })
  })

  describe('clearAllHistory', () => {
    it('clears all conversations and metadata', () => {
      const messages1: Message[] = [{ role: 'user', content: 'First' }]
      const messages2: Message[] = [{ role: 'user', content: 'Second' }]

      const id1 = saveConversation(messages1)
      const id2 = saveConversation(messages2)

      expect(loadMetadata()).toHaveLength(2)

      clearAllHistory()

      expect(loadMetadata()).toHaveLength(0)
      expect(loadConversation(id1)).toBeNull()
      expect(loadConversation(id2)).toBeNull()
    })
  })

  describe('conversation limit', () => {
    it('removes oldest conversations when exceeding max limit', () => {
      // Save 51 conversations (max is 50)
      const ids: string[] = []
      for (let i = 0; i < 51; i++) {
        const messages: Message[] = [{ role: 'user', content: `Message ${i}` }]
        ids.push(saveConversation(messages))
      }

      const metadata = loadMetadata()

      // Should only keep 50 conversations
      expect(metadata).toHaveLength(50)

      // First conversation should be removed
      expect(loadConversation(ids[0])).toBeNull()

      // Last conversation should still exist
      expect(loadConversation(ids[50])).toBeDefined()
    })
  })
})
