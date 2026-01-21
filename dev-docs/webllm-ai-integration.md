# WebLLM AI Integration

**Last Updated:** 2025-11-10
**Related Spec:** [/dev-docs/specs/webllm-ai-chat.md](specs/webllm-ai-chat.md)

This document provides technical details for developers working on the WebLLM-based AI assistant in Noodles.gl.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Details](#component-details)
3. [Tool System](#tool-system)
4. [RAG Implementation](#rag-implementation)
5. [Web Search](#web-search)
6. [Provider Abstraction](#provider-abstraction)
7. [Testing](#testing)
8. [Performance Optimization](#performance-optimization)
9. [Debugging](#debugging)
10. [Contributing](#contributing)

---

## Architecture Overview

The WebLLM AI integration replaces the previous Claude-only implementation with a dual-provider system that supports both local (WebLLM) and remote (Anthropic) inference.

### High-Level Flow

```
User Message
    ↓
AIController (routes to provider)
    ↓
WebLLMProvider or AnthropicProvider
    ↓
LangChain Agent Executor
    ↓
Tool Registry (MCP format)
    ↓
Tool Execution (MCPTools)
    ↓
Stream Response to UI
```

### Key Design Principles

1. **Provider Abstraction** - Both local and remote use the same interface
2. **MCP Protocol** - All tools use Model Context Protocol (OpenAI function calling format)
3. **Streaming First** - Responses stream token-by-token for better UX
4. **Fail Gracefully** - Errors don't crash the app, they're shown to the user
5. **Progressive Enhancement** - Works without WebGPU (falls back to remote)

---

## Component Details

### AIController (`ai-controller.ts`)

**Responsibility:** Route messages to the appropriate provider and manage conversation state.

**Key Methods:**

```typescript
class AIController {
  constructor(config: AIControllerConfig)

  // Initialize the controller and load the active provider
  async initialize(): Promise<void>

  // Send a user message and stream the response
  async sendMessage(message: string): AsyncGenerator<string>

  // Switch between local and remote providers
  async switchProvider(provider: 'local' | 'remote', config?: ProviderConfig): Promise<void>

  // Get current conversation history
  getHistory(): Message[]

  // Clear conversation history
  clearHistory(): void

  // Get provider stats (tokens/sec, memory usage)
  getStats(): ProviderStats
}
```

**Usage:**

```typescript
import { AIController } from './ai-controller'

const controller = new AIController({
  provider: 'local',
  localModel: 'phi-3-mini',
  historyLength: 7
})

await controller.initialize()

// Send message and stream response
const stream = controller.sendMessage('How do I load CSV files?')
for await (const token of stream) {
  console.log(token)
}
```

**State Management:**

- Conversation history stored in memory (array of `Message` objects)
- History length configurable (default 7 messages = 3.5 exchanges)
- Old messages pruned automatically when limit exceeded
- Provider state persisted to localStorage

### WebLLMProvider (`webllm-provider.ts`)

**Responsibility:** Load and run WebLLM models, generate completions with tool calling.

**Key Methods:**

```typescript
class WebLLMProvider implements AIProvider {
  constructor(config: WebLLMConfig)

  // Load model with progress callback
  async initialize(onProgress?: (progress: number, status: string) => void): Promise<void>

  // Generate completion with streaming
  async generateCompletion(messages: Message[], tools: Tool[]): AsyncGenerator<string>

  // Check if WebGPU is available
  isAvailable(): boolean

  // Get performance stats
  getStats(): { tokensPerSecond: number, memoryUsage: number }

  // Unload model from memory
  async unload(): Promise<void>
}
```

**Implementation Notes:**

- Uses `@mlc-ai/web-llm` for model loading and inference
- Model files cached in IndexedDB (persistent across sessions)
- Streaming implemented via async generator pattern
- Tool calls detected by parsing model output for function call JSON
- Errors handled gracefully with user-friendly messages

**Example:**

```typescript
import { WebLLMProvider } from './webllm-provider'

const provider = new WebLLMProvider({
  model: 'phi-3-mini',
  temperature: 0.7
})

// Load with progress tracking
await provider.initialize((progress, status) => {
  console.log(`${status}: ${progress}%`)
})

// Generate completion
const messages = [{ role: 'user', content: 'Hello!' }]
const tools = [/* tool definitions */]

for await (const token of provider.generateCompletion(messages, tools)) {
  process.stdout.write(token)
}
```

### AnthropicProvider (`anthropic-provider.ts`)

**Responsibility:** Wrapper around existing Claude client to match provider interface.

**Refactored from:** `claude-client.ts`

**Changes:**
- Implement `AIProvider` interface
- Expose streaming via async generator
- Normalize tool format to MCP
- Keep existing optimizations (prompt caching, history limiting)

**No changes to:**
- API client logic
- Token optimization strategies
- Error handling
- Message formatting

### LangChain Agent (`langchain-agent.ts`)

**Responsibility:** Orchestrate multi-turn tool calling loop using LangChain.js.

**Key Concepts:**

- **Agent Executor** - Coordinates tool calls and model responses
- **Tool Registry** - Typed tool definitions with validation
- **Prompt Template** - Injects system prompt and conversation history
- **Memory** - Tracks conversation state across turns

**Implementation:**

```typescript
import { initializeAgentExecutorWithOptions } from 'langchain/agents'
import { ChatWebLLM } from '@langchain/community/chat_models/webllm'
import { DynamicStructuredTool } from '@langchain/core/tools'

export class LangChainAgent {
  private executor: AgentExecutor
  private tools: DynamicStructuredTool[]

  constructor(provider: AIProvider, tools: Tool[]) {
    // Convert MCP tools to LangChain format
    this.tools = tools.map(convertToolToLangChain)

    // Create agent executor
    this.executor = await initializeAgentExecutorWithOptions(
      this.tools,
      provider,
      {
        agentType: 'openai-functions',
        verbose: false,
        maxIterations: 5
      }
    )
  }

  async run(message: string): AsyncGenerator<string> {
    const result = await this.executor.call({ input: message })
    yield result.output
  }
}
```

**Tool Calling Flow:**

1. User sends message → Agent receives input
2. Agent sends message to model with tool definitions
3. Model responds with tool call (JSON)
4. Agent parses tool call and invokes function
5. Agent sends tool result back to model
6. Model generates final response
7. Stream response to user

**Multi-Turn Example:**

```
User: "Show me bike share stations in NYC"

Turn 1:
  Model → "I'll search for NYC bike share data"
  Tool Call → search_web("NYC bike share station data")
  Tool Result → [URL to Citi Bike API]

Turn 2:
  Model → "I found the data, creating visualization..."
  Tool Call → apply_modifications([FileOp, ScatterplotLayerOp])
  Tool Result → "Successfully added 2 nodes"

Turn 3:
  Model → "Done! I've created a scatterplot of 1,500 stations."
  (Final response streamed to user)
```

---

## Tool System

### Model Context Protocol (MCP)

All tools use the **MCP format**, which is the OpenAI function calling standard:

```typescript
interface MCPTool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object'
      description: string
      default?: any
      enum?: any[]
    }>
    required: string[]
  }
}
```

### Tool Registry (`mcp-tools.ts`)

**Refactored from:** `claude-client.ts` and existing tool implementations

**Structure:**

```typescript
import { z } from 'zod'

export interface Tool {
  name: string
  description: string
  schema: z.ZodObject<any>  // Zod schema for validation
  execute: (args: any) => Promise<any>
}

export const tools: Tool[] = [
  {
    name: 'capture_visualization',
    description: 'Capture a screenshot of the visualization',
    schema: z.object({
      maxWidth: z.number().default(1024),
      quality: z.number().min(0).max(1).default(0.5)
    }),
    execute: async ({ maxWidth, quality }) => {
      // Existing implementation from MCPTools
      return { image: '...', width: 1024, height: 768 }
    }
  },
  // ... all other tools
]
```

**Converting to LangChain:**

```typescript
import { DynamicStructuredTool } from '@langchain/core/tools'
import { zodToJsonSchema } from 'zod-to-json-schema'

export function convertToolToLangChain(tool: Tool): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: zodToJsonSchema(tool.schema),
    func: async (args) => {
      const validated = tool.schema.parse(args)
      return await tool.execute(validated)
    }
  })
}

export const langchainTools = tools.map(convertToolToLangChain)
```

### Adding New Tools

**Step 1:** Define the tool in `mcp-tools.ts`

```typescript
{
  name: 'my_new_tool',
  description: 'Does something useful',
  schema: z.object({
    param1: z.string().describe('First parameter'),
    param2: z.number().optional().describe('Optional parameter')
  }),
  execute: async ({ param1, param2 }) => {
    // Implementation
    return { result: 'success' }
  }
}
```

**Step 2:** Add to tool registry (automatic if defined in `tools` array)

**Step 3:** Test with both providers

```typescript
// Test with WebLLM
const webllm = new WebLLMProvider({ model: 'phi-3-mini' })
await webllm.initialize()
const result = await tools.find(t => t.name === 'my_new_tool').execute({ param1: 'test' })
console.assert(result.result === 'success')

// Test with Anthropic
const anthropic = new AnthropicProvider({ apiKey: 'sk-...' })
const result2 = await tools.find(t => t.name === 'my_new_tool').execute({ param1: 'test' })
console.assert(result2.result === 'success')
```

**Step 4:** Write unit tests

```typescript
// mcp-tools.test.ts
describe('my_new_tool', () => {
  it('should execute successfully', async () => {
    const tool = tools.find(t => t.name === 'my_new_tool')
    const result = await tool.execute({ param1: 'test' })
    expect(result.result).toBe('success')
  })

  it('should validate parameters', async () => {
    const tool = tools.find(t => t.name === 'my_new_tool')
    await expect(tool.execute({ param1: 123 })).rejects.toThrow()  // param1 must be string
  })
})
```

### Tool Execution Context

Tools have access to the current project state via a shared context object:

```typescript
interface ToolContext {
  project: Project | null
  opMap: Map<string, Operator>
  applyModifications: (mods: Modification[]) => Promise<ModificationResult>
}

let toolContext: ToolContext

export function setToolContext(context: ToolContext) {
  toolContext = context
}

// In tool execution
execute: async (args) => {
  const { project, opMap, applyModifications } = toolContext
  // Use context
}
```

**Initialized in:** `chat-panel.tsx`

```typescript
useEffect(() => {
  setToolContext({
    project,
    opMap: store.opMap,
    applyModifications
  })
}, [project, applyModifications])
```

---

## RAG Implementation

### Overview

RAG (Retrieval-Augmented Generation) enables the AI to search and retrieve relevant documentation on-demand.

**Components:**
1. **Embedding Model** - `Xenova/all-MiniLM-L6-v2` via transformers.js
2. **Vector Database** - `voy-search` for similarity search
3. **Document Corpus** - Docs, operator schemas, examples
4. **Query Pipeline** - Embed query → Search voy → Format results

### RagService (`rag-service.ts`)

**Responsibility:** Embed documents, index in voy, and query for relevant results.

**Implementation:**

```typescript
import { pipeline } from '@xenova/transformers'
import { Voy } from 'voy-search'

export class RagService {
  private embedder: any
  private index: Voy
  private initialized = false

  async initialize() {
    if (this.initialized) return

    // Load embedding model (lazy)
    this.embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    )

    // Create voy index
    this.index = new Voy({
      embeddings: {
        size: 384,
        normalize: true
      }
    })

    // Load pre-generated embeddings from IndexedDB or fetch from server
    await this.loadEmbeddings()

    this.initialized = true
  }

  async search(query: string, limit = 5): Promise<RagResult[]> {
    // Embed query
    const queryEmbedding = await this.embedQuery(query)

    // Search voy
    const results = await this.index.search(queryEmbedding, {
      numResults: limit
    })

    // Format results
    return results.map(r => ({
      content: r.content,
      metadata: {
        source: r.metadata.file,
        heading: r.metadata.heading,
        score: r.score
      }
    }))
  }

  private async embedQuery(text: string): Promise<Float32Array> {
    const output = await this.embedder(text, {
      pooling: 'mean',
      normalize: true
    })
    return output.data
  }

  private async loadEmbeddings() {
    // Check IndexedDB cache
    const cached = await this.loadFromCache()
    if (cached) {
      this.index = cached
      return
    }

    // Fetch from server
    const response = await fetch('/noodles/rag-index.bin')
    const buffer = await response.arrayBuffer()
    const embeddings = this.deserializeEmbeddings(buffer)

    // Add to index
    for (const emb of embeddings) {
      await this.index.add({
        id: emb.id,
        embeddings: emb.embedding,
        content: emb.content,
        metadata: emb.metadata
      })
    }

    // Cache in IndexedDB
    await this.saveToCache(this.index)
  }
}
```

**Usage:**

```typescript
import { RagService } from './rag-service'

const rag = new RagService()
await rag.initialize()

const results = await rag.search('how to load CSV files', 5)
console.log(results)
// [
//   {
//     content: '## FileOp\nLoads data from files...',
//     metadata: { source: 'docs/users/operators.md', heading: 'FileOp', score: 0.87 }
//   },
//   ...
// ]
```

### Building Embeddings (`scripts/generate-rag-embeddings.ts`)

**Run during build:**

```bash
yarn generate:rag
```

**Script outline:**

```typescript
import { pipeline } from '@xenova/transformers'
import { glob } from 'glob'
import { readFile, writeFile } from 'fs/promises'

async function generateRagEmbeddings() {
  // 1. Load embedding model
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')

  // 2. Glob all docs
  const files = await glob('docs/**/*.md')
  files.push('AGENTS.md', 'README.md')

  // 3. Process each file
  const chunks = []
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const fileChunks = chunkMarkdown(content, { maxTokens: 512, overlap: 50 })

    for (const chunk of fileChunks) {
      const embedding = await embedder(chunk.content, {
        pooling: 'mean',
        normalize: true
      })

      chunks.push({
        id: `${file}#${chunk.heading}`,
        embedding: Array.from(embedding.data),
        content: chunk.content,
        metadata: {
          source: 'docs',
          file,
          heading: chunk.heading
        }
      })
    }
  }

  // 4. Serialize to binary format
  const buffer = serializeEmbeddings(chunks)

  // 5. Save to public folder
  await writeFile('noodles-editor/public/noodles/rag-index.bin', buffer)

  console.log(`Generated ${chunks.length} embeddings (${buffer.length} bytes)`)
}

// Helper: Chunk markdown by headings
function chunkMarkdown(content: string, options: { maxTokens: number, overlap: number }) {
  // Split by ## headings
  // Limit to maxTokens per chunk
  // Add overlap tokens from previous chunk
  // Return array of { content, heading } objects
}

// Helper: Serialize embeddings to binary format
function serializeEmbeddings(chunks: any[]): Buffer {
  // Pack embeddings into efficient binary format
  // Include metadata and content
  // Return buffer
}
```

**Add to CI:**

```yaml
# .github/workflows/deploy.yml
- name: Generate RAG embeddings
  run: yarn generate:rag

- name: Build app
  run: yarn build:all
```

### Tool Implementation

**`search_documentation` tool:**

```typescript
{
  name: 'search_documentation',
  description: 'Search Noodles.gl documentation for operators, APIs, and workflows',
  schema: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(5).describe('Max results')
  }),
  execute: async ({ query, limit }) => {
    const results = await ragService.search(query, limit)
    return {
      query,
      results: results.map(r => ({
        content: r.content,
        source: r.metadata.source,
        heading: r.metadata.heading,
        relevance: r.metadata.score
      }))
    }
  }
}
```

---

## Web Search

### Overview

Web search enables the AI to find external information (data sources, examples, tutorials) using DuckDuckGo.

**Components:**
1. **DuckDuckGo API** - Free search API
2. **Text Extraction** - Parse HTML to plain text
3. **Embedding & Caching** - Embed results and cache in voy
4. **Rate Limiting** - Prevent abuse

### WebSearchService (`web-search-service.ts`)

**Responsibility:** Query DuckDuckGo, extract text, embed results, cache in voy.

**Implementation:**

```typescript
import { createHash } from 'crypto'

export class WebSearchService {
  private cache: Voy
  private embedder: any
  private searchCount = 0
  private searchHistory = new Map<string, number>()

  async initialize() {
    // Load embedding model (shared with RAG)
    this.embedder = await getEmbedder()

    // Create cache index
    this.cache = new Voy({
      embeddings: { size: 384, normalize: true }
    })
  }

  async search(query: string): Promise<SearchResult[]> {
    // Check rate limit
    if (this.searchCount >= 10) {
      throw new Error('Search limit reached (10 per session)')
    }

    // Check debounce
    const lastSearch = this.searchHistory.get(query)
    if (lastSearch && Date.now() - lastSearch < 60000) {
      throw new Error('Please wait before searching again')
    }

    // Check cache
    const cacheKey = this.hashQuery(query)
    const cached = await this.getFromCache(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.results
    }

    // Fetch from DuckDuckGo
    const response = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
    )
    const data = await response.json()

    // Process results
    const results = await Promise.all(
      data.RelatedTopics.slice(0, 5).map(async (topic: any) => {
        try {
          const html = await fetch(topic.FirstURL).then(r => r.text())
          const text = this.extractText(html)
          const embedding = await this.embedText(text)

          return {
            title: topic.Text.split(' - ')[0],
            url: topic.FirstURL,
            snippet: text.slice(0, 500),
            embedding
          }
        } catch (err) {
          console.warn('Failed to fetch result:', topic.FirstURL, err)
          return null
        }
      })
    )

    const validResults = results.filter(r => r !== null)

    // Cache results
    await this.saveToCache(cacheKey, validResults)

    // Update tracking
    this.searchCount++
    this.searchHistory.set(query, Date.now())

    return validResults
  }

  private hashQuery(query: string): string {
    return createHash('sha256').update(query).digest('hex')
  }

  private extractText(html: string): string {
    // Remove scripts and styles
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ')

    // Decode entities
    text = text.replace(/&nbsp;/g, ' ')
    text = text.replace(/&amp;/g, '&')
    text = text.replace(/&lt;/g, '<')
    text = text.replace(/&gt;/g, '>')

    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim()

    return text
  }

  private async embedText(text: string): Promise<Float32Array> {
    const output = await this.embedder(text, {
      pooling: 'mean',
      normalize: true
    })
    return output.data
  }

  private async saveToCache(key: string, results: SearchResult[]) {
    await this.cache.add({
      id: key,
      embeddings: results[0].embedding,
      content: JSON.stringify(results),
      metadata: {
        type: 'search_cache',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000  // 24 hours
      }
    })
  }

  private async getFromCache(key: string): Promise<{ results: SearchResult[], expiresAt: number } | null> {
    const result = await this.cache.get(key)
    if (!result) return null

    return {
      results: JSON.parse(result.content),
      expiresAt: result.metadata.expiresAt
    }
  }
}
```

**Usage:**

```typescript
import { WebSearchService } from './web-search-service'

const search = new WebSearchService()
await search.initialize()

const results = await search.search('NYC bike share data API')
console.log(results)
// [
//   {
//     title: 'NYC Citi Bike System Data',
//     url: 'https://citibikenyc.com/system-data',
//     snippet: 'Real-time station data available at...'
//   },
//   ...
// ]
```

### Tool Implementation

**`search_web` tool:**

```typescript
{
  name: 'search_web',
  description: 'Search the web for information using DuckDuckGo',
  schema: z.object({
    query: z.string().describe('Search query')
  }),
  execute: async ({ query }) => {
    const results = await webSearchService.search(query)
    return {
      query,
      results: results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet
      }))
    }
  }
}
```

---

## Provider Abstraction

### AIProvider Interface

**Purpose:** Allow swapping between WebLLM and Anthropic without changing calling code.

```typescript
export interface AIProvider {
  // Initialize the provider (load model, validate API key, etc.)
  initialize(onProgress?: (progress: number, status: string) => void): Promise<void>

