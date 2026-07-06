# Sub-plan 05: Unified Tool Registry + WebMCP

One canonical agent-tool registry inside the editor, feeding all four surfaces — in-app chat, external-control WebSocket, `noodles-mcp --live` stdio, and WebMCP (`document.modelContext`) — so a browser-resident agent harness can learn about, interact with, and modify a running project.

## Goals

- A single source of truth for live tool definitions (name, description, JSON Schema, tier, executor).
- A WebMCP provider registering those tools in-page, behind feature detection and user consent.
- Fix the real bugs the current three-surface divergence hides (see below).
- Ship value even if the WebMCP origin trial lapses.

## Non-goals

- Docs tools (sub-plan 03) — this spec covers tools that need a running editor.
- Replacing the WebSocket external-control path — it remains the fallback for non-Chrome, CI, and Claude Desktop.

## Verified findings that shape this plan

First, framing: the three existing tool surfaces (in-app chat, external-control `ToolRegistry`, `mcp-proxy.js`) were each built for one consumer at different times, and each is correct for the path it was built to serve. The divergence between them is a growth artifact — three consumers arrived faster than a shared abstraction — not a design error, and this plan's parity snapshots exist precisely so consolidation can *prove* it changes nothing for existing consumers. With that said, probing the paths beyond each surface's original consumer surfaced a structural gap to fix *before* WebMCP writes are meaningful — **the external-control write path is scaffolding that was never finished** (consistent with `PIPELINE_TEST` and `DATA_UPLOAD` being explicit TODOs in the same module):

- `MCPTools.applyModifications` (`src/ai-chat/mcp-tools.ts:590`) only **validates** and returns "…will be applied". Actual mutation happens exclusively in `ChatPanel` (`src/ai-chat/chat-panel.tsx:145-147`) via the `useProjectModifications` ReactFlow hook.
- `worker-bridge.ts:66` and `tool-adapter.ts:41` construct private `MCPTools` instances and never call `setProject()` — over WebSocket, `getCurrentProject` returns "No project loaded" and `createNode`/`connectNodes`/`deleteNode` "succeed" without mutating anything.
- `worker-bridge.ts:398-404` passes `modifications: {nodes, edges}` (object) where the validator requires an array — `PIPELINE_CREATE` always fails.
- Session permissions `['read','write','execute']` (`session-manager.ts:41`) are never enforced.

Conversely, most reads are already headless-safe: `listNodes`/`getNodeInfo`/`getNodeOutput` use `getOpStore()`, capture/stats use `window.__deckCanvas`/`__deckInstance` (set at `src/timeline-editor.tsx:343`), timeline tools use `getTimelineStore()`. Vitest browser mode with Playwright chromium is already configured — a natural home for a modelContext shim.

## WebMCP background (external)

W3C Web Machine Learning CG draft (Feb 2026); Chrome origin trial roughly 149–156, Canary preview earlier; Edge expected, Firefox/Safari uncommitted. API (still moving — feature-detect both roots): `(document.modelContext ?? navigator.modelContext).registerTool({ name, description, inputSchema /* JSON Schema */, async execute(args) → { content: [{type:'text', text}] } }, { signal })`. Tools are enabled by default in top-level windows and same-origin iframes; cross-origin iframes require `allow="tools"`; calls fail with `NotAllowedError` when disabled.

## Design

### D1. Unified registry: new `noodles-editor/src/agent-tools/`

Why a new module rather than growing `tool-adapter.ts`: the `ToolRegistry` there was shaped for exactly one consumer (the WS protocol) and fits it well — but three properties that were fine for one surface block it as the shared home for four: its `parameters` shape predates standardizing on JSON Schema, its executor is a parallel copy of worker-bridge's dispatch (harmless with one consumer, a divergence engine with four), and it lives in the lazily-loaded external-control chunk while the chat and WebMCP surfaces need tools without that chunk. Nothing in it is discarded — its tool wrappers and parameter descriptions port into the new registry, and its names survive as aliases. New module, no React imports:

