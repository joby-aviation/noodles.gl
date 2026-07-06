# Sub-plan 03: `noodles-mcp` — Docs/Registry MCP Server

A shadcn-style MCP server so agents can search operators, read full reference material (schemas *and* hand-written Remarks), fetch examples, and validate `noodles.json` files — runnable via `npx -y noodles-mcp` with zero setup, no browser required. An optional `--live` mode absorbs the existing browser bridge.

## Goals

- One npm package, stdio transport, `@modelcontextprotocol/sdk`.
- Reads the public machine-readable surface (sub-plan 02) by default; `--local <repo-root>` for offline/contributor use.
- `validate_project` that catches the mistakes agents actually make (wrong handles, unknown ops, stale versions).
- Kill the three-way tool-surface divergence (in-app chat, external-control `ToolRegistry`, `mcp-proxy.js` hard-coded schemas).

## Non-goals

- The live in-browser tool implementations (sub-plan 05 owns the unified registry; this package only *bridges* to them in `--live` mode).
- Importing noodles-editor runtime code — `migrate-schema.ts` is Vite-coupled (`import.meta.glob`) and `serialization.ts` drags in React Flow. The server stays dependency-light Node.

## Requirements

1. WHEN a user runs `npx -y noodles-mcp` with no arguments THEN the server SHALL serve docs tools backed by `https://noodles.gl` and require no local checkout.
2. WHEN `--local <repo-root>` is passed THEN the server SHALL read `website/static/` and `docs/` from disk instead.
3. WHEN `validate_project` receives a project JSON THEN it SHALL report schema violations AND registry-aware lint errors (unknown node type, unknown handle, bad handle prefix, malformed edge id, non-current version) with actionable messages.
4. WHEN `get_operator` is called for an operator whose reference page has hand-written Remarks THEN the response SHALL include that prose.
5. WHEN `--live` is passed THEN the server SHALL additionally expose the live browser tools over the existing WebSocket (:8765) protocol, replacing `mcp-proxy.js`.

## Design

### D1. Package

New root workspace `noodles-mcp/` (added to root `package.json` workspaces). npm name `noodles-mcp`, bin `noodles-mcp`. Public URLs by default (always current with main, works anywhere); `--local` flag / `NOODLES_MCP_LOCAL` env for offline; `--base-url` override for staging.

```
noodles-mcp/
  package.json        # deps: @modelcontextprotocol/sdk, ajv, zod, ws
  tsconfig.json
  README.md           # install + .mcp.json snippets
  src/index.ts        # arg parsing, McpServer + StdioServerTransport
  src/data-source.ts  # RemoteSource (fetch + in-memory TTL cache) | LocalSource
  src/tools/operators.ts | docs.ts | examples.ts | validate.ts | live.ts
  src/tool-defs.ts    # dependency-free live-tool JSON Schemas (shared with the editor)
  src/validate/lint.ts
```

### D2. Tool surface

| Tool | Params | Returns | Backing data |
|---|---|---|---|
| `list_operators` | `{category?}` | `[{name, displayName, category, description}]` | `r/registry.json` |
| `search_operators` | `{query}` | ranked matches (name/description/category/field-name keywords) | `r/registry.json` in-memory |
| `get_operator` | `{name}` (class name or kebab) | full per-op JSON incl. `remarks`, `docsUrl`, `examples` | `r/ops/<kebab>.json` |
| `get_field_type` | `{name}` | field-type description + operators using it | registry `fieldTypes` + field-system docs mirror |
| `get_project_schema` | `{}` | the JSON Schema | `schema/noodles-project.schema.json` |
| `validate_project` | `{project}` | `{valid, schemaErrors[], lintErrors[]}` | Ajv + registry |
| `list_examples` | `{}` | example index | `r/examples.json` |
| `get_example` | `{id}` | readme + stripped project JSON | `r/examples/<id>.json` |
| `search_docs` | `{query}` | `[{id, title, url, mdUrl, matchedHeadings}]` | `r/docs.json` |
| `get_docs_page` | `{id}` (e.g. `users/data-guide`) | raw markdown | `<path>.md` mirror |
| `get_authoring_guide` | `{}` | authoring rules markdown | new `docs/developers/authoring-noodles-json.md` |
| *(`--live` only)* the live tools | per `tool-defs.ts` | proxied | WebSocket :8765 to the running browser |

