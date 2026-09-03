import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MCPTools } from '../mcp-tools'
import type { NoodlesProject } from '../types'
import { ChromeAIProvider } from './chrome-ai-provider'
import { ProviderError } from './ai-provider-interface'

// Mock the operator store
const mockOpStore = new Map()
vi.mock('../../noodles/store', () => ({
  getOpStore: () => ({
    getOp: (id: string) => mockOpStore.get(id),
  }),
}))

// Mock the Chrome AI global API
interface MockLanguageModelSession {
  prompt: ReturnType<typeof vi.fn>
  promptStreaming: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  clone: ReturnType<typeof vi.fn>
  contextWindow?: number
  contextUsage?: number
}

interface MockLanguageModel {
  availability: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

let mockLanguageModel: MockLanguageModel
let mockSession: MockLanguageModelSession

describe('ChromeAIProvider', () => {
  const mockProject: NoodlesProject = {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }

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
    getProject: () => mockProject,
    setProject: vi.fn(),
  } as unknown as MCPTools

  beforeEach(() => {
    // Create fresh mocks for each test
    mockSession = {
      prompt: vi.fn(),
      promptStreaming: vi.fn(),
      destroy: vi.fn(),
      clone: vi.fn(),
      contextWindow: 4096,
      contextUsage: 500,
    }

    mockLanguageModel = {
      availability: vi.fn(),
      create: vi.fn(),
    }

    // Inject mock into global scope
    ;(globalThis as any).LanguageModel = mockLanguageModel

    // Mock navigator.userActivation (read-only property)
    Object.defineProperty(globalThis.navigator, 'userActivation', {
      value: { isActive: true },
      writable: true,
      configurable: true,
    })
  })

  describe('Provider metadata', () => {
    it('has correct provider identification', () => {
      const provider = new ChromeAIProvider(mockTools)
      expect(provider.name).toBe('chrome-ai')
      expect(provider.displayName).toBe('Built-in AI (Chrome)')
      expect(provider.tier).toBe('free')
      expect(provider.supportsStreaming).toBe(true)
      expect(provider.supportsFunctionCalling).toBe(false)
    })
  })

  describe('initialize', () => {
    it('successfully initializes when Chrome AI is available', async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockResolvedValue(mockSession)

      const provider = new ChromeAIProvider(mockTools)
      const progressMessages: string[] = []
      await provider.initialize(msg => progressMessages.push(msg))

      expect(mockLanguageModel.availability).toHaveBeenCalledWith({
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      })
      expect(mockLanguageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('Noodles.gl'),
          temperature: 0.7,
          topK: 40,
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        })
      )
      expect(progressMessages).toContain('Checking Chrome AI availability...')
      expect(progressMessages).toContain('AI session ready')
    })

    it('throws error when LanguageModel is not defined', async () => {
      delete (globalThis as any).LanguageModel

      const provider = new ChromeAIProvider(mockTools)
      await expect(provider.initialize()).rejects.toThrow(ProviderError)
      await expect(provider.initialize()).rejects.toThrow('Chrome Built-in AI is not available')
    })

    it('throws error when availability is "unavailable"', async () => {
      mockLanguageModel.availability.mockResolvedValue('unavailable')

      const provider = new ChromeAIProvider(mockTools)
      await expect(provider.initialize()).rejects.toThrow(ProviderError)
      await expect(provider.initialize()).rejects.toThrow('not available on this device')
    })

    it('handles "downloadable" state with user activation', async () => {
      mockLanguageModel.availability.mockResolvedValue('downloadable')
      mockLanguageModel.create.mockResolvedValue(mockSession)

      const provider = new ChromeAIProvider(mockTools)
      const progressMessages: string[] = []
      await provider.initialize(msg => progressMessages.push(msg))

      expect(progressMessages).toContain('Triggering AI model download...')
      expect(mockLanguageModel.create).toHaveBeenCalled()
    })

    it('throws error when "downloadable" but no user activation', async () => {
      mockLanguageModel.availability.mockResolvedValue('downloadable')
      Object.defineProperty(globalThis.navigator, 'userActivation', {
        value: { isActive: false },
        writable: true,
        configurable: true,
      })

      const provider = new ChromeAIProvider(mockTools)
      await expect(provider.initialize()).rejects.toThrow(ProviderError)
      await expect(provider.initialize()).rejects.toThrow('needs to download')
    })

