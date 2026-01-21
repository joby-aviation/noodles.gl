/**
 * Example WebSocket server for bridging external tools to Noodles
 *
 * This server acts as a bridge between external AI tools (like Claude Code)
 * and the Noodles application running in the browser.
 *
 * Architecture:
 * External Tool <-> This Server <-> Noodles Browser App
 *
 * Usage:
 * 1. Install dependencies: npm install ws
 * 2. Run server: node server-example.js
 * 3. Open Noodles with external control enabled
 * 4. Connect external tools to this server
 */

const WebSocket = require('ws')

const PORT = 8765
const clients = new Set()
const noodlesConnections = new Set()

// Create WebSocket server
const wss = new WebSocket.Server({
  port: PORT,
  clientTracking: true,
})

console.log(`WebSocket bridge server running on ws://localhost:${PORT}`)

wss.on('connection', (ws, req) => {
  const clientAddress = req.socket.remoteAddress
  console.log(`New connection from ${clientAddress}`)

  // Determine if this is Noodles or an external client
  // In a real implementation, you'd use authentication or headers
  const isNoodles = req.headers['user-agent']?.includes('Mozilla')

  if (isNoodles) {
    noodlesConnections.add(ws)
    console.log('Noodles app connected')
  } else {
    clients.add(ws)
    console.log('External client connected')
  }

  // Handle messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString())
      console.log('Received message:', message.type, message.id)

      // Route messages between clients and Noodles
      if (isNoodles) {
        // Message from Noodles -> forward to external clients
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data)
          }
        }
      } else {
        // Message from external client -> forward to Noodles
        for (const noodles of noodlesConnections) {
          if (noodles.readyState === WebSocket.OPEN) {
            noodles.send(data)
          }
        }
      }
    } catch (error) {
      console.error('Error processing message:', error)
    }
  })

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error)
  })

  // Handle disconnection
  ws.on('close', () => {
    if (isNoodles) {
      noodlesConnections.delete(ws)
      console.log('Noodles app disconnected')
    } else {
      clients.delete(ws)
      console.log('External client disconnected')
    }
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

// Handle server errors
wss.on('error', (error) => {
  console.error('Server error:', error)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...')

  // Close all connections
  for (const client of wss.clients) {
    client.close(1000, 'Server shutting down')
  }

  wss.close(() => {
    console.log('Server shut down')
    process.exit(0)
  })
})

console.log('Bridge server ready. Waiting for connections...')
console.log('To connect Noodles: http://localhost:5173/examples/nyc-taxis?externalControl=true')
console.log('To test: Run create-pipeline.js in another terminal')