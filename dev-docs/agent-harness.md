# Agent harness (in-app AI chat)

**Last updated:** 2026-09-17

The in-app assistant runs on a hand-rolled agent loop in `noodles-editor/src/ai-chat/agent/`.
It is provider-agnostic: the same loop, tool surface, and context budgets serve a
frontier model on Anthropic, a mid-tier model on OpenRouter, a 4B model running on
the user's own GPU, and Chrome's built-in Gemini Nano — a 200,000-token window and a
4,096-token one, unchanged.

It replaces `claude-client.ts` (deleted), which was hardcoded to one model, sent
every tool schema on every request, and serialized tool results with no size cap.

> Two older documents describe a different design for on-device inference
> (LangChain.js + `@mlc-ai/web-llm` + `voy`): `dev-docs/webllm-ai-integration.md`
> and `dev-docs/specs/webllm-ai-chat/webllm-ai-chat.md`. WebLLM did land, but as
> one more `AgentProvider` behind a dynamic import rather than a second stack; both
> documents are superseded by this file.

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
| `agent/providers/*.ts` | `anthropic`, `openrouter`, `custom`, `webllm`, `chrome` |
| `agent/providers/openai-format.ts` | The OpenAI chat-completions wire format, shared by `openrouter` and `custom` |
| `agent/providers/json-tools.ts` | Tool-call emulation for the two on-device providers, which have no native tools |
| `agent/providers/endpoint-presets.ts` | Starting points for the custom-endpoint form |
| `agent/provider-selection.ts` | `isProviderReady` / `resolveProviderId` — which of the five actually runs |
| `noodles/openrouter-oauth.ts` | The PKCE flow that mints an OpenRouter key without a paste |
| `prompts/core.md` | The always-in-context system prompt |
| `prompts/sections/*.md` | Workflow walkthroughs, retrieved on demand via `get_documentation` |
| `docs-search.ts` | BM25 passage search behind `get_documentation`: best passage per topic, linked to its heading |

`tool-definitions.ts` and `mcp-tools.ts` remain the single source of truth for the
tool surface. WebMCP (`src/webmcp/register.ts`) registers all of them and is
unaffected by any of the routing below.

Two definitions set `audience: 'external'` and are registered on WebMCP only:
`export_video` and `get_export_status`. `getToolDefinition` and
`availableToolDefinitions` leave them out unless passed `{ includeExternal: true }`,
which only `register.ts` does, so the chat can neither discover nor dispatch them.
The reason is the user: in the chat they are one click from the Export button, and a
render takes over the canvas and the playhead for minutes, which a model should not
start on its own. An external agent has no button to click, because the save dialog
only opens on a user gesture. The export writes its MP4 through `writeAgentBinary`
in `agent-files.ts`, which goes through `resolvePath()` like `write_file`.

## Providers

| | Anthropic | OpenRouter | Custom | WebLLM | Chrome |
| --- | --- | --- | --- | --- | --- |
| Default model | `claude-sonnet-5` | best free tool-capable model in the catalogue | whatever you type | `Qwen3.5-4B-q4f16_1-MLC` | `gemini-nano` |
| Context window | 200k | from `/models`, per-model table as fallback | configurable, 32k default | 4k, pinned by every prebuilt config | discovered at runtime (~6k), and measured per turn |
| Native tool calling | yes | yes (filtered on `supported_parameters`) | assumed, switchable off | **no** — constrained JSON | **no** — constrained JSON |
| Images (screenshots) | yes | only when the catalogue lists `image` input | off by default | no | no |
| Web search | server-side `web_search_2026…`/`…20250305` | `plugins: [{id:'web'}]` | unavailable | unavailable | unavailable |
| Prompt caching | `cache_control: ephemeral` on the system prompt | — | — | KV cache reused across steps (byte-stable prefix) | session reused across turns |
| API key | required | one click, no paste | required, unless the server is your own | none | none |

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
`agent/model-store.ts`. The rules live in `agent/provider-selection.ts` rather than in
the panel, so they can be tested without mounting the editor. `'automatic'` walks
`anthropic → openrouter → custom → webllm` and takes the first one that is *ready*.
WebLLM is ready only once the user has chosen a model, so it is never a fallback for
a missing key. Chrome is experimental and not in the walk at all: its tool use and
instruction following are unreliable enough that it runs only when pinned. A pinned
provider that is not ready falls back to the same walk rather than showing an error.

