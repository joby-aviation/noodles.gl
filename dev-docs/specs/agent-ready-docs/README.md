# Agent-Ready Operator Docs — Roadmap

This spec directory defines a program of work to make Noodles.gl's operators fully documented for humans and fully consumable by AI agents. It is a roadmap plus five executable sub-plans. Each sub-plan is standalone: it can be picked up as its own task/PR series without reading the others first, and each one names its dependencies explicitly.

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
| [03-mcp-server.md](03-mcp-server.md) | `noodles-mcp` server | shadcn-style docs/registry MCP server (npx, stdio), `--local` and `--live` modes, tool-surface convergence |
| [04-skills.md](04-skills.md) | AI skills | `noodles-authoring` + `noodles-live` SKILL.md suite, `validate-projects` CLI, generated includes, install story |
| [05-webmcp.md](05-webmcp.md) | Unified tool registry + WebMCP | One canonical tool registry feeding chat/WS/stdio/WebMCP, project-bridge write path, consent UI, origin trial |
| [06-concept-essays.md](06-concept-essays.md) | Concept essays | Chen-style long-form pieces on the execution model, paths, memoization, timeline, fields — the connective tissue Remarks link to |
| [07-cuj-evals.md](07-cuj-evals.md) | CUJ eval harness | Greenfield-session evals with rubrics + graders: baseline against today's repo, regrade at every roadmap landing — the program's success metric |

## Dependency graph

```
01 operator reference ──┬──▶ 02 remarks embedding in /r/ops/*.json
                        └──▶ 03 get_operator returns Remarks prose

02 machine-readable ────────▶ 03 noodles-mcp (backing data: /r/, schema, mirrors)

04 skills ──(no hard deps: graceful degradation; upgrades as 01–03 land)
   └── validate-projects CLI ──▶ 03 validate_project tool wraps it (one impl, two surfaces)

05 phase 0 (agent-tools registry + project-bridge) ──(independent; fixes live bugs)
   └──▶ 05 phases 1–3 (WebMCP provider, consent, origin trial)

06 concept essays ──(independent; 01's Remarks link to them; 02 distributes them)

07 CUJ evals ──(T0 baseline BEFORE anything else lands; regrades track every landing;
                consumes 04's validateProject() once it exists)
```

Orderings that matter:

- 02's generator ships **before** 01 finishes prose — it embeds Remarks conditionally and degrades gracefully when `docs/reference/operators/` is absent.
- 03's `validate_project` must wrap 04's exported `validateProject()` function rather than reimplementing it.
- 04's skills teach the canonical snake_case tool names defined by 05's registry.
- 05 phase 0 is pure refactoring + bug fixes and can land any time; later phases ride the Chrome origin trial.

## Phasing

**Phase 0 — the before photo**
- 07: scaffold the eval harness and **run the T0 baseline against today's repo before any sub-plan merges**. Every later landing re-runs the same tasks at the new tier; the delta is the measured value of that investment.

**Phase A — foundations** (parallelizable)
- 01: parser extensions, `generate-operator-docs.ts`, generated skeleton pages for all ~130 ops, sidebar, style guide, CI drift check.
- 02: `project-schema.ts` + JSON Schema, `generate-reference.ts` + `/r/` surface + llms.txt regeneration, delete the conflicting `generate-context.yml` workflow.
- 05 phase 0: `src/agent-tools/` unified registry + project-bridge; migrate the three existing tool surfaces; enforce session permissions. Fixes four live bugs (see Quick wins).

**Phase B — consumption**
- 03: `noodles-mcp` package (docs mode, then `--live` mode absorbing `mcp-proxy.js`).
- 04: both skills + `validate-projects` CLI + generated includes + CI freshness job.
- 05 phase 1: WebMCP read-only provider behind feature detection.

**Phase C — polish and rollout**
- 01: prose for the priority operators, then the rest in category batches — LLM-drafted under the D6 protocol (exemplar canon, context packs, no invented history), maintainer-reviewed; driven by the index coverage counter and the prose-staleness queue, not memory.
- 06: concept essays 1–5, cross-linked from the priority pages (same author pass as the Remarks work where possible).
- 03: npm publish, `.mcp.json` docs page.
- 04: `.claude-plugin/marketplace.json` plugin packaging.
- 05 phases 2–3: write tools behind consent UI, origin-trial token for noodles.gl, image tool results.

## Knowledge accrual (how the repository keeps filling)

Generated skeletons make the docs *accurate*; these mechanisms make them *accumulate*:

- **Mine what already exists**: the History region (01) extracts per-operator change stories from `__migrations__/` — the repo's existing record of "what we tried first". Git log and PR descriptions feed the priority-page Remarks.
- **Make progress visible**: the reference index shows "N of M operators have written Remarks"; `--check` emits a prose-staleness queue (operator source changed, prose untouched).
- **Make it a ritual**: the PR template asks "does this change an operator's behavior? Update its Remarks" (01 step 8).
- **Keep examples honest**: fenced examples on reference pages are validated in CI (01), the same way authored projects are (04).
- **Close the loop from agents** (later): once 03/04 are live, `validate_project` failures and in-app assistant misses are a direct signal of what users get wrong — use that data to prioritize which Remarks and essays to write next. No tooling now; just look at it when Phase C prioritizes.

## Quick wins (small standalone PRs, high value, no phase gating)

1. **Register the dormant context tools** in the in-app chat: `MCPTools` already implements `list_operators`, `get_operator_schema`, `get_documentation`, `search_code`, `get_example`, `list_examples` — they are simply not registered in `claude-client.ts`'s `getTools()`.
2. **Delete `.github/workflows/generate-context.yml`** — its peaceiris gh-pages branch push mechanically conflicts with `deploy-docs.yml`'s Pages-artifact flow, which already regenerates context on every push to main.
3. **Fix stale `AGENTS.md`** — it claims project version 6 (actual: `NOODLES_VERSION` = 14, derived from migrations), points at `noodles-editor/examples/external-control/mcp-proxy.js` (actual: `examples/external-control/mcp-proxy.js`), and references `public/examples` (actual: `src/examples`).
4. **Fix the external-control write path** — `worker-bridge.ts` and `tool-adapter.ts` construct private `MCPTools` instances and never call `setProject()`, so `getCurrentProject` returns "No project loaded" and mutations validate-then-drop; `PIPELINE_CREATE` passes an object where the validator requires an array.
5. **Enforce session permissions** — `session-manager.ts` issues `['read','write','execute']` permissions that nothing checks.

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
