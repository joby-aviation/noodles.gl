# noodles-mcp

An MCP server (stdio) that gives coding agents what they need to write a Noodles.gl project file without a browser: operator schemas, docs, example projects, and validation. It reads a noodles.gl checkout and needs no build step.

Claude Code sessions in this repo pick it up from `.mcp.json` at the root after `npm install`. For another client, or a session outside the repo:

```bash
claude mcp add noodles -- node /path/to/noodles.gl/noodles-mcp/bin/noodles-mcp.ts
```

`--local <repo-root>` reads a different checkout. It defaults to the one the package is in.

## Tools

The first five have the names and parameters of the in-app assistant's tools (`noodles-editor/src/ai-chat/tool-definitions.ts`), so skills and prompts can use one set of names.

| Tool | Params | Returns |
|---|---|---|
| `list_operators` | `category?` | `[{type, name, category, description}]` |
| `get_operator_schema` | `type` (`scatter`, or a display name like `Scatterplot Layer`) | Input and output ports with types, parameters with kinds and defaults, and the port names an edge may use (`in`, `par:radiusScale`) |
| `get_documentation` | `query?`, `id?`, `section?` | Search results with excerpts and topic ids, or one topic in full. Same ids as in the app |
| `list_examples` | `category?`, `tag?` | `[{id, name, description, category, tags, path}]` |
| `get_example` | `id` | The project (large inline data trimmed to a sample), README, and the files beside it |
| `validate_project` | `path` or `project` | `{summary, valid, errors, warnings, registry}` from [noodles-validate](../noodles-validate/README.md). `summary` starts with `OK` when the file is done |

The server's instructions tell the client the workflow: start from an example, read both operators' schemas before writing an edge, validate after each edit, and stop when `validate_project` returns `"valid": true`.

Relative `path`s resolve against the server's working directory, which for Claude Code is the project root.

## Not here

- **A running editor.** To change what's on screen, use the editor's WebMCP tools through the relay (see `dev-docs/claude-code-workflow.md` and the `noodles-live` skill). The `--live` mode in the agent-ready docs spec is dropped: #668 removed the WebSocket proxy it would have wrapped.
- **Remote mode.** The spec's default reads `https://noodles.gl/r/`, which doesn't exist yet. Until it does, the server needs a checkout.
- **npm.** Node won't strip types from files under `node_modules`, so publishing needs a build step first. Until it's published under a scope we own, don't register it as `npx noodles-mcp`: the name is unclaimed on npm, so npx in a checkout without `node_modules` would fetch whatever someone publishes under it. `.mcp.json` runs the file with `node` for that reason.

## Development

```bash
cd noodles-mcp
npm test
npm run typecheck
npm run lint
```

The tests drive the server through an MCP client, in memory and over stdio.
