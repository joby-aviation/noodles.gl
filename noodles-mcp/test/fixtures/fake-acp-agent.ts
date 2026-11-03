// A stand-in ACP agent for the bridge tests. Answers initialize and
// session/new, reporting back the cwd and MCP servers the bridge gave it, and on
// session/prompt calls the editor's tools through that MCP server the way a
// real agent would, then streams what came back as its reply.

import { createInterface } from 'node:readline'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

interface StdioServer {
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

let server: StdioServer | undefined
const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`)

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line)
  const { id, method, params } = message

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'fake' } },
    })
  } else if (method === 'session/new') {
    server = params.mcpServers[0]
    send({
      jsonrpc: '2.0',
      id,
      result: {
        sessionId: 'session-1',
        _meta: { cwd: params.cwd, servers: params.mcpServers.map((s: StdioServer) => s.name) },
      },
    })
  } else if (method === 'session/prompt') {
    if (!server) throw new Error('session/prompt before session/new')
    const client = new Client({ name: 'fake-agent', version: '0' })
    await client.connect(
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: Object.fromEntries(server.env.map(entry => [entry.name, entry.value])),
      })
    )
    const { tools } = await client.listTools()
    const result = await client.callTool({ name: tools[0].name, arguments: { probe: true } })
    await client.close()
    const [content] = result.content as Array<{ type: string; text: string }>
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `${tools[0].name}: ${content.text}` },
        },
      },
    })
    send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } })
  } else if (method === 'test/exit') {
    process.exit(3)
  } else if (method === 'test/log') {
    // Not JSON, which the bridge must keep off the socket
    process.stdout.write('starting up...\n')
    send({ jsonrpc: '2.0', id, result: {} })
  }
}