  // Generate a completion with streaming
  generateCompletion(
    messages: Message[],
    tools: Tool[]
  ): AsyncGenerator<string>

  // Check if provider is available (WebGPU support, API key valid, etc.)
  isAvailable(): boolean

  // Get performance stats
  getStats(): ProviderStats

  // Clean up resources
  dispose(): Promise<void>
}

export interface ProviderStats {
  tokensPerSecond: number
  memoryUsage: number
  responseTime: number
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text' | 'image', [key: string]: any }>
}
```

### Implementing a New Provider

**Step 1:** Create provider class

```typescript
// my-provider.ts
import { AIProvider } from './provider-interface'

export class MyProvider implements AIProvider {
  constructor(config: MyProviderConfig) {
    // Initialize with config
  }

  async initialize() {
    // Load model or validate credentials
  }

  async *generateCompletion(messages, tools) {
    // Generate completion and yield tokens
    for (const token of response) {
      yield token
    }
  }

  isAvailable() {
    // Check if provider can be used
    return true
  }

  getStats() {
    return {
      tokensPerSecond: 20,
      memoryUsage: 2048,
      responseTime: 3000
    }
  }

  async dispose() {
    // Clean up resources
  }
}
```

**Step 2:** Register in AIController

```typescript
// ai-controller.ts
import { MyProvider } from './my-provider'

