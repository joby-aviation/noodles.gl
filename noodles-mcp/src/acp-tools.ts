// The MCP server an ACP agent starts to reach the editor's tools. The bridge
// (acp-bridge.ts) puts it in every session/new, with the address and token to
// call back on in its environment.
//
// It holds no tools of its own: the list and every call go to the connected
// tab, which runs them through the same definitions as the in-app chat
// (noodles-editor/src/ai-chat/tool-definitions.ts). The tab decides what is on
// offer, so a tool gated off there (run_code in safe mode) is absent here too.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import { TOOLS_SERVER_NAME } from './acp-bridge.ts'

export type Forward = (method: 'listTools' | 'callTool', params: unknown) => Promise<unknown>

export function createToolsServer(forward: Forward): Server {
  const server = new Server(
    { name: TOOLS_SERVER_NAME, version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => (await forward('listTools', {})) as ListToolsResult
  )

  // A failed call is a result the model can read and recover from, not a
  // protocol error that ends its turn
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      return (await forward('callTool', request.params)) as CallToolResult
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      }
    }
  })

  return server
}

// Calls back into the bridge that started this process's agent
export function forwardFromEnv(env: NodeJS.ProcessEnv): Forward {
  const url = env.NOODLES_ACP_TOOLS_URL
  const token = env.NOODLES_ACP_TOOLS_TOKEN
  const connection = env.NOODLES_ACP_CONNECTION
  if (!url || !token || !connection) {
    throw new Error(
      'acp-tools is started by the ACP bridge (noodles-mcp acp), not by hand: NOODLES_ACP_TOOLS_URL, NOODLES_ACP_TOOLS_TOKEN and NOODLES_ACP_CONNECTION are not set.'
    )
  }

  return async (method, params) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ connection, method, params }),
    })
    const body = (await response.json()) as { result?: unknown; error?: string }
    if (!response.ok || body.error) {
      throw new Error(body.error ?? `The bridge answered ${response.status}`)
    }
    return body.result
  }
}
