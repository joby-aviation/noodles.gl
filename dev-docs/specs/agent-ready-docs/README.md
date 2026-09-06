# Agent-Ready Operator Docs — Roadmap

This spec directory defines a program of work to make Noodles.gl's operators fully documented for humans and fully consumable by AI agents. It is a roadmap plus seven executable sub-plans. Each sub-plan is standalone: it can be picked up as its own task/PR series without reading the others first, and each one names its dependencies explicitly. The [cross-cutting rules index](#cross-cutting-rules-index) below collects the program's recurring principles in one place.

Execution tooling note: if we adopt GitHub Spec Kit post-merge, each sub-plan feeds one `specify → plan → tasks → implement` cycle. Adoption is deliberately not part of this PR.

## Vision

One authoritative operator reference, written once, consumed four ways:

1. **Humans** read CD-era MSDN-style reference pages on the docs site — formal Syntax/Inputs/Outputs/Requirements structure, with Raymond Chen-voiced Remarks sections that explain *why* an operator works the way it does, what will bite you, and what we tried first.
2. **Any agent with HTTP** fetches a stable machine-readable surface — `llms.txt`, raw markdown mirrors, per-operator JSON, and a JSON Schema for `noodles.json` — no tooling required.
3. **MCP-capable agents** (Claude Code, Cursor, Claude Desktop…) use a `noodles-mcp` server to search operators, read schemas *and* the hand-written Remarks, fetch examples, and validate project files — with no browser running.
4. **Browser-resident agents** use WebMCP tools registered by the running app to learn about, interact with, and modify a live project.

Style anchors: classic MSDN Win32 reference pages (structure), Raymond Chen's *The Old New Thing* (Remarks voice), RFC 7946/GeoJSON (normative precision), and the MapLibre/Mapbox style specs (property tables and a generated spec root). Distribution anchors: shadcn/ui's skills + MCP + registry model.

## Critical user journeys

| # | CUJ | Served by |
|---|-----|-----------|
| 1 | A human looks up an operator and understands every field, its defaults, and its gotchas | 01 |
| 2 | An agent with no browser fully contextualizes on Noodles: discovers operators, reads reference pages including Remarks, gets field schemas and examples, understands the `noodles.json` format | 02, 03 |
| 3 | An agent authors or modifies a `noodles.json` project file correctly (schema version, node types, edge handles, graph design rules) and validates it before delivering | 04, with 02/03 as data sources |
| 4 | A harness drives a *running* project in the browser: enumerates operators, reads graph state, captures the visualization, adds/edits nodes and keyframes | 05 |

## Sub-plans

| Spec | Title | One-line scope |
|------|-------|----------------|
| [01-operator-reference.md](01-operator-reference.md) | Operator reference pages | MSDN/Chen page per operator, generator with marker-preserved prose, style guide, sidebar, CI drift check |
| [02-machine-readable.md](02-machine-readable.md) | Machine-readable surface | Stable `/r/` JSON URLs, `llms.txt`/`llms-full.txt`, raw-markdown mirrors, `noodles.json` JSON Schema, deploy-path cleanup |
| [03-mcp-server.md](03-mcp-server.md) | `noodles-mcp` server | shadcn-style docs/registry MCP server (npx, stdio), `--local` mode; `--live` likely superseded by #508's relay |
| [04-skills.md](04-skills.md) | AI skills | `noodles-authoring` + `noodles-live` SKILL.md suite, `validate-projects` CLI, generated includes, install story |
| [05-webmcp.md](05-webmcp.md) | Unified tool registry + WebMCP | Core landed via PR #508 (shared tool definitions, bridge write path, WebMCP provider); spec now scopes follow-ups: access model, origin-trial token, embed hardening, WS fix-or-remove, docs |
| [06-concept-essays.md](06-concept-essays.md) | Concept essays | Chen-style long-form pieces on the execution model, paths, memoization, timeline, fields — the connective tissue Remarks link to |
| [07-cuj-evals.md](07-cuj-evals.md) | CUJ eval harness | Greenfield-session evals with rubrics + graders: baseline against today's repo, regrade at every roadmap landing — the program's success metric |

## Dependency graph

```
01 operator reference ──┬──▶ 02 remarks embedding in /r/ops/*.json
                        └──▶ 03 get_operator returns Remarks prose

02 machine-readable ────────▶ 03 noodles-mcp (backing data: /r/, schema, mirrors)

04 skills ──(no hard deps: graceful degradation; upgrades as 01–03 land)
   └── validate-projects CLI ◀── imports 03's registry lint (workspace dep),
                                  layers runtime-only checks on top

05 core (tool definitions + bridge + WebMCP provider) ── LANDED via PR #508
   ├──▶ 05 follow-ups F1–F5 (access model, origin-trial token, embed hardening,
   │                         WS fix-or-remove, docs)
   └──▶ 03 --live mode ── likely superseded by #508's relay (decide with 05 F4)

06 concept essays ──(independent; 01's Remarks link to them; 02 distributes them)

07 CUJ evals ──(T0 baseline BEFORE anything else lands; regrades track every landing;
                consumes 04's validateProject() once it exists)
```