class AIController {
  private async loadProvider(type: string, config: any): Promise<AIProvider> {
    switch (type) {
      case 'local':
        return new WebLLMProvider(config)
      case 'remote':
        return new AnthropicProvider(config)
      case 'my-provider':
        return new MyProvider(config)
      default:
        throw new Error(`Unknown provider: ${type}`)
    }
  }
}
```

**Step 3:** Add to settings UI

```typescript
// chat-panel.tsx
<select value={provider} onChange={e => setProvider(e.target.value)}>
  <option value="local">Local (WebLLM)</option>
  <option value="remote">Remote (Anthropic)</option>
  <option value="my-provider">My Provider</option>
</select>
```

---

## Testing

### Unit Tests

**Test each component in isolation:**

```typescript
// webllm-provider.test.ts
import { WebLLMProvider } from './webllm-provider'

describe('WebLLMProvider', () => {
  let provider: WebLLMProvider

  beforeEach(() => {
    provider = new WebLLMProvider({ model: 'phi-3-mini' })
  })

  it('should initialize successfully', async () => {
    await provider.initialize()
    expect(provider.isAvailable()).toBe(true)
  })

  it('should generate completions', async () => {
    await provider.initialize()
    const messages = [{ role: 'user', content: 'Hello' }]
    const stream = provider.generateCompletion(messages, [])

    let response = ''
    for await (const token of stream) {
      response += token
    }

    expect(response.length).toBeGreaterThan(0)
  })

  it('should handle tool calls', async () => {
    await provider.initialize()
    const messages = [{ role: 'user', content: 'Capture a screenshot' }]
    const tools = [/* tool definitions */]

    const stream = provider.generateCompletion(messages, tools)
    // ... assert tool call is made
  })
})
```

### Integration Tests

**Test component interactions:**

```typescript
// ai-controller.integration.test.ts
import { AIController } from './ai-controller'
import { tools } from './mcp-tools'