```
src/agent-tools/
  types.ts            # ToolSpec { name, aliases?, description, tier: 'read'|'write'|'execute',
                      #            inputSchema: JSONSchema, execute(args, ctx) -> ToolResult }
  registry.ts         # defineTool() + canonical table + alias resolution
  executor.ts         # ONE shared MCPTools, arg validation, central tier/permission enforcement
  project-bridge.ts   # headless getProject()/applyModifications() — the load-bearing new piece
  adapters/anthropic.ts | webmcp.ts | ws-legacy.ts
  webmcp-provider.tsx
```

- **JSON Schema is the single format**: Anthropic `input_schema` IS JSON Schema (rename only); WebMCP `inputSchema` IS JSON Schema; MCP `inputSchema` IS JSON Schema. Only the legacy WS `ToolDefinition` needs a shim (`adapters/ws-legacy.ts`), deleted after one release.
- **Canonical names are snake_case** (matches chat + MCP ecosystem); camelCase `ToolRegistry` names become deprecated aliases.
- **project-bridge**: the editor registers `{getProject, applyModifications}` from a `useEffect` where ReactFlow context exists (the pattern ChatPanel already uses), following the established `window.__deckInstance` registration idiom but typed and module-scoped. This makes writes real for WS, stdio, and WebMCP simultaneously.

**Migration of the three surfaces**: (1) `claude-client.ts` — replace inline `getTools()` (:383) with `toAnthropicTools(listToolSpecs())` and the `executeTool` method map (:568) with `executor.execute()`; chat-only context tools stay a chat-local extension array. (2) `worker-bridge.ts` — dispatch through `executor.execute(resolveAlias(name), args)`, delete its private MCPTools, and finally enforce `session.permissions` against `ToolSpec.tier` on non-localhost. (3) `mcp-proxy.js` / `noodles-mcp --live` — delete hard-coded schemas; add `TOOL_LIST`/`TOOL_LIST_RESPONSE` to `message-protocol.ts` so the bridge answers `tools/list` by querying the running browser (cached fallback when disconnected). Coordinate with sub-plan 03's `tool-defs.ts`: once this module exists, that file re-exports these specs.

### D2. WebMCP provider

`webmcp-provider.tsx`, lazily mounted from `src/app.tsx` (mirroring `ExternalControlProvider` at :50-63) only when feature detection passes and `?webmcp !== 'off'`. Local ambient types in `webmcp.d.ts`; no typings dependency. One `AbortController` per mount; `registerTool(descriptor, {signal})` per enabled ToolSpec; abort + re-register on consent change only — **no re-registration on project switch** (tools read live stores, so `get_current_project` always reflects the current graph). Catch `NotAllowedError` gracefully; skip registration entirely when `window.top !== window`.

Result mapping: `{content:[{type:'text', text: safeStringify(result)}]}` (reuse `src/noodles/utils/serialization`), `isError: true` on failure. `capture_visualization` attempts MCP-shaped `{type:'image', data, mimeType}` content with text fallback; JPEG q0.5 default to bound payload size.

### D3. v1 tool table (18 tools)

| Tier | Tools |
|---|---|
| **read** (auto-on) | `get_current_project` (via project-bridge), `list_nodes`, `get_node_info`, `get_node_output` (rows capped 100), `list_operators`, `get_operator_schema` (context bundle; graceful error if unloaded), `get_timeline`, `capture_visualization`, `get_console_errors`, `get_render_stats`, `inspect_layer` |
| **write** (consent-gated) | `apply_modifications` (the primitive, now real via project-bridge), `create_node`, `connect_nodes`, `delete_node` (thin wrappers ported from tool-adapter, camelCase aliases), `set_keyframe`, `delete_keyframe` |
| **execute** (consent-gated) | `set_playback_position` |

