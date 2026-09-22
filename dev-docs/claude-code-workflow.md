# Using Claude Code with Noodles.gl Projects

This section covers using Claude Code (the CLI tool) to work directly with projects, as opposed to the in-app chat panel.

### Setup

```bash
# Start the dev server
cd noodles-editor && npm start

# Projects are in noodles-editor/public/examples/
# Each project directory contains a noodles.json and optional data files
ls noodles-editor/public/examples/
```

### Editing Project Files Directly

Project files (`noodles.json`) are plain JSON and can be read and written by Claude Code. See the **Project Files** section above for the full schema. Key points:

- Node IDs are Unix-style paths: `/my-node`, `/container/child`
- Edge handles: `out.fieldName` (source) → `par.fieldName` (target)
- Only non-default input values need to be serialized
- Version 6 is current; do not change the version field

### Validating Changes

After editing a project file, run the project's tests to catch schema issues:

```bash
cd noodles-editor && npm test src/noodles/storage.test.ts
```

Load it in the browser at `http://localhost:5173/examples/<project-name>` to visually verify.

### Connecting Claude Code to a Running Browser Instance

#### WebMCP (recommended)

With `?externalControl=true`, the app registers its full AI tool surface (~27 tools) on `navigator.modelContext` (the W3C WebMCP API, polyfilled via `@mcp-b/global`). External MCP clients reach those tools through the `@mcp-b/webmcp-local-relay` stdio bridge — no proxy code to run:

```bash
# 1. Start the app with external control enabled
# Open: http://localhost:5173/examples/nyc-taxis?externalControl=true

# 2. Register the relay with Claude Code (once)
claude mcp add webmcp -- npx -y @mcp-b/webmcp-local-relay@4

# For Claude Desktop / Cursor, use the equivalent config:
{
  "mcpServers": {
    "webmcp": {
      "command": "npx",
      "args": ["-y", "@mcp-b/webmcp-local-relay@4"]
    }
  }
}
```

Tool names match the in-app chat (snake_case): `get_current_project`, `list_nodes`, `get_node_info`, `get_node_output`, `apply_modifications`, `run_code`, `list_files`, `read_file`, `write_file`, `grep_files`, `capture_visualization`, `get_timeline`, `set_keyframe`, `get_operator_schema`, `search_code`, and more. `apply_modifications` mutates the live editor graph, so changes appear immediately in the browser.

Notes:

- The relay embed script is only injected on localhost. Alternatives that need no relay: the WebMCP browser extension, or native Chrome WebMCP (origin trial).
- If multiple Noodles tabs are open, the relay suffixes tool names with a tab ID.
- Code search/docs tools download their context bundles on page load when external control is enabled.

#### Legacy WebSocket proxy

The older MCP proxy bridges Claude Code to the browser over a WebSocket. It exposes a smaller camelCase tool surface (`getCurrentProject`, `listNodes`, `createNode`, `connectNodes`, `captureVisualization`, …):

```bash
# 1. Start the app with external control enabled
# Open: http://localhost:5173/examples/nyc-taxis?externalControl=true

# 2. Start the MCP proxy (in a separate terminal)
node noodles-editor/examples/external-control/mcp-proxy.js

# 3. Add to Claude Desktop config:
#    macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
#    Windows: %APPDATA%\Claude\claude_desktop_config.json
{
  "mcpServers": {
    "noodles": {
      "command": "node",
      "args": ["/path/to/noodles-editor/examples/external-control/mcp-proxy.js"]
    }
  }
}
```

### Graph Design Guidelines for Claude Code

When generating or modifying `noodles.json` programmatically:

- **Keep graphs simple** — aim for 5–8 nodes. A human must be able to read and modify the result.
- **Prefer CodeOp for data transformation** over chaining FilterOp → MapOp → SortOp. One CodeOp node with a few lines of JavaScript is more reliable and easier to inspect:
  ```json
  {
    "id": "/transform",
    "type": "CodeOp",
    "data": { "inputs": { "code": "return data.filter(d => d.value > 0).sort((a,b) => b.value - a.value)" } }
  }
  ```
- **Standard pipeline**: FileOp/DuckDbOp → CodeOp (transform) → AccessorOp (position) → LayerOp → DeckRendererOp
- **Always include MaplibreBasemapOp** for geographic visualizations
- **Verify handle names** using `get_operator_schema` or the operator registry before writing edges

### Timeline / Animation

The timeline is serialized inside `noodles.json` under the `"timeline"` key. The structure is complex — prefer using the in-app chat's `set_keyframe` / `get_timeline` tools rather than editing the timeline JSON directly.