describe('AIController Integration', () => {
  it('should switch providers mid-conversation', async () => {
    const controller = new AIController({ provider: 'local' })
    await controller.initialize()

    // Send message with local provider
    await controller.sendMessage('Hello')
    expect(controller.getHistory()).toHaveLength(2)

    // Switch to remote
    await controller.switchProvider('remote', { apiKey: 'test-key' })

    // Continue conversation
    await controller.sendMessage('How are you?')
    expect(controller.getHistory()).toHaveLength(4)
  })

  it('should execute tools correctly', async () => {
    const controller = new AIController({ provider: 'local' })
    await controller.initialize()

    // Mock tool execution
    const captureToolSpy = jest.spyOn(tools[0], 'execute')

    await controller.sendMessage('Capture a screenshot')

    expect(captureToolSpy).toHaveBeenCalled()
  })
})
```

### E2E Tests

**Test full user workflows:**

```typescript
// ai-chat.e2e.test.ts
import { test, expect } from '@playwright/test'

test('should create visualization via chat', async ({ page }) => {
  await page.goto('http://localhost:5173/')

  // Open chat
  await page.click('[aria-label="AI Assistant"]')

  // Wait for model ready
  await page.waitForSelector('text=Model ready', { timeout: 60000 })

  // Send message
  await page.fill('textarea[placeholder="Ask me anything..."]', 'Create a scatterplot at [0,0]')
  await page.click('button:has-text("Send")')

  // Wait for response
  await page.waitForSelector('text=I\'ve created')

  // Verify node exists
  const node = await page.locator('[data-id*="ScatterplotLayerOp"]')
  await expect(node).toBeVisible()
})
```

---

## Performance Optimization

### Model Caching

**Cache models in IndexedDB:**

```typescript
async function cacheModel(modelUrl: string, modelData: ArrayBuffer) {
  const db = await openDB('webllm-cache', 1, {
    upgrade(db) {
      db.createObjectStore('models')
    }
  })

  await db.put('models', modelData, modelUrl)
}

