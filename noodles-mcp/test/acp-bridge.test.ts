import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import {
  type Bridge,
  CLOSE_AGENT_EXITED,
  CLOSE_AGENT_FAILED,
  CLOSE_REPLACED,
  startBridge,
  TOOLS_SERVER_NAME,
} from '../src/acp-bridge.ts'
import { parseAcpArgs } from '../src/index.ts'

const FAKE_AGENT = fileURLToPath(new URL('./fixtures/fake-acp-agent.ts', import.meta.url))
const ORIGIN = 'http://localhost:5173'
const TOKEN = 'test-token'

interface Message {
  id?: string | number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { message: string }
}

// The tab's side of the bridge: sends requests, answers the bridge's tool calls
// the way the chat panel does, and collects notifications
class Tab {
  notifications: Message[] = []
  toolCalls: unknown[] = []
  private nextId = 1
  private waiting = new Map<number, (message: Message) => void>()
  readonly socket: WebSocket

  constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', data => {
      const message = JSON.parse(data.toString()) as Message
      if (message.method === 'noodles/listTools') {
        this.reply(message.id, {
          tools: [
            { name: 'list_nodes', description: 'List nodes', inputSchema: { type: 'object' } },
          ],
        })
      } else if (message.method === 'noodles/callTool') {
        this.toolCalls.push(message.params)
        this.reply(message.id, { content: [{ type: 'text', text: '3 nodes' }] })
      } else if (message.method) {
        this.notifications.push(message)
      } else if (typeof message.id === 'number') {
        const resolve = this.waiting.get(message.id)
        if (typeof resolve === 'function') resolve(message)
      }
    })
  }

  static open(bridge: Bridge, options: { origin?: string; token?: string } = {}): Promise<Tab> {
    const url = bridge.url.replace(TOKEN, options.token ?? TOKEN)
    const socket = new WebSocket(url, { origin: options.origin ?? ORIGIN })
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(new Tab(socket)))
      socket.once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))))
      socket.once('error', reject)
    })
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<Message> {
    const id = this.nextId++
    return new Promise(resolve => {
      this.waiting.set(id, resolve)
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  closed(): Promise<{ code: number; reason: string }> {
    return new Promise(resolve =>
      this.socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    )
  }

  private reply(id: unknown, result: unknown) {
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }
}

describe('ACP bridge', () => {
  let bridge: Bridge

  before(async () => {
    bridge = await startBridge({
      command: process.execPath,
      args: [FAKE_AGENT],
      cwd: '/tmp',
      port: 0,
      origins: [ORIGIN],
      token: TOKEN,
    })
  })

  after(() => bridge.close())

  it('refuses a page from another origin', async () => {
    await assert.rejects(Tab.open(bridge, { origin: 'https://evil.example' }), /403/)
  })

  it('refuses the wrong token', async () => {
    await assert.rejects(Tab.open(bridge, { token: 'guess' }), /401/)
  })

  it('relays a prompt turn, with the editor tools reaching the agent over MCP', async () => {
    const tab = await Tab.open(bridge)
    const init = await tab.request('initialize', { protocolVersion: 1 })
    assert.equal(init.result?.protocolVersion, 1)

    // Whatever the tab asks for, the bridge decides the cwd and the servers
    const session = await tab.request('session/new', {
      cwd: '/somewhere/else',
      mcpServers: [{ name: 'injected', command: 'rm', args: ['-rf', '/'], env: [] }],
    })
    assert.deepEqual(session.result?._meta, { cwd: '/tmp', servers: [TOOLS_SERVER_NAME] })

    const prompt = await tab.request('session/prompt', {
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'how many nodes?' }],
    })
    assert.equal(prompt.result?.stopReason, 'end_turn')
    assert.deepEqual(tab.toolCalls, [{ name: 'list_nodes', arguments: { probe: true } }])
    const [chunk] = tab.notifications
    assert.deepEqual((chunk.params?.update as { content?: unknown } | undefined)?.content, {
      type: 'text',
      text: 'list_nodes: 3 nodes',
    })
    tab.socket.close()
  })

  it('keeps an agent printing non-JSON off the socket', async () => {
    const tab = await Tab.open(bridge)
    const reply = await tab.request('test/log')
    assert.deepEqual(reply.result, {})
    assert.deepEqual(tab.notifications, [])
    tab.socket.close()
  })

  it('closes the socket when the agent exits', async () => {
    const tab = await Tab.open(bridge)
    const closed = tab.closed()
    tab.socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'test/exit' }))
    assert.deepEqual(await closed, {
      code: CLOSE_AGENT_EXITED,
      reason: 'The agent exited with code 3',
    })
  })

  it('hands the agent to the newest tab', async () => {
    const first = await Tab.open(bridge)
    const closed = first.closed()
    const second = await Tab.open(bridge)
    assert.equal((await closed).code, CLOSE_REPLACED)
    const init = await second.request('initialize', { protocolVersion: 1 })
    assert.equal(init.result?.protocolVersion, 1)
    second.socket.close()
  })

  it('serves the tools endpoint only to the tools server', async () => {
    const tools = `http://127.0.0.1:${bridge.port}/tools`
    const body = JSON.stringify({ connection: 'x', method: 'listTools' })
    const fromPage = await fetch(tools, { method: 'POST', body, headers: { Origin: ORIGIN } })
    assert.equal(fromPage.status, 403)
    const noToken = await fetch(tools, { method: 'POST', body })
    assert.equal(noToken.status, 401)
  })
})

