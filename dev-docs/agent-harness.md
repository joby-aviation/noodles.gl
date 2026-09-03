# Agent harness (in-app AI chat)

**Last updated:** 2026-09-03

The in-app assistant runs on a hand-rolled agent loop in `noodles-editor/src/ai-chat/agent/`.
It is provider-agnostic: the same loop, tool surface, and context budgets serve a
frontier model on Anthropic, a mid-tier model on OpenRouter, and Chrome's built-in
Gemini Nano — a 200,000-token window and a ~6,000-token one, unchanged.

It replaces `claude-client.ts` (deleted), which was hardcoded to one model, sent
every tool schema on every request, and serialized tool results with no size cap.

> Two older documents describe a different, never-implemented design (LangChain.js +
> `@mlc-ai/web-llm` + `voy`): `dev-docs/webllm-ai-integration.md` and
> `dev-docs/specs/webllm-ai-chat/webllm-ai-chat.md`. Both are superseded by this file.

## Layout

| File | Role |
| --- | --- |
| `agent/types.ts` | `AgentProvider`, `AgentEvent`, `AgentMessage` — the provider-neutral wire types |
| `agent/loop.ts` | `runAgent` — the step loop, tool dispatch, batching, screenshots, abort |
| `agent/session.ts` | `AgentSession` — what the UI talks to; owns router state, history, compaction |
| `agent/tool-router.ts` | Progressive tool disclosure (`find_tools`), allowlists |
| `agent/result-budget.ts` | Caps every tool result against the provider's window |
| `agent/subagent.ts` | The `delegate` tool and its toolsets |
| `agent/web-search.ts` | The `web_search` tool, per provider |
| `agent/providers/*.ts` | `anthropic`, `openrouter`, `chrome` |
| `prompts/core.md` | The always-in-context system prompt |
| `prompts/sections/*.md` | Workflow walkthroughs, retrieved on demand via `get_documentation` |

`tool-definitions.ts` and `mcp-tools.ts` remain the single source of truth for the
tool surface. WebMCP (`src/webmcp/register.ts`) still registers all of them
unconditionally and is unaffected by any of the routing below.

## Providers

| | Anthropic | OpenRouter | Chrome |
| --- | --- | --- | --- |
| Default model | `claude-sonnet-5` | `google/gemini-2.5-flash` | `gemini-nano` |
| Context window | 200k | per-model table, 128k fallback | discovered at runtime (~6k) |
| Native tool calling | yes | yes | **no** — constrained JSON |
| Images (screenshots) | yes | yes | no |
| Web search | server-side `web_search_2026…`/`…20250305` | `plugins: [{id:'web'}]` | unavailable |
| Prompt caching | `cache_control: ephemeral` on the system prompt | — | — |
| API key | required | required | none |

The provider and model are chosen in the chat panel header and persisted by
`agent/model-store.ts`. Chrome is selectable but never the automatic fallback — it
is the weakest of the three, so it has to be asked for.

Two provider flags carry all the behavioural difference: `supportsNativeTools`
(false makes the Chrome provider emulate the tool round-trip with a
`responseConstraint` JSON schema, translating the model's one-object reply into the
same `tool_call` event the others emit) and `contextWindow` (which sizes the
disclosure limits, the per-result budget, the step limit, and the compaction
threshold).

Adding a provider means implementing `AgentProvider.stream()` to yield
`text_delta` / `tool_call` / `usage` / `stop` events, adding it to `ProviderId`, and
adding a case to `createProvider` and `modelChoicesFor` in `chat-panel.tsx`. Nothing
in the loop, router, or budget changes.

## The loop

`runAgent` steps until the model stops or it hits the step limit — 12 steps, or 6
when the window is under 32k. Each step is one model turn plus its tool batch.

- **Batching.** Calls in one batch run concurrently while every tool in it is
  read-only (`ToolAnnotations.readOnlyHint`, or `HarnessTool.readOnly`); the first
  mutating call forces the rest to run in order after it, so two
  `apply_modifications` calls can never race.
- **Screenshots.** Base64 is stripped from the tool result and reattached as an
  image block on the follow-up message — only when `provider.supportsImages`.
- **Opaque provider blocks.** Anything a provider needs echoed back verbatim
  (Anthropic thinking blocks, for instance) rides through the transcript as a
  `provider_block` and is never inspected. Dropping them makes Anthropic reject the
  following tool-result turn.
- **Compaction.** `compactionThreshold(contextWindow)` is a quarter of the window,
  so a 6k local model compacts at ~1.5k tokens instead of never. The summarizer runs
  through the provider, not a hardcoded client.
- **Abort.** The panel's Stop button aborts mid-stream; the partial reply is kept,
  because the user stopped the run, they did not undo it.

## Progressive tool disclosure

The old client sent 13 tool schemas on every request and hid 9 retrieval tools
behind `exposeToChat: false` — which meant the chat could never reach the docs,
examples, or code-search tools at all. That flag is gone.

Now five tools are always sent — `list_nodes`, `get_node_info`, `get_node_output`,
`apply_modifications`, `find_tools` — and `find_tools({query})` keyword-scores the
whole surface, returns full input schemas for the best matches, and unlocks them for
the rest of the conversation. How many stay unlocked at once depends on the window:
2 below 16k, 6 below 100k, unlimited above.

