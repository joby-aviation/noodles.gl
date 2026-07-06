// Registers the shared AI tool surface on navigator.modelContext (WebMCP).
// External MCP clients (Claude Code, Claude Desktop, Cursor) reach these tools
// through the WebMCP browser extension, native Chrome (origin trial), or the
// @mcp-b/webmcp-local-relay stdio bridge.

// Pulls in the global Document/Navigator modelContext type augmentation
/// <reference types="@mcp-b/webmcp-types" />

import type { InputSchema } from '@mcp-b/webmcp-types'
import { globalContextManager } from '../ai-chat/global-context-manager'
import { MCPTools } from '../ai-chat/mcp-tools'
import { type ToolDefinition, toolDefinitions } from '../ai-chat/tool-definitions'
import type { ProjectModification, ToolResult } from '../ai-chat/types'
import type { ProjectModification as ReactFlowModification } from '../noodles/hooks/use-project-modifications'
import { safeStringify } from '../noodles/utils/serialization'
import { debugWebMCP } from '../utils/debug'
import { getCurrentProject, getModificationApplier, onProjectChange } from './bridge'

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
    // transports that bridge tools to the WebMCP extension / local relay
    await import('@mcp-b/global')

    // Load the context bundles (code index, docs, examples) so the search/docs
    // tools work even if the chat panel never opened. On failure those tools
    // degrade to error results.
    const loader = await globalContextManager.waitForReady().catch(error => {
      debugWebMCP('context load failed, search/docs tools degraded:', error)
      return undefined
    })

    if (signal.aborted) return

    const tools = new MCPTools(loader)
    const project = getCurrentProject()
    if (project) tools.setProject(project)
    const unsubscribe = onProjectChange(p => tools.setProject(p))
    signal.addEventListener('abort', unsubscribe)

    for (const definition of toolDefinitions) {
      navigator.modelContext.registerTool(
        {
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema as InputSchema,
          execute: async (args: Record<string, unknown>) =>
            toToolResponse(definition.name, await runTool(tools, definition, args ?? {})),
        },
        { signal }
      )
    }

    debugWebMCP('registered %d tools on navigator.modelContext', toolDefinitions.length)
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
    const result = await definition.execute(tools, params, getCurrentProject)

    // apply_modifications only validates in MCPTools — the actual graph
    // mutation goes through the editor's applier registered in the bridge
    if (definition.name === 'apply_modifications' && result.success) {
      return applyToEditor(result)
    }

    return result
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function applyToEditor(validationResult: ToolResult): ToolResult {
  const applier = getModificationApplier()
  if (!applier) {
    return { success: false, error: 'Editor not mounted — open a project first' }
  }

  const data = validationResult.data as { modifications?: ProjectModification[] } | undefined
  const modifications = data?.modifications
  if (!modifications || modifications.length === 0) {
    return { success: false, error: 'No modifications to apply' }
  }

  // The editor applier expects React Flow node/edge shapes; the validated
  // modifications carry the same structure (chat-panel.tsx does the same cast)
  const applied = applier(modifications as unknown as ReactFlowModification[])
  if (!applied.success) {
    return { success: false, error: applied.error ?? 'Failed to apply modifications' }
  }

  return {
    success: true,
    data: {
      modificationsCount: modifications.length,
      warnings: applied.warnings,
      message: `${modifications.length} modification(s) applied to the project`,
    },
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
