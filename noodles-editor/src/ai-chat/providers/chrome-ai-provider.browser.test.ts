import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MCPTools } from '../mcp-tools'
import type { NoodlesProject } from '../types'
import { ChromeAIProvider } from './chrome-ai-provider'
import { ProviderError } from './ai-provider-interface'

// Browser-based E2E tests for Chrome AI provider
// These tests run in a real Chromium instance via Playwright
// In Vitest 4 browser mode, tests run directly in the browser context

describe('ChromeAIProvider E2E (Browser)', () => {
  const mockTools = {
    captureVisualization: vi.fn(),
    getConsoleErrors: vi.fn(),
    getRenderStats: vi.fn(),
    inspectLayer: vi.fn(),
    applyModifications: vi.fn(),
    getCurrentProject: vi.fn(),
    getProject: vi.fn(() => mockProject),
    listNodes: vi.fn(),
    getNodeInfo: vi.fn(),
    getNodeOutput: vi.fn(),
    getTimeline: vi.fn(),
    setKeyframe: vi.fn(),
    deleteKeyframe: vi.fn(),
    setPlaybackPosition: vi.fn(),
  } as unknown as MCPTools

  const mockProject: NoodlesProject = {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }

  let chromeAIAvailable: boolean
  let chromeAIState: 'unavailable' | 'downloadable' | 'downloading' | 'available'

  beforeAll(async () => {
    // Check if Chrome AI is available in the test browser
    chromeAIAvailable = typeof (window as any).LanguageModel !== 'undefined'

    if (chromeAIAvailable) {
      try {
        chromeAIState = await (window as any).LanguageModel.availability({
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        })
      } catch {
        chromeAIState = 'unavailable'
      }
    } else {
      chromeAIState = 'unavailable'
    }
  })

  describe('Real Chrome AI Integration', () => {
    // Skip if Chrome AI not available in test environment
    it(
      'initializes and creates a session with real Chrome AI',
      { skip: !chromeAIAvailable || chromeAIState === 'unavailable' },
      async () => {
        // Create provider directly in browser context
        const provider = new ChromeAIProvider(mockTools)

        expect(provider.name).toBe('chrome-ai')
        expect(provider.displayName).toBe('Built-in AI (Chrome)')

        // Try to initialize
        try {
          const messages: string[] = []
          await provider.initialize((msg: string) => messages.push(msg))

          if (chromeAIState === 'available') {
            expect(messages).toContain('AI session ready')
          }
        } catch (error: any) {
          // May require download or fail
          if (chromeAIState !== 'available') {
            expect(error.message).toBeDefined()
          } else {
            throw error
          }
        }
      },
      { timeout: 15000 }
    )

    it(
      'sends a real message and receives response',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const provider = new ChromeAIProvider(mockTools)
        await provider.initialize()

        const response = await provider.sendMessage({
          message: 'Say "test successful" in your response',
          project: mockProject,
        })

        expect(response.message).toBeDefined()
        expect(response.message.length).toBeGreaterThan(0)
        expect(response.projectModifications.length).toBeGreaterThanOrEqual(0)
        // Chrome AI doesn't support tool calling
        expect(response.toolCalls.length).toBe(0)
      },
      { timeout: 30000 }
    )

    it(
      'extracts project modifications from response',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const provider = new ChromeAIProvider(mockTools)
        await provider.initialize()

        const response = await provider.sendMessage({
          message:
            'Create a JSON code block with: [{"type":"add_node","data":{"id":"/test","type":"NumberOp","position":{"x":100,"y":100}}}]',
          project: mockProject,
        })

        // The AI should include the JSON in its response
        expect(response.message).toContain('add_node')
      },
      { timeout: 30000 }
    )

    it(
      'handles conversation history correctly',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const provider = new ChromeAIProvider(mockTools)
        await provider.initialize()

        // First message
        const response1 = await provider.sendMessage({
          message: 'Remember that my favorite color is blue',
          project: mockProject,
          conversationHistory: [],
        })

        // Second message with history
        const response2 = await provider.sendMessage({
          message: 'What is my favorite color?',
          project: mockProject,
          conversationHistory: [
            { role: 'user', content: 'Remember that my favorite color is blue' },
            { role: 'assistant', content: response1.message },
          ],
        })

        // The second response should reference the color from history
        // (This is probabilistic but Chrome AI should understand context)
        expect(response2.message.toLowerCase()).toContain('blue')
      },
      { timeout: 60000 }
    )

    it(
      'exposes context window information',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const provider = new ChromeAIProvider(mockTools)
        await provider.initialize()

        const contextBefore = provider.getContextWindow()

        await provider.sendMessage({
          message: 'Tell me about geospatial visualization',
          project: mockProject,
        })

        const contextAfter = provider.getContextWindow()

        if (contextBefore) {
          expect(contextBefore.used).toBeGreaterThan(0)
          expect(contextBefore.total).toBeGreaterThan(0)
          expect(contextBefore.percentage).toBeGreaterThanOrEqual(0)
          expect(contextBefore.percentage).toBeLessThanOrEqual(100)
        }

        if (contextAfter) {
          // Context usage should increase after sending a message
          expect(contextAfter.used).toBeGreaterThanOrEqual(contextBefore?.used || 0)
        }
      },
      { timeout: 30000 }
    )

    it(
      'cleans up session on destroy',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const provider = new ChromeAIProvider(mockTools)
        await provider.initialize()

        // Session should work before destroy
        const responseBefore = await provider.sendMessage({
          message: 'Test',
          project: mockProject,
        })

        expect(responseBefore.message).toBeDefined()

        // Destroy the session
        provider.destroy()

        // Try to use after destroy
        await expect(
          provider.sendMessage({
            message: 'Test',
            project: mockProject,
          })
        ).rejects.toThrow('not initialized')
      },
      { timeout: 30000 }
    )
  })

  describe('Polyfilled Chrome AI (Mock Mode)', () => {
    beforeEach(() => {
      // Install a polyfill/mock in the browser for testing when real API unavailable
      if (typeof (window as any).LanguageModel !== 'undefined') {
        return // Real API already available
      }

      // Create a simple mock implementation
      const mockSession = {
        prompt: async (input: string) => {
          // Simple echo with prefix
          return `Mock AI response to: ${input.slice(0, 50)}...`
        },
        promptStreaming: (input: string) => {
          const encoder = new TextEncoderStream()
          const writer = encoder.writable.getWriter()
          writer.write('Mock streaming response')
          writer.close()
          return encoder.readable
        },
        destroy: () => {},
        clone: () => mockSession,
        contextWindow: 4096,
        contextUsage: 500,
      }

      ;(window as any).LanguageModel = {
        availability: async () => 'available',
        create: async () => mockSession,
      }
    })

    it('works with polyfilled Chrome AI API', async () => {
      const provider = new ChromeAIProvider(mockTools)
      const messages: string[] = []
      await provider.initialize((msg: string) => messages.push(msg))

      const response = await provider.sendMessage({
        message: 'Test message',
        project: mockProject,
      })

      expect(messages).toContain('AI session ready')
      expect(response.message).toContain('Mock AI response')
    })

    it('handles errors in polyfilled API', async () => {
      // Override with error-throwing mock
      ;(window as any).LanguageModel = {
        availability: async () => 'unavailable',
        create: async () => {
          throw new Error('Mock creation failed')
        },
      }

      const provider = new ChromeAIProvider(mockTools)

      await expect(provider.initialize()).rejects.toThrow('not available')
    })
  })

  describe('Error Handling in Browser Context', () => {
    it('provides helpful error when API not available', async () => {
      // Temporarily remove LanguageModel
      const originalLM = (window as any).LanguageModel
      delete (window as any).LanguageModel

      try {
        const provider = new ChromeAIProvider(mockTools)
        await expect(provider.initialize()).rejects.toThrow(/Chrome/)
        await expect(provider.initialize()).rejects.toThrow(/flag/)
      } finally {
        ;(window as any).LanguageModel = originalLM
      }
    })

    it('detects Chrome version in error messages', () => {
      const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1]

      expect(chromeVersion).toBeDefined()
      // Modern test browsers should be Chrome 100+
      expect(Number.parseInt(chromeVersion || '0')).toBeGreaterThan(100)
    })
  })

  describe('Progress Tracking', () => {
    beforeEach(() => {
      // Mock user activation (required for downloadable state)
      Object.defineProperty(navigator, 'userActivation', {
        value: { isActive: true, hasBeenActive: true },
        writable: true,
        configurable: true,
      })

      // Install mock with download progress
      const createMockSession = () => ({
        prompt: async (input: string) => `Response to: ${input}`,
        promptStreaming: () => new ReadableStream(),
        destroy: () => {},
        clone: () => createMockSession(),
        contextWindow: 4096,
        contextUsage: 500,
      })

      ;(window as any).LanguageModel = {
        availability: async () => 'downloadable',
        create: async (options: any) => {
          // Simulate download progress - fire synchronously to avoid timing issues
          if (options.monitor) {
            const mockMonitor = {
              addEventListener: (event: string, callback: (e: any) => void) => {
                if (event === 'downloadprogress') {
                  // Fire progress events immediately
                  callback({ loaded: 250, total: 1000 })
                  callback({ loaded: 500, total: 1000 })
                  callback({ loaded: 750, total: 1000 })
                  callback({ loaded: 1000, total: 1000 })
                }
              },
            }
            options.monitor(mockMonitor)
          }

          return createMockSession()
        },
      }
    })

    it(
      'tracks download progress',
      { timeout: 10000 },
      async () => {
        const provider = new ChromeAIProvider(mockTools)
        const messages: string[] = []

        await provider.initialize((msg: string) => {
          messages.push(msg)
        })

        expect(messages).toContain('Triggering AI model download...')
        expect(messages).toContain('Downloading AI model: 25%')
        expect(messages).toContain('Downloading AI model: 50%')
        expect(messages).toContain('Downloading AI model: 100%')
        expect(messages).toContain('AI session ready')
      }
    )
  })
})