Orderings that matter:

- 02's generator ships **before** 01 finishes prose — it embeds Remarks conditionally and degrades gracefully when `docs/reference/operators/` is absent.
- Project validation ownership is settled: the registry-aware lint is owned by 03 (`noodles-mcp/src/validate/lint.ts`, importable from plain Node). 04's `validate-projects` CLI imports that lint via workspace dep and layers the runtime-only checks (migrations, anything needing the Vite-built world) on top; `validateProject()` remains 04's exported composite, and 07 consumes it. One rule set, no fork.
- 04's skills teach the canonical snake_case tool names defined in `src/ai-chat/tool-definitions.ts` (landed via PR #508), plus the relay connection for live sessions.
- 05's core landed early and externally (PR #508, authored independently before this roadmap was reviewed — the two converged). 05 is now a follow-up sub-plan: access model, origin-trial token, embed hardening, WS fix-or-remove, docs. Note #508 also edited AGENTS.md, which is agent-visible context; since it merges before the eval harness exists, it simply becomes part of the T0 baseline rather than needing a measured smoke run.

## Phasing

**Phase 0 — the before photo**
- 07: scaffold the eval harness and **run the T0 baseline against today's repo before any sub-plan merges**. Every later landing re-runs the same tasks at the new tier; the delta is the measured value of that investment.

