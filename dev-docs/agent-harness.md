# Agent harness (in-app AI chat)

**Last updated:** 2026-09-08

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
| `agent/providers/*.ts` | `anthropic`, `openrouter`, `custom`, `chrome` |
| `agent/providers/openai-format.ts` | The OpenAI chat-completions wire format, shared by `openrouter` and `custom` |
| `prompts/core.md` | The always-in-context system prompt |
| `prompts/sections/*.md` | Workflow walkthroughs, retrieved on demand via `get_documentation` |

`tool-definitions.ts` and `mcp-tools.ts` remain the single source of truth for the
tool surface. WebMCP (`src/webmcp/register.ts`) still registers all of them
unconditionally and is unaffected by any of the routing below.

## Providers

| | Anthropic | OpenRouter | Custom | Chrome |
| --- | --- | --- | --- | --- |
| Default model | `claude-sonnet-5` | `google/gemini-2.5-flash` | whatever you type | `gemini-nano` |
| Context window | 200k | per-model table, 128k fallback | configurable, 32k default | discovered at runtime (~6k), and measured per turn |
| Native tool calling | yes | yes | assumed, switchable off | **no** — constrained JSON |
| Images (screenshots) | yes | yes | off by default | no |
| Web search | server-side `web_search_2026…`/`…20250305` | `plugins: [{id:'web'}]` | unavailable | unavailable |
| Prompt caching | `cache_control: ephemeral` on the system prompt | — | — | — |
| API key | required | required | required | none |

`custom` is one provider no matter how many servers it points at: any endpoint
speaking OpenAI chat-completions — Groq, OpenAI itself, vLLM, LM Studio, Ollama's
compat layer. It is configured in Settings → AI Provider (base URL, key, model,
display name, optional context window), and the Save button first calls
`validateCustomEndpoint`, which `GET`s `{base}/models` and refuses a server whose
catalogue does not list the model you typed. Because these servers disagree about
error shape, `describeFailure` tries `error.message`, then a bare `message`, then the
status line, and a browser-level "Failed to fetch" is reported as "connection
refused, or the server does not allow browser requests (CORS)" — which is what it
almost always is for a self-hosted model.

`openrouter` and `custom` differ only in what the same wire format asks for:
`usage: {include: true}` versus `stream_options: {include_usage: true}`, plus
attribution headers. Everything else — message translation, SSE decoding, tool-call
fragment reassembly — lives once in `providers/openai-format.ts`.

The provider is chosen in the chat panel header (or pinned in Settings) and stored as
`providerPreference` in `noodles/keys-store.tsx`; the model is stored separately in
`agent/model-store.ts`. `'automatic'` walks `anthropic → openrouter → custom → chrome`
and takes the first one whose credential is present, so Chrome is never picked for you
— it is the weakest of the four and has to be asked for. A pinned provider that has
lost its credential falls back to the same walk rather than showing an error.

Two provider flags carry all the behavioural difference: `supportsNativeTools`
(false makes the Chrome provider emulate the tool round-trip with a
`responseConstraint` JSON schema, translating the model's one-object reply into the
same `tool_call` event the others emit) and `contextWindow` (which sizes the
disclosure limits, the per-result budget, the step limit, and the compaction
threshold).

`AgentProvider.dispose()` is optional and only Chrome implements it: an HTTP
provider holds nothing between turns, an on-device session holds the transcript.
`AgentSession.dispose()` forwards to it, and `chat-panel.tsx` calls that from its
init effect's cleanup — including for a session that was superseded while still
being built.

### The Chrome provider's session

Unlike an HTTP provider, which is handed the whole history on every request, a
Prompt API session *accumulates* it. So the provider keeps one session across turns
and sends only the messages that session has not seen, which makes two things true:

- The system prompt and the tool schemas live in `initialPrompts`, which the API
  documents as never evicted. They are paid for once per conversation instead of
  once per turn, and they survive a conversation that overflows the window.