"Ready" is not the same question as "has a key":

- `anthropic`, `openrouter` — a key from the browser or the environment. A project
  file is never a source: `keys-store` strips `AI_KEY_TYPES` from it on load and
  from `getKeysForProject()` on save, so a shared file cannot point the chat at its
  author's account or carry the user's key away.
- `custom` — a saved base URL *and* model. The key is optional: `CustomProvider` omits
  the `Authorization` header entirely when there is none, because `Bearer ` with
  nothing after it is a malformed credential that a keyless endpoint may reject where
  no header would have been fine. That is what makes an LM Studio or llama.cpp server
  on the LAN work with no key at all.
- `webllm` — WebGPU available **and** a model chosen. The second half is load-bearing:
  selecting a model starts a download of gigabytes, so it must be something the user
  asked for and never a consequence of no key being configured.
- `chrome` — the Prompt API reports the model as available.

Two provider flags carry all the behavioural difference: `supportsNativeTools`
(false routes the provider through `providers/json-tools.ts`, which emulates the tool
round-trip with a JSON schema the runtime enforces and translates the model's
one-object reply into the same `tool_call` event the others emit — `input` is the
last property, because a grammar that requires `reply` after it leaves a model that
wants to close the object nothing to emit but whitespace until `max_tokens`, and an
object cut off anyway is closed and flagged `json_repaired`) and `contextWindow`
(which sizes the disclosure limits, the per-result budget, the step limit, and the
compaction threshold).

`AgentProvider.dispose()` is optional and only the on-device providers implement it:
an HTTP provider holds nothing between turns, a local model holds gigabytes.
`AgentSession.dispose()` forwards to it, and `chat-panel.tsx` calls that from its
init effect's cleanup — including for a session that was superseded while still
being built.

### Getting a credential without a paste: OpenRouter PKCE

`noodles/openrouter-oauth.ts` mints a real OpenRouter key from a click. PKCE needs no
client secret, so it works from a static site with no backend — which matters, because
there is no backend anywhere in this repo and this feature was not going to be the
reason to add one.

`beginOpenRouterAuth()` generates a 64-byte verifier, derives an S256 challenge, keeps
the verifier in `sessionStorage`, and opens `https://openrouter.ai/auth`. The callback
lands on `/auth/openrouter` (`components/openrouter-callback.tsx`) — **a popup, not a
top-level redirect**, because the editor holds unsaved graph state that a navigation
would discard. The popup exchanges the code for a key, `postMessage`s it to
`window.opener`, and closes; with no opener (popup blocked, or the user reopened the
URL) it stores the key itself and navigates back to the saved return path.
`use-openrouter-connect.tsx` is the hook the panel and the settings dialog both use.

Analytics record that a connect started, succeeded, or failed. Never the code, never
the key.

Free models are discovered, not listed: `fetchOpenRouterFreeModels()` reads
`GET /models`, keeps entries whose `supported_parameters` includes `tools`, and splits
on `pricing.prompt === '0'`. A hard-coded list of free slugs would go stale the same
way the old `llama-3.1-70b-versatile` preset did, and free-tier availability churns
faster than releases. On any failure it falls back to the static `OPENROUTER_MODELS`.

### WebLLM: the model runs in the tab

Five facts shape `providers/webllm.ts`:

1. **No native tool calling, for any model.** WebLLM does ship tool calls, but only
   for four Hermes builds, and its parser requires the *entire* completion to be a
   JSON array of calls — a plain-text final answer throws. That is unusable for a loop
   that alternates between calling tools and replying, so `supportsNativeTools` is
   `false` unconditionally and every model goes through `json-tools.ts`. The upside is
   that the emulation is grammar-enforced by the runtime rather than requested in the
   prompt, which is why it works at all on the 0.9 GB Llama-3.2-1B.
