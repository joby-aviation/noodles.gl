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
  # (no tool-defs.ts — live-tool definitions come from 05's agent-tools ToolSpec table, see D4)
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
| `validate_project` | `{project}` | `{valid, schemaErrors[], lintErrors[], registry: {version, commit}}` — skew-aware messaging per D3 | Ajv + registry |
| `list_examples` | `{}` | example index | `r/examples.json` |
| `get_example` | `{id}` | readme + stripped project JSON | `r/examples/<id>.json` |
| `search_docs` | `{query}` | `[{id, title, url, mdUrl, matchedHeadings}]` | `r/docs.json` |
| `get_docs_page` | `{id}` (e.g. `users/data-guide`) | raw markdown | `<path>.md` mirror |
| `get_authoring_guide` | `{}` | authoring rules markdown | new `docs/developers/authoring-noodles-json.md` |
| *(`--live` only)* the live tools | per 05's `agent-tools` ToolSpec table | proxied | WebSocket :8765 to the running browser |

`get_authoring_guide` serves a new docs page whose content is lifted from `src/ai-chat/system-prompt.md` (handle formats `out.X`/`par.X`, edge id formula, path rules, a minimal valid project skeleton, the schema URL) — the same invariants sub-plan 04's skill inlines — **plus a timeline section**: the serialized format from `src/timeline/types.ts` with a worked keyframe-animation example, its invariants (sorted keyframes, unique ids, resolvable track paths), and a note that the `sheetsById.Noodles` nesting is Theatre.js-era backward compatibility, not meaningful structure. This page is the **`noodles.json` file-format spec**, and it is the one place (together with the JSON Schema docs, sub-plan 02) written in RFC 2119 register — capitalized MUST/SHOULD/MAY for contract-strength statements, per the style guide in sub-plan 01 D5.

### D3. `validate_project`: schema + registry lint, not runtime

Two layers, both in this package:

1. **Ajv** against the published JSON Schema (structure, version literal).
2. **Registry-aware lint** (`src/validate/lint.ts`): node `type` exists in the registry; `sourceHandle`/`targetHandle` carry `out.`/`par.` prefixes AND name real fields on the resolved operator schema; edge `id` matches `${source}.${sourceHandle}->${target}.${targetHandle}`; duplicate node ids; version ≠ current → error with "run `npm run migrate-projects`" hint; timeline integrity (track paths resolve to existing nodes, keyframes sorted by position, unique keyframe ids, marker connections reference existing keyframes) — timeline edits are a supported authoring path, so the validator must catch their failure modes, not just refuse them.

Runtime validation (actually executing migrations/operators) was rejected: it needs the Vite-coupled editor world. The registry already knows every operator's inputs/outputs, which covers the highest-value checks.

**Remote-mode version skew.** `npx noodles-mcp` validates against main's registry, but the user may be authoring against an older release. Three provisions:

- Every `validate_project` result embeds the instrument's provenance — `registry: {version, commit, generated}` from `r/registry.json` — so a result is always attributable to what produced it.
- When the project's declared `version` predates the registry's current one, lint messages distinguish **"wrong for your version"** (fails only against the *current* schema/registry — e.g. a handle a later migration renamed; remedy: `npm run migrate-projects`, or ignore if intentionally pinned to the old release) from **"wrong, period"** (fails against the schema matching the project's own declared version — malformed edge id, bad handle prefix). The versioned schema aliases from 02 (`noodles-project.v14.schema.json`, one per version, retained as new versions land) are what make the distinction computable; when no versioned schema exists for the project's declared version, the tool says so explicitly and falls back to current-version-only messaging rather than guessing.
- `--base-url` is the documented escape hatch: point validation at an older deployed registry (or staging) when working against a pinned release.

**Ownership (settled)**: the registry-aware lint lives here, in `src/validate/lint.ts`, importable from plain Node with no editor dependencies. Sub-plan 04's `validate-projects` CLI imports this lint via workspace dep and layers the runtime-only checks (migrations, anything needing the Vite-built world) on top; its exported `validateProject()` is that composite, and 07's graders consume it. One rule set, two thicknesses, no fork.

### D4. Convergence with existing surfaces

- **Quick win (independent PR)**: register the dormant `MCPTools` context tools (`list_operators`, `get_operator_schema`, `get_documentation`, `get_example`, `list_examples`, `search_code`) in `claude-client.ts`'s `getTools()`/`executeTool` so the in-app chat gets the same lookup powers.
- **Live mode**: `mcp-proxy.js` is the working reference implementation that proved the stdio↔browser bridge — the port honors it rather than replaces it. `src/tools/live.ts` carries over its protocol verbatim (stdio ↔ WebSocket :8765, protocol 2024-11-05, request/response correlation, 30s timeout); the only things that change are distribution (`npx` instead of a checked-out script) and where tool schemas come from (queried from the browser instead of hard-coded — the hard-coded copies were fine when written, but every schema copy is a drift liability once the registry becomes the source of truth). The file itself stays with a deprecation pointer ("use `npx noodles-mcp --live`") so existing setups keep a working breadcrumb; remove it only after a release cycle.
- **Tool definitions**: `noodles-mcp` consumes 05's `agent-tools` ToolSpec table from day one via a workspace dep on `noodles-editor` — 05 Phase 0 lands in Phase A, before this package exists, so there is never a second copy to reconcile. `src/tools/live.ts` imports only the declarative half of each ToolSpec (name, description, inputSchema, tier); the browser-bound `execute` bindings stay in the app, and the bridge proxies calls over the WebSocket as before. One constraint this places on 05: the ToolSpec table must be importable by a plain Node package without dragging in the app bundle (05 already specifies the module has no React imports; the table additionally must not import `MCPTools` at module scope — bind executors at registration time, not in the table).

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

- Inbound: 02 (backing data — hard), 01 (Remarks — soft), 05 phase 0 (`agent-tools` ToolSpec table — hard for `--live` mode only; docs mode has no dependency on it). Outbound: 04's `validate-projects` CLI imports this package's registry lint (workspace dep).

## Open questions

- Whether to also expose an HTTP/SSE transport later for hosted use.
- npm org/scope for the package name (`noodles-mcp` vs `@noodles-gl/mcp`).
