// A local bridge between the editor's chat panel and an ACP agent
// (https://agentclientprotocol.com): Claude through claude-agent-acp, Codex
// through codex-acp, Gemini CLI, Goose, OpenCode, and the rest.
//
// ACP agents speak JSON-RPC over stdio, and a browser tab cannot start a
// process. This starts the agent for the tab and passes each message between
// the agent's stdio and one WebSocket, unchanged except for session/new: there
// it sets the working directory, which the tab cannot know, and hands the agent
// the editor's own tools as an MCP server (acp-tools.ts) whose calls come back
// here and go to the tab over the same socket.
//
// The socket drives a coding agent that can run shell commands, so two checks
// stand between it and every other page the user has open: the page's Origin
// has to be on the allowlist, and it has to present the token printed at start.

import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { type WebSocket, WebSocketServer } from 'ws'

export const DEFAULT_PORT = 7341

// The hosted app and the dev server. Anything else (a fork's deployment, a
// preview build) is added with --allow-origin.
export const DEFAULT_ORIGINS = [
  'https://noodles.gl',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

// What the agent calls the editor's tools. Not 'noodles': in this repo
// .mcp.json already registers the docs server under that name, and an agent
// that reads project settings would see two servers with one name.
export const TOOLS_SERVER_NAME = 'noodles-editor'

// Close codes the panel tells apart. 4000-4999 are free for applications.
export const CLOSE_AGENT_EXITED = 4001
export const CLOSE_AGENT_FAILED = 4002
export const CLOSE_REPLACED = 4003

// A tool call waits on the tab, which can be busy (a capture, a long query) but
// should never take minutes
const TOOL_TIMEOUT_MS = 120_000

// Prefix for the ids of requests the bridge itself sends the tab, so their
// responses can be told apart from the tab's responses to the agent
const BRIDGE_ID_PREFIX = 'noodles-bridge:'

const BIN = fileURLToPath(new URL('../bin/noodles-mcp.ts', import.meta.url))

export interface BridgeOptions {
  command: string
  args: string[]
  // The agent's working directory, and the cwd every session/new is given
  cwd: string
  // 0 picks a free port
  port: number
  origins: string[]
  // Fixed so a saved connection URL keeps working across restarts. Random when
  // omitted.
  token?: string
  log?: (line: string) => void
}

export interface Bridge {
  // What the user pastes into the editor's settings
  url: string
  port: number
  close(): Promise<void>
}

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface PendingRequest {
  resolve: (message: JsonRpcMessage) => void
  timer: NodeJS.Timeout
}

// One tab, one agent process. A second tab connecting replaces the first rather
// than sharing its agent: two chats steering one session would interleave.
class Connection {
  readonly id = randomUUID()
  private agent: ChildProcess
  private pending = new Map<string, PendingRequest>()
  private nextId = 0
  private closed = false
  private socket: WebSocket
  private options: BridgeOptions
  private toolsServer: () => Record<string, unknown>
  private onClosed: () => void

  constructor(
    socket: WebSocket,
    options: BridgeOptions,
    toolsServer: () => Record<string, unknown>,
    onClosed: () => void
  ) {
    this.socket = socket
    this.options = options
    this.toolsServer = toolsServer
    this.onClosed = onClosed
    const log = options.log ?? (() => {})
    this.agent = spawn(options.command, options.args, {
      cwd: options.cwd,
      // stderr is the agent's log, so it goes to the terminal running the bridge
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    this.agent.on('error', error => {
      log(`Could not start ${options.command}: ${error.message}`)
      this.close(CLOSE_AGENT_FAILED, `Could not start ${options.command}: ${error.message}`)
    })
    this.agent.on('exit', (code, signal) => {
      if (this.closed) return
      const how = signal ? `signal ${signal}` : `code ${code}`
      log(`Agent exited with ${how}`)
      this.close(CLOSE_AGENT_EXITED, `The agent exited with ${how}`)
    })

    const lines = createInterface({ input: this.agent.stdout as NodeJS.ReadableStream })
    lines.on('line', line => {
      if (!line.trim()) return
      // A message is one line of JSON. Anything else on stdout is an agent
      // logging where it should not, and the tab would fail to parse it.
      try {
        JSON.parse(line)
      } catch {
        log(`agent: ${line}`)
        return
      }
      this.socket.send(line)
    })

    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      let message: JsonRpcMessage
      try {
        message = JSON.parse(data.toString())
      } catch {
        log('Ignored a message from the tab that is not JSON')
        return
      }
      if (this.settle(message)) return
      this.toAgent(this.rewrite(message))
    })
    socket.on('close', () => this.close())
  }

  // Sends the tab a request of the bridge's own and waits for its answer
  request(method: string, params: unknown): Promise<JsonRpcMessage> {
    const id = `${BRIDGE_ID_PREFIX}${this.nextId++}`
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(errorMessage(id, `The editor did not answer ${method} in time`))
      }, TOOL_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  close(code?: number, reason?: string) {
    if (this.closed) return
    this.closed = true
    for (const [id, { resolve, timer }] of this.pending) {
      clearTimeout(timer)
      resolve(errorMessage(id, 'The editor disconnected'))
    }
    this.pending.clear()
    if (this.agent.exitCode === null && this.agent.signalCode === null) this.agent.kill()
    // A close reason is capped at 123 bytes
    if (this.socket.readyState === this.socket.OPEN) this.socket.close(code, reason?.slice(0, 120))
    this.onClosed()
  }

  // A response to one of the bridge's own requests
  private settle(message: JsonRpcMessage): boolean {
    if (message.method !== undefined || typeof message.id !== 'string') return false
    const pending = this.pending.get(message.id)
    if (!pending) return false
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    pending.resolve(message)
    return true
  }

  // The tab knows neither this machine's paths nor how to start the tools
  // server, and should not choose commands for the agent to run, so both are
  // set here whatever the tab sent
  private rewrite(message: JsonRpcMessage): JsonRpcMessage {
    if (message.method !== 'session/new' && message.method !== 'session/load') return message
    return {
      ...message,
      params: { ...message.params, cwd: this.options.cwd, mcpServers: [this.toolsServer()] },
    }
  }

  private toAgent(message: JsonRpcMessage) {
    if (this.closed || !this.agent.stdin?.writable) return
    this.agent.stdin.write(`${JSON.stringify(message)}\n`)
  }
}

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const token = options.token ?? randomBytes(24).toString('base64url')
  // Separate from the tab's token, for the tools server the agent starts. It
  // travels in that process's environment and never reaches a page.
  const toolsToken = randomBytes(24).toString('base64url')
  const connections = new Map<string, Connection>()
  const log = options.log ?? (() => {})
  let port = options.port

  const server = createServer((req, res) => {
    handleToolsRequest(req, res, toolsToken, connections).catch(error => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const origin = req.headers.origin
    const refuse = (status: number, why: string) => {
      log(`Refused a connection from ${origin ?? 'no origin'}: ${why}`)
      socket.end(`HTTP/1.1 ${status} ${why}\r\nConnection: close\r\n\r\n`)
    }
    if (url.pathname !== '/acp') return refuse(404, 'Not Found')
    if (!origin || !options.origins.includes(origin)) return refuse(403, 'Origin not allowed')
    if (!sameSecret(url.searchParams.get('token'), token)) return refuse(401, 'Bad token')

    wss.handleUpgrade(req, socket, head, ws => {
      for (const previous of connections.values()) {
        previous.close(CLOSE_REPLACED, 'Another tab connected to this bridge')
      }
      const connection: Connection = new Connection(
        ws,
        options,
        () => ({
          name: TOOLS_SERVER_NAME,
          command: process.execPath,
          args: [BIN, 'acp-tools'],
          env: [
            { name: 'NOODLES_ACP_TOOLS_URL', value: `http://127.0.0.1:${port}/tools` },
            { name: 'NOODLES_ACP_TOOLS_TOKEN', value: toolsToken },
            { name: 'NOODLES_ACP_CONNECTION', value: connection.id },
          ],
        }),
        () => connections.delete(connection.id)
      )
      connections.set(connection.id, connection)
      log(`Editor connected from ${origin}`)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    // Loopback only: nothing on the network should reach an agent with a shell
    server.listen(options.port, '127.0.0.1', () => resolve())
  })
  port = (server.address() as AddressInfo).port

  return {
    url: `ws://127.0.0.1:${port}/acp?token=${token}`,
    port,
    close: async () => {
      for (const connection of connections.values()) connection.close()
      wss.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

// The tools server's calls, from the agent's side of the bridge. Pages have no
// business here, so any request carrying an Origin is refused before the token
// is even read.
async function handleToolsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  toolsToken: string,
  connections: Map<string, Connection>
) {
  if (req.method !== 'POST' || req.url !== '/tools')
    return sendJson(res, 404, { error: 'Not found' })
  if (req.headers.origin) return sendJson(res, 403, { error: 'Not available to web pages' })
  const auth = req.headers.authorization ?? ''
  if (!sameSecret(auth.replace(/^Bearer /, ''), toolsToken)) {
    return sendJson(res, 401, { error: 'Bad token' })
  }

  const body = JSON.parse(await readBody(req)) as {
    connection?: string
    method?: string
    params?: unknown
  }
  if (body.method !== 'listTools' && body.method !== 'callTool') {
    return sendJson(res, 400, { error: `Unknown method ${body.method}` })
  }
  const connection = connections.get(body.connection ?? '')
  if (!connection) return sendJson(res, 410, { error: 'The editor tab is no longer connected' })

  const reply = await connection.request(`noodles/${body.method}`, body.params ?? {})
  if (reply.error) return sendJson(res, 502, { error: reply.error.message })
  sendJson(res, 200, { result: reply.result })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function errorMessage(id: string, message: string): JsonRpcMessage {
  return { jsonrpc: '2.0', id, error: { code: -32603, message } }
}

// Constant-time, so the token cannot be guessed a byte at a time from timings
function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