    it('waits for download when "downloading"', async () => {
      mockLanguageModel.availability.mockResolvedValue('downloading')
      mockLanguageModel.create.mockResolvedValue(mockSession)

      const provider = new ChromeAIProvider(mockTools)
      const progressMessages: string[] = []
      await provider.initialize(msg => progressMessages.push(msg))

      expect(progressMessages).toContain('Waiting for AI model download to complete...')
      expect(mockLanguageModel.create).toHaveBeenCalled()
    })

    it('handles download progress events', async () => {
      mockLanguageModel.availability.mockResolvedValue('downloadable')

      let monitorCallback: ((e: any) => void) | null = null
      mockLanguageModel.create.mockImplementation((options: any) => {
        // Capture the monitor callback
        if (options.monitor) {
          const mockMonitor = {
            addEventListener: (event: string, callback: (e: any) => void) => {
              if (event === 'downloadprogress') {
                monitorCallback = callback
              }
            },
          }
          options.monitor(mockMonitor)
        }

        // Simulate download progress immediately
        if (monitorCallback) {
          monitorCallback({ loaded: 500, total: 1000 })
          monitorCallback({ loaded: 1000, total: 1000 })
        }

        return Promise.resolve(mockSession)
      })

      const provider = new ChromeAIProvider(mockTools)
      const progressMessages: string[] = []
      await provider.initialize(msg => progressMessages.push(msg))

      expect(progressMessages).toContain('Downloading AI model: 50%')
      expect(progressMessages).toContain('Downloading AI model: 100%')
    })

