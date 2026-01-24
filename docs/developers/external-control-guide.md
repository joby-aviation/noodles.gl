# External Control API Guide

The Noodles External Control API allows AI tools, scripts, and external applications to programmatically control the Noodles visualization platform. This enables automated data pipeline creation, testing, and debugging without manual UI interaction.

## Overview

The External Control API provides:
- **WebSocket-based communication** for real-time bidirectional control
- **Pipeline creation and testing** tools for automated workflows
- **Direct node manipulation** for fine-grained control
- **State observation** for monitoring changes
- **Tool execution** for accessing all MCP (Model Context Protocol) tools

## Architecture

There are two ways to connect to Noodles:

### Option A: MCP Protocol (Recommended for Claude Desktop)

```
Claude Desktop
      ↓ (stdio/MCP)
MCP Proxy Server
      ↓ (WebSocket)
Noodles Browser App
```

### Option B: Direct WebSocket (For Custom Tools)

```
External AI Tool (e.g., Claude Code)
         ↓
    WebSocket Client
         ↓
    Bridge Server (ws://localhost:8765)
         ↓
    Web Worker (in Noodles)
         ↓
    Main Thread (Noodles App)
```

## Quick Start

### Method 1: Claude Desktop Integration (MCP)

This is the recommended approach for Claude Desktop users.

#### 1. Install the MCP Proxy

```bash
cd examples/external-control
npm install
```

#### 2. Configure Claude Desktop

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "noodles": {
      "command": "node",
      "args": ["/absolute/path/to/examples/external-control/mcp-proxy.js"]
    }
  }
}
```

#### 3. Open Noodles with External Control

```
http://localhost:5173/examples/nyc-taxis?externalControl=true
```

#### 4. Use Claude Desktop

Now Claude can control Noodles directly! Try asking:
- "List all the nodes in the current project"
- "Create a scatterplot layer showing the pickup locations"
- "Capture a screenshot of the visualization"

### Method 2: Direct WebSocket (Custom Tools)

#### 1. Enable External Control in Noodles

Add URL parameters when opening Noodles:

```
http://localhost:5173/examples/nyc-taxis?externalControl=true&externalControlDebug=true
```

Parameters:
- `externalControl=true` - Enables the external control system
- `externalControlDebug=true` - Shows connection status indicator

#### 2. Start the Bridge Server

The bridge server routes messages between external tools and Noodles:

```bash
cd examples/external-control
npm install
node server-example.js
```

#### 3. Connect from External Tool

#### JavaScript/Node.js
```javascript
const { NoodlesClient } = require('./client')

const client = new NoodlesClient({
  host: 'localhost',
  port: 8765,
  debug: true
})

await client.connect()

// Create a pipeline
const pipeline = await client.createPipeline({
  dataSource: { type: 'FileOp', config: { url: 'data.csv' } },
  transformations: [
    { type: 'FilterOp', config: { expression: 'd.value > 100' } }
  ],
  output: { type: 'ScatterplotLayerOp', config: {} }
})
```

#### Python
```python
from noodles_client import NoodlesClient

client = NoodlesClient(debug=True)
client.connect()

