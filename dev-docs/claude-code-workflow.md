# Using Claude Code with Noodles.gl Projects

This section covers using Claude Code (the CLI tool) to work directly with projects, as opposed to the in-app chat panel.

### Setup

```bash
# Start the dev server
cd noodles-editor && npm start

# Projects are in noodles-editor/src/examples/
# Each project directory contains a noodles.json and optional data files
ls src/examples/
```

### Editing Project Files Directly

A project saved from the editor is a document (`EditorDoc`, defined in
`packages/planner/src/doc.ts`): `nodes` with an `op` and `params`, and `edges` between ports.
See the [Project Files section](../AGENTS.md#project-files) for the shape. Key points:

- Node ids are opaque; a node's `name` is unique within its network, and its path is its name
  under its subnets' names (`/data-source`, `/subnet/filter`).
- Edges join `sourcePort` to `targetPort`: `out` → `in` for tables, `out` → `layers` (with an
  `index`) for layers into the deck, and `par:<name>` to drive a parameter.
- `params` hold literals, `{ "expr": "..." }` or `{ "ref": "node/param" }`. Leave out
  parameters that keep their default.
- The examples in `src/examples/` are still operator-graph files (`noodles.json` schema 19).
  They are migrated and converted when they load; edit them as operator graphs, or open one,
  save it, and work on the document it becomes.

### Validating Changes

Load the project in the browser at `http://localhost:5173/examples/<project-name>` (or open
the file) and check the nodes for error badges. `npm run validate:examples` checks the
examples' JSON and edges structurally. The headless check is
`npm test -- src/runtime/migrate/examples.node.test.ts` from `noodles-editor/`, which converts,
lowers and runs every example.

### Connecting Claude Code to a Running Browser Instance

#### WebMCP

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

Two tools exist only over WebMCP, not in the in-app chat: `export_video` and `get_export_status`. `export_video` renders the timeline to an MP4, the same as the Export button. Every parameter is optional (`startTime`, `endTime`, `fps`, `width`, `height`, `codec`, `download`, `waitSeconds`); omitted ones come from the project's render settings and the timeline in/out points. The file goes to `@/.agent/renders/<project>-<timestamp>.mp4` in the project, where `list_files` shows it, and also to the browser's downloads folder with `download: true` (or when the project is read-only). The relay fails any tool call that runs past 25 s, so a call waits at most 20 s and then returns progress (`framesDone`, `totalFrames`); call `get_export_status` until `status` is `done`. The finished result has the file name, path, byte size, frame count and duration. Needs WebCodecs (`VideoEncoder`), so Chrome or Edge. An example project lives in memory, so pass `download: true` there to keep the file after a reload.

The [`noodles-live`](../.claude/skills/noodles-live/SKILL.md) skill teaches Claude Code this loop end to end: read the graph, make one edit, check it with a screenshot, change keyframes, and export. Claude Code loads it automatically in this repo.

Notes:

- The relay embed script is only injected on localhost. Alternatives that need no relay: the WebMCP browser extension, or native Chrome WebMCP (origin trial).
- If multiple Noodles tabs are open, the relay suffixes tool names with a tab ID.
- Code search/docs tools download their context bundles on page load when external control is enabled.

#### Quick start prompt

[`website/static/claude-code-prompt.txt`](../website/static/claude-code-prompt.txt) is the one-paste setup that the landing page's Claude Code tab and the assistant's onboarding panel copy. [`website/static/agent-prompt.txt`](../website/static/agent-prompt.txt) is the version for every other agent: it lists the relay registration for Codex, Gemini CLI, Claude Code, Cursor and VS Code, and since those can't start a second session the way `claude -p` does, it stops after registering and asks the user to restart the agent and paste the same prompt again. Every step skips itself when it's already done, so the second paste picks up at the dev server. Keep the two prompts' steps in sync. The user-facing version of this page is [docs/users/ai-agents.md](../docs/users/ai-agents.md). It clones and installs the repo, starts the dev server, registers the relay, and makes one change. Claude Code only loads an MCP server at startup, so the session that registers the relay runs a second `claude -p` session for the change and the screenshot, and pulls the image out of that session's `stream-json` output.

Two things the prompt works around, found while testing it:

- Open the tab after the relay is running. The relay's page widget scans ports 9333 to 9348 and stops retrying after about 10 seconds, so a tab opened earlier never connects until it is reloaded. That is why the second session opens the example itself.
- Keep the browser window visible. A hidden tab stops drawing, so `capture_visualization` refuses rather than return a stale frame.

### Graph Design Guidelines for Claude Code

When generating or modifying a document:

- **Keep graphs simple**: 5–8 nodes a person can read and change.
- **Standard pipeline**: a source (`file`, `geojson`, `sql`) → row nodes (`filter`,
  `attribute`, `aggregate`, `join`) → a layer (`scatter`, `path`, `polygon`, `heatmap`…) → the
  `deck` node, which holds the basemap, the camera and the render settings.
- **Per-row values are columns.** Compute them with `attribute` nodes or a layer channel's
  expression (`[lng, lat]`, `magnitude * 1000`), not JavaScript accessors.
- **Use `sql` for reshaping** that would take a chain of nodes; `{{input0}}` is the table on
  `in0`, and `ch('node/param')` reads a parameter.
- **`code`** runs JavaScript in the engine worker and returns rows. A converted CodeOp whose
  code reads `op()`, the timeline or `this` stays a host operator, run outside the plan.
- **Check ports and parameters** with `get_operator_schema` before writing edges.

### Timeline / Animation

The timeline is `timeline.tracks` in the document; each track's `target` is `nodeId.param`. Prefer the
`set_keyframe` / `get_timeline` tools to editing it by hand.