- Reuse is only valid while the transcript is being *extended*. Each turn's
  messages are serialized to one line apiece and diffed against what was sent; a
  changed prefix (compaction, the loop's own trimming, a cleared conversation) or a
  changed tool set (`find_tools` unlocking one rewrites the schemas) rebuilds the
  session, because a session cannot forget and `initialPrompts` cannot be amended.

Overflow is handled before the API throws: `measureContextUsage()` is checked
against `contextWindow - contextUsage`, and a turn that will not fit rebuilds on a
trimmed transcript. `QuotaExceededError` remains caught as a backstop, since the
measurement is optional and can undercount.

### Native tool calling on the Prompt API: not yet

MDN documents a `tools: [{name, description, inputSchema, execute}]` option on
`LanguageModel.create()`, which would replace the emulation above with
grammar-constrained tool calls. It is spec, not implementation. Measured against
Chrome 152 (2026-09-07):

| Probe | Result | Reading |
| --- | --- | --- |
| `create({initialPrompts: 42})` | `TypeError: … cannot be converted to a sequence` | declared member |
| `create({tools: 42})` | `NotSupportedError` | **ignored** |
| `create({totallyMadeUpOption: 42})` | `NotSupportedError` | control |
| `availability({expectedOutputs: [{type: 'tool-call'}]})` | `'unavailable'` | `tool-call` is in the shipped enum |
| `availability({expectedOutputs: [{type: 'not-a-real-type'}]})` | `TypeError: … not a valid enum value` | control |

WebIDL converts arguments in the binding layer before the method body runs, so those
readings hold on a machine where the model itself is absent. Chrome's own tracker
agrees: *Function Calling capability in Prompt API* is `Proposed` — no milestone, no
dev trial, no flag.

The trap is in rows 4 and 5: the `tool-call` message type shipped **ahead** of the
`tools` option, so a probe that passed a well-formed tool plus
`expectedOutputs: [{type: 'tool-call'}]` and watched for a rejection would report
support that is not there. `nativeToolSupport()` therefore reads IDL conversion
instead — it hands `tools` a non-sequence and treats a `TypeError` as the signal,
with a control call so an engine that rejects every `create()` cannot pass.

It is reported but not yet wired, and wiring it is not a swap: those tools take an
`execute` callback the browser invokes itself, awaiting all of them before the model
replies, whereas `AgentProvider.stream()` yields tool calls out for the loop to
schedule — and the loop is what serializes anything mutating. Adopting it means
holding a `prompt()` promise open across `stream()` calls and resolving it from the
next request's tool result. MDN also notes `execute`'s arguments are "specific to the
model being used", which is not something to write a provider against until there is
a real implementation to read.

Adding a provider means implementing `AgentProvider.stream()` to yield
`text_delta` / `tool_call` / `usage` / `stop` events, adding it to `ProviderId`, and
adding a case to `createProvider` and `modelChoicesFor` in `chat-panel.tsx`. Nothing
in the loop, router, or budget changes. If it speaks OpenAI chat-completions, reach
for `openai-format.ts` rather than a third copy of the fragment-reassembly logic.

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

## `run_code`

`run_code({code, timeoutMs})` evaluates JavaScript against the live graph and returns
the value. It is CodeOp's sandbox without a node: `fnWithSource` compiles the body,
`op('/id').out.data` / `.par.field` read any operator, and `d3`, `turf`, `deck`,
`Plot`, `Temporal`, `utils` and every operator class are in scope, plus
`sequenceTime` / `frame` / `totalFrames` / `sequence`. `await` is allowed. The
implementation is `src/ai-chat/run-code.ts`; `MCPTools.runCode` is a one-line
forwarder so the tool definitions and WebMCP still reach everything through one
surface.

This is the largest single capability jump in the harness and it benefits every
provider at once — a model that could previously only *describe* a transform can now
check whether it works.

Four things about it are deliberate:

- **Results are summarized in `describe()` before `capToolResult` ever sees them.**
  The budget caps what reaches the model, but it serializes the whole value first, so
  returning a million-row array would build hundreds of megabytes of string just to
  throw it away. Arrays over 20 items come back as `{length, sample, note}`; typed
  arrays, `Map`/`Set` and operators get their own summaries; `NaN` and `Infinity`
  render as `[NaN]` / `[Infinity]`, because `JSON.stringify` turns them into `null`
  and "no value" is the wrong thing for a model to read when the arithmetic went
  wrong.
- **Field-value changes land in one undo entry**, via the non-React
  `captureOperatorInputs` / `firePropertyMutation` pair. Pure computation creates no
  entry at all, and a call that did change something reports `changedFieldValues`.
  This only covers field values — adding or deleting operators goes through
  `apply_modifications`, which the UI applies with its own history — so the tool
  description points structural edits there.
- **`timeoutMs` bounds the await, not the code.** A synchronous infinite loop hangs
  the tab and no amount of racing changes that; the only real fix is a worker, and a
  worker cannot see the graph, which is the point of the tool. What the timeout does
  catch is the realistic hang: an `await` on a fetch that never resolves, which would
  otherwise wedge the loop with no step limit to save it. The timeout message says so
  rather than implying the code was cancelled.
- **`readOnlyHint: false`**, so the loop serializes it instead of batching it with
  reads.

`ToolDefinition` gained an optional `available?: () => boolean` for this tool and,
for now, only this tool. Safe mode (`?safeMode=true`) exists to stop the app
executing arbitrary code, so `run_code` has to *disappear* rather than be offered and
then refuse — a tool the model can see but that always fails wastes turns. The gate
is read through `getToolDefinition` and `availableToolDefinitions()`, never off the
raw `toolDefinitions` array, which covers three surfaces at once: `find_tools`
scoring, `webmcp/register.ts`, and dispatch. Dispatch matters as much as discovery,
because `executeTool` looks tools up by name and a model can name one it was never
offered; an undefined lookup becomes "Unknown tool" and makes `isReadOnly` fall back
to treating the call as mutating.

`run_code` is not tier 0, so it costs nothing per turn — the model reaches it through
`find_tools`, whose description now leads with "running JavaScript against the live
graph". That is why the measured always-sent schema payload below is unchanged by
adding it.

## The agent filesystem

`list_files`, `read_file`, `write_file` and `grep_files` give the assistant the
project's own data directory. The implementation is `src/ai-chat/agent-files.ts`, a
thin layer over the same `readAsset` / `writeAsset` / `listDataFiles` in
`noodles/storage.ts` that a `FileOp` uses — which is the whole point. A file written to
`@/.agent/joined.csv` is loadable by setting a `FileOp`'s `url` to that path, with no
import step, so the model can compute a derived dataset in `run_code`, persist it, wire
it into the graph, and confirm the result with `get_node_output`.

**Reads and writes are deliberately asymmetric.** Reads resolve anywhere under `data/`,
because that is data the project already exposes to the assistant through its nodes.
Writes are rejected unless the resolved path is inside `data/.agent/`, so a mistaken
path cannot clobber the dataset the project is built on.

`resolvePath()` is the security boundary and is tested directly and exhaustively
(`agent-files.test.ts`). Three things about it:

- **Resolve, then check.** Segments are walked onto a stack that refuses to pop past
  the root, and the write check runs on the resolved segments. A blocklist of `..`
  spellings would be whack-a-mole; a stack cannot be talked out of it.
  `.agent/../trips.csv` is rejected and `.agent/../.agent/out.csv` is allowed, which is
  exactly the distinction a string check gets wrong.
- **`@/` and `data/` prefixes are both accepted**, because both are spellings the model
  has already seen — the first in a `FileOp` url, the second in project JSON. An
  interior `..` resolves rather than being refused; refusing a legal path teaches the
  model to distrust the tool.
- **Absolute paths, backslashes and NUL bytes are refused by name.** A backslash is a
  legal POSIX filename character, so treating it as a separator would be wrong — but a
  Windows-shaped path is a mistake worth reporting rather than silently honouring as a
  file called `..\secrets`.

Two deviations from the plan, both deliberate:

- **Writes are not in the undo stack.** `UndoRedoManager` snapshots
  `projectState: NodesProjectJSON` and keeps 50 entries; putting file contents there
  would make undo a memory problem. Instead, replacing a scratch file copies the
  previous contents to `@/.agent/.previous/<path>`, which is hidden from `list_files`
  and `grep_files` and is itself not writable. Combined with the write sandbox — which
  by construction contains no user data — a bad write is recoverable without a prompt,
  which is what the no-prompts decision was actually for.
- **`read_file` summarizes before `result-budget` sees it**, same reasoning as
  `run_code`: a file up to 200 lines and 20,000 chars comes back whole, anything larger
  comes back as a line count plus 30 head lines and 10 tail lines, and
  `startLine`/`endLine` page through it. A 50,000-line CSV yields under 4,000 chars.
  Non-text files (detected by a NUL byte) are refused with a pointer at `FileOp` and
  `run_code` rather than being mangled into the transcript.

Storage type matters for writes: examples load into `memory` storage (`noodles.tsx`
copies their assets there), so writes work in `/examples/*`. `publicFolder` is
read-only and `writeAsset`'s refusal is surfaced verbatim.

`grep_files` is plain JS `RegExp` over the files — no wasm toolchain for something that
is a loop. It caps matches (40), per-file size (50M chars) and total scanned (100M
chars), and reports every file it skipped, because a grep that silently misses a file
is worse than a slow one. The per-file cap started at 4M and was raised after it
skipped `nyc-taxis`' only data file: it bounds scan time, not memory, since `readAsset`
has already materialized the whole string either way. Measured, a match on that 12M-char
CSV takes ~11ms.

One supporting fix was needed underneath: `getFileHandle` rejects any name containing
`/`, so a nested path was unaddressable on `fileSystemAccess` and `opfs`. That was
already a latent bug — `listDataFiles` emits nested paths like `raw/notes.txt` that
`readAsset` could not then read — and `resolveParent()` in
`noodles/utils/filesystem.ts` now walks the segments at that choke point, creating
intermediate directories on write and never on read.

## Harness tools

Two tools need something the tool definitions have no access to (a provider, an API
key), so they live in the harness and are discoverable and unlockable exactly like
the rest:

- **`web_search`** — server-side search on Anthropic, the `web` plugin on
  OpenRouter, unavailable on Chrome and on custom endpoints (where the tool is not
  offered at all, so the model never promises a search it cannot run).
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
| Tool schemas | 4,291 chars, 13 tools (~1,070 tok) | 2,292 chars, 5 tools (~570 tok) | −47% |
| One `list_nodes` result (200k window) | 18,447 chars (~4,600 tok) | 11,462 chars (~2,870 tok) | −38% |
| One `list_nodes` result (6k window) | 18,447 chars (~4,600 tok) | 1,637 chars (~410 tok) | −91% |
| **First turn, all three** | ~32,000 chars (~8,000 tok) | ~16,700 chars (~4,175 tok) | **−48%** |

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
`providers/*.test.ts` cover SSE fragment reassembly (`openai-format.test.ts`),
request shaping and endpoint validation (`custom.test.ts`), and constrained-JSON
parsing, session reuse and invalidation, and measure-before-overflow trimming
(`chrome.test.ts`) against fakes. `chrome.test.ts`'s fake mints one session per
`create()` call, which is what lets a test tell reuse from a rebuild. No test spends
a real API request.

End-to-end checks that do need keys are listed in the PR description for this work:
streaming and Stop on Anthropic, cost readout on OpenRouter, `find_tools` →
`get_documentation` on a docs question, `delegate` on an examples question, and a
`list_nodes` turn on Chrome Canary with the Prompt API enabled.
