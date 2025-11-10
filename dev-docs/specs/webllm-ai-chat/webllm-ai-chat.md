# WebLLM AI Chat Specification

**Status:** Draft
**Created:** 2025-11-10
**Issue:** https://github.com/joby-aviation/noodles.gl/issues/123
**Author:** AI Assistant

## Table of Contents

1. [Overview](#overview)
2. [Goals & Success Criteria](#goals--success-criteria)
3. [Architecture](#architecture)
4. [Technical Stack](#technical-stack)
5. [Model Selection](#model-selection)
6. [Tool System](#tool-system)
7. [RAG Implementation](#rag-implementation)
8. [Web Search Integration](#web-search-integration)
9. [Settings & Configuration](#settings--configuration)
10. [First-Time User Experience](#first-time-user-experience)
11. [Fallback to Remote API](#fallback-to-remote-api)
12. [Migration Strategy](#migration-strategy)
13. [Documentation Requirements](#documentation-requirements)
14. [Implementation Phases](#implementation-phases)
15. [Testing Strategy](#testing-strategy)
16. [Performance Targets](#performance-targets)
17. [System Prompt Strategy](#system-prompt-strategy)
18. [Design Decisions](#design-decisions)

---

## Overview

Replace the current Anthropic Claude API-based AI chat with a fully local, browser-based agentic system powered by WebLLM. This will enable users to:

- Run AI assistance entirely in their browser without API costs
- Work offline after initial model download
- Maintain privacy (no data leaves the browser)
- Fall back to Anthropic API when needed for complex tasks

The new system will use **WebLLM** for model inference, **LangChain.js** for agentic tool-calling, **transformers.js** for embeddings, and **voy** for vector storage.

### Key Changes from Current System

| Current (Claude API) | New (WebLLM + Fallback) |
|---------------------|------------------------|
| Cloud-based inference | Local browser inference |
| API key required | No API key needed (optional for fallback) |
| Sub-second responses | 3-5 second responses |
| Pay per token | Free after model download |
| Always online | Offline-capable |
| Unlimited context | Limited by GPU memory |
| Single provider (Anthropic) | Local + Anthropic fallback |

---

## Goals & Success Criteria

### Primary Goals

1. **Enable local AI assistance** - Users can chat with AI without API costs or internet dependency
2. **Preserve existing capabilities** - All current tools and workflows continue to work
3. **Maintain UX quality** - Responses are helpful, interface is responsive, errors are clear
4. **Provide escape hatch** - Users can fall back to Anthropic for complex tasks or unsupported hardware

### Success Criteria

- ✅ Model loads and runs on MacBook Pro (2020+) with acceptable performance (3-5s response time)
- ✅ All 13+ existing tools work with WebLLM (including new web search and RAG tools)
- ✅ Users can complete critical workflows (data visualization, debugging, layer creation) without API
- ✅ First-time setup is smooth (< 2 minutes from chat open to first response)
- ✅ Settings allow switching between local and remote seamlessly
- ✅ Documentation clearly explains trade-offs and setup process

### Non-Goals

- Supporting all possible hardware (acceptable to fail gracefully on old devices)
- Matching Claude API response quality 1:1 (local models have limitations)
- Supporting multiple concurrent conversations (single conversation focus)
- Fine-tuning or custom model training (use off-the-shelf models only)

---

## Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                      Noodles Editor App                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Chat Panel UI                        │ │
│  │  - Message display                                      │ │
│  │  - Input area                                           │ │
│  │  - Settings button                                      │ │
│  │  - Download progress                                    │ │
│  └─────────────────────┬────────────────────────────────────┘ │
│                        │                                      │
│  ┌─────────────────────▼────────────────────────────────────┐ │
│  │              AI Chat Controller                          │ │
│  │  - Message routing                                       │ │
│  │  - Provider selection (local vs remote)                  │ │
│  │  - Conversation history management                       │ │
│  └─────┬───────────────────────────────────┬────────────────┘ │
│        │                                   │                  │
│  ┌─────▼──────────────────┐       ┌───────▼───────────────┐  │
│  │   WebLLM Provider      │       │  Anthropic Provider   │  │
│  │  - Model loading       │       │  - API client         │  │
│  │  - Inference           │       │  - Token optimization │  │
│  │  - Streaming           │       │  (existing)           │  │
│  └─────┬──────────────────┘       └───────┬───────────────┘  │
│        │                                   │                  │
│  ┌─────▼───────────────────────────────────▼────────────────┐ │
│  │              LangChain.js Agent Executor                 │ │
│  │  - Tool calling loop                                     │ │
│  │  - MCP protocol (OpenAI function calling format)         │ │
│  │  - Multi-turn orchestration                              │ │
│  └─────┬────────────────────────────────────────────────────┘ │
│        │                                                      │
│  ┌─────▼────────────────────────────────────────────────────┐ │
│  │                    Tool Registry                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │ │
│  │  │   Project    │  │   Visual     │  │     RAG      │   │ │
│  │  │    Tools     │  │   Debugging  │  │    Tools     │   │ │
│  │  │  (existing)  │  │   (existing) │  │    (new)     │   │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │ │
│  │  ┌──────────────┐  ┌──────────────┐                     │ │
│  │  │  Web Search  │  │  Code Search │                     │ │
│  │  │    (new)     │  │   (enabled)  │                     │ │
│  │  └──────────────┘  └──────────────┘                     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Supporting Services                        │  │
│  │  ┌────────────────┐  ┌──────────────────────────────┐  │  │
│  │  │ transformers.js│  │         voy DB               │  │  │
│  │  │  - Embeddings  │  │  - Doc embeddings            │  │  │
│  │  │  - Text        │  │  - Web search cache          │  │  │
│  │  │    processing  │  │  - Vector similarity search  │  │  │
│  │  └────────────────┘  └──────────────────────────────┘  │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │             Context Loader                         │ │  │
│  │  │  - Pre-generated bundles (existing)                │ │  │
│  │  │  - Operator registry, docs, examples               │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User sends message** → Chat Panel UI
2. **Controller routes to provider** → WebLLM (default) or Anthropic (fallback)
3. **Provider generates response** → Streams tokens back
4. **LangChain detects tool call** → Pauses generation, invokes tool
5. **Tool executes** → Calls into MCP Tools (same as current system)
6. **Tool result returned** → LangChain resumes generation with result
7. **Final response** → Streamed to UI

### Component Responsibilities

**Chat Panel UI** (`chat-panel.tsx`)
- Render messages, handle user input
- Display download progress for model
- Show provider status (local/remote)
- Settings button to configure

**AI Chat Controller** (new: `ai-controller.ts`)
- Select provider based on settings and availability
- Manage conversation history (default 7 messages)
- Handle streaming from both providers
- Coordinate tool execution

**WebLLM Provider** (new: `webllm-provider.ts`)
- Initialize and load model
- Generate completions with tool calls
- Stream tokens progressively
- Handle errors and model failures

**Anthropic Provider** (existing: `claude-client.ts`)
- Preserve existing implementation
- Minor refactor to match provider interface

**Cloud AI Providers** (new: via LangChain.js)

- AWS Bedrock - Support Claude, Llama, Titan models
- Google Vertex AI - Support Gemini, PaLM models
- OpenAI - Support GPT-4, GPT-3.5 models
- Unified interface through LangChain abstractions

**LangChain Agent Executor** (new: `langchain-agent.ts`)
- Multi-turn tool calling loop
- Parse tool requests from model
- Invoke tools via registry
- Format tool results for model

**Tool Registry** (refactor: `mcp-tools.ts`)
- Register all tools with MCP schema
- Provide type-safe tool invocation
- Handle tool errors gracefully

**RAG Service** (new: `rag-service.ts`)
- Load and embed documentation
- Query voy for relevant docs
- Format results for tool response

**Web Search Service** (new: `web-search-service.ts`)
- Query DuckDuckGo API
- Embed and cache results
- Return relevant search snippets

---

## Technical Stack

### Core Libraries

| Library | Version | Purpose | Bundle Size |
|---------|---------|---------|-------------|
| `@mlc-ai/web-llm` | `^0.2.x` | WebGPU-based LLM inference | ~50 KB |
| `langchain` | `^0.3.x` | Agentic orchestration, tool calling | ~200 KB |
| `@langchain/community` | `^0.3.x` | WebLLM integration | ~100 KB |
| `@xenova/transformers` | `^2.17.x` | Embedding generation | ~500 KB |
| `voy-search` | `^0.6.x` | WASM vector database | ~200 KB |

### Model Assets

| Asset | Size | Download Time (10 Mbps) | Storage |
|-------|------|-------------------------|---------|
| Phi-3-mini-4k-instruct (Q4) | ~2.3 GB | ~3-4 minutes | IndexedDB |
| MiniLM-L6-v2 embeddings | ~90 MB | ~1 minute | Memory + Cache |
| Documentation embeddings | ~10 MB | Instant (pre-generated) | IndexedDB |

### Existing Infrastructure (Preserve)

- **Context Bundles** - Pre-generated code index, operator registry, docs, examples
- **Project Modification Hook** - `use-project-modifications.ts` for atomic graph updates
- **Operator Store** - Global `opMap` for accessing operator instances
- **Conversation History** - localStorage-based persistence

### Lazy Loading Strategy

**Critical:** To minimize initial bundle size and app load time, all AI chat dependencies must be lazy-loaded in the background only after the main app has loaded and sat idle.

**Implementation:**

```typescript
// In noodles.tsx or app entry point
useEffect(() => {
  let timeoutId: NodeJS.Timeout

  const lazyLoadAIDeps = async () => {
    // Wait for app to be idle (user not interacting)
    await new Promise(resolve => {
      timeoutId = setTimeout(resolve, 2000) // 2 seconds of idle time
    })

    // Preload AI chat dependencies in background
    await Promise.all([
      import('./ai-chat/ai-controller'),
      import('./ai-chat/webllm-provider'),
      import('./ai-chat/rag-service'),
      import('./ai-chat/web-search-service'),
      // Don't preload heavy deps yet (WebLLM, transformers.js)
      // Those load when user opens chat for first time
    ])

    console.log('AI chat dependencies preloaded')
  }

  // Start lazy loading after initial render
  const idleCallback = requestIdleCallback || setTimeout
  idleCallback(lazyLoadAIDeps, { timeout: 5000 })

  return () => {
    clearTimeout(timeoutId)
  }
}, [])
```

**Bundle Strategy:**

1. **Main Bundle** - Core app WITHOUT AI chat dependencies (~2-3 MB)
2. **AI Chat Bundle** - Controller, providers, services (~350 KB, lazy loaded)
3. **Heavy AI Dependencies** - WebLLM, transformers.js, LangChain (~750 KB, loaded on chat open)
4. **Model Assets** - Phi-3 model, embeddings (2.3+ GB, loaded on demand)

**Loading Sequence:**

1. **App Load** (0-2s) - Main bundle loads, app renders
2. **Idle Time** (2-4s) - User explores UI, app sits idle
3. **Background Preload** (4-6s) - AI chat code lazy loads in background
4. **User Opens Chat** (user action) - Heavy deps load if not already cached
5. **Model Download** (first time only) - Phi-3 downloads with progress bar

**Benefits:**

- ✅ **Fast initial load** - Main app bundle stays lean
- ✅ **Non-blocking** - AI deps don't slow down critical path
- ✅ **Progressive enhancement** - Chat loads seamlessly when user needs it
- ✅ **Cache-friendly** - Preloaded code ready when chat opens

**Vite Configuration:**

```typescript
// vite.config.ts
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'ai-chat': [
            './src/ai-chat/ai-controller',
            './src/ai-chat/webllm-provider',
            './src/ai-chat/anthropic-provider',
            './src/ai-chat/langchain-agent',
            './src/ai-chat/rag-service',
            './src/ai-chat/web-search-service',
            './src/ai-chat/mcp-tools'
          ],
          'ai-heavy': [
            '@mlc-ai/web-llm',
            'langchain',
            '@langchain/community',
            '@xenova/transformers',
            'voy-search'
          ]
        }
      }
    }
  }
}
```

---

## Model Selection

### Default Model: Phi-3-mini-4k-instruct

**Recommendation:** Use `Phi-3-mini-4k-instruct-q4f16_1-MLC` as the default model.

**Rationale:**

- **Size:** 2.3 GB (reasonable download time)
- **Performance:** Runs at 20-30 tokens/sec on M1 MacBook Pro
- **Context:** 4K tokens (sufficient for 7-message history + tools)
- **Quality:** Strong instruction following, good tool calling
- **Maintained:** Actively supported by MLC team

**Alternative Models** (for future consideration):

- `Llama-3-8B-Instruct-q4f16_1-MLC` - Larger, higher quality, slower
- `Qwen2.5-3B-Instruct-q4f16_1-MLC` - Smaller, faster, lower quality

### Custom Model Support

**Settings UI will include:**

- **Model Dropdown/Typeahead:** Quick selection from curated list:
  - Phi-3 Mini (Recommended) - Default
  - Llama-3-8B-Instruct - Higher quality, slower
  - Qwen2.5-3B-Instruct - Faster, lower quality
  - Custom model URL... - For advanced users
- **Custom URL input:** Text field for WebLLM-compatible model URLs
- **Model validation:** Test inference before saving
- **Persistence:** Save preference to localStorage

**Implementation:**

```typescript
// Settings UI
<select>
  <option value="phi-3-mini">Phi-3 Mini (Recommended)</option>
  <option value="llama-3-8b">Llama-3 8B (Slower, higher quality)</option>
  <option value="custom">Custom model URL...</option>
</select>

// Custom URL input (shown if "custom" selected)
<input placeholder="https://huggingface.co/..." />
```

### Model Loading Flow

1. **Check IndexedDB** - Is model already cached?
2. **If cached** - Load from IndexedDB (~2-3 seconds)
3. **If not cached** - Download from CDN with progress (3-4 minutes)
4. **Validate model** - Test inference with simple prompt
5. **Mark as ready** - Enable chat input

---

## Tool System

### Tool Format: Model Context Protocol (MCP)

All tools will use the **MCP format** (OpenAI function calling), which is compatible with LangChain.js and widely supported.

**Example MCP Tool Schema:**

```typescript
{
  name: "capture_visualization",
  description: "Capture a screenshot of the current visualization",
  parameters: {
    type: "object",
    properties: {
      maxWidth: {
        type: "number",
        description: "Maximum width in pixels (default: 1024)",
        default: 1024
      },
      quality: {
        type: "number",
        description: "JPEG quality 0-1 (default: 0.5)",
        default: 0.5
      }
    },
    required: []
  }
}
```

### Preserved Tools (13 existing)

All current tools will be preserved with identical functionality:

**Visual Debugging:**

1. `capture_visualization` - Screenshot capture
2. `get_console_errors` - Browser console errors/warnings
3. `get_render_stats` - Deck.gl performance metrics
4. `inspect_layer` - Layer-specific information

**Project State:**

1. `apply_modifications` - Batch node/edge operations
2. `get_current_project` - Full project snapshot
3. `list_nodes` - All nodes with execution state
4. `get_node_info` - Detailed node + connection info
5. `get_node_output` - Read operator output data

**Code/Documentation** (currently disabled, will be enabled):

1. `search_code` - Regex search through GitHub source
2. `get_source_code` - File content retrieval from GitHub
3. `get_operator_schema` - Operator input/output schemas
4. `list_operators` - Available operator catalog

### New Tools (4 additions)

1. **`search_web`** - Search the web via DuckDuckGo
2. **`search_documentation`** - RAG-based doc search
3. **`get_documentation`** - Retrieve specific doc page (preserve existing)
4. **`get_example`** / **`list_examples`** - Example projects (preserve existing)

### Tool Implementation Details

**Refactor `mcp-tools.ts`:**

```typescript
// Current structure (preserve logic, change format)
export const tools = [
  {
    name: "capture_visualization",
    description: "...",
    parameters: { /* MCP schema */ },
    execute: async (args) => { /* existing logic */ }
  },
  // ... all other tools
]

// LangChain integration (new)
import { DynamicStructuredTool } from "@langchain/core/tools"

export const langchainTools = tools.map(tool =>
  new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: zodToJsonSchema(tool.parameters),
    func: tool.execute
  })
)
```

**No changes to tool logic** - Only format conversion for LangChain compatibility.

---

## RAG Implementation

### Goal

Enable the AI to answer questions about:
- Noodles.gl operators and APIs
- Documentation and user guides
- Project structure and architecture
- Common patterns and best practices

### Documentation Corpus

**Sources to index:**

1. `/docs/**` - User documentation (markdown files)
2. `/dev-docs/**` - Developer documentation
3. `/AGENTS.md` - Comprehensive LLM context
4. `/README.md` - Project overview
5. Operator schemas (from registry) - Input/output definitions
6. Example projects (annotations only)

**Total estimated size:** ~500-700 pages of text, ~10 MB embedded

### Embedding Strategy

**Model:** `Xenova/all-MiniLM-L6-v2` via transformers.js

- **Embedding size:** 384 dimensions
- **Performance:** 100-200 chunks/sec in browser
- **Quality:** Good for semantic search, widely used

**Pre-generation vs Runtime:**

**Recommendation: Hybrid approach**

1. **Pre-generate doc embeddings** during build:
   - Run `scripts/generate-rag-embeddings.ts` at build time
   - Embed all docs, AGENTS.md, README
   - Save to `public/noodles/rag-index.bin` (binary format)
   - Include in IndexedDB cache manifest

2. **Generate operator embeddings at runtime**:
   - Embed operator schemas when context loads
   - Refresh when operators change
   - Store in voy alongside docs

**Benefits:**

- Fast initial load (pre-generated embeddings)
- Always up-to-date operator info (runtime generation)
- No stale docs (refresh embeddings in CI)

### Chunking Strategy

**Markdown chunking:**

- Split by headings (## level 2)
- Max 512 tokens per chunk
- Overlap of 50 tokens
- Preserve code blocks intact

**Example:**

```typescript
// Input: docs/users/operators.md
## FileOp
Loads data from files...
### Inputs
- url: File URL
### Outputs
- data: Loaded data

// Output chunks:
[
  {
    content: "## FileOp\nLoads data from files...",
    metadata: { file: "docs/users/operators.md", heading: "FileOp" }
  },
  {
    content: "### Inputs\n- url: File URL",
    metadata: { file: "docs/users/operators.md", heading: "FileOp > Inputs" }
  },
  ...
]
```

### Vector Storage (voy)

**Database schema:**

```typescript
interface RagIndex {
  id: string                    // Unique chunk ID
  embedding: Float32Array       // 384-dim vector
  content: string               // Original text
  metadata: {
    source: 'docs' | 'operators' | 'examples'
    file: string                // File path
    heading?: string            // Section heading
    type?: string               // Operator type
  }
}
```

**Indexing:**

```typescript
import { Voy } from "voy-search"

const index = new Voy({
  embeddings: {
    size: 384,
    normalize: true
  }
})

// Add documents
for (const chunk of chunks) {
  await index.add({
    id: chunk.id,
    embeddings: chunk.embedding,
    title: chunk.metadata.heading,
    content: chunk.content
  })
}
```

**Query:**

```typescript
// User asks: "How do I load CSV files?"
const query = "load CSV files"
const queryEmbedding = await embedText(query)

const results = await index.search(queryEmbedding, {
  numResults: 5
})

// Returns:
// [
//   { id: "docs/users/operators.md#FileOp", score: 0.87, content: "..." },
//   { id: "docs/users/data-sources.md#csv", score: 0.82, content: "..." },
//   ...
// ]
```

### Tool Implementation

**`search_documentation` tool:**

```typescript
{
  name: "search_documentation",
  description: "Search Noodles.gl documentation for help with operators, APIs, and workflows. Returns relevant documentation snippets.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'how to load CSV files', 'ScatterplotLayer options')"
      },
      limit: {
        type: "number",
        description: "Max results to return (default: 5)",
        default: 5
      }
    },
    required: ["query"]
  }
}

// Implementation
async function searchDocumentation(query: string, limit: number = 5) {
  const embedding = await embedQuery(query)
  const results = await voyIndex.search(embedding, { numResults: limit })

  return {
    results: results.map(r => ({
      source: r.metadata.file,
      heading: r.metadata.heading,
      content: r.content,
      relevance: r.score
    }))
  }
}
```

### Build-Time Script

**`scripts/generate-rag-embeddings.ts`:**

```typescript
import { pipeline } from "@xenova/transformers"
import { glob } from "glob"
import { readFile, writeFile } from "fs/promises"

async function generateRagEmbeddings() {
  // Load embedding model
  const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")

  // Glob all docs
  const docFiles = await glob("docs/**/*.md")
  const devDocFiles = await glob("dev-docs/**/*.md")
  const agentsFile = "AGENTS.md"

  const chunks = []

  // Process each file
  for (const file of [...docFiles, ...devDocFiles, agentsFile]) {
    const content = await readFile(file, "utf-8")
    const fileChunks = chunkMarkdown(content, { maxTokens: 512, overlap: 50 })

    for (const chunk of fileChunks) {
      const embedding = await embedder(chunk.content, { pooling: "mean", normalize: true })
      chunks.push({
        id: `${file}#${chunk.heading}`,
        embedding: Array.from(embedding.data),
        content: chunk.content,
        metadata: {
          source: "docs",
          file,
          heading: chunk.heading
        }
      })
    }
  }

  // Save to binary format
  const buffer = serializeEmbeddings(chunks)
  await writeFile("public/noodles/rag-index.bin", buffer)

  console.log(`Generated ${chunks.length} embeddings`)
}
```

**Add to CI/build:**

```json
// package.json
{
  "scripts": {
    "generate:rag": "tsx scripts/generate-rag-embeddings.ts",
    "prebuild": "yarn generate:context && yarn generate:rag"
  }
}
```

---

## Web Search Integration

### Goal

Enable the AI to search the web for:
- Noodles.gl examples and tutorials (GitHub, blog posts)
- Geospatial data sources (OpenStreetMap, government APIs)
- Deck.gl layer documentation
- Troubleshooting and debugging help

### DuckDuckGo API

**API Choice:** DuckDuckGo Instant Answer API (free, no key required)

**Endpoint:**

```text
https://api.duckduckgo.com/?q={query}&format=json
```

**Response format:**

```json
{
  "AbstractText": "Summary text...",
  "AbstractSource": "Wikipedia",
  "AbstractURL": "https://...",
  "RelatedTopics": [
    {
      "Text": "Related result...",
      "FirstURL": "https://..."
    }
  ]
}
```

**Limitations:**

- Rate limited (exact limits unclear, ~100 requests/day safe)
- No pagination
- Results are instant answers, not full web search
- Best for factual queries, not recent news

**Fallback Strategy:** Fail gracefully with clear error message. Note in documentation that SearXNG public instance could be added as backup in future if DuckDuckGo proves unreliable.

### Search Pipeline

1. **Query DuckDuckGo** - Fetch top 5 results
2. **Fetch page content** - Use `fetch()` to get HTML
3. **Extract text** - Strip HTML, keep relevant paragraphs
4. **Embed snippets** - Generate embeddings for each result
5. **Cache in voy** - Store with TTL metadata
6. **Return to model** - Format as tool result

### Caching Strategy

**Cache key:** Hash of search query
**TTL:** 24 hours (configurable)
**Storage:** voy database (separate namespace from docs)

**Cache structure:**

```typescript
interface SearchCache {
  query: string
  queryHash: string
  results: Array<{
    title: string
    url: string
    snippet: string
    embedding: Float32Array
  }>
  timestamp: number  // Unix timestamp
  expiresAt: number  // timestamp + TTL
}
```

**Cache lookup:**

```typescript
async function searchWeb(query: string) {
  const cacheKey = hashQuery(query)

  // Check cache
  const cached = await voyIndex.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results
  }

  // Fetch from DuckDuckGo
  const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`)
  const data = await response.json()

  // Process results
  const results = await Promise.all(
    data.RelatedTopics.slice(0, 5).map(async (topic) => {
      const html = await fetch(topic.FirstURL).then(r => r.text())
      const text = extractText(html)
      const embedding = await embedText(text)

      return {
        title: topic.Text.split(" - ")[0],
        url: topic.FirstURL,
        snippet: text.slice(0, 500),
        embedding
      }
    })
  )

  // Cache results
  await voyIndex.add({
    id: cacheKey,
    embeddings: results[0].embedding,  // Use first result as representative
    content: JSON.stringify(results),
    metadata: {
      type: "search_cache",
      query,
      timestamp: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000  // 24 hours
    }
  })

  return results
}
```

### Tool Implementation

**`search_web` tool:**

```typescript
{
  name: "search_web",
  description: "Search the web for information about Noodles.gl, geospatial data, Deck.gl, or general programming topics. Use this when the documentation doesn't have the answer.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'NYC bike share data API', 'Deck.gl PathLayer examples')"
      }
    },
    required: ["query"]
  }
}

// Implementation
async function searchWebTool(query: string) {
  const results = await searchWeb(query)

  return {
    query,
    results: results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet
    }))
  }
}
```

### Rate Limiting

**Prevent abuse:**

- Max 10 searches per chat session
- Debounce identical queries (1 minute)
- Warn user if rate limit approached

```typescript
let searchCount = 0
const searchHistory = new Map<string, number>()

async function searchWebWithLimits(query: string) {
  // Check rate limit
  if (searchCount >= 10) {
    throw new Error("Search limit reached for this session (10 max). Please start a new conversation.")
  }

  // Check debounce
  const lastSearch = searchHistory.get(query)
  if (lastSearch && Date.now() - lastSearch < 60000) {
    throw new Error("Please wait before searching the same query again.")
  }

  // Execute search
  const results = await searchWeb(query)

  // Update tracking
  searchCount++
  searchHistory.set(query, Date.now())

  return results
}
```

---

## Settings & Configuration

### Settings UI Location

**Primary:** Settings button in chat panel header (gear icon)
**Secondary:** App menu > Preferences > AI Assistant (future)

### Settings Modal

**Layout:**

```text
┌─────────────────────────────────────────────┐
│  AI Assistant Settings                   ✕  │
├─────────────────────────────────────────────┤
│                                             │
│  Model Provider                             │
│  ○ Local                                    │
│  ○ Remote                                   │
│                                             │
└─────────────────────────────────────────────┘
```

Based on the selected provider, show relevant configuration sections. Selecting "Local" shows local model options; selecting "Remote" reveals remote API configurations, including API keys and region settings for remote providers (Vertex, Bedrock, etc).

```text
┌─────────────────────────────────────────────┐
│                                             │
│  Local Model                                │
│  [Phi-3 Mini (Recommended)    ▼]            │
│  [ ] Use custom model URL                   │
│  [________________________________]          │
│                                             │
│  ──────────────────────────────────────────  │
│                                             │
│  Remote API (Anthropic)                     │
│  API Key: [********************]            │
│  [ ] Remember key across sessions           │
│  [Get API key →]                            │
│                                             │
│  ──────────────────────────────────────────  │
│                                             │
│  AWS Bedrock Configuration                  │
│  Region: [us-east-1            ▼]           │
│  Model: [anthropic.claude-3-sonnet ▼]       │
│  Access Key ID: [********************]      │
│  Secret Access Key: [********************]  │
│  [ ] Use IAM role (if running on EC2/ECS)   │
│  [ ] Remember credentials                   │
│                                             │
│  ──────────────────────────────────────────  │
│                                             │
│  Google Vertex AI Configuration             │
│  Project ID: [my-project-id]                │
│  Location: [us-central1        ▼]           │
│  Model: [gemini-1.5-pro        ▼]           │
│  Service Account Key (JSON):                │
│  [Upload file or paste JSON...]             │
│  [ ] Remember credentials                   │
│                                             │
│  ──────────────────────────────────────────  │
│                                             │
│  OpenAI Configuration                       │
│  Model: [gpt-4-turbo          ▼]            │
│  API Key: [********************]            │
│  Organization ID (optional): [org-xxxxx]    │
│  [ ] Remember credentials                   │
│  [Get API key →]                            │
│                                             │
│  ──────────────────────────────────────────  │
│                                             │
│  Conversation Settings                      │
│  History length: [7 messages     ▼]         │
│  [ ] Auto-capture screenshots               │
│                                             │
│  ──────────────────────────────────────────  │
│                                             │
│  [Learn more about providers]               │
│                                             │
│  [Cancel]                    [Save Changes] │
│                                             │
└─────────────────────────────────────────────┘
```

### Configuration Options

**Core Settings:**

| Setting | Type | Default | Options | Storage |
|---------|------|---------|---------|---------|
| `provider` | enum | `local` | `local`, `anthropic`, `bedrock`, `vertex`, `openai` | localStorage |
| `historyLength` | number | `7` | 3, 5, 7, 10, 15, 20 | localStorage |
| `autoCapture` | boolean | `false` | - | localStorage |

**Local Provider (WebLLM):**

| Setting | Type | Default | Options | Storage |
|---------|------|---------|---------|---------|
| `localModel` | string | `phi-3-mini` | `phi-3-mini`, `llama-3-8b`, `custom` | localStorage |
| `customModelUrl` | string | `null` | Any WebLLM-compatible URL | localStorage |

**Anthropic Provider:**

| Setting | Type | Default | Options | Storage |
|---------|------|---------|---------|---------|
| `anthropicApiKey` | string | `null` | User-provided | localStorage or sessionStorage |
| `rememberAnthropicKey` | boolean | `false` | - | localStorage |

**AWS Bedrock Provider:**

| Setting | Type | Default | Options | Storage |
|---------|------|---------|---------|---------|
| `bedrockRegion` | string | `us-east-1` | AWS regions | localStorage |
| `bedrockModel` | string | `anthropic.claude-3-sonnet-20240229-v1:0` | Available Bedrock models | localStorage |
| `bedrockAccessKeyId` | string | `null` | User-provided | localStorage or sessionStorage |
| `bedrockSecretAccessKey` | string | `null` | User-provided | localStorage or sessionStorage |
| `bedrockUseIAMRole` | boolean | `false` | - | localStorage |
| `rememberBedrockCredentials` | boolean | `false` | - | localStorage |

**Google Vertex AI Provider:**

| Setting | Type | Default | Options | Storage |
|---------|------|---------|---------|---------|
| `vertexProjectId` | string | `null` | User-provided | localStorage |
| `vertexLocation` | string | `us-central1` | Available regions | localStorage |
| `vertexModel` | string | `gemini-1.5-pro` | Available Vertex models | localStorage |
| `vertexServiceAccountKey` | string | `null` | JSON key file content | localStorage or sessionStorage |
| `rememberVertexCredentials` | boolean | `false` | - | localStorage |

**OpenAI Provider:**

| Setting | Type | Default | Options | Storage |
|---------|------|---------|---------|---------|
| `openaiApiKey` | string | `null` | User-provided | localStorage or sessionStorage |
| `openaiModel` | string | `gpt-4-turbo` | `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo` | localStorage |
| `openaiOrganization` | string | `null` | User-provided (optional) | localStorage |
| `rememberOpenAICredentials` | boolean | `false` | - | localStorage |

### Settings Persistence

#### localStorage Keys

```typescript
{
  // Core settings
  "noodles-ai-provider": "local" | "anthropic" | "bedrock" | "vertex" | "openai",
  "noodles-ai-history-length": number,
  "noodles-ai-auto-capture": boolean,

  // Local (WebLLM)
  "noodles-ai-local-model": "phi-3-mini" | "llama-3-8b" | "custom",
  "noodles-ai-custom-model-url": string | null,

  // Anthropic
  "noodles-ai-anthropic-api-key": string | null,
  "noodles-ai-remember-anthropic-key": boolean,

  // AWS Bedrock
  "noodles-ai-bedrock-region": string,
  "noodles-ai-bedrock-model": string,
  "noodles-ai-bedrock-access-key-id": string | null,
  "noodles-ai-bedrock-secret-access-key": string | null,
  "noodles-ai-bedrock-use-iam-role": boolean,
  "noodles-ai-remember-bedrock-credentials": boolean,

  // Google Vertex AI
  "noodles-ai-vertex-project-id": string | null,
  "noodles-ai-vertex-location": string,
  "noodles-ai-vertex-model": string,
  "noodles-ai-vertex-service-account-key": string | null,
  "noodles-ai-remember-vertex-credentials": boolean,

  // OpenAI
  "noodles-ai-openai-api-key": string | null,
  "noodles-ai-openai-model": string,
  "noodles-ai-openai-organization": string | null,
  "noodles-ai-remember-openai-credentials": boolean
}
```

#### Environment Variable Support

For deployed environments, CI/CD, or advanced users who prefer managing credentials outside the browser, the system supports reading configuration from environment variables.

**Precedence order:**

1. localStorage/sessionStorage (UI-configured values)
2. Environment variables (fallback)
3. Default values

**Supported environment variables:**

```typescript
// Core settings
NOODLES_AI_PROVIDER: "local" | "anthropic" | "bedrock" | "vertex" | "openai"
NOODLES_AI_HISTORY_LENGTH: number

// Anthropic
ANTHROPIC_API_KEY: string

// AWS Bedrock
AWS_REGION: string
AWS_BEDROCK_MODEL: string
AWS_ACCESS_KEY_ID: string
AWS_SECRET_ACCESS_KEY: string

// Google Vertex AI
GOOGLE_CLOUD_PROJECT: string
GOOGLE_CLOUD_LOCATION: string
VERTEX_AI_MODEL: string
GOOGLE_APPLICATION_CREDENTIALS: string  // Path to JSON key file

// OpenAI
OPENAI_API_KEY: string
OPENAI_ORGANIZATION: string
OPENAI_MODEL: string
```

**Implementation:**

```typescript
// config-loader.ts
export function getConfig(): AIConfig {
  return {
    provider: localStorage.getItem('noodles-ai-provider') ||
              import.meta.env.NOODLES_AI_PROVIDER ||
              'local',

    // Anthropic
    anthropic: {
      apiKey: localStorage.getItem('noodles-ai-anthropic-api-key') ||
              import.meta.env.ANTHROPIC_API_KEY ||
              null
    },

    // AWS Bedrock
    bedrock: {
      region: localStorage.getItem('noodles-ai-bedrock-region') ||
              import.meta.env.AWS_REGION ||
              'us-east-1',
      model: localStorage.getItem('noodles-ai-bedrock-model') ||
             import.meta.env.AWS_BEDROCK_MODEL ||
             'anthropic.claude-3-sonnet-20240229-v1:0',
      accessKeyId: localStorage.getItem('noodles-ai-bedrock-access-key-id') ||
                   import.meta.env.AWS_ACCESS_KEY_ID ||
                   null,
      secretAccessKey: localStorage.getItem('noodles-ai-bedrock-secret-access-key') ||
                       import.meta.env.AWS_SECRET_ACCESS_KEY ||
                       null
    },

    // Google Vertex AI
    vertex: {
      projectId: localStorage.getItem('noodles-ai-vertex-project-id') ||
                 import.meta.env.GOOGLE_CLOUD_PROJECT ||
                 null,
      location: localStorage.getItem('noodles-ai-vertex-location') ||
                import.meta.env.GOOGLE_CLOUD_LOCATION ||
                'us-central1',
      model: localStorage.getItem('noodles-ai-vertex-model') ||
             import.meta.env.VERTEX_AI_MODEL ||
             'gemini-1.5-pro',
      serviceAccountKey: localStorage.getItem('noodles-ai-vertex-service-account-key') ||
                         loadServiceAccountFromPath(import.meta.env.GOOGLE_APPLICATION_CREDENTIALS) ||
                         null
    },

    // OpenAI
    openai: {
      apiKey: localStorage.getItem('noodles-ai-openai-api-key') ||
              import.meta.env.OPENAI_API_KEY ||
              null,
      organization: localStorage.getItem('noodles-ai-openai-organization') ||
                    import.meta.env.OPENAI_ORGANIZATION ||
                    null,
      model: localStorage.getItem('noodles-ai-openai-model') ||
             import.meta.env.OPENAI_MODEL ||
             'gpt-4-turbo'
    }
  }
}

function loadServiceAccountFromPath(path: string | undefined): string | null {
  if (!path) return null
  try {
    // In browser, this would be handled differently (e.g., fetch)
    // For Node.js environments (e.g., Electron), use fs
    const fs = require('fs')
    return fs.readFileSync(path, 'utf-8')
  } catch (err) {
    console.warn('Failed to load service account key from path:', path, err)
    return null
  }
}
```

**Setting environment variables:**

#### For local development (Vite)

Create `.env.local` file (gitignored):

```bash
# .env.local
NOODLES_AI_PROVIDER=bedrock
AWS_REGION=us-west-2
AWS_BEDROCK_MODEL=anthropic.claude-3-haiku-20240307-v1:0
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

#### For production deployment

Set environment variables in your hosting platform:

**Vercel:**

```bash
vercel env add ANTHROPIC_API_KEY
vercel env add AWS_ACCESS_KEY_ID
vercel env add AWS_SECRET_ACCESS_KEY
```

**Netlify:**

```bash
netlify env:set ANTHROPIC_API_KEY "sk-ant-..."
netlify env:set AWS_REGION "us-east-1"
```

**Docker:**

```dockerfile
ENV ANTHROPIC_API_KEY=sk-ant-...
ENV AWS_REGION=us-east-1
ENV OPENAI_API_KEY=sk-proj-...
```

**Benefits:**

- **Security**: Keep credentials out of localStorage in production
- **Flexibility**: Easy to rotate keys without UI changes
- **CI/CD**: Automated testing with test credentials
- **Multi-environment**: Different keys for dev/staging/prod
- **Team workflows**: Centralized credential management

**Limitations:**

- Browser-based apps can't access true environment variables (use build-time injection via Vite)
- Secrets exposed in browser bundle if not careful (use server-side proxies for sensitive production deployments)

**Security Note:**

For production web apps, consider using a backend proxy to avoid exposing API keys in the browser:

```typescript
// Instead of direct API calls
const response = await fetch('https://api.anthropic.com/v1/messages', {
  headers: { 'x-api-key': apiKey }  // ❌ Key exposed in browser
})

// Use backend proxy
const response = await fetch('/api/ai/chat', {
  method: 'POST',
  body: JSON.stringify({ message })  // ✅ Backend handles credentials
})
```

### Settings Validation

**On save:**

1. **Local provider**: If localModel = `custom`, validate custom URL format
2. **Anthropic provider**: Validate API key with test API call
3. **Bedrock provider**: Validate AWS credentials and region/model availability
4. **Vertex AI provider**: Validate service account key JSON format and permissions
5. **OpenAI provider**: Validate API key with test API call
6. **All providers**: If historyLength > 20, show warning about memory usage

### Model Download from Settings

**Purpose:** Allow users to download the local LLM model directly from the settings window, with the ability to continue the download in the background if they close the settings.

**UI Implementation:**

When the user selects the Local provider in settings:

1. **Check model status** - Is the model already downloaded?
2. **Show download button** - If not downloaded, show "Download Model" button
3. **Display model info** - Show model size (~2.3 GB) and estimated download time

**Settings UI with Download Option:**

```text
┌─────────────────────────────────────────────┐
│  AI Assistant Settings                   ✕  │
├─────────────────────────────────────────────┤
│                                             │
│  Model Provider                             │
│  ● Local                                    │
│  ○ Remote                                   │
│                                             │
│  Local Model                                │
│  [Phi-3 Mini (Recommended)    ▼]            │
│                                             │
│  Model Status: Not Downloaded               │
│  Size: 2.3 GB                               │
│                                             │
│  [Download Model]                           │
│                                             │
│  ─────────────────────────────────────────  │
│                                             │
│  [Cancel]                    [Save Changes] │
└─────────────────────────────────────────────┘
```

**During Download:**

```text
┌─────────────────────────────────────────────┐
│  AI Assistant Settings                   ✕  │
├─────────────────────────────────────────────┤
│                                             │
│  Model Provider                             │
│  ● Local                                    │
│  ○ Remote                                   │
│                                             │
│  Local Model                                │
│  [Phi-3 Mini (Recommended)    ▼]            │
│                                             │
│  Downloading model...                       │
│  ███████████░░░░░░░░░░  45% (1.04 / 2.3 GB) │
│  Estimated 2 minutes remaining              │
│                                             │
│  [Cancel Download]                          │
│                                             │
│  ─────────────────────────────────────────  │
│                                             │
│  Download will continue in background       │
│  if you close this window                   │
│                                             │
│  [Cancel]                    [Save Changes] │
└─────────────────────────────────────────────┘
```

**After Download Complete:**

```text
┌─────────────────────────────────────────────┐
│  AI Assistant Settings                   ✕  │
├─────────────────────────────────────────────┤
│                                             │
│  Model Provider                             │
│  ● Local                                    │
│  ○ Remote                                   │
│                                             │
│  Local Model                                │
│  [Phi-3 Mini (Recommended)    ▼]            │
│                                             │
│  Model Status: ✓ Downloaded                 │
│  Size: 2.3 GB                               │
│                                             │
│  [Delete Model]  [Re-download]              │
│                                             │
│  ──────────────────────────────────────────  │
│                                             │
│  [Cancel]                    [Save Changes] │
└─────────────────────────────────────────────┘
```

**Background Download Behavior:**

1. **User closes settings** - Download continues in background
2. **Progress notification** - Small notification badge appears on settings icon showing download progress
3. **Download complete** - Notification updates to show completion
4. **Re-open settings** - Shows completed status

**Implementation Details:**

```typescript
// model-download-manager.ts
export class ModelDownloadManager {
  private downloadProgress = new Subject<DownloadProgress>()
  private activeDownload: AbortController | null = null

  async startDownload(modelUrl: string): Promise<void> {
    this.activeDownload = new AbortController()

    const response = await fetch(modelUrl, {
      signal: this.activeDownload.signal
    })

    const contentLength = response.headers.get('content-length')
    const total = contentLength ? parseInt(contentLength, 10) : 0

    let loaded = 0
    const reader = response.body!.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      loaded += value.length

      // Emit progress
      this.downloadProgress.next({
        loaded,
        total,
        percentage: (loaded / total) * 100,
        estimatedTimeRemaining: this.calculateETA(loaded, total)
      })

      // Store chunk in IndexedDB
      await this.storeChunk(value)
    }

    // Finalize model
    await this.finalizeModel()
  }

  cancelDownload(): void {
    this.activeDownload?.abort()
    this.activeDownload = null
  }

  getProgress(): Observable<DownloadProgress> {
    return this.downloadProgress.asObservable()
  }

  private calculateETA(loaded: number, total: number): number {
    // Calculate based on download speed
    // Returns seconds remaining
  }
}
```

**Settings Component Integration:**

```typescript
// settings-modal.tsx
export function SettingsModal() {
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'complete'>('idle')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const downloadManager = useRef(new ModelDownloadManager())

  useEffect(() => {
    // Subscribe to download progress even if modal is closed
    const subscription = downloadManager.current.getProgress().subscribe(progress => {
      setDownloadProgress(progress.percentage)
      if (progress.percentage === 100) {
        setDownloadStatus('complete')
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleStartDownload = async () => {
    setDownloadStatus('downloading')
    try {
      await downloadManager.current.startDownload(modelUrl)
    } catch (err) {
      console.error('Download failed:', err)
      setDownloadStatus('idle')
    }
  }

  const handleCancelDownload = () => {
    downloadManager.current.cancelDownload()
    setDownloadStatus('idle')
  }

  return (
    <Modal onClose={() => {
      // Download continues in background when modal closes
    }}>
      {/* Settings UI with download progress */}
    </Modal>
  )
}
```

**Progress Notification Badge:**

When settings modal is closed but download is active:

```typescript
// chat-panel.tsx
export function ChatPanel() {
  const downloadProgress = useDownloadProgress()

  return (
    <div>
      <button onClick={openSettings} aria-label="Settings">
        <GearIcon />
        {downloadProgress && downloadProgress < 100 && (
          <Badge>
            <CircularProgress value={downloadProgress} size="small" />
            {Math.round(downloadProgress)}%
          </Badge>
        )}
        {downloadProgress === 100 && (
          <Badge>
            <CheckIcon />
          </Badge>
        )}
      </button>
    </div>
  )
}
```

**Key Features:**

1. **Non-blocking** - Settings can be closed while download continues
2. **Resumable** - Download state persisted to IndexedDB, can resume if interrupted
3. **Progress visibility** - Badge on settings icon shows download status
4. **User control** - Can cancel or re-download at any time
5. **Storage management** - Option to delete model to free up disk space

**Error Handling:**

- **Network failure** - Show retry button, optionally resume from last chunk
- **Insufficient space** - Check available storage before starting, warn user
- **Corrupted download** - Validate model integrity, offer re-download
- **Browser closed** - Download state saved, resume on next app open

---

## First-Time User Experience

### Initial State

When user opens chat panel for the **first time:**

1. Check localStorage for saved provider preference
2. If no preference, **auto-select local** provider
3. Show brief message explaining local vs remote with link to docs

### Welcome Message (Auto-Select Local)

```
Welcome to Noodles AI Assistant! 🎉

I'm running locally in your browser using WebLLM. This means:
✓ No API costs
✓ Works offline (after initial download)
✓ Your data never leaves your device

I need to download a ~2.3 GB model first. This will take 3-4 minutes
on a typical connection, but only happens once.

[Start Download]  [Use Remote API Instead]

Learn more about local vs remote models →
```

### Model Download Flow

**1. User clicks "Start Download"**

**2. Show download progress:**
```
Downloading Phi-3 Mini model...

████████████░░░░░░░░░░░░  45% (1.04 GB / 2.3 GB)

Estimated time remaining: 2 minutes

[Cancel Download]
```

**3. Loading progress:**
```
Initializing model...
▓▓▓▓▓▓▓▓░░░░  65%

This may take 10-15 seconds...
```

**4. Ready state:**
```
Model ready! You can now start chatting.

[Start Chatting]
```

### Fallback Flow (User Clicks "Use Remote API Instead")

**1. Show API key modal:**
```
Use Anthropic API

To use the remote API, you'll need an Anthropic API key.

API Key: [_________________________________]

[ ] Remember key across sessions

[Get API key →]  [Cancel]  [Continue]
```

**2. Validate key** (test API call)

**3. If valid, start chatting** with remote provider

### Progress Indicator UI

**In chat panel header:**
```
┌─────────────────────────────────────────────┐
│  🤖 Noodles Assistant          [⚙️] [─] [✕]  │
├─────────────────────────────────────────────┤
│  ⬇️ Downloading model: 45%                   │
│  ████████████░░░░░░░░░░░░  1.04 / 2.3 GB    │
│  Estimated 2 minutes remaining              │
├─────────────────────────────────────────────┤
│  [Messages area disabled during download]   │
└─────────────────────────────────────────────┘
```

### Error Handling

**WebGPU not supported:**
```
❌ Local AI requires WebGPU

Your browser doesn't support WebGPU, which is required for local AI.

Options:
• Use Chrome 113+, Edge 113+, or Safari 17+
• Use the remote API instead (requires API key)

[Use Remote API]  [Learn More]
```

**Download failed:**
```
❌ Download failed

The model download was interrupted. Please check your connection
and try again.

[Retry Download]  [Use Remote API]
```

**Model loading failed:**
```
❌ Model failed to load

The model couldn't be initialized. This may be due to insufficient
GPU memory or a corrupted download.

[Clear Cache & Retry]  [Use Remote API]
```

---

## Fallback to Remote API

### When to Suggest Fallback

**Automatic fallback (without prompting user):**
1. WebGPU not supported in browser
2. Model download fails after 3 retries
3. Model loading fails (initialization error)

**Prompt user for fallback:**
1. Response time > 10 seconds (model is too slow)
2. User explicitly asks for better/faster responses
3. Task complexity detected (long multi-step operation)

### Complexity Detection

**Heuristics to detect complex tasks:**
- User message > 500 characters
- User asks for "detailed", "comprehensive", "full" analysis
- User mentions multiple operators or complex workflows
- Task requires > 3 tool calls

**Prompt user:**

```text
This looks like a complex task. For better results, you can switch to
the remote API (powered by Claude). This requires an API key but
provides faster, higher-quality responses.

[Switch to Remote]  [Continue with Local]
```

### Switching Mid-Conversation

**UI element:**
- Button in chat panel: "Switch to Remote" / "Switch to Local"
- Shows current provider with icon (🏠 Local / ☁️ Remote)

**Behavior:**
1. User clicks "Switch to Remote"
2. If no API key saved, show API key modal
3. If API key valid, switch provider immediately
4. Conversation history preserved (compatible format)
5. Show message: "Switched to remote API. Next responses will be faster and higher quality."

**Switching back to local:**
- Reverse process, no API key needed
- Warn user if model not loaded yet

---

## Migration Strategy

### Replace Entirely (No Feature Flag)

**Rationale:**
- WebLLM version is a superset (has local + remote fallback)
- Current users can continue using remote via settings
- No need to maintain two implementations

### Code Changes

**Files to modify:**
1. `chat-panel.tsx` - Add provider selection, download progress UI
2. `claude-client.ts` - Refactor to implement provider interface
3. `mcp-tools.ts` - Convert tools to MCP format

**Files to create:**
1. `ai-controller.ts` - Provider selection and routing
2. `webllm-provider.ts` - WebLLM inference and streaming
3. `langchain-agent.ts` - Agent executor with tool calling
4. `rag-service.ts` - Documentation RAG
5. `web-search-service.ts` - Web search with caching
6. `provider-interface.ts` - Shared interface for providers

### Conversation History Compatibility

**Current format:**
```typescript
{
  id: string
  title: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: string | Array<{ type: 'text' | 'image', ... }>
  }>
  timestamp: number
}
```

**This format is compatible with WebLLM** - no migration needed.

**Edge case:** If conversation has cached Claude responses with tool use, preserve them as-is. WebLLM will continue the conversation with its own format.

---

## Cloud Provider Support

### Overview

In addition to local (WebLLM) and Anthropic providers, the system supports three additional cloud AI providers via LangChain.js:

- **AWS Bedrock** - Access Claude, Llama, Mistral, and Amazon Titan models
- **Google Vertex AI** - Access Gemini, PaLM, and Claude models
- **OpenAI** - Access GPT-4, GPT-4 Turbo, and GPT-3.5 models

All providers use the same unified interface and tool system, allowing seamless switching between providers.

### Why Cloud Providers?

**Use cases:**

- **Cost optimization**: Different providers have different pricing models
- **Model variety**: Access to different model families and capabilities
- **Compliance**: Some organizations require specific cloud providers
- **Experimentation**: Test different models for specific use cases
- **Redundancy**: Fallback options if one provider has issues

### LangChain.js Integration

**Architecture:**

```typescript
AIController
    ↓
Provider Interface
    ↓
┌────────────────────────────────────────────────┐
│  Local (WebLLM) │ Anthropic │ Bedrock │ Vertex │ OpenAI
└────────────────────────────────────────────────┘
    ↓
LangChain Agent Executor
    ↓
Tool Registry (MCP format)
```

**Benefits:**

- Unified API across all providers
- Consistent streaming implementation
- Shared tool calling protocol
- Easy to add new providers
- Built-in retry and error handling

### AWS Bedrock Provider

#### Bedrock Implementation

**File:** `noodles-editor/src/ai-chat/bedrock-provider.ts`

```typescript
import { BedrockChat } from '@langchain/community/chat_models/bedrock'
import { AIProvider } from './provider-interface'

export class BedrockProvider implements AIProvider {
  private model: BedrockChat

  constructor(config: BedrockConfig) {
    this.model = new BedrockChat({
      model: config.model || 'anthropic.claude-3-sonnet-20240229-v1:0',
      region: config.region || 'us-east-1',
      credentials: config.useIAMRole ? undefined : {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })
  }

  async initialize() {
    // Test connection with simple prompt
    await this.model.call([{ role: 'user', content: 'Hello' }])
  }

  async *generateCompletion(messages, tools) {
    const stream = await this.model.stream(messages, { tools })
    for await (const chunk of stream) {
      yield chunk.content
    }
  }

  isAvailable() {
    return true  // Always available with valid credentials
  }

  getStats() {
    return {
      tokensPerSecond: 100,  // Estimate based on network latency
      memoryUsage: 0,  // Cloud inference
      responseTime: 1000
    }
  }

  async dispose() {
    // No cleanup needed
  }
}
```

#### Bedrock Available Models

| Model ID | Description | Context | Cost (per 1M tokens)* |
|----------|-------------|---------|---------------------|
| `anthropic.claude-3-sonnet-20240229-v1:0` | Claude 3 Sonnet | 200K | ~$3-15 |
| `anthropic.claude-3-haiku-20240307-v1:0` | Claude 3 Haiku (fast) | 200K | ~$0.25-1.25 |
| `anthropic.claude-3-opus-20240229-v1:0` | Claude 3 Opus (best) | 200K | ~$15-75 |
| `meta.llama3-70b-instruct-v1:0` | Llama 3 70B | 8K | ~$2.50-3.50 |
| `mistral.mistral-large-2402-v1:0` | Mistral Large | 32K | ~$8-24 |

*Pricing is approximate and varies by region. Check [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) for current rates.

#### Bedrock Authentication

#### Option 1: Access Keys (localStorage)

```typescript
{
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1'
}
```

#### Option 2: IAM Role (for EC2/ECS deployments)

```typescript
{
  useIAMRole: true,
  region: 'us-east-1'
}
```

#### Permissions Required

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/*"
    }
  ]
}
```

#### Bedrock Setup Guide

1. **Get AWS Account**: Sign up at [aws.amazon.com](https://aws.amazon.com/)
2. **Request Model Access**: Go to Bedrock console → Model access → Request access for desired models
3. **Create Access Keys**: IAM → Users → Security credentials → Create access key
4. **Configure in Settings**:
   - Select "AWS Bedrock" provider
   - Choose region (e.g., us-east-1, us-west-2)
   - Select model
   - Enter access key ID and secret
   - Test connection

### Google Vertex AI Provider

#### Vertex Implementation

**File:** `noodles-editor/src/ai-chat/vertex-provider.ts`

```typescript
import { ChatVertexAI } from '@langchain/google-vertexai'
import { AIProvider } from './provider-interface'

export class VertexProvider implements AIProvider {
  private model: ChatVertexAI

  constructor(config: VertexConfig) {
    this.model = new ChatVertexAI({
      model: config.model || 'gemini-1.5-pro',
      location: config.location || 'us-central1',
      authOptions: {
        credentials: JSON.parse(config.serviceAccountKey)
      }
    })
  }

  async initialize() {
    // Test with simple prompt
    await this.model.call([{ role: 'user', content: 'Hello' }])
  }

  async *generateCompletion(messages, tools) {
    const stream = await this.model.stream(messages, { tools })
    for await (const chunk of stream) {
      yield chunk.content
    }
  }

  isAvailable() {
    return true
  }

  getStats() {
    return {
      tokensPerSecond: 80,
      memoryUsage: 0,
      responseTime: 1500
    }
  }

  async dispose() {
    // No cleanup needed
  }
}
```

#### Vertex Available Models

| Model ID | Description | Context | Cost (per 1M tokens)* |
|----------|-------------|---------|---------------------|
| `gemini-1.5-pro` | Gemini 1.5 Pro | 2M | ~$3.50-10.50 |
| `gemini-1.5-flash` | Gemini 1.5 Flash (fast) | 1M | ~$0.35-1.05 |
| `gemini-1.0-pro` | Gemini 1.0 Pro | 32K | ~$0.50-1.50 |
| `claude-3-opus@20240229` | Claude 3 Opus via Vertex | 200K | ~$15-75 |
| `claude-3-sonnet@20240229` | Claude 3 Sonnet via Vertex | 200K | ~$3-15 |

*Pricing is approximate and varies by region. Check [Google Cloud Vertex AI pricing](https://cloud.google.com/vertex-ai/pricing) for current rates.

#### Vertex Authentication

#### Service Account Key (JSON)

```json
{
  "type": "service_account",
  "project_id": "my-project-123456",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "noodles-ai@my-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

#### Vertex Permissions Required

- `aiplatform.endpoints.predict`
- `aiplatform.endpoints.streamingPredict`

#### Vertex Setup Guide

1. **Get Google Cloud Account**: Sign up at [cloud.google.com](https://cloud.google.com/)
2. **Enable Vertex AI API**: Console → APIs & Services → Enable Vertex AI API
3. **Create Service Account**:
   - IAM & Admin → Service Accounts → Create
   - Grant "Vertex AI User" role
   - Create JSON key
4. **Configure in Settings**:
   - Select "Google Vertex AI" provider
   - Enter project ID
   - Choose location (us-central1, europe-west1, etc.)
   - Select model
   - Upload or paste service account key JSON
   - Test connection

### OpenAI Provider

#### OpenAI Implementation

**File:** `noodles-editor/src/ai-chat/openai-provider.ts`

```typescript
import { ChatOpenAI } from '@langchain/openai'
import { AIProvider } from './provider-interface'

export class OpenAIProvider implements AIProvider {
  private model: ChatOpenAI

  constructor(config: OpenAIConfig) {
    this.model = new ChatOpenAI({
      modelName: config.model || 'gpt-4-turbo',
      openAIApiKey: config.apiKey,
      organization: config.organization
    })
  }

  async initialize() {
    // Test with simple prompt
    await this.model.call([{ role: 'user', content: 'Hello' }])
  }

  async *generateCompletion(messages, tools) {
    const stream = await this.model.stream(messages, { tools })
    for await (const chunk of stream) {
      yield chunk.content
    }
  }

  isAvailable() {
    return true
  }

  getStats() {
    return {
      tokensPerSecond: 120,
      memoryUsage: 0,
      responseTime: 800
    }
  }

  async dispose() {
    // No cleanup needed
  }
}
```

#### OpenAI Available Models

| Model ID | Description | Context | Cost (per 1M tokens)* |
|----------|-------------|---------|---------------------|
| `gpt-4-turbo` | GPT-4 Turbo (latest) | 128K | ~$10-30 |
| `gpt-4` | GPT-4 | 8K | ~$30-60 |
| `gpt-4-32k` | GPT-4 32K | 32K | ~$60-120 |
| `gpt-3.5-turbo` | GPT-3.5 Turbo (fast, cheap) | 16K | ~$0.50-1.50 |

*Pricing is approximate and varies by region. Check [OpenAI pricing](https://openai.com/pricing) for current rates.

#### OpenAI Authentication

#### API Key

```typescript
{
  apiKey: 'sk-proj-...',
  organization: 'org-...' // Optional
}
```

#### OpenAI Setup Guide

1. **Get OpenAI Account**: Sign up at [platform.openai.com](https://platform.openai.com/)
2. **Create API Key**: API Keys → Create new secret key
3. **Add Credits**: Billing → Add payment method
4. **Configure in Settings**:
   - Select "OpenAI" provider
   - Enter API key
   - (Optional) Enter organization ID
   - Select model
   - Test connection

### Provider Comparison

| Provider | Best For | Pros | Cons |
|----------|----------|------|------|
| **Local (WebLLM)** | Privacy, offline work | Free, private, offline | Slower, requires GPU |
| **Anthropic** | High-quality responses | Best quality, fast | Costs money, cloud-only |
| **AWS Bedrock** | AWS infrastructure | Multiple models, IAM auth | AWS account required |
| **Vertex AI** | Google Cloud users | Gemini models, GCP integration | GCP account required |
| **OpenAI** | Fastest responses | Very fast, well-documented | Most expensive |

### Cost Estimation

#### Example: 100 conversations per month

Assumptions:

- Average 10 messages per conversation
- Average 200 tokens per message
- Total: 100 conversations × 10 messages × 200 tokens = 200K tokens/month

| Provider | Model | Monthly Cost |
|----------|-------|--------------|
| Local | Phi-3 Mini | $0 |
| Anthropic | Claude 3 Sonnet | ~$0.60 input + $3.00 output = **$3.60** |
| Bedrock | Claude 3 Haiku | ~$0.05 input + $0.25 output = **$0.30** |
| Vertex AI | Gemini 1.5 Flash | ~$0.07 input + $0.21 output = **$0.28** |
| OpenAI | GPT-3.5 Turbo | ~$0.10 input + $0.30 output = **$0.40** |

### Cloud Provider Implementation Phases

#### Phase 1: Core Providers

- Local (WebLLM)
- Anthropic

#### Phase 2: Cloud Providers

- AWS Bedrock
- Google Vertex AI
- OpenAI

#### Phase 3: Optimization

- Model-specific prompt tuning
- Cost tracking UI
- Usage analytics

### Dependencies

```json
{
  "dependencies": {
    "@langchain/community": "^0.3.11",
    "@langchain/openai": "^0.3.2",
    "@langchain/google-vertexai": "^0.1.2",
    "@aws-sdk/client-bedrock-runtime": "^3.621.0"
  }
}
```

### Cloud Provider Security Considerations

#### Credential Storage

- All credentials stored in localStorage (user's browser only)
- Never sent to Noodles.gl servers
- Option to use sessionStorage for temporary credentials
- Clear warning about storing credentials

#### Best Practices

- Use IAM roles when possible (Bedrock)
- Rotate API keys regularly
- Monitor usage for unexpected charges
- Set billing alerts on cloud providers
- Use separate keys for development/production

#### User Education

- Explain cloud vs local privacy trade-offs
- Link to each provider's privacy policy
- Warn about costs before enabling
- Show estimated monthly costs based on usage

---

### Rollout Plan

**Phase 1: Core WebLLM integration**

- Implement WebLLM provider
- Basic tool calling with LangChain
- Settings UI for provider selection
- First-time UX with model download

**Phase 2: RAG & Web Search**

- Generate documentation embeddings
- Implement RAG service with voy
- Implement web search with DuckDuckGo
- Add new tools to registry

**Phase 3: Polish & Testing**

- Error handling and fallback flows
- Performance optimization
- User documentation
- Developer documentation

**Phase 4: Release**

- Deploy to production
- Monitor usage and errors
- Gather user feedback
- Iterate on prompt and tools

---

## Documentation Requirements

### User Documentation

**New page:** `docs/users/ai-assistant.md`

**Outline:**
```markdown
# AI Assistant

## Overview
- What is the AI Assistant?
- How does it help with visualizations?

## Getting Started
- Opening the chat panel
- First-time setup (local vs remote)
- Model download process

## Local vs Remote Models
- **Local (WebLLM)**
  - Pros: Free, offline, private
  - Cons: Slower, requires powerful device
  - Requirements: WebGPU support, ~3 GB disk space
- **Remote (Anthropic)**
  - Pros: Fast, high quality
  - Cons: API costs, requires internet
  - Requirements: API key

## Using the Assistant
- Asking questions about operators
- Creating visualizations
- Debugging projects
- Getting examples

## Settings
- Switching providers
- Changing models
- Managing conversation history

## Troubleshooting
- WebGPU not supported → Use remote API or upgrade browser
- Model download failed → Check connection, retry
- Slow responses → Consider switching to remote API
- Out of memory → Close other tabs, restart browser

## Privacy & Security
- Local models: All data stays in browser
- Remote API: Data sent to Anthropic (see their privacy policy)
- API keys stored in browser localStorage (can opt out)
```

### Developer Documentation

**New page:** `dev-docs/webllm-ai-integration.md`

**Outline:**
```markdown
# WebLLM AI Integration

## Architecture
- Provider abstraction
- LangChain agent executor
- Tool registry and MCP format

## Components
- `ai-controller.ts` - Provider routing
- `webllm-provider.ts` - Model inference
- `langchain-agent.ts` - Tool calling loop
- `rag-service.ts` - Documentation search
- `web-search-service.ts` - Web search

## Adding New Tools
- Define MCP schema
- Implement execute function
- Register in tool registry
- Test with both providers

## RAG System
- Documentation corpus
- Embedding generation (build-time)
- Vector search with voy
- Query pipeline

## Web Search
- DuckDuckGo API integration
- Caching strategy
- Rate limiting

## Testing
- Unit tests for tools
- Integration tests for providers
- E2E tests for critical workflows

## Performance Optimization
- Model caching in IndexedDB
- Lazy loading of embeddings
- Streaming responses
- Token optimization

## Debugging
- WebLLM console logs
- LangChain agent tracing
- Tool execution logging
```

---

## Implementation Phases

### Phase 1: Core WebLLM Integration

**Goals:**

- Basic WebLLM inference working
- Provider abstraction layer
- LangChain tool calling
- Settings UI

**Tasks:**

1. Install dependencies (`@mlc-ai/web-llm`, `langchain`, `@langchain/community`)
2. Create provider interface (`provider-interface.ts`)
3. Implement WebLLM provider (`webllm-provider.ts`)
   - Model loading with progress
   - Streaming completions
   - Error handling
4. Refactor Claude client to provider interface (`anthropic-provider.ts`)
5. Create AI controller (`ai-controller.ts`)
   - Provider selection based on settings
   - Route messages to providers
   - Handle streaming from both
6. Convert tools to MCP format (`mcp-tools.ts`)
   - Preserve existing logic
   - Add Zod schemas
   - Test with both providers
7. Implement LangChain agent (`langchain-agent.ts`)
   - Multi-turn tool calling loop
   - Tool result formatting
   - Error handling
8. Update chat panel UI (`chat-panel.tsx`)
   - Provider selection
   - Download progress
   - Settings modal
   - First-time UX
9. Add settings persistence (localStorage)

**Deliverable:** Users can chat with WebLLM, existing tools work, can switch to Anthropic

### Phase 2: RAG & Web Search

**Goals:**

- Documentation search working
- Web search with caching
- Pre-generated embeddings

**Tasks:**

1. Install dependencies (`@xenova/transformers`, `voy-search`)
2. Create RAG service (`rag-service.ts`)
   - Load embedding model
   - Initialize voy database
   - Implement search function
3. Create embedding generation script (`scripts/generate-rag-embeddings.ts`)
   - Glob all docs
   - Chunk markdown
   - Generate embeddings
   - Save to binary format
4. Update build scripts
   - Add `generate:rag` to package.json
   - Run in CI before build
5. Implement `search_documentation` tool
6. Create web search service (`web-search-service.ts`)
   - DuckDuckGo API client
   - HTML text extraction
   - Result embedding
   - Cache in voy with TTL
7. Implement `search_web` tool
8. Add rate limiting for web search
9. Enable code search tools (`search_code`, `get_source_code`)
   - Integrate with GitHub API
   - Add to tool registry

**Deliverable:** AI can search docs and web, answer questions beyond system prompt

### Phase 3: Polish & Testing

**Goals:**

- Robust error handling
- Performance optimization
- Comprehensive testing

**Tasks:**

1. Error handling improvements
   - WebGPU detection
   - Model loading failures
   - Network errors for web search
   - Graceful degradation
2. Performance optimization
   - Lazy load embedding model
   - Cache embeddings in IndexedDB
   - Debounce web searches
   - Optimize token usage
3. Unit tests
   - Test each tool in isolation
   - Test providers with mock models
   - Test RAG search accuracy
4. Integration tests
   - Test provider switching
   - Test tool calling loop
   - Test conversation history
5. E2E tests (Playwright)
   - First-time setup flow
   - Create visualization via chat
   - Debug project with AI
   - Switch providers mid-conversation
6. Performance benchmarks
   - Measure response time
   - Measure memory usage
   - Compare local vs remote

**Deliverable:** Production-ready, well-tested implementation

### Phase 4: Documentation & Release

**Goals:**

- Complete documentation
- Deploy to production
- Monitor and iterate

**Tasks:**

1. Write user documentation (`docs/users/ai-assistant.md`)
2. Write developer documentation (`dev-docs/webllm-ai-integration.md`)
3. Update AGENTS.md with WebLLM details
4. Create video tutorial (optional)
5. Deploy to production
6. Monitor errors in production
   - Set up error tracking (Sentry?)
   - Monitor API fallback rate
   - Track model download success rate
7. Gather user feedback
   - In-app feedback form
   - GitHub issues
   - User interviews
8. Iterate on prompt and tools
   - Tune system prompt for WebLLM
   - Add missing tools based on feedback
   - Improve error messages

**Deliverable:** Shipped feature, documentation, monitoring in place

---

## Testing Strategy

### Unit Tests

**Test coverage:**
- All tools (each tool has dedicated test)
- Provider implementations (mock WebLLM API)
- RAG service (mock voy database)
- Web search service (mock DuckDuckGo API)
- LangChain agent (mock tool calls)

**Example test:**
```typescript
// mcp-tools.test.ts
describe('capture_visualization', () => {
  it('should capture screenshot with default settings', async () => {
    const result = await tools.capture_visualization.execute({})
    expect(result).toHaveProperty('image')
    expect(result).toHaveProperty('width')
    expect(result).toHaveProperty('height')
  })

  it('should respect maxWidth parameter', async () => {
    const result = await tools.capture_visualization.execute({ maxWidth: 512 })
    expect(result.width).toBeLessThanOrEqual(512)
  })
})
```

### Integration Tests

**Test scenarios:**
- Provider switching preserves conversation
- Tool calls work with both providers
- RAG returns relevant docs
- Web search caches results
- Error handling falls back correctly

**Example test:**
```typescript
// ai-controller.test.ts
describe('AIController', () => {
  it('should switch from local to remote mid-conversation', async () => {
    const controller = new AIController({ provider: 'local' })
    await controller.sendMessage('Hello')

    controller.switchProvider('remote', { apiKey: 'test-key' })
    await controller.sendMessage('How do I load CSV?')

    expect(controller.conversationHistory).toHaveLength(4)  // 2 exchanges
    expect(controller.currentProvider).toBe('remote')
  })
})
```

### E2E Tests (Playwright)

**Critical user journeys:**
1. **First-time setup (local)**
   - Open chat panel
   - See welcome message
   - Start model download
   - Wait for download
   - Send first message
   - Receive response

2. **Create visualization via chat**
   - Ask AI to create a scatterplot
   - AI calls `apply_modifications` tool
   - Node appears in graph
   - Verify node has correct inputs

3. **Debug project with AI**
   - User reports error
   - AI calls `get_console_errors` tool
   - AI suggests fix
   - Apply fix
   - Verify error resolved

4. **Switch providers**
   - Start with local provider
   - Click "Switch to Remote"
   - Enter API key
   - Continue conversation
   - Verify responses come from remote

**Example E2E test:**
```typescript
// ai-chat.spec.ts
test('should create scatterplot via chat', async ({ page }) => {
  await page.goto('http://localhost:5173/?project=example')

  // Open chat
  await page.click('[aria-label="AI Assistant"]')

  // Wait for model ready (or use mock)
  await page.waitForSelector('text=Model ready', { timeout: 60000 })

  // Send message
  await page.fill('[placeholder="Ask me anything..."]', 'Create a scatterplot layer showing points at random locations in NYC.')
  await page.click('button:has-text("Send")')

  // Wait for response
  await page.waitForSelector('text=I\'ve created a ScatterplotLayer')

  // Verify node exists
  const node = await page.locator('[data-id*="ScatterplotLayerOp"]')
  expect(node).toBeVisible()
})
```

### Performance Benchmarks

**Metrics to track:**

- Model load time (target: < 5 seconds from cache)
- First token time (target: < 2 seconds)
- Tokens per second (target: > 20 tok/sec on M1 MBP)
- Memory usage (target: < 4 GB total)
- Tool execution time (target: < 500ms per tool)
- RAG search latency (target: < 100ms)

---

## Performance Targets

### Model Loading

| Metric | Target | Notes |
|--------|--------|-------|
| Initial download time | < 5 minutes | On 10 Mbps connection |
| Load from cache | < 5 seconds | Subsequent loads |
| Memory usage (idle) | < 500 MB | Model loaded, not inferencing |
| Memory usage (active) | < 4 GB | During inference |

### Inference

| Metric | Target | Notes |
|--------|--------|-------|
| First token latency | < 2 seconds | Time to first token |
| Tokens per second | > 20 tok/sec | On M1 MacBook Pro |
| Total response time | < 10 seconds | For typical 50-100 token response |
| Tool call overhead | < 500ms | Per tool execution |

### RAG & Search

| Metric | Target | Notes |
|--------|--------|-------|
| Doc search latency | < 100ms | After embeddings loaded |
| Web search latency | < 3 seconds | First search (cache miss) |
| Web search latency | < 50ms | Cached result |
| Embedding generation | < 500ms | Per query |

### UI Responsiveness

| Metric | Target | Notes |
|--------|--------|-------|
| Settings modal open | < 100ms | Instant |
| Provider switch | < 2 seconds | If model already loaded |
| Message send to first token | < 2.5 seconds | Total perceived latency |
| Streaming update frequency | 10-20 updates/sec | Smooth streaming UX |

---

## System Prompt Strategy

### Overview

The system prompt is critical for guiding the AI's behavior, tool usage, and response quality. The current `system-prompt.md` is highly tuned for Claude Sonnet, but smaller local models like Phi-3 have different characteristics that require adaptation.

### Key Differences: Claude vs Local Models

| Aspect | Claude Sonnet | Phi-3 / Local Models |
|--------|--------------|---------------------|
| Context window | 200K tokens | 4K tokens |
| Instruction following | Highly reliable | Good but less consistent |
| Tool calling | Native, robust | Via function calling format |
| Multi-step reasoning | Excellent | Good for 2-3 steps |
| Edge case handling | Strong | May struggle |
| Response length | Can be verbose | Tends to be concise |

### Prompt Adaptation Strategy

#### Phase 1: Unified Prompt (MVP)

Start with a single prompt that works for both providers:

- **Simplify structure:** Remove nested conditionals and advanced patterns
- **Explicit instructions:** Be very clear about when/how to use each tool
- **Add examples:** Include 2-3 few-shot examples for common tasks
- **Shorten context:** Keep within 2K tokens to leave room for conversation

#### Phase 2: Provider-Specific Tuning (Post-Launch)

If quality issues arise, create separate prompts:

- **WebLLM prompt:** Simpler, more examples, explicit tool guidance
- **Anthropic prompt:** Current sophisticated approach

### Prompt Structure (Unified Version)

```markdown
# System Prompt for Noodles AI Assistant

You are an AI assistant for Noodles.gl, a node-based geospatial visualization tool.

## Your Capabilities

You can help users:
1. Create visualizations (maps, layers, animations)
2. Debug errors (check console, inspect layers)
3. Find documentation and examples
4. Search for data sources

## Available Tools

[List of 17 tools with clear descriptions of when to use each]

## Critical Patterns

### Creating a Visualization

1. Search for data if needed: `search_web("NYC bike share API")`
2. Create nodes: `apply_modifications([FileOp, ScatterplotLayerOp])`
3. Verify: `get_node_info("/scatterplot-1")`

### Debugging Errors

1. Check console: `get_console_errors()`
2. Inspect problematic node: `get_node_info(nodeId)`
3. Suggest fix or apply modification

### Finding Information

1. Search docs first: `search_documentation("how to load CSV")`
2. If not found, search web: `search_web("DuckDB CSV loading")`

## Important Rules

- Always use fully qualified paths (e.g., `/data-loader`)
- Handle naming: `out.fieldName` for outputs, `par.fieldName` for inputs
- Create nodes before connecting them
- Check for errors before claiming success

## Example Conversations

[2-3 complete examples showing tool usage]
```

### Prompt Optimization Techniques

**For Phi-3 and similar models:**

1. **Structure Instructions as Lists**
   - ✅ "To create a map: 1) Load data 2) Create layer 3) Verify"
   - ❌ "You should first load the data, then create an appropriate layer, and finally verify it works"

2. **Use Explicit Tool Triggers**
   - ✅ "If user mentions errors, call `get_console_errors()`"
   - ❌ "You may want to check for errors in relevant situations"

3. **Provide Concrete Examples**
   - ✅ Show full tool call JSON with actual parameters
   - ❌ Generic descriptions without examples

4. **Limit Conditional Logic**
   - ✅ "Always check errors first when debugging"
   - ❌ "Check errors if the user seems to be having trouble, unless they've explicitly said otherwise"

5. **Emphasize Critical Patterns**
   - Repeat important instructions
   - Use bold/caps for critical rules
   - Put common patterns first

### Token Budget Management

**System Prompt:** ~2000 tokens (target)

- Core instructions: 800 tokens
- Tool descriptions: 800 tokens
- Examples: 400 tokens

**Conversation History:** Default 7 messages = ~1500 tokens

- Configurable up to 20 messages
- Warn users that longer history = slower responses

**Total Context Usage:** ~3500 tokens, leaving ~500 tokens for tool definitions and user input

### Monitoring & Iteration

**Track these metrics:**

1. **Tool Call Success Rate**
   - What % of tool calls execute successfully?
   - Which tools fail most often?

2. **User Corrections**
   - How often do users correct the AI?
   - What types of mistakes are made?

3. **Task Completion Rate**
   - What % of conversations end with user satisfaction?
   - Which task types have highest failure rate?

4. **Response Quality Comparison**
   - A/B test: Same prompts on local vs remote
   - Track user preference signals

**Iteration Process:**

1. **Initial deployment:** Deploy unified prompt, gather baseline metrics
2. **Early phase:** Identify pain points in local model responses
3. **If needed:** Create separate WebLLM prompt based on quality issues
4. **Ongoing:** Continuously refine based on usage data

### Specific Prompt Adjustments for Common Issues

#### Issue: Model forgets to use tools

**Fix:** Add explicit checklist at prompt start:

```markdown
## Before Responding

Ask yourself:
1. Can I answer from docs? → Use `search_documentation`
2. Need implementation details? → Use `search_code`
3. User reports error? → Use `get_console_errors`
4. Creating/modifying nodes? → Use `apply_modifications`
```

#### Issue: Model creates invalid modifications

**Fix:** Add validation examples:

```markdown
## Invalid vs Valid Modifications

❌ WRONG: Creating edge before nodes exist
✓ CORRECT: Create nodes first, then edges

❌ WRONG: Using `in.data` as targetHandle
✓ CORRECT: Using `par.data` as targetHandle
```

#### Issue: Model doesn't handle errors gracefully

**Fix:** Add explicit error handling pattern:

```markdown
## When Tool Fails

1. Retry once with different parameters
2. If still fails, explain to user:
   - What you tried
   - Why it might have failed
   - What user can try instead
```

### Testing the Prompt

**Manual Testing Scenarios:**

1. **Create visualization from scratch**
   - "Show me earthquake data as a heatmap"
   - Verify: Correct sequence of tool calls

2. **Debug a broken project**
   - "My map isn't showing, help!"
   - Verify: Checks console, inspects nodes, suggests fix

3. **Find information**
   - "How do I animate a path over time?"
   - Verify: Searches docs, provides relevant info

4. **Complex multi-step task**
   - "Load NYC subway data, filter to Brooklyn lines, show as colored routes"
   - Verify: Breaks down correctly, handles each step

**Automated Testing:**

```typescript
// prompt-quality.test.ts
describe('System Prompt Quality', () => {
  it('should call correct tools for visualization task', async () => {
    const response = await testPrompt('Create a map of airports')
    expect(response.tools).toContain('search_web')
    expect(response.tools).toContain('apply_modifications')
  })

  it('should check console when user reports error', async () => {
    const response = await testPrompt('Nothing is showing up')
    expect(response.tools).toContain('get_console_errors')
  })
})
```

---

## Design Decisions

### Model Selection

**Decision:** Phi-3 Mini as default, with dropdown for Llama-3-8B, Qwen2.5-3B, and custom URLs.

**Rationale:** Balances ease of use (curated list) with flexibility (custom URLs) without maintenance burden of supporting many models.

### RAG Corpus Scope

**Decision:** Docs + operator schemas only. Implementation details via `search_code` tool.

**Rationale:** Keeps index small (~10 MB) and fast while still providing access to codebase through tools when needed.

### Web Search Fallback

**Decision:** Fail gracefully, note SearXNG as potential future backup.

**Rationale:** Simplifies MVP, avoids complexity. DuckDuckGo should be reliable enough for initial release.

### Conversation History

**Decision:** Default 7 messages, configurable 3-20, warn about performance impact.

**Rationale:** Optimizes for speed while giving power users flexibility. Default matches current implementation.

### Streaming UX

**Decision:** Show tool calls immediately, don't wait for completion.

**Rationale:** Keeps users informed during slow operations (web search, file operations). More responsive feel.

### Error Recovery

**Decision:** Retry once automatically, then ask user what to do.

**Rationale:** Balances UX (automatic recovery) with transparency (user involvement if problem persists).

### Mobile Support

**Decision:** Desktop only for MVP.

**Rationale:** WebGPU support limited, model size too large, touch UI needs work. Revisit in Phase 2.

### Model Updates

**Decision:** Prompt user when updates available, don't auto-download.

**Rationale:** Respects user bandwidth/metered connections. Gives user control over large downloads.

### Analytics

**Decision:** Basic opt-in analytics (provider choice, error rates). No PII or conversation content.

**Rationale:** Helps prioritize improvements while respecting privacy. Must be opt-in and anonymous.

---

## Appendix A: Tool Schemas

### Complete MCP Tool Definitions

See [mcp-tools.ts](../../noodles-editor/src/ai-chat/mcp-tools.ts) for full implementations. All existing tools will be preserved with MCP-compatible schemas.

**New tools:**

```typescript
// search_web
{
  name: "search_web",
  description: "Search the web for information using DuckDuckGo. Returns up to 5 relevant results with titles, URLs, and snippets.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'NYC bike share data API')"
      }
    },
    required: ["query"]
  }
}

// search_documentation
{
  name: "search_documentation",
  description: "Search Noodles.gl documentation for operators, APIs, and workflows. Returns relevant doc snippets with source references.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'how to load CSV files')"
      },
      limit: {
        type: "number",
        description: "Max results to return (default: 5)",
        default: 5
      }
    },
    required: ["query"]
  }
}
```

---

## Appendix B: Example Conversations

### Example 1: Create Scatterplot (Local Model)

**User:** Show me all bike share stations in NYC as a scatterplot.

**Assistant:** I'll help you create a scatterplot of NYC bike share stations. Let me search for the data source first.

*[Tool call: search_web("NYC bike share station data API")]*

**Tool result:**
```json
{
  "results": [
    {
      "title": "NYC Citi Bike System Data",
      "url": "https://citibikenyc.com/system-data",
      "snippet": "Real-time station data available at https://gbfs.citibikenyc.com/gbfs/en/station_information.json"
    }
  ]
}
```

**Assistant:** Great! I found the Citi Bike station data. I'll create a visualization using that API.

*[Tool call: apply_modifications({...})]*

**Tool result:** Successfully added FileOp and ScatterplotLayerOp nodes.

**Assistant:** Done! I've created a scatterplot showing all 1,500+ Citi Bike stations across NYC. The visualization includes:
- Red markers for each station
- Data loaded from the official Citi Bike API
- Markers sized by station capacity

You can zoom in to see individual stations or adjust the colors in the ScatterplotLayer node.

### Example 2: Debug Console Errors (Local Model)

**User:** My visualization isn't showing up. Can you help?

**Assistant:** Let me check for any errors in the console.

*[Tool call: get_console_errors()]*

**Tool result:**
```json
{
  "errors": [
    {
      "message": "Cannot read property 'data' of undefined",
      "source": "ScatterplotLayerOp",
      "timestamp": 1699564123000
    }
  ]
}
```

**Assistant:** I found an error in your ScatterplotLayer. It looks like the `data` input is undefined. Let me check your project structure.

*[Tool call: get_node_info({ nodeId: "/scatterplot-1" })]*

**Tool result:**
```json
{
  "node": { "id": "/scatterplot-1", "type": "ScatterplotLayerOp" },
  "inputs": { "data": null },
  "connections": []
}
```

**Assistant:** The issue is that your ScatterplotLayer doesn't have any data connected. You need to connect a data source (like FileOp) to its data input. Would you like me to add a data loader for you?

**User:** Yes please, load the bike share data.

**Assistant:** *[Continues with apply_modifications...]*

---

## Appendix C: Dependencies

### NPM Packages

```json
{
  "dependencies": {
    "@mlc-ai/web-llm": "^0.2.70",
    "langchain": "^0.3.5",
    "@langchain/community": "^0.3.11",
    "@xenova/transformers": "^2.17.2",
    "voy-search": "^0.6.3"
  }
}
```

### Type Definitions

```typescript
// provider-interface.ts
export interface AIProvider {
  initialize(): Promise<void>
  generateCompletion(messages: Message[], tools: Tool[]): AsyncGenerator<string>
  isAvailable(): boolean
  getStats(): { tokensPerSecond: number, memoryUsage: number }
}

// ai-controller.ts
export interface AIControllerConfig {
  provider: 'local' | 'remote'
  localModel?: string
  apiKey?: string
  historyLength?: number
}

// rag-service.ts
export interface RagQuery {
  query: string
  limit?: number
  filters?: { source?: string[], type?: string[] }
}

export interface RagResult {
  content: string
  metadata: {
    source: string
    file: string
    heading?: string
    score: number
  }
}

// web-search-service.ts
export interface SearchResult {
  title: string
  url: string
  snippet: string
  timestamp: number
}

export interface SearchCache {
  query: string
  results: SearchResult[]
  expiresAt: number
}
```

---

**End of Specification**

For questions or clarifications, please open an issue on GitHub or contact the development team.
