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
import { toToolResponse } from '../ai-chat/tool-response'
import type { ToolResult } from '../ai-chat/types'
import { debugWebMCP } from '../utils/debug'

// Guards against double registration (registerTool throws on duplicate names)
// when HMR remounts the provider before the previous AbortSignal fires
let active = false

/**
 * Whether external clients may change the project, not only read it: on localhost, or when the
 * page opts in with `?agentAccess=read-write` (#756). Elsewhere `?externalControl=true` offers
 * only the read-only tools, so a link to a deployed editor can't hand a page's project to an
 * agent to edit.
 */
export function allowsWrites(location: Pick<Location, 'hostname' | 'search'> = window.location) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  return local || new URLSearchParams(location.search).get('agentAccess') === 'read-write'
}

export async function initWebMCP(
  signal: AbortSignal,
  { allowWrites = allowsWrites() }: { allowWrites?: boolean } = {}
): Promise<void> {
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
    // Without write access, only the tools that change nothing (readOnlyHint)
    const definitions = availableToolDefinitions({ includeExternal: true }).filter(
      d => allowWrites || d.annotations.readOnlyHint
    )

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

    debugWebMCP(
      'registered %d tools on navigator.modelContext%s',
      definitions.length,
      allowWrites ? '' : ' (read-only; add ?agentAccess=read-write to allow changes)'
    )
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
    return await definition.execute(tools, params)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