2. **4,096 tokens, prompt and completion together** — every prebuilt config pins
   `context_window_size` to it, whatever the model's nominal window. Overflow *throws*
   rather than truncating, so `MAX_OUTPUT_TOKENS` is 768 (the loop asks for 8192) and
   an overflow retries once on a trimmed transcript: `trimTranscript()` in
   `json-tools.ts` keeps the first turn, the current request and the last tool call
   with its result, and drops the middle. A transcript with no middle to drop (the
   task, one call, one result) is not retried, because the same prompt would overflow
   the same way. The loop still holds every message, so after a trim the provider
   sends the trimmed transcript plus whatever is newer (`transcriptFor`). Later steps
   then extend what the engine holds instead of overflowing again and prefilling
   about 3k tokens from an empty cache (Qwen3.5-4B: 118 tokens in 0.3 s instead of
   ~3,000 in ~11 s). The error crosses the worker's
   `postMessage` as its `toString()` and the engine rejects with that string, not an
   `Error`, so the provider matches the `ContextWindowSizeExceededError` prefix in
   the text. Its token count is only the tokens added this step: the engine checks
   them plus the KV cache it kept from earlier steps, so an overflow can read as
   "446 tokens; context window size 4096".
3. **Inference runs in a worker** (`webllm-worker.ts`). On the main thread the GPU
   submit loop competes with deck.gl's and the map stutters for the length of every
   answer. `vite.config.js` sets `worker.format: 'es'` for this: the worker's
   dependency graph code-splits, which Vite's default IIFE worker build cannot express.
4. **`@mlc-ai/web-llm` is only ever reached through `await import()`.** It is the
   largest dependency in the app and users who never pick a local model pay nothing
   for it. It is also in `optimizeDeps.exclude`.