**Phase A — foundations** (parallelizable)
- 01: parser extensions, `generate-operator-docs.ts`, generated skeleton pages for all ~130 ops, sidebar, style guide, CI drift check.
- 02: `project-schema.ts` + JSON Schema, `generate-reference.ts` + `/r/` surface + llms.txt regeneration, consolidate the two context-deploy paths (see Quick wins #2).
- 05 core: ~~unified registry + project-bridge + WebMCP provider~~ **landed via PR #508** (`src/ai-chat/tool-definitions.ts`, `src/webmcp/`). Remaining in Phase A from 05: the F1 access model (write gating + iframe guard) and F4's WS fix-or-remove decision; the WS bugs and unenforced permissions persist until F4.

**Phase B — consumption**
- 03: `noodles-mcp` package (docs mode; `--live` is likely superseded by #508's relay — decide with 05 F4).
- 04: both skills + `validate-projects` CLI + generated includes + CI freshness job.
- 05 phase 1: WebMCP read-only provider behind feature detection.

**Phase C — polish and rollout**
- 01: prose for the priority operators, then the rest in category batches — LLM-drafted under the D6 protocol (exemplar canon, context packs, no invented history), maintainer-reviewed; driven by the index coverage counter and the prose-staleness queue, not memory.
- 06: concept essays 1–5, cross-linked from the priority pages (same author pass as the Remarks work where possible).
- 03: npm publish, `.mcp.json` docs page.
- 04: `.claude-plugin/marketplace.json` plugin packaging.
- 05 follow-ups F1–F3: access model (write gating, iframe guard, indicator), origin-trial token for noodles.gl (committed; gated on the polyfill-vs-native answer), relay embed hardening.

## Knowledge accrual (how the repository keeps filling)

Generated skeletons make the docs *accurate*; these mechanisms make them *accumulate*:

- **Mine what already exists**: the History region (01) extracts per-operator change stories from `__migrations__/` — the repo's existing record of "what we tried first". Git log and PR descriptions feed the priority-page Remarks.
- **Make progress visible**: the reference index shows "N of M operators have written Remarks"; `--check` emits a prose-staleness queue (operator source changed, prose untouched).
- **Make it a ritual**: the PR template asks "does this change an operator's behavior? Update its Remarks" (01 step 8).
- **Keep examples honest**: fenced examples on reference pages are validated in CI (01), the same way authored projects are (04).
- **Close the loop from agents** (later): once 03/04 are live, `validate_project` failures and in-app assistant misses are a direct signal of what users get wrong — use that data to prioritize which Remarks and essays to write next. No tooling now; just look at it when Phase C prioritizes.

## Quick wins (small standalone PRs, high value, no phase gating)

A note on framing: several of these touch code that works as designed for the path it was built for — the gaps below are what surfaced when we probed the *other* paths. Also: any of these that change what a greenfield agent sees fall under 07 D7's standing question and must take a sanctioned path (measured, stripped, or forbidden) rather than silently shifting the eval baseline. Where a spec proposes deleting or consolidating something, it owes the reader three things: what the original was for, the concrete failure mode now, and what preserves the original capability. If a spec asserts intent that the original author knows to be wrong, that's a spec bug — please correct it in review.

1. **Register the dormant context tools** — mostly landed via PR #508: all nine got schemas and WebMCP exposure in `tool-definitions.ts`. The remaining sliver: they carry `exposeToChat: false` (a deliberate token-budget call), so the in-app chat still can't invoke them. Flipping that for some subset is the leftover decision (05 F5).
2. **Consolidate the two context-deploy paths** — `generate-context.yml` refreshes the AI context bundles on content changes without waiting for a full site deploy (a reasonable goal); `deploy-docs.yml` also regenerates them inside the Pages-artifact flow on every main push. The two publish to GitHub Pages by different mechanisms (gh-pages branch push vs. Pages artifact), and a Pages site has one publishing source — whichever is configured wins and the other's output is dead or, worse, flips the source. Proposal (02): `deploy-docs.yml` becomes the single owner; if bundle freshness between deploys matters, add path triggers to `deploy-docs.yml` rather than keeping a second publisher. **Confirm the original intent with whoever set it up before deleting.**
3. **Refresh `AGENTS.md`** — it drifted as the code moved: claims project version 6 (actual: `NOODLES_VERSION` = 14, derived from migrations), points at `noodles-editor/examples/external-control/mcp-proxy.js` (actual: `examples/external-control/mcp-proxy.js`), references `public/examples` (actual: `src/examples`), and still warns against editing the `timeline` JSON — Theatre.js-era advice; the native timeline's serialized format is fully typed in `src/timeline/types.ts` and is a supported editing surface (see 02/04). This drift is the argument for sub-plan 04's generated includes — hand-maintained facts rot no matter how diligent the authors.
4. **Finish the external-control write path** — half landed: PR #508's `src/webmcp/bridge.ts` wires the editor's applier for the WebMCP surface, so `apply_modifications` mutates the real graph there. The WebSocket surface keeps its scaffolding bugs (`worker-bridge.ts`/`tool-adapter.ts` never call `setProject()`; `PIPELINE_CREATE` passes an object where the validator requires an array) and is now labeled legacy. Resolution is 05 F4: wire it through the same bridge, or set a removal date.
5. **Enforce session permissions** — `session-manager.ts` already models `['read','write','execute']` permissions; the enforcement hook just never got wired into the dispatch path. Folded into 05 F4: if the WS path gets fixed, enforce these while there; if it gets removed, they go with it.

## Cross-cutting rules index

These principles recur across the sub-plans. Each is owned by the section that defines and enforces it; this list is the index, not the law.

- **One owner per fact** — generators harvest, never define (Ownership boundaries, below)
- **Generated and hand-written content never mix silently** — markers, idempotent regeneration, CI drift gates, staleness queues (01 D1, D3)
- **No invented history** — behavioral claims from code/tests; history only from migrations/git/PRs/maintainer notes; uncertainty flagged inline (01 D6; 06 writing process)
- **Two voices, strictly separated** — normative vs Remarks; RFC 2119 only in the `noodles.json` file-format spec (01 D5)
- **Deletion carries its courtesy** — original intent, concrete failure mode, preserved capability, invited correction (Quick wins note, below)
- **Nothing changes what a greenfield agent sees without a sanctioned path** — measured, stripped, or forbidden (07 D7)
- **Count what's countable; judge only what requires judgment** — no bare scales; tag-matched applicability (07 D4)
- **No quality claim without a calibrated instrument** — (rubricVersion, judgeModel) calibration, pre-committed thresholds, noise bands, regrade-not-fork (07 D4–D6)
- **Dependencies flow toward plain Node** — npx/CI code never imports Vite-built code; shared definitions live at the most dependency-free importable point (03 D4; Orderings, above)
- **Capability outlives its container** — aliases for a release cycle, schema versions retained forever, provenance embedded in responses (02 D1–D2, 03 D3–D4, 05 D1)
- **Review is sampling backed by machines** — CI holds the mechanical line; humans spend attention on flagged claims and expensive-to-fail samples (01 D6 batch workflow)

## Ownership boundaries

- `noodles-editor/src/noodles/operators.ts` owns operator **schemas** (fields, defaults, options). Generators harvest; they never define.
- `docs/` markdown owns **prose** (Remarks, Examples, descriptions). Generators preserve; they never overwrite.
- `.github/workflows/deploy-docs.yml` owns the **public machine-readable surface**. No second deploy path.
- `noodles-editor/src/agent-tools/` (once 05 lands) owns **live tool definitions**. All four surfaces derive from it.

## Terminology

- **Operator / Op** — a node class extending `Operator`, registered in `opTypes` (~130 today).
- **Reference page** — `docs/reference/operators/<kebab>.md`, one per operator.
- **Registry JSON** — the per-operator machine-readable JSON at `noodles.gl/r/ops/<kebab>.json`.
- **Live tools** — tools that require a running editor (graph mutation, screenshots, timeline).
- **Docs tools** — tools answerable from published static data (schemas, docs, examples, validation).