describe('ACP bridge with an agent that stops reading its input', () => {
  it('closes that connection and keeps serving', async () => {
    // Alive, but with its stdin closed, so the bridge's next write hits a
    // closed pipe. Unhandled, the EPIPE would crash this process.
    const bridge = await startBridge({
      command: '/bin/sh',
      args: ['-c', 'exec 0<&- sleep 30'],
      cwd: '/tmp',
      port: 0,
      origins: [ORIGIN],
      token: TOKEN,
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      const tab = await Tab.open(bridge)
      const closed = tab.closed()
      const flood = setInterval(() => {
        if (tab.socket.readyState === WebSocket.OPEN) {
          tab.socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'noop', params: {} }))
        }
      }, 10)
      const { code } = await closed
      clearInterval(flood)
      assert.equal(code, CLOSE_AGENT_EXITED)
    }
    await bridge.close()
  })
})

describe('ACP bridge with a token that needs escaping', () => {
  it('prints a URL that still authenticates', async () => {
    const bridge = await startBridge({
      command: process.execPath,
      args: [FAKE_AGENT],
      cwd: '/tmp',
      port: 0,
      origins: [ORIGIN],
      token: 'a+b&c#d e',
    })
    const tab = await Tab.open(bridge)
    const init = await tab.request('initialize', { protocolVersion: 1 })
    assert.equal(init.result?.protocolVersion, 1)
    tab.socket.close()
    await bridge.close()
  })
})

describe('ACP bridge with an agent that will not start', () => {
  it('says so in the close reason', async () => {
    const bridge = await startBridge({
      command: '/no/such/agent',
      args: [],
      cwd: '/tmp',
      port: 0,
      origins: [ORIGIN],
      token: TOKEN,
    })
    const tab = await Tab.open(bridge)
    const { code, reason } = await tab.closed()
    assert.equal(code, CLOSE_AGENT_FAILED)
    assert.match(reason, /Could not start \/no\/such\/agent/)
    await bridge.close()
  })
})

describe('parseAcpArgs', () => {
  it('takes the agent command after --', () => {
    const args = parseAcpArgs(['--port', '9000', '--', 'npx', '-y', 'agent'], '/work', {})
    assert.deepEqual(args, {
      command: 'npx',
      args: ['-y', 'agent'],
      cwd: '/work',
      port: 9000,
      origins: ['https://noodles.gl', 'http://localhost:5173', 'http://127.0.0.1:5173'],
      token: undefined,
    })
  })

  it('adds origins as a browser sends them, and reads the token from the environment', () => {
    const args = parseAcpArgs(
      ['--allow-origin', 'https://preview.example.com/app/', 'agent'],
      '/work',
      { NOODLES_ACP_TOKEN: 'saved' }
    )
    assert.ok('origins' in args)
    assert.equal(args.origins.at(-1), 'https://preview.example.com')
    assert.equal(args.token, 'saved')
  })

  it('needs an agent', () => {
    assert.ok('error' in parseAcpArgs(['--port', '9000'], '/work', {}))
    assert.ok('error' in parseAcpArgs(['--bogus', 'agent'], '/work', {}))
  })
})