Not carried forward as separate tools — with their capability preserved: `listOperatorTypes` becomes an alias of `list_operators` (same data, one name canonical); `createPipeline`'s high-level pipeline-spec form is reimplemented *on top of* `apply_modifications` (which also fixes the object-vs-array mismatch that currently prevents it from working at all), so existing WS clients sending `PIPELINE_CREATE` keep working. Schemas are copied from `claude-client.ts`'s `getTools()` — the best-written set — enriched with mcp-proxy's parameter descriptions, so the prior authors' descriptive work carries into the unified registry rather than being rewritten.

### D4. Security and gating

Threat model: any user-invited browser agent (possibly prompt-injected via rendered dataset content) can call registered tools.

- **Read tools default-ON** with a visible status pill — they expose nothing an in-browser agent can't already scrape from the DOM/canvas; that is WebMCP's trust model.
- **Write/execute default-OFF** behind an "Allow agents to edit this project" toggle added to the existing `src/external-control/components/sharing-dialog.tsx` (button renamed "Agent Access"), persisted per-origin in localStorage (`off | read | read-write`), with a session-only override.
- Tier enforcement lives centrally in `executor.ts` per calling surface: WebMCP → consent store; WS → `session.permissions` (finally enforced); in-app chat → full access.
- Activity counter flashes the pill per call. No stored-project/deletion tools exist in the table — `apply_modifications` touches only the open graph.

### D5. Origin trial + fallback

A small `transformIndexHtml` Vite plugin injects `<meta http-equiv="origin-trial">` into `noodles-editor/index.html` only when `VITE_WEBMCP_OT_TOKEN` is set (register the trial for `https://noodles.gl`). Local dev: Chrome Canary flag, documented. The WS path remains the fallback; both surfaces share the executor, so behavior is identical.

### D6. Testing

- ~30-line `modelContext` shim (`src/agent-tools/__tests__/webmcp-shim.ts`) recording registrations, run under the already-configured Vitest browser mode.
- Registry tests: schema validity, name uniqueness, alias table covers all 12 legacy names.
- **Parity snapshots**: snapshot today's `getTools()` output *before* migrating; assert `toAnthropicTools()` matches. `TOOL_LIST` equals registry.
- Provider lifecycle: default read count, consent flip re-registers, abort unregisters, `?webmcp=off`, `NotAllowedError` path.
- Project-bridge round-trip (would have caught the existing WS write no-op).
- Manual Canary checklist for E2E.

## Implementation steps / phasing

- **Phase 0 (ships standalone, zero WebMCP dependency)**: `agent-tools` module + project-bridge; migrate all three surfaces; enforce WS permissions; fix the `PIPELINE_CREATE` array bug. Fixes four real bugs today.
- **Phase 1**: WebMCP read-only provider + shim tests + `docs/developers/webmcp.md` (support table → Canary quick start → generated tool reference → consent/security model → WebMCP-vs-WebSocket decision matrix → troubleshooting); update `src/external-control/README.md` architecture diagram to one-registry-four-surfaces.
- **Phase 2**: write tools + consent UI in sharing-dialog + activity indicator.
- **Phase 3**: origin-trial token, image content for capture, promote context-bundle tools (ensure `globalContextManager.startLoading()` fires when any agent surface initializes, not just chat), delete the ws-legacy shim.

If the origin trial lapses: Phases 0 and 2 remain fully valuable for the WS path; WebMCP code is inert behind feature detection.

## Verification

1. Unit/browser tests above green; parity snapshots prove no chat regression.
2. WS path: `npx noodles-mcp --live` (or interim proxy) against `?externalControl=true` — `create_node` now actually mutates the graph; permission-restricted session rejects writes.
3. Canary manual: open noodles.gl/app with the flag; agent lists tools, reads graph, screenshot; enable Agent Access; `apply_modifications` adds a node visible in the editor.

## Dependencies

- Inbound: none for Phase 0. Coordinates with 03 (`tool-defs.ts` becomes a re-export), 04 (skills teach canonical snake_case names + `apply_modifications` shapes), 01/02 (get_documentation-style tools once bundles/pages exist).

## Open questions

- Multimodal tool results (image content types) — track the spec; text fallback is required regardless.
- Whether declarative (HTML-attribute) WebMCP registration is worth adding for static affordances later.