async function loadCachedModel(modelUrl: string): Promise<ArrayBuffer | null> {
  const db = await openDB('webllm-cache', 1)
  return await db.get('models', modelUrl)
}
```

### Lazy Loading

**Load embedding model only when needed:**

```typescript
class RagService {
  private embedder: any = null

  private async getEmbedder() {
    if (!this.embedder) {
      this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    }
    return this.embedder
  }
}
```

### Token Streaming

**Stream tokens progressively for better UX:**

```typescript
async function* streamCompletion(prompt: string) {
  const response = await fetch('/api/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
    headers: { 'Content-Type': 'application/json' }
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value)
    yield text
  }
}
```

### Memory Management

**Clean up resources when not in use:**

```typescript
class WebLLMProvider {
  async dispose() {
    // Unload model from GPU
    await this.engine.unload()

    // Clear caches
    this.tokenCache.clear()

    // Free memory
    this.embeddings = null
  }
}
```

---

## Debugging

### WebLLM Logs

**Enable verbose logging:**

```typescript
import { ChatWebLLM } from '@langchain/community/chat_models/webllm'

const model = new ChatWebLLM({
  model: 'phi-3-mini',
  verbose: true  // Enable logs
})
```

**Check browser console for:**
- Model download progress
- GPU memory usage
- Inference timing
- Tool call parsing

### LangChain Tracing

**Enable agent tracing:**

```typescript
import { initializeAgentExecutorWithOptions } from 'langchain/agents'

