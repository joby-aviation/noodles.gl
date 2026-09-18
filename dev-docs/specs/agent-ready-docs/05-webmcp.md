# Sub-plan 05: Unified Tool Registry + WebMCP

One canonical tool-definition source feeding every agent surface of the running editor, exposed to browser-resident agents and external MCP clients via WebMCP. The core of this sub-plan **landed independently in PR #508** (authored before this spec was reviewed; the two converged on the same shape). This spec is reconciled against that PR: it records what exists, then scopes the follow-ups. Where the PR and the original spec diverged, the PR's calls were mostly better and this spec adopted them.

## Landed via #508

- **Canonical tool definitions**: `src/ai-chat/tool-definitions.ts` — 22 tools, snake_case names, JSON Schema, one source of truth consumed by both the in-app chat (`claude-client.ts` refactored to derive its Anthropic tool list from it) and WebMCP registration. Type-only imports, so it satisfies the plain-Node importability constraint 03 needs. (The original spec placed this in a new `src/agent-tools/` module with a separate executor and alias table; the single-file shape that landed is simpler and does the job. `tier` and `mutatesProject` fields are proposed in review, pending the author's read.)
- **The write path is real for WebMCP**: `src/webmcp/bridge.ts` + a `noodles.tsx` effect register the editor's `useProjectModifications` applier and sync live `{nodes, edges}`, so `apply_modifications` mutates the actual graph. This fixes, for the WebMCP surface, the write no-op this spec originally diagnosed (`MCPTools.applyModifications` only validates).
- **WebMCP provider**: `src/webmcp/register.ts` + `index.tsx` — lazy chunk behind `?externalControl=true`, AbortSignal teardown, registration on `navigator.modelContext` via the `@mcp-b/global` polyfill, localhost-only injection of the `@mcp-b/webmcp-local-relay` embed (pinned v4; the relay is how stdio MCP clients like Claude Code reach the page).
- **The dormant context tools promoted**: all nine (search_code, get_operator_schema, list_operators, get_documentation, get_example, list_examples, find_symbol, get_source_code, analyze_project) got schemas and WebMCP exposure, with `exposeToChat: false` keeping the chat's token budget unchanged. Context bundles load whenever the agent surface initializes, not just when chat opens.
- **Result mapping**: text blocks, `isError` conversion, and screenshots as proper MCP image blocks (originally a phase 3 item here).
- **Tests**: 18 covering registration, abort/re-register, chat parity, error conversion, and the bridge round-trip — the substance of the original D6.
- **Docs**: AGENTS.md and `src/external-control/README.md` updated; WebMCP documented as the recommended path, the WebSocket proxy relabeled legacy.

Two calls in #508 the original spec didn't make, both adopted:

1. **The relay solves stdio access.** Claude Code can't speak WebMCP natively; the spec's answer was keeping the WS proxy as fallback. The relay (`claude mcp add webmcp -- npx -y @mcp-b/webmcp-local-relay@4`) bridges MCP clients to the page directly, and likely supersedes 03's planned `--live` mode entirely.
2. **Polyfill over feature detection.** `@mcp-b/global` makes WebMCP work in any browser today, rather than waiting on native support. Native still matters (see F2), but as an addition, not a gate.

## What remains true from the original findings

- The **WebSocket surface's bugs are still live**: `worker-bridge.ts`/`tool-adapter.ts` construct private `MCPTools` instances without `setProject()` (reads report "No project loaded", mutations validate-then-drop), `PIPELINE_CREATE` passes an object where an array is required, and `session.permissions` are never enforced. #508 labels the path legacy without touching it. Resolution is F4 below.
- **No access tiering exists.** All 22 tools, including writes, register wherever `?externalControl=true` is set, on any origin. The relay embed is localhost-only, but registration is not, so the hosted app with that param hands writes to any browser-resident agent (extension or origin-trial Chrome). Deliberately accepted at merge; the access model is F1.

## WebMCP background (updated)

The Chrome origin trial is **live now** (Chrome 149–156); local testing needs only `chrome://flags/#enable-webmcp-testing` on 149+. Firefox/Safari remain uncommitted, which is the polyfill's enduring justification. Delivery reality: native WebMCP serves browser-resident agents; the relay serves stdio MCP clients; the polyfill covers browsers without native support. All three coexist on the same registration call.

## Follow-ups (the remaining scope of this sub-plan)

### F1. Access model

Gate write/execute tools (`apply_modifications`, `set_keyframe`, `delete_keyframe`, `set_playback_position`) behind an explicit grant; reads stay on wherever `?externalControl=true` is (they expose little a browser-resident agent can't already scrape). Proposed mechanism, raised in #508 review and compatible with 07's T5 builder:

- `?agentAccess=read-write` (session-only, never persisted, headlessly settable by construction) or localhost enables writes; default elsewhere is read-only.
- Skip registration entirely when `window.top !== window`, so an embedding page can't quietly pick up the tool surface.
- A `tier: 'read' | 'write' | 'execute'` field on `ToolDefinition` makes the gate data instead of a name list (also proposed: `mutatesProject: true` to replace the by-name special-case of `apply_modifications` in `runTool`).
- A visible indicator when tools are registered, with an activity flash per call.

The original spec's fuller consent store (`noodles:agent-access` in localStorage, `consent.ts` owner module, sharing-dialog toggle) remains the design if per-origin persistence proves wanted; it may be over-designed relative to the URL param, and that judgment is explicitly deferred to the follow-up (see the #508 review thread on `register.ts`). Until F1 lands, the documented interim behavior is: `externalControl=true` grants writes.

### F2. Origin-trial token (committed)

Register `https://noodles.gl` for the WebMCP origin trial and inject the token via a small `transformIndexHtml` Vite plugin when `VITE_WEBMCP_OT_TOKEN` is set, making the hosted app natively agent-visible in ordinary Chrome 149–156. **Precondition**: confirm whether `@mcp-b/global` defers to native `modelContext` when present or conflicts with it (asked in the #508 review thread on `index.tsx`); if it doesn't defer, add a feature-detect guard before the side-effect import. Token expires with the trial window; the polyfill path is unaffected either way.

### F3. Relay embed hardening

Self-host the relay embed (`public/webmcp/`, documented in the code comment) or add an SRI integrity hash to the injected script tag. Localhost-only injection bounds the blast radius to dev machines, which are the machines holding keys. Also resolves the offline-dev availability dependency on jsdelivr.

### F4. WebSocket path resolution

Decide fix-or-remove (asked in the #508 review thread on the external-control README): either wire the applier through the same bridge (small, and kills the `PIPELINE_CREATE` bug and enforces `session.permissions` while there), or set a removal date and delete `worker-bridge`/`tool-adapter`/`mcp-proxy.js` outright. The unacceptable steady state is the current one, where the docs say legacy and the bug says broken. If removal wins, 03's `--live` mode is also moot and its spec section should be cut rather than built.

### F5. Docs and chat parity

- `docs/developers/webmcp.md` on the published site: support matrix (native trial / polyfill / relay / extension), quick starts per client, the access model from F1, and the WebMCP-vs-WebSocket status.
- Decide whether the context tools should also be offered to the in-app chat (`exposeToChat` is currently `false` for all nine, a deliberate token-budget call; the roadmap's original quick win #1 assumed they'd be registered). Small, separate decision.

## Verification (for the follow-ups)

1. F1: with `?externalControl=true` alone on a non-localhost origin, write tools are absent from `tools/list`; adding `?agentAccess=read-write` restores them; registration is skipped in an iframe. Existing #508 tests stay green.
2. F2: with the token deployed, native Chrome (no flags) on noodles.gl lists the tools; with the flag enabled locally, polyfill and native don't double-register.
3. F4 (if fix): the WS path's `create_node` mutates the graph and a permission-restricted session rejects writes; (if remove): grep confirms no references remain, and external-control docs point exclusively at WebMCP/relay.

## Dependencies

- 03: `--live` mode is likely superseded by the relay (decide alongside F4); the import target for tool definitions is `src/ai-chat/tool-definitions.ts`.
- 07: the T5 environment builder uses F1's `?agentAccess=read-write` once it exists; until then T5's documented grant is `?externalControl=true` alone (writes-on interim).
- 04: `noodles-live` skill teaches the relay connection (`claude mcp add webmcp -- npx -y @mcp-b/webmcp-local-relay@4`) and the snake_case tool names.

## Open questions (tracking #508 review threads)

- Does `@mcp-b/global` defer to native `modelContext` when the origin trial/flag is active? (Gates F2.)
- `tier`/`mutatesProject` fields on `ToolDefinition` — author's read pending. (Shapes F1.)
- WS path: fix or remove? (F4.)
- Is the URL-param grant sufficient long-term, or does the persistent consent store earn its complexity? (F1.)
- Whether declarative (HTML-attribute) WebMCP registration is worth adding for static affordances later.
