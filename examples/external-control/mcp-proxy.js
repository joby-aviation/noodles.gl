#!/usr/bin/env node

// MCP Proxy Server for Noodles
//
// This proxy bridges Claude Desktop (via stdio MCP) to Noodles running in the browser (via WebSocket).
//
// Architecture:
// Claude Desktop <--stdio/MCP--> This Proxy <--WebSocket--> Noodles Browser App
//
// Usage:
// 1. Add to Claude Desktop config (~/.config/claude/claude_desktop_config.json):
//    {
//      "mcpServers": {
//        "noodles": {
//          "command": "node",
//          "args": ["/path/to/mcp-proxy.js"]
//        }
//      }
//    }
// 2. Open Noodles with external control enabled:
//    http://localhost:5173/examples/nyc-taxis?externalControl=true
// 3. The proxy will connect automatically when Claude Desktop starts

const WebSocket = require('ws')
const readline = require('readline')

// Configuration
const CONFIG = {
  wsPort: 8765,
  wsHost: 'localhost',
  reconnectDelay: 3000,
  requestTimeout: 30000,
}

// MCP Protocol version
const PROTOCOL_VERSION = '2024-11-05'

// Server info
const SERVER_INFO = {
  name: 'noodles',
  version: '1.0.0',
}

// Pending requests waiting for browser response
const pendingRequests = new Map()

// WebSocket connection to browser
let browserWs = null
let wsServer = null

// Tool definitions that match what Noodles exposes
const TOOLS = [
  {
    name: 'getCurrentProject',
    description: 'Get the current Noodles project state including all nodes and edges',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'listNodes',
    description: 'List all nodes in the current project with their types and states',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getNodeInfo',
    description: 'Get detailed information about a specific node including connections and schema',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node to inspect (e.g., "/file-loader")',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'getNodeOutput',
    description: 'Get the output data from a node. Useful for inspecting data flow.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node',
        },
        maxRows: {
          type: 'number',
          description: 'Maximum rows to return for array data (default: 10)',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'createNode',
    description: 'Create a new node in the Noodles project',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Operator type (e.g., "FileOp", "FilterOp", "ScatterplotLayerOp")',
        },
        id: {
          type: 'string',
          description: 'Node ID (optional, will be generated if not provided)',
        },
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          description: 'Position on canvas (default: {x: 100, y: 100})',
        },
        inputs: {
          type: 'object',
          description: 'Initial input values for the node',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'connectNodes',
    description: 'Create a connection (edge) between two nodes',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'Source node ID',
        },
        targetId: {
          type: 'string',
          description: 'Target node ID',
        },
        sourceField: {
          type: 'string',
          description: 'Source output field (default: "out.result")',
        },
        targetField: {
          type: 'string',
          description: 'Target input field (default: "par.data")',
        },
      },
      required: ['sourceId', 'targetId'],
    },
  },
  {
    name: 'deleteNode',
    description: 'Delete a node and its connections from the project',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'ID of the node to delete',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'captureVisualization',
    description: 'Capture a screenshot of the current Noodles visualization',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description: 'Image format (default: "png")',
        },
        quality: {
          type: 'number',
          description: 'JPEG quality 0-1 (default: 0.9)',
        },
      },
      required: [],
    },
  },
  {
    name: 'getConsoleErrors',
    description: 'Get recent console errors and warnings from Noodles',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of errors to return (default: 10)',
        },
        level: {
          type: 'string',
          enum: ['error', 'warn', 'all'],
          description: 'Filter by error level (default: "all")',
        },
      },
      required: [],
    },
  },
  {
    name: 'getRenderStats',
    description: 'Get deck.gl rendering statistics (FPS, memory usage, etc.)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'listOperatorTypes',
    description: 'List all available operator types that can be used to create nodes',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'createPipeline',
    description: 'Create a complete data pipeline with multiple nodes and connections',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              position: {
                type: 'object',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
              },
              data: {
                type: 'object',
                properties: {
                  inputs: { type: 'object' },
                },
              },
            },
            required: ['id', 'type'],
          },
          description: 'Array of nodes to create',
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              sourceHandle: { type: 'string' },
              targetHandle: { type: 'string' },
            },
            required: ['source', 'target', 'sourceHandle', 'targetHandle'],
          },
          description: 'Array of edges connecting the nodes',
        },
      },
      required: ['nodes', 'edges'],
    },
  },
]

// Logging to stderr (stdout is for MCP messages)
function log(...args) {
  console.error('[MCP-Proxy]', ...args)
}