const executor = await initializeAgentExecutorWithOptions(tools, model, {
  agentType: 'openai-functions',
  verbose: true  // Log agent steps
})
```

**Trace output:**
```
[Agent] Entering new AgentExecutor chain...
[Agent] Action: search_web
[Agent] Action Input: {"query": "NYC bike share data"}
[Tool] Result: [{"title": "...", "url": "..."}]
[Agent] Final Answer: I found the data at...
```

### Performance Profiling

**Measure inference time:**

```typescript
const start = performance.now()
const response = await provider.generateCompletion(messages, tools)
for await (const token of response) {
  console.log(token)
}
const end = performance.now()
console.log(`Inference time: ${end - start}ms`)
```

**Memory usage:**

```typescript
if (performance.memory) {
  console.log('Used JS Heap:', performance.memory.usedJSHeapSize / 1024 / 1024, 'MB')
  console.log('Total JS Heap:', performance.memory.totalJSHeapSize / 1024 / 1024, 'MB')
}
```

### Common Issues

**Issue:** "WebGPU not supported"
**Fix:** Update browser to Chrome 113+, Edge 113+, or Safari 17+

**Issue:** Model fails to load
**Fix:** Clear IndexedDB cache, retry download

**Issue:** Slow inference (> 10 seconds)
**Fix:** Close other tabs, reduce history length, switch to remote API

**Issue:** Tool calls not working
**Fix:** Check tool schema matches MCP format, validate with Zod

**Issue:** Out of memory
**Fix:** Unload model when not in use, reduce model size, use remote API

---

## Contributing

### Code Style

- Follow project conventions (Biome formatting)
- Write TypeScript strictly (no `any` without comment)
- Use async/await over promises
- Prefer functional style over classes where appropriate

### Adding Features

1. **Discuss in issue** - Propose feature in GitHub issue first
2. **Write spec** - Document behavior and API in spec doc
3. **Implement** - Write code with tests
4. **Test thoroughly** - Unit, integration, and E2E tests
5. **Document** - Update user and developer docs
6. **Submit PR** - Link to issue, explain changes

### Testing Requirements

- All new tools must have unit tests
- Provider implementations must have integration tests
- Critical workflows must have E2E tests
- Performance-sensitive code must have benchmarks

### Documentation Standards

- Update `docs/users/ai-assistant.md` for user-facing changes
- Update this file (`dev-docs/webllm-ai-integration.md`) for technical changes
- Update `AGENTS.md` if changing core architecture
- Include code examples and explanations

---

## Further Reading

- [WebLLM Documentation](https://github.com/mlc-ai/web-llm)
- [LangChain.js Documentation](https://js.langchain.com/docs/)
- [Model Context Protocol Spec](https://github.com/anthropics/mcp)
- [transformers.js Documentation](https://huggingface.co/docs/transformers.js)
- [voy-search Documentation](https://github.com/tantaraio/voy)

---

**Questions?** Open an issue on [GitHub](https://github.com/joby-aviation/noodles.gl/issues) or ask in [Discussions](https://github.com/joby-aviation/noodles.gl/discussions).
