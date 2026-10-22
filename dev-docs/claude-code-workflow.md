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

Project files (`noodles.json`) are plain JSON and can be read and written by Claude Code. See the [Project Files section](../AGENTS.md#project-files-noodlesjson) for the full schema. Key points:

- Node IDs are Unix-style paths: `/my-node`, `/container/child`
- Edge handles: `out.fieldName` (source) → `par.fieldName` (target)
- Only non-default input values need to be serialized
- The current version is the number of the latest migration in `src/noodles/__migrations__/`; `validate-projects` prints it. Write new files at the current version; older files are migrated when they load, so don't bump the version of an existing file by hand

### Looking Things Up Without a Browser

The `noodles` MCP server ([noodles-mcp](../noodles-mcp/README.md)) answers from this checkout, with no dev server running. `.mcp.json` registers it, so Claude Code sessions in this repo have it after `npm install`; approve it when Claude Code asks. Its tools:

- `list_operators`, `get_operator_schema`: every operator, and one operator's inputs, outputs and the `par.`/`out.` handles to wire them
- `get_documentation`: search the docs and workflow guides, or read a topic by id
- `list_examples`, `get_example`: the projects under `src/examples/`, with their READMEs and data files
- `validate_project`: the check below, as a tool

The first five have the same names and parameters as the in-app assistant's tools. With the WebMCP relay also connected, Claude Code tells them apart by server (`mcp__noodles__get_operator_schema`, `mcp__webmcp__get_operator_schema`). The live one reads the running editor's operator classes; the `noodles` one reads a snapshot of them that `npm test` keeps current.

To write a project file:

1. Find a similar project with `list_examples` and read it with `get_example`.
2. Read each operator you'll use with `get_operator_schema` before writing its edges. Never guess a field name.
3. Write the file, then validate it (next section) and fix every error.
4. When it validates, the file is done. Load it in the browser if you want to see it, but don't keep researching.

### Validating Changes

After editing a project file, check it against the operator registry, with the `validate_project` tool or from anywhere in the repo:

```bash
npx validate-projects path/to/noodles.json
```

It checks the schema version, operator types, input names, edge handles and duplicate edges, and names the fix for each error. When it prints `OK` (or `validate_project` returns `"valid": true`), the file is valid. With no path it checks every project under `src/examples/` and `public/noodles/`; `npm run validate:examples` checks `src/examples/` only. See [noodles-validate](../noodles-validate/README.md) for the rules and exit codes.

It doesn't check the `timeline` key or run the project. Load it in the browser at `http://localhost:5173/examples/<project-name>` to visually verify.

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

[`website/static/claude-code-prompt.txt`](../website/static/claude-code-prompt.txt) is the one-paste setup that the landing page and the assistant's onboarding panel copy. It clones and installs the repo, starts the dev server, registers the relay, and makes one change. Claude Code only loads an MCP server at startup, so the session that registers the relay runs a second `claude -p` session for the change and the screenshot, and pulls the image out of that session's `stream-json` output.

Two things the prompt works around, found while testing it:

- Open the tab after the relay is running. The relay's page widget scans ports 9333 to 9348 and stops retrying after about 10 seconds, so a tab opened earlier never connects until it is reloaded. That is why the second session opens the example itself.
- Keep the browser window visible. A hidden tab stops drawing, so `capture_visualization` refuses rather than return a stale frame.

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
- **Verify handle names** with `get_operator_schema` before writing edges, and validate the file when you're done (see [Validating Changes](#validating-changes))

### Timeline / Animation

The timeline is serialized inside `noodles.json` under the `"timeline"` key. The structure is complex — prefer using the in-app chat's `set_keyframe` / `get_timeline` tools rather than editing the timeline JSON directly.
