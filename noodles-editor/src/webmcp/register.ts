// Registers the shared AI tool surface on navigator.modelContext (WebMCP).
// External MCP clients (Claude Code, Claude Desktop, Cursor) reach these tools
// through the WebMCP browser extension, native Chrome (origin trial), or the
// @mcp-b/webmcp-local-relay stdio bridge.

// Pulls in the global Document/Navigator modelContext type augmentation
/// <reference types="@mcp-b/webmcp-types" />

import type { InputSchema } from '@mcp-b/webmcp-types'
import { globalContextManager } from '../ai-chat/global-context-manager'
import { MCPTools } from '../ai-chat/mcp-tools'
import { availableToolDefinitions, type ToolDefinition } from '../ai-chat/tool-definitions'
import type { ToolResult } from '../ai-chat/types'
import { safeStringify } from '../noodles/utils/serialization'
import { debugWebMCP } from '../utils/debug'
import { getCurrentProject } from './bridge'

interface ContentBlock {
  type: string
  [key: string]: unknown
}

interface ToolResponse {
  content: ContentBlock[]
  isError?: boolean
}

// Guards against double registration (registerTool throws on duplicate names)
// when HMR remounts the provider before the previous AbortSignal fires
let active = false

export async function initWebMCP(signal: AbortSignal): Promise<void> {
  if (active) {
    debugWebMCP('already initialized, skipping')
    return
  }
  active = true
  signal.addEventListener('abort', () => {
    active = false
  })

  try {
    // Side-effect import: installs the navigator.modelContext polyfill and the
    // transports that bridge tools to the WebMCP extension / local relay.
    // Note: zod-to-json-schema in package.json exists solely to satisfy this
    // package's top-level optional-peer import — vite build fails without it,
    // even though we only pass plain JSON Schema (its Zod path needs Zod 3)
    await import('@mcp-b/global')

    // Load the context bundles (code index, docs, examples) so the search/docs
    // tools work even if the chat panel never opened. On failure those tools
    // degrade to error results.
    const loader = await globalContextManager.waitForReady().catch(error => {
      debugWebMCP('context load failed, search/docs tools degraded:', error)
      return undefined
    })

    if (signal.aborted) return

    // The tools read and edit the editor's document directly
    const tools = new MCPTools(loader)

    // Skips tools this session does not offer — run_code is absent in safe mode,
    // which external clients have to respect for the same reason the chat does.
    // Includes the external-only tools (export_video) the chat never sees.
    const definitions = availableToolDefinitions({ includeExternal: true })

    for (const definition of definitions) {
      navigator.modelContext.registerTool(
        {
          name: definition.name,
          description: definition.description,
          annotations: definition.annotations,
          inputSchema: definition.inputSchema as InputSchema,
          execute: async (args: Record<string, unknown>) =>
            toToolResponse(definition.name, await runTool(tools, definition, args ?? {})),
        },
        { signal }
      )
    }

    debugWebMCP('registered %d tools on navigator.modelContext', definitions.length)
  } catch (error) {
    active = false
    throw error
  }
}

// Executes a tool definition, never letting exceptions escape to the transport
async function runTool(
  tools: MCPTools,
  definition: ToolDefinition,
  params: Record<string, unknown>
): Promise<ToolResult> {
  try {
    return await definition.execute(tools, params, getCurrentProject)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Converts a ToolResult into the WebMCP/MCP CallToolResult shape
function toToolResponse(toolName: string, result: ToolResult): ToolResponse {
  if (!result.success) {
    return {
      content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
      isError: true,
    }
  }

  // Screenshots go back as a proper MCP image block; the base64 payload is
  // stripped from the text metadata to keep it readable
  if (toolName === 'capture_visualization' && isScreenshotData(result.data)) {
    const { screenshot, format = 'jpeg', ...meta } = result.data
    return {
      content: [
        { type: 'image', data: screenshot, mimeType: `image/${format}` },
        { type: 'text', text: JSON.stringify({ format, ...meta }) },
      ],
    }
  }

  return {
    content: [{ type: 'text', text: stringifyData(result.data) }],
  }
}

function stringifyData(data: unknown): string {
  // safeStringify sanitizes functions/circular refs but only accepts objects
  if (typeof data === 'object' && data !== null) {
    return safeStringify(data as Record<string, unknown>).trimEnd()
  }
  return JSON.stringify(data) ?? 'null'
}

function isScreenshotData(
  data: unknown
): data is { screenshot: string; format?: 'png' | 'jpeg'; [key: string]: unknown } {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { screenshot?: unknown }).screenshot === 'string'
  )
}
