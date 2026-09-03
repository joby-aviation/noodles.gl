import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { MCPTools } from '../mcp-tools'
import type { NoodlesProject } from '../types'
import { ChromeAIProvider } from './chrome-ai-provider'
import { ProviderError } from './ai-provider-interface'

// Browser-based E2E tests for Chrome AI provider
// These tests run in a real Chromium instance via Playwright

// TODO: Fix for Vitest 4 browser API migration
//
// Problem: Vitest 4 changed browser testing API:
//   Old (v3): import { page } from '@vitest/browser/context'  // Raw Playwright page
//   New (v4): import { page } from 'vitest/browser'           // Simplified API (no page.evaluate)
//
// These tests use page.evaluate() to run code in browser context, which no longer works.
//
// Solution options:
//   1. Find correct import for Playwright page in Vitest 4.1.2 + @vitest/browser-playwright
//      Try: import { page } from '@vitest/browser-playwright/context'
//   2. Rewrite using Vitest browser commands (complex, may not work for Chrome LanguageModel API)
//   3. Move to standalone Playwright E2E tests
//
// These tests are valuable (11 tests covering real Chrome AI integration) - worth fixing!
describe.skip('ChromeAIProvider E2E (Browser)', () => {
  const mockTools = {
    captureVisualization: vi.fn(),
    getConsoleErrors: vi.fn(),
    getRenderStats: vi.fn(),
    inspectLayer: vi.fn(),
    applyModifications: vi.fn(),
    getCurrentProject: vi.fn(),
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
    chromeAIAvailable = await page.evaluate(() => {
      return typeof (window as any).LanguageModel !== 'undefined'
    })

    if (chromeAIAvailable) {
      chromeAIState = await page.evaluate(async () => {
        try {
          const availability = await (window as any).LanguageModel.availability({
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
          })
          return availability
        } catch {
          return 'unavailable'
        }
      })
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
        // Create provider in browser context
        const provider = await page.evaluate(() => {
          const tools = {} as any
          const provider = new (window as any).ChromeAIProvider(tools)
          return { name: provider.name, displayName: provider.displayName }
        })

        expect(provider.name).toBe('chrome-ai')
        expect(provider.displayName).toBe('Built-in AI (Chrome)')

        // Try to initialize
        const initResult = await page.evaluate(async () => {
          try {
            const tools = {} as any
            const provider = new (window as any).ChromeAIProvider(tools)
            const messages: string[] = []
            await provider.initialize((msg: string) => messages.push(msg))
            return { success: true, messages, error: null }
          } catch (error: any) {
            return {
              success: false,
              messages: [],
              error: error.message,
            }
          }
        })

        if (chromeAIState === 'available') {
          expect(initResult.success).toBe(true)
          expect(initResult.messages).toContain('AI session ready')
        } else {
          // May require download or fail
          expect(initResult.error).toBeDefined()
        }
      },
      { timeout: 15000 }
    )

    it(
      'sends a real message and receives response',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const result = await page.evaluate(async () => {
          try {
            const tools = {} as any
            const provider = new (window as any).ChromeAIProvider(tools)
            await provider.initialize()

            const response = await provider.sendMessage({
              message: 'Say "test successful" in your response',
              project: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
            })

            return {
              success: true,
              message: response.message,
              hasModifications: response.projectModifications.length > 0,
              hasToolCalls: response.toolCalls.length > 0,
            }
          } catch (error: any) {
            return {
              success: false,
              error: error.message,
            }
          }
        })

        expect(result.success).toBe(true)
        expect(result.message).toBeDefined()
        expect(result.message.length).toBeGreaterThan(0)
        // Chrome AI doesn't support tool calling
        expect(result.hasToolCalls).toBe(false)
      },
      { timeout: 30000 }
    )

    it(
      'extracts project modifications from response',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const result = await page.evaluate(async () => {
          try {
            const tools = {} as any
            const provider = new (window as any).ChromeAIProvider(tools)
            await provider.initialize()

            const response = await provider.sendMessage({
              message:
                'Create a JSON code block with: [{"type":"add_node","data":{"id":"/test","type":"NumberOp","position":{"x":100,"y":100}}}]',
              project: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
            })

            return {
              success: true,
              message: response.message,
              modifications: response.projectModifications,
            }
          } catch (error: any) {
            return {
              success: false,
              error: error.message,
            }
          }
        })

        expect(result.success).toBe(true)
        // The AI should include the JSON in its response
        expect(result.message).toContain('add_node')
      },
      { timeout: 30000 }
    )

    it(
      'handles conversation history correctly',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const result = await page.evaluate(async () => {
          try {
            const tools = {} as any
            const provider = new (window as any).ChromeAIProvider(tools)
            await provider.initialize()

            // First message
            const response1 = await provider.sendMessage({
              message: 'Remember that my favorite color is blue',
              project: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
              conversationHistory: [],
            })

            // Second message with history
            const response2 = await provider.sendMessage({
              message: 'What is my favorite color?',
              project: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
              conversationHistory: [
                { role: 'user', content: 'Remember that my favorite color is blue' },
                { role: 'assistant', content: response1.message },
              ],
            })

            return {
              success: true,
              firstResponse: response1.message,
              secondResponse: response2.message,
            }
          } catch (error: any) {
            return {
              success: false,
              error: error.message,
            }
          }
        })

        expect(result.success).toBe(true)
        // The second response should reference the color from history
        // (This is probabilistic but Chrome AI should understand context)
        expect(result.secondResponse.toLowerCase()).toContain('blue')
      },
      { timeout: 60000 }
    )

    it(
      'exposes context window information',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const result = await page.evaluate(async () => {
          try {
            const tools = {} as any
            const provider = new (window as any).ChromeAIProvider(tools)
            await provider.initialize()

            const contextBefore = provider.getContextWindow()

            await provider.sendMessage({
              message: 'Tell me about geospatial visualization',
              project: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
            })

            const contextAfter = provider.getContextWindow()

            return {
              success: true,
              contextBefore,
              contextAfter,
            }
          } catch (error: any) {
            return {
              success: false,
              error: error.message,
            }
          }
        })

        expect(result.success).toBe(true)

        if (result.contextBefore) {
          expect(result.contextBefore.used).toBeGreaterThan(0)
          expect(result.contextBefore.total).toBeGreaterThan(0)
          expect(result.contextBefore.percentage).toBeGreaterThanOrEqual(0)
          expect(result.contextBefore.percentage).toBeLessThanOrEqual(100)
        }

        if (result.contextAfter) {
          // Context usage should increase after sending a message
          expect(result.contextAfter.used).toBeGreaterThanOrEqual(result.contextBefore?.used || 0)
        }
      },
      { timeout: 30000 }
    )

    it(
      'cleans up session on destroy',
      { skip: !chromeAIAvailable || chromeAIState !== 'available' },
      async () => {
        const result = await page.evaluate(async () => {
          try {
            const tools = {} as any
            const provider = new (window as any).ChromeAIProvider(tools)
            await provider.initialize()

            // Session should work before destroy
            const responseBefore = await provider.sendMessage({
              message: 'Test',
              project: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
            })

            // Destroy the session
            provider.destroy()

            // Try to use after destroy
            let errorAfter = null
            try {
              await provider.sendMessage({
                message: 'Test',
                project: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
              })
            } catch (error: any) {
              errorAfter = error.message
            }

            return {
              success: true,
              beforeMessage: responseBefore.message,
              errorAfter,
            }
          } catch (error: any) {
            return {
              success: false,
              error: error.message,
            }
          }
        })

        expect(result.success).toBe(true)
        expect(result.beforeMessage).toBeDefined()
        expect(result.errorAfter).toContain('not initialized')
      },
      { timeout: 30000 }
    )
  })

  describe('Polyfilled Chrome AI (Mock Mode)', () => {
    beforeEach(async () => {
      // Install a polyfill/mock in the browser for testing when real API unavailable
      await page.evaluate(() => {
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
    })

    it('works with polyfilled Chrome AI API', async () => {
      const result = await page.evaluate(async () => {
        try {
          const tools = {} as any
          const provider = new (window as any).ChromeAIProvider(tools)
          const messages: string[] = []
          await provider.initialize((msg: string) => messages.push(msg))

          const response = await provider.sendMessage({
            message: 'Test message',
            project: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          })

          return {
            success: true,
            initMessages: messages,
            response: response.message,
          }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          }
        }
      })

      expect(result.success).toBe(true)
      expect(result.initMessages).toContain('AI session ready')
      expect(result.response).toContain('Mock AI response')
    })

    it('handles errors in polyfilled API', async () => {
      // Override with error-throwing mock
      await page.evaluate(() => {
        ;(window as any).LanguageModel = {
          availability: async () => 'unavailable',
          create: async () => {
            throw new Error('Mock creation failed')
          },
        }
      })

      const result = await page.evaluate(async () => {
        try {
          const tools = {} as any
          const provider = new (window as any).ChromeAIProvider(tools)
          await provider.initialize()
          return { success: true }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
          }
        }
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not available')
    })
  })

  describe('Error Handling in Browser Context', () => {
    it('provides helpful error when API not available', async () => {
      // Temporarily remove LanguageModel
      const result = await page.evaluate(async () => {
        const originalLM = (window as any).LanguageModel
        delete (window as any).LanguageModel

        try {
          const tools = {} as any
          const provider = new (window as any).ChromeAIProvider(tools)
          await provider.initialize()
          return { success: true, error: null }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            includesChrome: error.message.includes('Chrome'),
            includesFlag: error.message.includes('flag'),
          }
        } finally {
          ;(window as any).LanguageModel = originalLM
        }
      })

      expect(result.success).toBe(false)
      expect(result.includesChrome).toBe(true)
      expect(result.includesFlag).toBe(true)
    })

    it('detects Chrome version in error messages', async () => {
      const result = await page.evaluate(async () => {
        const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1]
        return chromeVersion
      })

      expect(result).toBeDefined()
      // Modern test browsers should be Chrome 100+
      expect(Number.parseInt(result || '0')).toBeGreaterThan(100)
    })
  })

  describe('Progress Tracking', () => {
    beforeEach(async () => {
      // Install mock with download progress
      await page.evaluate(() => {
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
            // Simulate download progress
            if (options.monitor) {
              const mockMonitor = {
                addEventListener: (event: string, callback: (e: any) => void) => {
                  if (event === 'downloadprogress') {
                    // Simulate progress events
                    setTimeout(() => callback({ loaded: 250, total: 1000 }), 10)
                    setTimeout(() => callback({ loaded: 500, total: 1000 }), 20)
                    setTimeout(() => callback({ loaded: 750, total: 1000 }), 30)
                    setTimeout(() => callback({ loaded: 1000, total: 1000 }), 40)
                  }
                },
              }
              options.monitor(mockMonitor)
            }

            // Wait for progress events
            await new Promise(resolve => setTimeout(resolve, 50))
            return createMockSession()
          },
        }
      })
    })

    it('tracks download progress', async () => {
      const result = await page.evaluate(async () => {
        const tools = {} as any
        const provider = new (window as any).ChromeAIProvider(tools)
        const messages: string[] = []

        await provider.initialize((msg: string) => {
          messages.push(msg)
        })

        return { success: true, messages }
      })

      expect(result.success).toBe(true)
      expect(result.messages).toContain('Triggering AI model download...')
      expect(result.messages).toContain('Downloading AI model: 25%')
      expect(result.messages).toContain('Downloading AI model: 50%')
      expect(result.messages).toContain('Downloading AI model: 100%')
      expect(result.messages).toContain('AI session ready')
    }, 10000)
  })
})
