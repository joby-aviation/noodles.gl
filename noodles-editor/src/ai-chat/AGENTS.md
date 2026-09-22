# The In-App AI Assistant

The chat panel in the editor (`noodles-editor/src/ai-chat/`) runs its own agent loop
in `ai-chat/agent/`. It is provider-agnostic — the same loop and tool surface serve
Anthropic, OpenRouter, any OpenAI-compatible endpoint you point it at, a local model
on the user's own GPU via WebLLM, and Chrome's built-in Gemini Nano — and it bounds
context cost rather than sending everything it has.

Five things to know before changing it:

1. **`tool-definitions.ts` + `mcp-tools.ts` stay the single source of truth** for the
   tool surface. WebMCP (`src/webmcp/`) registers every one it is offered; the chat
   reaches them through routing. Read the surface through
   `availableToolDefinitions()` / `getToolDefinition()`, never off the raw
   `toolDefinitions` array — `run_code` is gated on `safeMode` via `available?()` and
   has to vanish from discovery *and* dispatch together.
2. **Only 5 tools are sent by default.** `list_nodes`, `get_node_info`,
   `get_node_output`, `apply_modifications`, `find_tools`. The model calls
   `find_tools({query})` to unlock the rest, so a new tool needs a good description —
   that description is how it gets found.
3. **Every tool result is capped** by `agent/result-budget.ts` against the provider's
   context window. A tool that returns unbounded data will be truncated, so return
   ids and previews rather than whole objects (see `listNodes`).
4. **The provider interface is two flags plus a stream.** `supportsNativeTools` and
   `contextWindow` carry all the behavioural difference; adding a provider touches
   nothing in the loop or router. An OpenAI-compatible provider should reuse
   `agent/providers/openai-format.ts` rather than re-implement SSE tool-call
   fragment reassembly.
5. **Which provider runs is `providerPreference` in `noodles/keys-store.tsx`**, not
   the model store, and the rules are in `agent/provider-selection.ts`. `'automatic'`
   picks the first of anthropic → openrouter → custom → webllm → chrome that is
   *ready*. Ready is not the same as "has a key": a custom endpoint needs a base URL
   and a model but no key, and `webllm` needs WebGPU **and** a model the user chose —
   selecting one starts a multi-gigabyte download, so it can never be a consequence
   of no key being configured.

One security boundary lives in this code: `resolvePath()` in `ai-chat/agent-files.ts`.
The assistant reads anywhere under the project's `data/` directory but writes only
inside `data/.agent/`, and the check runs on the *resolved* path segments so a `../`
cannot escape. Any new filesystem tool must go through it rather than calling
`writeAsset` directly.

Full details, including the measured before/after context cost, are in
[dev-docs/agent-harness.md](dev-docs/agent-harness.md).