// Send MCP message to stdout
function sendMcpMessage(message) {
  const json = JSON.stringify(message)
  process.stdout.write(json + '\n')
}

// Send JSON-RPC response
function sendResponse(id, result) {
  sendMcpMessage({
    jsonrpc: '2.0',
    id,
    result,
  })
}

// Send JSON-RPC error
function sendError(id, code, message, data) {
  sendMcpMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  })
}

// Generate unique request ID
let requestIdCounter = 0
function generateRequestId() {
  return `proxy-${Date.now()}-${++requestIdCounter}`
}

// Forward tool call to browser and wait for response
async function forwardToBrowser(toolName, args) {
  return new Promise((resolve, reject) => {
    if (!browserWs || browserWs.readyState !== WebSocket.OPEN) {
      reject(new Error('Noodles browser is not connected. Please open Noodles with ?externalControl=true'))
      return
    }

    const requestId = generateRequestId()
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('Request timeout - Noodles did not respond'))
    }, CONFIG.requestTimeout)

    pendingRequests.set(requestId, { resolve, reject, timeout })

    // Send to browser using the existing message protocol
    const message = {
      id: requestId,
      type: 'tool_call',
      timestamp: Date.now(),
      payload: {
        tool: toolName,
        args,
      },
    }

    browserWs.send(JSON.stringify(message))
  })
}

// Handle MCP request
async function handleMcpRequest(request) {
  const { id, method, params } = request

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
      })
      break

    case 'notifications/initialized':
      // Client acknowledged initialization
      log('MCP client initialized')
      break

    case 'tools/list':
      sendResponse(id, {
        tools: TOOLS,
      })
      break

    case 'tools/call': {
      const { name, arguments: args } = params

      try {
        const result = await forwardToBrowser(name, args || {})

        // Format response based on result
        if (result.success) {
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.result || result.data, null, 2),
              },
            ],
          })
        } else {
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: `Error: ${result.error?.message || result.error || 'Unknown error'}`,
              },
            ],
            isError: true,
          })
        }
      } catch (error) {
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        })
      }
      break
    }

    case 'ping':
      sendResponse(id, {})
      break

    default:
      sendError(id, -32601, `Method not found: ${method}`)
  }
}

// Handle message from browser
function handleBrowserMessage(data) {
  try {
    const message = JSON.parse(data.toString())
    log('Received from browser:', message.type, message.id)

    // Check if this is a response to a pending request
    if (message.type === 'tool_response' || message.type === 'tool_error') {
      const pending = pendingRequests.get(message.id)
      if (pending) {
        clearTimeout(pending.timeout)
        pendingRequests.delete(message.id)

        if (message.type === 'tool_error') {
          pending.resolve({
            success: false,
            error: message.payload.error,
          })
        } else {
          pending.resolve({
            success: true,
            result: message.payload.result,
          })
        }
      }
    }
  } catch (error) {
    log('Error parsing browser message:', error)
  }
}

// Start WebSocket server for browser connections
function startWebSocketServer() {
  wsServer = new WebSocket.Server({ port: CONFIG.wsPort })

  wsServer.on('listening', () => {
    log(`WebSocket server listening on ws://${CONFIG.wsHost}:${CONFIG.wsPort}`)
  })

  wsServer.on('connection', (ws, req) => {
    const clientAddress = req.socket.remoteAddress
    log(`Browser connected from ${clientAddress}`)

    browserWs = ws

    ws.on('message', handleBrowserMessage)

    ws.on('close', () => {
      log('Browser disconnected')
      if (browserWs === ws) {
        browserWs = null
      }
    })

    ws.on('error', (error) => {
      log('WebSocket error:', error.message)
    })

    // Send ping to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
      } else {
        clearInterval(pingInterval)
      }
    }, 30000)
  })

  wsServer.on('error', (error) => {
    log('WebSocket server error:', error.message)
  })
}

// Start MCP stdio interface
function startMcpInterface() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  rl.on('line', (line) => {
    try {
      const request = JSON.parse(line)
      handleMcpRequest(request)
    } catch (error) {
      log('Error parsing MCP request:', error.message)
    }
  })

  rl.on('close', () => {
    log('MCP interface closed')
    cleanup()
  })
}

// Cleanup on exit
function cleanup() {
  if (wsServer) {
    wsServer.close()
  }
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

// Main
log('Starting Noodles MCP Proxy...')
log('Waiting for:')
log('  1. Claude Desktop to connect via stdio')
log('  2. Noodles browser to connect via WebSocket')

startWebSocketServer()
startMcpInterface()