5. **Prefill is most of the wait, so the prefix stays byte-stable.** The engine
   keeps its KV cache only when a request is the previous conversation plus one
   message, compared string for string, system message included; anything else
   resets it and prefills the whole prompt again. Two things used to break that on
   every step. The preamble listed the current tools, which grow with each
   `find_tools`, so `preambleFor` now keeps the first preamble per system prompt
   while every tool it lists is still offered; later tools reach the model through
   `find_tools`' own result and the grammar's enum, which is per request and not
   part of the prefix. Once that result has left the transcript (trimmed, or a new
   turn), the preamble is rebuilt so the tool keeps its description. And assistant turns went back re-serialised ("Called X with
   …") rather than as the JSON the engine had recorded, so the raw completion now
   rides in a `provider_block` and `toWireTurns` replays it verbatim. Measured on
   Qwen3-4B at 16k (M-series Mac, T2 tasks): later steps prefill 20–1,000 new tokens
   in 0.1–2.3 s instead of ~4k in 14–23 s, and tasks take 6–22 s instead of 10–48 s.
   Each step logs its prefill and decode timings under `noodles:ai-chat`.

Both on-device providers are slower than a hosted one, and the panel says so
rather than letting the user find out (`on-device-notice.tsx`): a dismissible
banner above the conversation, and a line inside any reply still running after
`SLOW_REPLY_MS`, each with one button. It switches straight to a hosted provider
that is already set up (`readyCloudProvider`, same order as automatic selection)
or opens Settings → AI Provider, where OpenRouter is one click. Switching stops the
running reply, and `AgentSession.dispose` waits for it to settle before disposing
the provider.

`WEBLLM_MODELS` carries seven ids checked against `prebuiltAppConfig.model_list`. Two
are recommended: Qwen3.5 4B (2.4 GB download, 3.9 GB GPU memory) and Qwen3.5 2B, the
fast one (1.1 GB download, 2.2 GB GPU memory). The rest sit under "Advanced
compatibility" so a saved choice keeps working. Download size and GPU memory are
separate fields, since `vram_required_MB` runs well above the download and both
numbers make the choice an informed one. When a model fails to load, the panel
offers the 2B, which needs about half the memory. Every entry carries
`supportsImages: false` until WebLLM ships a Qwen3.5 vision build. The download
reports progress through the same `DownloadProgress` UI Chrome uses.

### The hosted free tier

No free OpenAI-compatible endpoint is callable from a browser page, so the keyless
path is a proxy of our own. When this was first tried against public services:

- `text.pollinations.ai/openai` returned `403 {"error":"Missing Turnstile token"}` for
  any request carrying a page `Origin`.
- `ai.hackclub.com` served no CORS headers.
- `api.deepinfra.com/v1/openai` answered `GET /models` but `401` on chat completions.

The proxy is a Cloudflare Pages Function, `functions/api/llm/[[path]].ts`, deployed
with the site by the same `wrangler pages deploy` (Pages compiles `functions/` from
the directory the command runs in). It forwards chat completions to an
OpenAI-compatible provider, Groq by default, with a key the browser never sees:

| Route | |
| --- | --- |
| `GET /api/llm/status` | `{available, model, providerName, contextWindow, freeMessages}`; `available` is false without a key, and on localhost the route does not exist at all |
| `POST /api/llm/v1/chat/completions` | the proxied request, streamed back as SSE |

It only serves the assistant, and only for a first taste:

- The system message has to start with `prompts/core.md`, checked against
  `CORE_PROMPT_FINGERPRINT` (length and SHA-256) so the Function needs no Markdown
  loader. `hosted-llm.test.ts` fails when `core.md` changes and prints the new values.
- At most `FREE_MESSAGES` (2) user messages per conversation. History travels with
  every request and tool results are `tool` messages, so counting `user` messages
  needs no storage.
- Browser requests from the deployment's own host or `HOSTED_LLM_ALLOWED_ORIGINS`
  only (default `https://noodles.gl`), a 256 KB body cap, 80 messages, 64 tools, 1024 output tokens, and
  the model set by the Function. The upstream body is rebuilt from named fields.
- A per-minute 429 from the provider is waited out (up to 15 s, twice), because one
  agent turn makes several requests in a row. A longer `Retry-After` is a daily limit
  and is passed on as `429 busy`.
- With a KV namespace bound as `LLM_LIMITS`, 60 requests per IP per day. Without
  one, the provider's own quota is the backstop.

Errors use the `{error: {message, code}}` shape `describeFailure` reads; `code` is
`free_limit` or `busy` where the client needs to tell those apart.

noodles.gl itself is served by GitHub Pages (`deploy-docs.yml`), where Functions do
not run; Cloudflare Pages serves `noodles-gl.pages.dev` and the PR previews. So the
editor on noodles.gl calls `https://noodles-gl.pages.dev/api/llm` across origins,
and the Function answers the CORS preflight for allowed origins. Previews call
their own host.

Groq's free tier allows 8K tokens a minute and rejects any single request larger
than that, which is why `contextWindow` is 8192 rather than the model's own window.

**Setup**, in the Cloudflare dashboard under the `noodles-gl` Pages project, Settings,
Variables and Secrets, for Production and Preview:

1. `HOSTED_LLM_API_KEY` (secret): a Groq key from console.groq.com.
2. Optional: `HOSTED_LLM_BASE_URL`, `HOSTED_LLM_MODEL` and `HOSTED_LLM_PROVIDER_NAME`
   to use another provider or model. Defaults are `https://api.groq.com/openai/v1`,
   `openai/gpt-oss-120b` and `Groq`. `HOSTED_LLM_ALLOWED_ORIGINS` replaces the
   `https://noodles.gl` default.
3. Optional: a KV namespace bound as `LLM_LIMITS` for the per-IP cap.

Changes to variables apply to the next deployment.

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
measurement is optional and can undercount. Both paths use the same
`trimTranscript()` as WebLLM, and both skip the rebuild when it would keep every
message: the turn is sent as-is and the API's own `QuotaExceededError` reaches the
user. The separate one-time rebuild for unknown Chrome API errors still runs.

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
- **Repeated calls.** A call identical to an earlier one (same name, same input)
  is not run again; the model gets the earlier outcome back as an error telling it
  to try something else, and the third identical call ends the run. Small models
  otherwise loop — the same failed lookup six times, or the same edit queued six
  times. A successful mutating call clears the memory of read-only calls, since a
  read may now return something new, and a read that follows a write in the same
  batch always runs. Each refusal emits a `repeated_tool_call` diagnostic.
- **Validated edits.** `apply_modifications` validates the whole batch against
  `ProjectModificationSchema` and the project before anything is queued: ids must
  name existing nodes (or nodes added earlier in the batch or the run), `add_node`
  must not collide, and an `update_node` must change something. Every problem is
  reported at once, with the ids that do exist. Bare ids (`pickup-layer`,
  `map-range` for `/analysis/map-range`) are resolved when they name exactly one
  node, here and in `get_node_info` / `get_node_output`. What a run queued is
  forgotten when the next run starts, so a failed run cannot block its retry.
- **Validated fields.** When a context loader supplies the operator registry,
  `modification-fields.ts` also checks operator types, input names and edge
  handles. The editor would otherwise accept all three silently: an unknown type
  becomes a dead node, a wrong handle becomes an edge that connects nothing. A
  display name (`File`) or a missing `Op` suffix resolves to the type when it names
  exactly one operator, and a bare handle (`data`) gets its side (`out.data` /
  `par.data`). Anything else is rejected with the names that do exist, e.g. "/heat
  (HeatmapLayerOp) has no output vis. Outputs on /heat: out.layer". The known
  names are the class's fields plus the live operator's, plus custom inputs an
  `add_node` in the run declares. A handle is checked by its whole name, since the
  graph looks up `par.viewState.zoom` as a field named `viewState.zoom`.
- **Proposals.** What a run queued reaches the panel as a proposal: a card listing
  each change and its proposed values (long values cut to a preview that expands)
  with Accept and Reject. Nothing in the batch touches the graph until Accept, which
  runs the batch through `useProjectModifications` inside `recordGraphMutation`
  (`noodles/utils/graph-history.ts`), so the whole batch, field values included, is
  one undo entry. Reject leaves a line in the conversation so the next turn knows
  the edit did not land (a `run_code` call in the same run may already have changed
  field values; the card and the line speak only for the batch). Sending is blocked
  while a proposal waits. Starting or loading a conversation, or opening another
  project (`projectKey`), drops it and aborts a run in flight, whose reply and
  proposal are then ignored. A modifications array written into the reply as
  JSON is not picked up: only `apply_modifications` validates a batch. The live
  benchmark and WebMCP apply batches directly, without a proposal.
- **Unverified edit claims.** A reply that announces a change in the past tense
  ("the radius has been set to 10") when no mutating tool succeeded and no
  modification was queued gets a one-line correction appended and emits an
  `unverified_edit_claim` diagnostic. On-device models do this often — one step, no
  tool call, a confident report — and unmarked it reads as done. Present-tense
  descriptions ("is currently set to `#8d12af`"), instructions and refusals are left
  alone; `claimsAnEdit` in `agent/loop.ts` holds the test.
- **Screenshots.** Base64 is stripped from the tool result and reattached as an
  image block on the follow-up message — only when `provider.supportsImages`. The
  panel's Capture button is hidden when it is false, and a capture rides on the
  next message the user sends. OpenRouter reads `supportsImages` from the
  catalogue's `architecture.input_modalities`, since many free models are text-only.
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
  `apply_modifications`, whose accepted proposal is its own undo entry — so the
  tool description points structural edits there.
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
`modifications`, which the parent loop already collects. A `build` child that
reports success while nothing landed — no modifications, no keyframe call — comes
back as an **error** with its claim quoted, because the report is all the parent
can see and small models write reports for work they never did. A keyframe-only
build queues no modifications, so `delegate` also returns `changed: true` when the
child's own tools changed the project.

`delegate` is only offered when `provider.contextWindow` is at least 32k
(`DELEGATE_MIN_CONTEXT_TOKENS`). Below that the window cannot afford a second loop,
and on-device models spent their one delegation on a fabricated report they then
relayed to the user.

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
| System prompt | 9,278 chars (~2,300 tok) | ~9,000 chars (~2,250 tok) | −3% |
| Tool schemas | 4,291 chars, 13 tools (~1,070 tok) | 2,292 chars, 5 tools (~570 tok) | −47% |
| One `list_nodes` result (200k window) | 18,447 chars (~4,600 tok) | 11,462 chars (~2,870 tok) | −38% |
| One `list_nodes` result (6k window) | 18,447 chars (~4,600 tok) | 1,637 chars (~410 tok) | −91% |
| **First turn, all three** | ~32,000 chars (~8,000 tok) | ~22,750 chars (~5,700 tok) | **−29%** |

The `list_nodes` saving is the slimming alone (role groupings carry ids instead of
re-serialized node objects; `position` dropped; long string inputs clipped to a
preview) — at a 200k window the result still fits under the 24,000-char cap, so the
budget never engages. At Nano's window the budget is what makes the call possible at
all: 18k chars would exceed the entire context.

The remaining six prompt sections (16,914 chars total) are no longer sent at all;
they reach the model through `get_documentation` when a workflow actually calls for
one. The system prompt barely shrank anyway: `core.md` is 2,910 chars, but
`generateContextReference()` appends ~6,000 more (every operator name, doc topic
titles, example summaries), and that reference is sent on every turn.

### Headroom per window

`src/ai-chat/agent/context-budget.test.ts` subtracts the fixed first-turn cost
(system prompt, tool schemas, the provider's output reserve) and one capped
`list_nodes` result from each provider's window. Rounded to 50 tokens:

| Target | Fixed cost | Left before any tool result | Left after one `list_nodes` |
| --- | --- | --- | --- |
| WebLLM, 4k window (today) | ~3,570 tok | ~550 tok | ~300 tok |
| Chrome Nano, 6k fallback | ~3,800 tok | ~2,350 tok | ~1,950 tok |
| WebLLM, 16k window | ~3,570 tok | ~12,850 tok | ~11,700 tok |
| Anthropic, 200k | ~11,000 tok | ~189,000 tok | ~186,150 tok |

At 4k the model has room for one small tool result and nothing else, which is why
on-device sessions run out of context almost immediately. The test snapshots these
numbers, so growth in the prompt or tier-0 schemas shows up in the PR diff, and it
fails if a window of 16k or more leaves less than 1,500 tokens after an inspect.

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
`create()` call, which is what lets a test tell reuse from a rebuild. `webllm.test.ts`
fakes the engine, so no test downloads a model; `provider-selection.test.ts` covers the
readiness rules, including that `webllm` is never auto-selected before a model is
chosen; `openrouter-oauth.test.ts` covers the S256 derivation and the failure paths. No
test spends a real API request.

End-to-end checks that do need keys are listed in the PR description for this work:
streaming and Stop on Anthropic, cost readout on OpenRouter, `find_tools` →
`get_documentation` on a docs question, `delegate` on an examples question, and a
`list_nodes` turn on Chrome Canary with the Prompt API enabled.

## Live benchmark

`noodles-editor/bench/agent/` runs this harness against scripted tasks with a real
model in a real browser — WebLLM and Gemini Nano on the machine's own GPU, or a
cloud provider as the ceiling — and grades the resulting project deterministically.
`npm run bench:agent` from `noodles-editor/`; see its
[README](../noodles-editor/bench/agent/README.md). It is how a change to the prompt,
the tool surface or the context budget should be judged: run the matrix before and
after, then `bench:agent:report --compare`.
