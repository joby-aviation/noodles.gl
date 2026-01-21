# External Control Module

This module enables external AI tools and scripts to control the Noodles application programmatically through a WebSocket-based API.

## Architecture

The external control system supports two connection methods:

### Option 1: MCP Protocol (Recommended for Claude Desktop)

Use the MCP proxy to connect Claude Desktop directly to Noodles:

```
Claude Desktop ←--stdio/MCP--→ mcp-proxy.js ←--WebSocket--→ Noodles Browser
```

See `examples/external-control/mcp-proxy.js` for the proxy implementation.

### Option 2: Direct WebSocket

For custom tools, connect directly via WebSocket:

```
Custom Tool ←--WebSocket--→ server-example.js ←--WebSocket--→ Noodles Browser
```

### Core Components

1. **`message-protocol.ts`** - Defines the message format and protocol for communication
2. **`websocket-worker.ts`** - Web Worker that handles WebSocket connections
3. **`worker-bridge.ts`** - Bridge between Web Worker and main thread
4. **`tool-adapter.ts`** - Adapts MCP tools for external use
5. **`pipeline-tools.ts`** - Specialized tools for pipeline creation and testing
6. **`api.ts`** - High-level API for external control
7. **`index.tsx`** - React component for initialization
8. **`client.ts`** - Reference client implementation

### Data Flow

```
External Tool → WebSocket → Web Worker → Main Thread → Noodles App
                                ↑             ↓
                            Message       Tool Execution
                            Protocol       & State Updates
```

## Usage

### Enable in Noodles

Add URL parameters when opening Noodles:
```
?externalControl=true&externalControlDebug=true
```

### Connect from External Tool

```javascript
const client = new NoodlesClient()
await client.connect('ws://localhost:8765')

// Create and test pipelines
const pipeline = await client.createPipeline(spec)
const result = await client.testPipeline(pipeline.id, testData)
```

## Key Features

### Pipeline Management
- Create complete data pipelines from specifications
- Test pipelines with sample data
- Validate pipeline configurations
- Debug pipeline execution

### Node Operations
- Add, connect, and delete nodes
- Configure node parameters
- Get node outputs
- List available operators

### State Observation
- Monitor project state changes
- Capture visualizations
- Get console errors
- Track render statistics

### Tool Execution
- Access all MCP tools
- Execute custom operations
- Apply project modifications
- Query project data

## Message Protocol

Messages follow this structure:
```typescript
{
  id: string,
  type: MessageType,
  timestamp: number,
  payload: any
}
```

Key message types:
- `tool_call` - Execute a tool
- `pipeline_create` - Create a pipeline
- `state_change` - State update
- `error` - Error notification

## Development

### Adding New Tools

1. Register in `tool-adapter.ts`:
```typescript
toolRegistry.register({
  name: 'myTool',
  description: 'Description',
  parameters: { /* ... */ }
})
```

2. Implement in `ToolRegistry.execute()`:
```typescript
case 'myTool': {
  result = await this.myTool(args)
  break
}
```

### Extending the Protocol

1. Add message type to `MessageType` enum
2. Define message interface
3. Handle in `worker-bridge.ts`
4. Implement in client

## Testing

Run the test suite:
```bash
npm test src/external-control
```

Test with example scripts:
```bash
node examples/external-control/create-pipeline.js
python examples/external-control/create_pipeline.py
```

## Security

The external control API is designed for local development:
- No authentication by default
- Binds to localhost only
- Full access to all tools
- No encryption (use WSS for production)

## Performance

- Web Worker prevents UI blocking
- Message batching for efficiency
- Async/await for better flow control
- Connection pooling in bridge server

## Troubleshooting

Common issues:
1. **Connection failed** - Check bridge server is running
2. **Tool not found** - Verify tool name and registration
3. **Pipeline error** - Validate operator types and connections
4. **Timeout** - Increase timeout or check for blocking operations

Enable debug mode for detailed logging:
```javascript
const client = new NoodlesClient({ debug: true })
```

## Future Improvements

- [ ] Native server mode (no browser required)
- [ ] Authentication and authorization
- [ ] WebSocket Secure (WSS) support
- [ ] Rate limiting and quotas
- [ ] Multi-project support
- [ ] GraphQL interface
- [ ] Plugin system for custom tools

## Documentation

- [External Control Guide](../../../docs/developers/external-control-guide.md)
- [Examples](../../../examples/external-control/)
- [API Reference](./api.ts)

## License

See main project LICENSE file.