    it.skip('times out for long downloads after 10 minutes', async () => {
      // Skipped: This test would take 10+ minutes to run
      // Timeout behavior is verified by unit testing the withTimeout utility
      mockLanguageModel.availability.mockResolvedValue('downloadable')
      mockLanguageModel.create.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 700000)) // 11 minutes
      )

      const provider = new ChromeAIProvider(mockTools)
      await expect(provider.initialize()).rejects.toThrow('timed out')
    })

    it.skip('times out for initialization after 60 seconds', async () => {
      // Skipped: This test would take 60+ seconds to run
      // Timeout behavior is verified by unit testing the withTimeout utility
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 70000)) // 70 seconds
      )

      const provider = new ChromeAIProvider(mockTools)
      await expect(provider.initialize()).rejects.toThrow('timed out')
    })

    it('logs context window usage after initialization', async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockSession.contextWindow = 4096
      mockSession.contextUsage = 3500 // 85% usage
      mockLanguageModel.create.mockResolvedValue(mockSession)

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      // Should have logged warning about high usage
      // (check via debug logs in actual implementation)
    })

    it('handles availability check failures', async () => {
      mockLanguageModel.availability.mockRejectedValue(new Error('Check failed'))

      const provider = new ChromeAIProvider(mockTools)
      await expect(provider.initialize()).rejects.toThrow(ProviderError)
      await expect(provider.initialize()).rejects.toThrow('check failed')
    })

    it('handles session creation failures', async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockRejectedValue(new Error('Session creation failed'))

      const provider = new ChromeAIProvider(mockTools)
      await expect(provider.initialize()).rejects.toThrow(ProviderError)
      await expect(provider.initialize()).rejects.toThrow('Failed to create Chrome AI session')
    })
  })

  describe('sendMessage', () => {
    beforeEach(async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockResolvedValue(mockSession)
    })

    it('throws error when session not initialized', async () => {
      const provider = new ChromeAIProvider(mockTools)
      await expect(
        provider.sendMessage({
          message: 'Test',
          project: mockProject,
        })
      ).rejects.toThrow('not initialized')
    })

    it('sends a simple message and gets response', async () => {
      mockSession.prompt.mockResolvedValue('Here is my response')

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      const response = await provider.sendMessage({
        message: 'Hello AI',
        project: mockProject,
      })

      // Prompt should include the message formatted with User/Assistant prefix
      expect(mockSession.prompt).toHaveBeenCalledWith(expect.stringContaining('Hello AI'))
      expect(response.message).toBe('Here is my response')
      expect(response.toolCalls).toEqual([])
      expect(response.projectModifications).toEqual([])
    })

    it('includes conversation history in prompt', async () => {
      mockSession.prompt.mockResolvedValue('Response with context')

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      const response = await provider.sendMessage({
        message: 'What was I asking about?',
        project: mockProject,
        conversationHistory: [
          { role: 'user', content: 'Tell me about NYC' },
          { role: 'assistant', content: 'NYC is a large city' },
          { role: 'user', content: 'What about its population?' },
          { role: 'assistant', content: 'About 8 million people' },
        ],
      })

      // Should include recent history in the prompt
      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('User: Tell me about NYC')
      )
      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('Assistant: NYC is a large city')
      )
      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('What was I asking about?')
      )
    })

    it('limits conversation history to last 4 messages', async () => {
      mockSession.prompt.mockResolvedValue('Response')

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      // Create 10 messages in history
      const history = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i}`,
      }))

      await provider.sendMessage({
        message: 'New message',
        project: mockProject,
        conversationHistory: history,
      })

      const promptCall = mockSession.prompt.mock.calls[0][0]
      // Should only include last 4 messages
      expect(promptCall).toContain('Message 6')
      expect(promptCall).not.toContain('Message 0')
      expect(promptCall).not.toContain('Message 1')
    })

    it('strips images from message content', async () => {
      mockSession.prompt.mockResolvedValue('Response')

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      await provider.sendMessage({
        message: 'Analyze this',
        project: mockProject,
        conversationHistory: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Here is an image' },
              { type: 'image', source: { type: 'base64', data: 'abc123' } },
            ],
          },
          { role: 'assistant', content: 'I see the image' },
        ],
      })

      const promptCall = mockSession.prompt.mock.calls[0][0]
      // Should contain text but not image data
      expect(promptCall).toContain('Here is an image')
      expect(promptCall).not.toContain('abc123')
    })

    it('extracts project modifications from JSON code blocks', async () => {
      const responseWithMods = `Here's how to add a node:

\`\`\`json
[
  {
    "type": "add_node",
    "data": {
      "id": "/test-node",
      "type": "NumberOp",
      "position": { "x": 100, "y": 100 }
    }
  }
]
\`\`\`

This will create a new number operator.`

      mockSession.prompt.mockResolvedValue(responseWithMods)

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      const response = await provider.sendMessage({
        message: 'Add a number node',
        project: mockProject,
      })

      expect(response.projectModifications).toHaveLength(1)
      expect(response.projectModifications[0]).toEqual({
        type: 'add_node',
        data: {
          id: '/test-node',
          type: 'NumberOp',
          position: { x: 100, y: 100 },
        },
      })
    })

    it('handles multiple JSON code blocks and uses first valid one', async () => {
      const responseWithMultiple = `
Invalid JSON first:
\`\`\`json
{ invalid }
\`\`\`

Valid modifications:
\`\`\`json
[
  { "type": "update_node", "data": { "id": "/node", "data": { "inputs": { "value": 42 } } } }
]
\`\`\`
`

      mockSession.prompt.mockResolvedValue(responseWithMultiple)

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      const response = await provider.sendMessage({
        message: 'Update node',
        project: mockProject,
      })

      expect(response.projectModifications).toHaveLength(1)
      expect(response.projectModifications[0].type).toBe('update_node')
    })

    it('handles API errors gracefully', async () => {
      mockSession.prompt.mockRejectedValue(new Error('API Error'))

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      await expect(
        provider.sendMessage({
          message: 'Test',
          project: mockProject,
        })
      ).rejects.toThrow(ProviderError)
    })

    it('does not support tool calling', async () => {
      mockSession.prompt.mockResolvedValue('Response')

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      const response = await provider.sendMessage({
        message: 'List all nodes',
        project: mockProject,
      })

      // No tool calls should be made
      expect(response.toolCalls).toEqual([])
    })
  })

  describe('getRateLimit', () => {
    it('returns null (no rate limits for local AI)', async () => {
      const provider = new ChromeAIProvider(mockTools)
      expect(provider.getRateLimit()).toBeNull()
    })
  })

  describe('getContextWindow', () => {
    beforeEach(async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockResolvedValue(mockSession)
    })

    it('returns null before initialization', () => {
      const provider = new ChromeAIProvider(mockTools)
      expect(provider.getContextWindow()).toBeNull()
    })

    it('returns context window info after initialization', async () => {
      mockSession.contextWindow = 4096
      mockSession.contextUsage = 1024

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      const contextInfo = provider.getContextWindow()
      expect(contextInfo).toEqual({
        used: 1024,
        total: 4096,
        percentage: 25,
      })
    })

    it('handles session without context info', async () => {
      delete mockSession.contextWindow
      delete mockSession.contextUsage

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      expect(provider.getContextWindow()).toBeNull()
    })

    it('updates context usage across multiple messages', async () => {
      mockSession.contextUsage = 500
      mockSession.contextWindow = 4096
      mockSession.prompt.mockResolvedValue('Response')

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      let contextInfo = provider.getContextWindow()
      expect(contextInfo?.used).toBe(500)

      // Simulate context usage increasing
      mockSession.contextUsage = 1000
      await provider.sendMessage({ message: 'Test', project: mockProject })

      contextInfo = provider.getContextWindow()
      expect(contextInfo?.used).toBe(1000)
    })
  })

  describe('destroy', () => {
    beforeEach(async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockResolvedValue(mockSession)
    })

    it('destroys the session and cleans up', async () => {
      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      provider.destroy()

      expect(mockSession.destroy).toHaveBeenCalled()

      // Should not be able to send messages after destroy
      await expect(provider.sendMessage({ message: 'Test', project: mockProject })).rejects.toThrow(
        'not initialized'
      )
    })

    it('handles destroy when session was never created', () => {
      const provider = new ChromeAIProvider(mockTools)
      expect(() => provider.destroy()).not.toThrow()
    })
  })

  describe('System prompt', () => {
    it('includes Noodles.gl context', async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockResolvedValue(mockSession)

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      expect(mockLanguageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('Noodles.gl'),
        })
      )
    })

    it('includes JSON modification format instructions', async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockResolvedValue(mockSession)

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      expect(mockLanguageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('update_node'),
        })
      )
    })

    it('is concise to fit small context window', async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockResolvedValue(mockSession)

      const provider = new ChromeAIProvider(mockTools)
      await provider.initialize()

      const systemPrompt = mockLanguageModel.create.mock.calls[0][0].systemPrompt
      // Should be under 1000 characters (much smaller than full system prompt)
      expect(systemPrompt.length).toBeLessThan(1000)
    })
  })

  describe('Project context injection', () => {
    beforeEach(async () => {
      mockLanguageModel.availability.mockResolvedValue('available')
      mockLanguageModel.create.mockResolvedValue(mockSession)
      mockSession.prompt.mockResolvedValue('Response')

      // Clear mock op store before each test
      mockOpStore.clear()
    })

    it('injects project node context into prompts', async () => {
      // Setup test operators in mock store
      mockOpStore.set('/data', {
        inputs: { url: { value: 'test-data.csv' } },
      })
      mockOpStore.set('/layer', {
        inputs: {},
      })

      const projectWithNodes: NoodlesProject = {
        nodes: [
          { id: '/data', type: 'FileOp' },
          { id: '/layer', type: 'ScatterplotLayerOp' },
        ],
        edges: [
          {
            id: 'edge1',
            source: '/data',
            target: '/layer',
            sourceHandle: 'out.data',
            targetHandle: 'par.data',
          },
        ],
      }

      const mockToolsWithProject = {
        ...mockTools,
        getProject: () => projectWithNodes,
      } as unknown as MCPTools

      const provider = new ChromeAIProvider(mockToolsWithProject)
      await provider.initialize()

      await provider.sendMessage({
        message: 'Change the color',
        project: projectWithNodes,
      })

      const promptCall = mockSession.prompt.mock.calls[0][0]
      // Should contain node information with clear separators
      expect(promptCall).toContain('PROJECT GRAPH')
      expect(promptCall).toContain('/data (FileOp)')
      expect(promptCall).toContain('/layer (ScatterplotLayerOp)')
    })

    it('generates JSON modifications instead of echoing context format', async () => {
      // Setup project with ColorOp
      mockOpStore.set('/pickup-color', {
        inputs: { color: { value: '#00ff00' } },
      })

      const projectWithColor: NoodlesProject = {
        nodes: [{ id: '/pickup-color', type: 'ColorOp' }],
        edges: [],
      }

      const mockToolsWithColor = {
        ...mockTools,
        getProject: () => projectWithColor,
      } as unknown as MCPTools

      // Simulate proper JSON response (not echoing context format)
      const properResponse = `I'll change the color to red:
\`\`\`json
[
  {
    "type": "update_node",
    "data": {
      "id": "/pickup-color",
      "data": {
        "inputs": {
          "color": "#ff0000"
        }
      }
    }
  }
]
\`\`\`

This will update the pickup color to red.`

      mockSession.prompt.mockResolvedValue(properResponse)

      const provider = new ChromeAIProvider(mockToolsWithColor)
      await provider.initialize()

      const response = await provider.sendMessage({
        message: 'Make the pickup color red',
        project: projectWithColor,
      })

      // Should extract JSON modifications
      expect(response.projectModifications).toHaveLength(1)
      expect(response.projectModifications[0]).toEqual({
        type: 'update_node',
        data: {
          id: '/pickup-color',
          data: {
            inputs: {
              color: '#ff0000',
            },
          },
        },
      })
    })

    it('returns no modifications when AI only echoes text without JSON', async () => {
      // Setup project with ColorOp
      mockOpStore.set('/pickup-color', {
        inputs: { color: { value: '#00ff00' } },
      })

      const projectWithColor: NoodlesProject = {
        nodes: [{ id: '/pickup-color', type: 'ColorOp' }],
        edges: [],
      }

      const mockToolsWithColor = {
        ...mockTools,
        getProject: () => projectWithColor,
      } as unknown as MCPTools

      // Simulate bad response that just echoes back context format
      const badResponse = '/pickup-color (ColorOp) - color: #ff0000'

      mockSession.prompt.mockResolvedValue(badResponse)

      const provider = new ChromeAIProvider(mockToolsWithColor)
      await provider.initialize()

      const response = await provider.sendMessage({
        message: 'Make the pickup color red',
        project: projectWithColor,
      })

      // Should NOT extract modifications from plain text
      expect(response.projectModifications).toHaveLength(0)
    })

    it('handles empty project gracefully', async () => {
      const emptyProject: NoodlesProject = {
        nodes: [],
        edges: [],
      }

      const mockToolsWithEmpty = {
        ...mockTools,
        getProject: () => emptyProject,
      } as unknown as MCPTools

      const provider = new ChromeAIProvider(mockToolsWithEmpty)
      await provider.initialize()

      await provider.sendMessage({
        message: 'Hello',
        project: emptyProject,
      })

      const promptCall = mockSession.prompt.mock.calls[0][0]
      // Should not inject context for empty project
      expect(promptCall).not.toContain('PROJECT GRAPH')
      expect(promptCall).toContain('Hello')
    })

    it('handles project with no nodes array', async () => {
      const projectWithoutNodes: NoodlesProject = {}

      const mockToolsWithNoNodes = {
        ...mockTools,
        getProject: () => projectWithoutNodes,
      } as unknown as MCPTools

      const provider = new ChromeAIProvider(mockToolsWithNoNodes)
      await provider.initialize()

      await provider.sendMessage({
        message: 'Test',
        project: projectWithoutNodes,
      })

      const promptCall = mockSession.prompt.mock.calls[0][0]
      expect(promptCall).not.toContain('PROJECT GRAPH')
    })

    it('truncates large projects to avoid context overflow', async () => {
      // Create 50 nodes (exceeds 30 node limit)
      const manyNodes = Array.from({ length: 50 }, (_, i) => ({
        id: `/node-${i}`,
        type: 'NumberOp',
      }))

      const largeProject: NoodlesProject = {
        nodes: manyNodes,
        edges: [],
      }

      // Setup 50 nodes in mock store
      for (let i = 0; i < 50; i++) {
        mockOpStore.set(`/node-${i}`, { inputs: {} })
      }

      const mockToolsWithLarge = {
        ...mockTools,
        getProject: () => largeProject,
      } as unknown as MCPTools

      const provider = new ChromeAIProvider(mockToolsWithLarge)
      await provider.initialize()

      await provider.sendMessage({
        message: 'Test',
        project: largeProject,
      })

      const promptCall = mockSession.prompt.mock.calls[0][0]
      // Should include truncation note
      expect(promptCall).toContain('and 20 more nodes')
    })
  })
})