`get_authoring_guide` serves a new docs page whose content is lifted from `src/ai-chat/system-prompt.md` (handle formats `out.X`/`par.X`, edge id formula, path rules, a minimal valid project skeleton, the schema URL) — the same invariants sub-plan 04's skill inlines. This page is the **`noodles.json` file-format spec**, and it is the one place (together with the JSON Schema docs, sub-plan 02) written in RFC 2119 register — capitalized MUST/SHOULD/MAY for contract-strength statements, per the style guide in sub-plan 01 D5.

### D3. `validate_project`: schema + registry lint, not runtime

Two layers, both in this package:

1. **Ajv** against the published JSON Schema (structure, version literal).
2. **Registry-aware lint** (`src/validate/lint.ts`): node `type` exists in the registry; `sourceHandle`/`targetHandle` carry `out.`/`par.` prefixes AND name real fields on the resolved operator schema; edge `id` matches `${source}.${sourceHandle}->${target}.${targetHandle}`; duplicate node ids; version ≠ current → error with "run `npm run migrate-projects`" hint.

Runtime validation (actually executing migrations/operators) was rejected: it needs the Vite-coupled editor world. The registry already knows every operator's inputs/outputs, which covers the highest-value checks.

**Convergence requirement**: once sub-plan 04's `validate-projects` CLI exists in the editor workspace, its exported `validateProject()` and this lint must not fork. The lint rules live here (dependency-free); the CLI adds the runtime-only checks (migrations) on top. Reconcile when both exist — one rule set, two thicknesses.

### D4. Convergence with existing surfaces

- **Quick win (independent PR)**: register the dormant `MCPTools` context tools (`list_operators`, `get_operator_schema`, `get_documentation`, `get_example`, `list_examples`, `search_code`) in `claude-client.ts`'s `getTools()`/`executeTool` so the in-app chat gets the same lookup powers.
- **Live mode**: `mcp-proxy.js` is the working reference implementation that proved the stdio↔browser bridge — the port honors it rather than replaces it. `src/tools/live.ts` carries over its protocol verbatim (stdio ↔ WebSocket :8765, protocol 2024-11-05, request/response correlation, 30s timeout); the only things that change are distribution (`npx` instead of a checked-out script) and where tool schemas come from (queried from the browser instead of hard-coded — the hard-coded copies were fine when written, but every schema copy is a drift liability once the registry becomes the source of truth). The file itself stays with a deprecation pointer ("use `npx noodles-mcp --live`") so existing setups keep a working breadcrumb; remove it only after a release cycle.
- **Tool definitions**: live-tool JSON Schemas live in dependency-free `src/tool-defs.ts`; `noodles-editor` takes a workspace dep and `src/external-control/tool-adapter.ts` derives its registrations from it. (Sub-plan 05 goes further and moves execution into a unified `agent-tools` registry — when 05 lands, `tool-defs.ts` becomes a re-export of 05's specs. Coordinate; don't build twice.)

### D5. Distribution

- `docs/developers/mcp.md` (+ sidebar entry) with config snippets:

```json
{ "mcpServers": { "noodles": { "command": "npx", "args": ["-y", "noodles-mcp"] } } }
```

- Manual `npm publish` v0.1.0; a `release-mcp.yml` workflow later.
- Update `docs/developers/external-control-guide.md` to point at `--live` mode.

## Implementation steps

1. Scaffold the workspace; implement `data-source.ts` (remote + local) and the docs tools per the table.
2. Implement `validate.ts` + `lint.ts` with unit tests over the example projects (valid) and mutated copies (each lint rule firing).
3. Port the live bridge into `live.ts`; deprecate `mcp-proxy.js`.
4. Quick-win PR: register dormant context tools in the in-app chat.
5. Write `docs/developers/authoring-noodles-json.md` and `docs/developers/mcp.md`; sidebar entries.
6. Publish v0.1.0.

## Verification

1. `claude mcp add noodles -- npx -y noodles-mcp --local .` then, in Claude Code: `list_operators`, `get_operator ScatterplotLayerOp` (Remarks present once 01 lands), `validate_project` on `src/examples/nyc-taxis/noodles.json` (valid) and on a copy with `sourceHandle: "data"` (lint error names the fix).
2. After the 02 surface deploys: repeat in remote mode.
3. `--live` smoke test against a dev server with `?externalControl=true`.

## Dependencies

- Inbound: 02 (backing data — hard), 01 (Remarks — soft), 04 (`validateProject()` reconciliation), 05 (tool-def unification).

## Open questions

- Whether to also expose an HTTP/SSE transport later for hosted use.
- npm org/scope for the package name (`noodles-mcp` vs `@noodles-gl/mcp`).