# Create a pipeline
pipeline = client.create_pipeline({
    "dataSource": {"type": "FileOp", "config": {"url": "data.csv"}},
    "transformations": [
        {"type": "FilterOp", "config": {"expression": "d.value > 100"}}
    ],
    "output": {"type": "ScatterplotLayerOp", "config": {}}
})
```

## API Reference

### Connection Management

#### `connect(host?, port?)`
Establishes WebSocket connection to Noodles.

```javascript
await client.connect('localhost', 8765)
```

#### `disconnect()`
Closes the connection.

```javascript
client.disconnect()
```

### Pipeline Operations

#### `createPipeline(spec)`
Creates a complete data pipeline from specification.

```javascript
const pipeline = await client.createPipeline({
  dataSource: {
    type: 'FileOp',
    config: { url: '@/data.csv', format: 'csv' }
  },
  transformations: [
    {
      type: 'FilterOp',
      config: { expression: 'd.value > threshold' }
    },
    {
      type: 'MapOp',
      config: { expression: '({ ...d, normalized: d.value / 100 })' }
    }
  ],
  output: {
    type: 'ScatterplotLayerOp',
    config: {
      getPosition: 'd => [d.lng, d.lat]',
      getRadius: 100,
      getFillColor: '[255, 0, 0]'
    }
  }
})
```

#### `testPipeline(pipelineId, testData)`
Tests a pipeline with sample data.

```javascript
const result = await client.testPipeline(pipeline.id, [
  { lng: -74.0, lat: 40.7, value: 150 },
  { lng: -73.9, lat: 40.8, value: 200 }
])
```

#### `validatePipeline(pipelineId)`
Validates pipeline connections and configuration.

```javascript
const validation = await client.validatePipeline(pipeline.id)
if (!validation.valid) {
  console.error('Pipeline errors:', validation.errors)
}
```

### Node Operations

#### `addNode(type, position, config?)`
Adds a new node to the pipeline.

```javascript
const nodeId = await client.addNode('FilterOp', { x: 100, y: 200 }, {
  expression: 'd.value > 0'
})
```

#### `connectNodes(source, target, sourceField?, targetField?)`
Creates a connection between nodes.

```javascript
await client.connectNodes(
  '/source-node',
  '/target-node',
  'out.result',
  'par.data'
)
```

#### `deleteNode(nodeId)`
Removes a node and its connections.

```javascript
await client.deleteNode('/filter-123')
```

### Data Operations

#### `uploadDataFile(filename, content, mimeType?)`
Uploads a data file for use in pipelines.

```javascript
const url = await client.uploadDataFile(
  'mydata.csv',
  csvContent,
  'text/csv'
)
```

### State Operations

#### `getProjectState()`
Returns the current project state including all nodes and edges.

```javascript
const state = await client.getProjectState()
console.log(`Project has ${state.nodes.length} nodes`)
```

#### `getNodeOutputs(nodeId)`
Gets the output values of a specific node.

```javascript
const outputs = await client.getNodeOutputs('/filter-op')
console.log('Filtered data:', outputs)
```

#### `captureVisualization(format?, quality?)`
Captures a screenshot of the current visualization.

```javascript
const screenshot = await client.captureVisualization('png', 0.9)
// screenshot.data contains base64 encoded image
```

### Tool Execution

#### `callTool(toolName, args)`
Executes any registered MCP tool.

```javascript
// Get console errors
const errors = await client.callTool('getConsoleErrors', { limit: 10 })

// Get render stats
const stats = await client.callTool('getRenderStats', {})

// Apply modifications
await client.callTool('applyModifications', {
  modifications: {
    nodes: [{ type: 'add', node: newNode }],
    edges: [{ type: 'add', edge: newEdge }]
  }
})
```

### Event Handling

#### `onStateChange(callback)`
Subscribe to project state changes.

```javascript
client.onStateChange((state) => {
  console.log('State changed:', state)
})
```

#### `onError(callback)`
Subscribe to error events.

```javascript
client.onError((error) => {
  console.error('Error:', error)
})
```

## Available Operator Types

### Data Sources
- `FileOp` - Load CSV, JSON, GeoJSON files
- `DuckDbOp` - SQL queries
- `NetworkOp` - Fetch from URLs

### Transformations
- `FilterOp` - Filter data by condition
- `MapOp` - Transform data items
- `GroupByOp` - Group and aggregate
- `JoinOp` - Join datasets
- `SortOp` - Sort data

### Visualizations
- `ScatterplotLayerOp` - Point visualizations
- `PathLayerOp` - Lines and routes
- `ArcLayerOp` - Arc connections
- `HeatmapLayerOp` - Density maps
- `GeoJsonLayerOp` - Geographic features
- `TextLayerOp` - Text labels
- `TripsLayerOp` - Animated paths/trips

See the [Operators Guide](../users/operators-guide.md) for complete list.

## Message Protocol

The External Control API uses a JSON-based message protocol over WebSocket.

### Message Structure
```typescript
interface Message {
  id: string          // Unique message ID
  type: MessageType   // Message type
  timestamp: number   // Unix timestamp
  payload: any        // Message-specific payload
}
```

### Message Types
- `connect` - Establish connection
- `disconnect` - Close connection
- `tool_call` - Execute a tool
- `tool_response` - Tool execution result
- `pipeline_create` - Create pipeline
- `pipeline_test` - Test pipeline
- `state_change` - State update notification
- `error` - Error message

## Examples

### Create a Geographic Visualization

```javascript
const pipeline = await client.createPipeline({
  dataSource: {
    type: 'FileOp',
    config: { url: '@/cities.geojson', format: 'geojson' }
  },
  transformations: [
    {
      type: 'FilterOp',
      config: { expression: 'd.properties.population > 1000000' }
    }
  ],
  output: {
    type: 'GeoJsonLayerOp',
    config: {
      getFillColor: '[255, 140, 0]',
      getLineColor: '[0, 0, 0]',
      lineWidthMinPixels: 2
    }
  }
})
```

### Automated Testing Workflow

```javascript
// Create test pipeline
const pipeline = await client.createPipeline(pipelineSpec)