Sub-agents get a narrowed router via `ToolRouter`'s `allow` option. Toolsets are
allowlists rather than deny-lists, so a new mutating tool cannot quietly become
available to a research agent; the loop also refuses a disallowed name at dispatch,
because a model can name a tool it was never offered.

## Result budget

`capToolResult(name, result, budgetChars)` serializes a result and, if it is over
budget, walks a ladder of successively tighter (array items, string chars) limits
until it fits, then appends a `_truncated` marker with a per-tool hint telling the
model how to get the omitted detail. Truncation is element-wise on arrays and
marked on strings, so the payload is always valid JSON.

The budget is 10% of the window in chars, clamped to 600–24,000 — so the same
`list_nodes` call fits a 200k model and a 6k one.

## Harness tools

Two tools need something the tool definitions have no access to (a provider, an API
key), so they live in the harness and are discoverable and unlockable exactly like
the rest:

- **`web_search`** — server-side search on Anthropic, the `web` plugin on
  OpenRouter, unavailable on Chrome (where the tool is not offered at all, so the
  model never promises a search it cannot run).
- **`delegate({task, toolset})`** — spawns `runAgent` at `depth + 1` with a fresh
  transcript and a narrowed toolset, and returns **only** the child's final report.
  Its tool results never enter the parent transcript, which is the largest single
  context win — `search_code` returns large per-hit context arrays. Depth is capped
  at 1: no recursive fan-out in a browser tab.

| Toolset | For | Can mutate the graph |
| --- | --- | --- |
| `research` | docs, examples, source, operator schemas, web | no |
| `inspect` | the live graph, outputs, render stats, screenshots | no |
| `build` | inspect plus `apply_modifications` and keyframes | yes |

A `build` sub-agent's edits reach the graph because `delegate` returns them under
`modifications`, which the parent loop already collects.

## Transcript fidelity

`Message` gained an optional `toolUses: {name, params, ok}[]`, recorded on each
assistant turn and replayed as a single text line (`[tools used: get_node_info(nodeId=…)]`).
This is a deliberate departure from replaying real `tool_use` / `tool_result`
blocks: full fidelity would put every past tool result back into context on every
later turn, which is the cost this harness exists to bound. A follow-up like "why
did you pick that layer?" needs the *fact* of the call, at tens of tokens, not the
kilobytes of its result.

Stored conversations carry `version: 2` (`CONVERSATION_VERSION`); records written
before versioning load as version 1 and still work.

## Measured context cost

Numbers below are **serialized payload sizes**, measured by
`src/ai-chat/agent/context-cost.test.ts` against a synthetic 60-node project shaped
like `nyc-taxis` (6 `CodeOp`, 6 `DuckDbOp`, 12 layers, 35 small nodes). Re-run with:

```bash
cd noodles-editor && npx vitest run src/ai-chat/agent/context-cost.test.ts --silent=false
```

Token figures are estimates at ~4 chars/token, not tokenizer counts. "Before" is the
old code path reconstructed in that test: the 13 schemas the old client sent, and
the old `listNodes` shape copied verbatim.

| Per-turn component | Before | After | Change |
| --- | --- | --- | --- |
| System prompt | 9,278 chars (~2,300 tok) | 2,910 chars (~730 tok) | −69% |
| Tool schemas | 4,291 chars, 13 tools (~1,070 tok) | 2,183 chars, 5 tools (~550 tok) | −49% |
| One `list_nodes` result (200k window) | 18,447 chars (~4,600 tok) | 11,462 chars (~2,870 tok) | −38% |
| One `list_nodes` result (6k window) | 18,447 chars (~4,600 tok) | 1,637 chars (~410 tok) | −91% |
| **First turn, all three** | ~32,000 chars (~8,000 tok) | ~16,600 chars (~4,150 tok) | **−48%** |

The `list_nodes` saving is the slimming alone (role groupings carry ids instead of
re-serialized node objects; `position` dropped; long string inputs clipped to a
preview) — at a 200k window the result still fits under the 24,000-char cap, so the
budget never engages. At Nano's window the budget is what makes the call possible at
all: 18k chars would exceed the entire context.

The remaining six prompt sections (16,914 chars total) are no longer sent at all;
they reach the model through `get_documentation` when a workflow actually calls for
one.

**Not yet measured:** live per-turn `inputTokens` from a real provider. The figures
above are payload sizes computed offline, which is why they are reproducible without
an API key — but they do not account for tokenizer differences or prompt caching (on
Anthropic the system prompt is cached, so its cost is paid once per session rather
than per turn).

## Testing

```bash
cd noodles-editor && npx vitest run src/ai-chat src/webmcp
```

`loop.test.ts` drives the loop with a fake provider yielding scripted events;
`providers/*.test.ts` cover SSE fragment reassembly (OpenRouter) and constrained-JSON
parsing (Chrome) against fakes. No test spends a real API request.

End-to-end checks that do need keys are listed in the PR description for this work:
streaming and Stop on Anthropic, cost readout on OpenRouter, `find_tools` →
`get_documentation` on a docs question, `delegate` on an examples question, and a
`list_nodes` turn on Chrome Canary with the Prompt API enabled.