// Validate connections
const validation = await client.validatePipeline(pipeline.id)
assert(validation.valid)

// Test with different datasets
for (const dataset of testDatasets) {
  const result = await client.testPipeline(pipeline.id, dataset)
  assert(result.success)

  // Capture visualization for each test
  const screenshot = await client.captureVisualization()
  saveScreenshot(screenshot, `test-${dataset.name}.png`)
}

// Check for errors
const errors = await client.callTool('getConsoleErrors', {})
assert(errors.length === 0)
```

### Real-time Monitoring

```javascript
// Monitor state changes
client.onStateChange((state) => {
  // Update external dashboard
  updateDashboard({
    nodeCount: state.nodes.length,
    edgeCount: state.edges.length
  })
})

// Monitor errors
client.onError((error) => {
  // Send alert
  alertSystem.notify('Noodles Error', error.message)
})

// Periodic health checks
setInterval(async () => {
  const stats = await client.callTool('getRenderStats', {})
  if (stats.fps < 30) {
    console.warn('Low FPS:', stats.fps)
  }
}, 5000)
```

## Debugging

### Enable Debug Mode

Set `debug: true` when creating the client:

```javascript
const client = new NoodlesClient({ debug: true })
```

This will log all messages to the console.

### Check Connection Status

The debug indicator in Noodles shows connection status:
- Green: Connected
- Red: Error
- Gray: Disconnected

### Common Issues

1. **Connection Failed**
   - Ensure bridge server is running
   - Check firewall/network settings
   - Verify correct host/port

2. **Tool Not Found**
   - Check tool name spelling
   - Verify tool is registered
   - See available tools with `listTools()`

3. **Pipeline Creation Failed**
   - Validate operator types exist
   - Check field connections are compatible
   - Review error details in response

4. **WebSocket Timeout**
   - Increase timeout in client config
   - Check for long-running operations
   - Verify server is responding

## Security Considerations

The External Control API is designed for local development:

- **No Authentication**: Currently no auth mechanism
- **Local Only**: Bind to localhost by default
- **No Encryption**: WebSocket traffic is unencrypted
- **Full Access**: Can execute any available tool

For production use, consider:
- Adding authentication tokens
- Using WSS (WebSocket Secure)
- Implementing rate limiting
- Restricting tool access

## Performance Tips

1. **Batch Operations**: Use `applyModifications` for multiple changes
2. **Reuse Connections**: Keep WebSocket open for multiple operations
3. **Async Operations**: Use promises/async-await for better flow
4. **Monitor Stats**: Check FPS and render times regularly
5. **Optimize Pipelines**: Minimize transformation steps

## Limitations

- Browser-based: Requires Noodles running in browser
- Single Project: Controls one project at a time
- Local Files: Limited to browser file access
- Memory Constraints: Subject to browser memory limits

## Future Enhancements

Planned improvements:
- Native server mode (no browser required)
- Multi-project support
- Remote file access
- Batch processing API
- GraphQL interface
- Plugin system for custom tools

## Support

For issues or questions:
- GitHub Issues: [noodles.gl/issues](https://github.com/noodles.gl/issues)
- Documentation: [noodles.gl/docs](https://noodles.gl/docs)
- Examples: `/examples/external-control/`