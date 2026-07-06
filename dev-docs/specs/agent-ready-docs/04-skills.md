# Sub-plan 04: AI Skills Suite

SKILL.md packages — modeled on shadcn's skills — that give coding agents the context to author and modify `noodles.json` projects correctly (offline) and to drive a running editor (live), teaching tool-first workflows instead of guessing.

## Goals

- Two installable skills: `noodles-authoring` and `noodles-live`.
- A `validate-projects` CLI so the authoring loop ends in verification, not hope.
- Generated includes + CI so skill content (version numbers, operator lists, tool catalogs) cannot rot.
- Dogfooding: Claude Code sessions in this repo auto-load the skills.

## Non-goals

- A third debugging skill — debugging splits by mode (offline validation errors → authoring skill; live console/screenshot debugging → live skill); each gets a Debugging section instead.
- Unifying `system-prompt.md` with the skills into one source (deferred; drift-checked instead).
- An npx installer (curl + marketplace packaging cover it).

## Requirements

1. WHEN an agent with `noodles-authoring` installed is asked to create a Noodles visualization THEN it SHALL consult an authoritative schema source (MCP tool, published reference, or local registry) before writing any edge.
2. WHEN an agent authors or modifies a project file THEN it SHALL validate the result with `validate-projects` (or the MCP `validate_project` tool) before delivering.
3. WHEN an agent modifies an existing project THEN it SHALL preserve everything it was not asked to change (`viewport`, unrecognized keys, untouched timeline tracks), SHALL NOT hand-bump `version`, and SHALL recompute edge ids when endpoints change.
4. WHEN an agent is asked to create or modify an animation THEN it SHALL treat the `timeline` key as a supported editing surface: edit against the documented format, maintain its invariants (sorted keyframes, unique ids, resolvable track paths), and validate afterward.
5. WHEN a new migration lands (NOODLES_VERSION changes) THEN CI SHALL fail until the skills' generated blocks are regenerated.
6. WHEN a Claude Code session opens in this repo THEN both skills SHALL be auto-discoverable via `.claude/skills/`.

## Verified groundwork

- `NOODLES_VERSION` is derived: `Math.max(...)` over `noodles-editor/src/noodles/__migrations__/*.ts` (`migrate-schema.ts:10`); currently 14. **`AGENTS.md` is stale** — says "Version 6 is current", points at a nonexistent `noodles-editor/examples/external-control/mcp-proxy.js` (real: `examples/external-control/mcp-proxy.js`) and `public/examples` (real: `src/examples`). Fix as part of this sub-plan.
- No validation CLI exists. `npm run migrate-projects` builds `scripts/migrate-project-files.ts` via `vite.config.migrate.ts` (needed because `migrate-schema.ts` uses `import.meta.glob`) — the template for the validator.
- No `.claude/` directory or SKILL.md exists anywhere. `CLAUDE.md` is `@AGENTS.md`.
- Rich source material: `src/ai-chat/system-prompt.md` (handle rules, layout heuristics, CodeOp consolidation), `src/ai-chat/docs/critical-user-journeys.md` (4 CUJs with ASCII graph diagrams), `AGENTS.md` §Graph Design Guidelines, example projects with READMEs.

## Design

### D1. Skill inventory

- **`skills/noodles-authoring/`** — write/modify `noodles.json` without a browser.
- **`skills/noodles-live/`** — drive a running instance via external control / MCP / WebMCP.

A third skill would share 80% of its trigger surface with these two and cause activation ambiguity.

### D2. Location and install

- Source of truth: `skills/<name>/SKILL.md` at repo root (discoverable, publishable via raw.githubusercontent — the shadcn model).
- Dogfood: `.claude/skills/<name>` → relative symlinks to `../../skills/<name>`.
- Install story, phased: (1) documented curl one-liner per agent into `~/.claude/skills/`; (2) `.claude-plugin/marketplace.json` exposing a `noodles` plugin containing both skills (`/plugin marketplace add joby-aviation/noodles.gl`).
- One line added to `AGENTS.md` pointing at the skills as the authoritative graph-authoring guidance.

### D3. Content strategy: thin router

**Inline in SKILL.md** (small, stable, or generator-injected): handle format (`out.<field>` / `par.<field>`, never `in.`); edge id formula `"{source}.{sourceHandle}->{target}.{targetHandle}"`; Unix-path node IDs; `@/` data-path prefix; `version` = current NOODLES_VERSION (injected, never hand-typed); graph design rules (5–8 nodes, CodeOp consolidation, standard pipeline `FileOp/DuckDbOp → CodeOp → AccessorOp → LayerOp → DeckRendererOp → OutOp`, always `MaplibreBasemapOp` for geo, left→right layout x+=350); "only serialize non-default inputs"; timeline invariants (keyframes sorted by position, unique `kf_*`/`tm_*` ids, track paths must resolve, the `sheetsById.Noodles` nesting is legacy shape to preserve, not structure to reorganize); "preserve unknown keys".

**Fetched, in priority order** (spelled out as a lookup table in the skill):
1. MCP docs tools (`get_operator`, `validate_project`, `get_example`) if connected,
2. published reference: `https://noodles.gl/r/ops/<kebab>.json` / reference pages,
3. local fallback: `noodles-editor/public/context/operator-registry.json` (run `npm run generate:context` if absent) or read `operators.ts` directly.

Graceful degradation means the skills ship **before** sub-plans 01–03 land; those landings only promote steps 1–2 to primary.

### D4. Validation loop: `npm run validate-projects`

- New `noodles-editor/scripts/validate-project-files.ts` exporting `validateProject(json)`, plus `vite.config.validate.ts` (clone of `vite.config.migrate.ts`).
- Checks: `version === NOODLES_VERSION` (error + "run `npm run migrate-projects`" hint); every `node.type` in `opTypes`; every input key exists on that operator; edges reference existing nodes; handle prefixes and real field names; canonical edge id; duplicate node ids; container path consistency; timeline integrity (track paths resolve, keyframes sorted, unique keyframe/marker ids, marker connections reference existing keyframes). Nonzero exit, per-file diagnostics.
- npm script: `"validate-projects": "vite build --config vite.config.validate.ts && node dist/validate-project-files.js"`, accepting paths (default: `src/examples` + `public/noodles`).
- **Sub-plan 03's `validate_project` MCP tool wraps this same rule set** — one implementation, two surfaces (03 carries the dependency-free lint; this CLI adds runtime-only checks).
- Interim fallback documented in the skill until the CLI lands: `npm test src/noodles/utils/examples-version.test.ts src/noodles/storage.test.ts`.

### D5. Freshness: generated includes + CI

- New `noodles-editor/scripts/generate-skill-includes.ts` (npm `generate:skills`, `--check`): rewrites blocks between `<!-- BEGIN GENERATED:x --> / <!-- END GENERATED:x -->` markers. Generated facts: NOODLES_VERSION; operator count + category→operator lists (reuse `parse-operators.ts`); live tool catalog (from `mcp-proxy.js` today, from the unified registry once 05 lands); reference-URL index; the `references/minimal-project.json` seed (a validated, current-version, empty-but-runnable project: MaplibreBasemapOp + DeckRendererOp + OutOp).
- CI `skills-check` job in `test.yml`: `generate:skills --check` (drift), frontmatter lint (name/description present, description < 1024 chars, mentions triggers), `validate-projects` over `minimal-project.json` + examples, symlink integrity for `.claude/skills`.

### D6. Sync with `system-prompt.md`

The generator lifts the two truly shared sections — "Handle Naming Format" and "Graph Design Principles" — from `system-prompt.md` by heading anchor into a generated block in `noodles-authoring`. `--check` fails if either side drifts, forcing a deliberate decision. Full extraction of a common partial consumed by both is deferred (file a follow-up issue).

## SKILL.md outlines

### `skills/noodles-authoring/SKILL.md`

```yaml
---
name: noodles-authoring
description: >
  Author or modify Noodles.gl project files (noodles.json) — node/edge graphs for
  geospatial visualization. Use when creating a noodles.json from scratch, editing
  nodes, edges, or inputs in an existing one, or building a Noodles visualization
  without a running app. Covers schema version and migrations, node/edge/handle
  formats, graph design rules, and validation. Trigger: a noodles.json exists in
  the workspace, or the user mentions Noodles.gl / noodles project / node graph.
---
```

1. **Look things up, don't guess** — the D3 lookup table. Hard rule: *never write an edge without confirming both field names from one of these sources.*
2. **Project file invariants** — generated block: version; node/edge shapes with the edge-id formula; `out.`/`par.` rules with the WRONG-examples table from system-prompt.md; Unix-path ids; `@/` prefix; non-default inputs only.
3. **Graph design rules** — generated block extracted from system-prompt.md.
4. **Creating a new project** — start from `references/minimal-project.json`; per-operator schema lookup; wire edges; descriptive node names (`/earthquake-data`, not `/node-1`); place in `src/examples/<name>/` with data beside it.
5. **Modifying an existing project** — read whole file first; if `version <` current, `npm run migrate-projects` before editing, never hand-bump; preserve `viewport`/unknown keys and any timeline tracks you weren't asked to touch; inputs merge; recompute edge ids.
5a. **Animating** — the `timeline` key is yours to edit: the format reference (`references/timeline-format.md`, generated from `src/timeline/types.ts`) shows the track/keyframe/handle shapes with a worked zoom-animation example. Maintain the invariants (sorted keyframes, unique ids, resolvable track paths), validate afterward, and scrub the result in the app. When a live session is available, the `set_keyframe` tools are the ergonomic path (they maintain ids and sorting for you), but they are a convenience, not a boundary.
6. **Validate before you're done** — `cd noodles-editor && npm run validate-projects <path>` (or MCP `validate_project`); error→fix table; then load `http://localhost:5173/examples/<name>`.
7. **Common mistakes** — `in.`/bare handles, missing DeckRenderer/Out terminus, stale edge ids, invented `get*` field names, edited version.
8. **Deeper references** — `references/project-format.md`, `references/graph-recipes.md`, docs URLs, examples index (generated).

Supporting files: `references/project-format.md` (full serialization detail: containers, GraphInput/GraphOutput, path prefixes); `references/timeline-format.md` (generated from `src/timeline/types.ts`: track/keyframe/handle/marker shapes, invariants, and a worked two-keyframe animation example); `references/graph-recipes.md` (per-CUJ node+edge JSON skeletons distilled from `critical-user-journeys.md`: points, arcs, polygons, heatmap, SQL pipelines); `references/minimal-project.json` (generated, CI-validated).

### `skills/noodles-live/SKILL.md`

```yaml
---
name: noodles-live
description: >
  Drive a running Noodles.gl editor via the external-control MCP proxy or WebMCP.
  Use when a Noodles dev server is running (localhost:5173) or the user asks to
  change, inspect, animate, or debug what's currently on screen in Noodles.
  Trigger: noodles MCP tools are available, ?externalControl=true is mentioned,
  or the user says "in the running app / on my screen".
---
```

1. **Setup check** — is the `noodles` MCP server connected? If not: open `http://localhost:5173/examples/<p>?externalControl=true`, run `npx noodles-mcp --live` (interim: `node examples/external-control/mcp-proxy.js`); link `docs/developers/external-control-guide.md`.
2. **Tool catalog and priority** — generated block: reads (`list_nodes` → `get_node_info` → `get_node_output`) cheap, use often; mutations next; `capture_visualization` expensive, on explicit request.
3. **Read before write** — always list+inspect before mutating; after adding a data node, `get_node_output` to verify structure before building layers.
4. **Update the source node** — trace edges and mutate the upstream source's input, not the connected target handle (the ColorOp-vs-`getFillColor` rule).
5. **Debugging runbook** — `get_console_errors` → graph completeness → edges attached → common causes (missing edges, opacity 0, bad accessor, disconnected renderer) → screenshot last.
6. **Timeline/animation** — prefer the live timeline tools here (they maintain keyframe ids and sort order for you, and you see the result scrub immediately); durable or bulk animation edits can also go through the JSON per `noodles-authoring`'s timeline reference.
7. **When to switch modes** — durable file changes / bulk refactors → save and switch to `noodles-authoring`; skills cross-reference each other.

Supporting file: `references/tool-catalog.md` (generated).

## Implementation steps

1. Validation CLI (`validate-project-files.ts`, `vite.config.validate.ts`, npm script, tests; burn in over all example projects).
2. `skills/noodles-authoring/` — SKILL.md + references, sourced from system-prompt.md, corrected AGENTS.md content, critical-user-journeys.md, and a realistic example (e.g. `california-earthquakes`). Generated-block markers from day one, hand-filled initially.
3. `skills/noodles-live/` — SKILL.md + tool catalog.
4. Dogfooding: `.claude/skills/` symlinks; AGENTS.md pointer + staleness fixes (version, proxy path, examples path).
5. `generate-skill-includes.ts` + `generate:skills` + CI `skills-check` job.
6. `docs/developers/skills.md` (+ sidebar): what skills are, per-agent install, dogfooding note, relation to the in-app assistant and MCP server. Phase-2 marketplace.json.

## Verification

1. Fresh agent, empty dir, `noodles-authoring` only: "plot California earthquakes as a scatterplot" with the example's data file — assert it consulted schemas before wiring; output validates; version current; loads at `localhost:5173` rendering points.
2. Modify test: hand it `uk-commute`, "make arcs red and thicker" — source-node edit, timeline untouched (nothing about the ask involves animation), still validates.
3. Animation test: hand it a project with an existing camera animation, "make the zoom-in take twice as long" — keyframe positions rescaled in the timeline JSON, ids and sort order intact, validates, and scrubs correctly in the app.
4. Live test: `?externalControl=true` + proxy + `noodles-live`: a color change and a "why is it blank" debug.
5. Rot test: simulate a `015-*.ts` migration → CI `--check` fails.

## Dependencies

- None blocking (D3 graceful degradation). Upgrades when 01 (reference URLs), 02 (`/r/` URLs), 03 (MCP tools primary; `validate_project` wraps `validateProject()`), and 05 (canonical snake_case tool names in the catalog) land.

## Open questions

- Whether Cursor/other agents need a different distribution artifact than SKILL.md (rules files) — revisit at marketplace packaging time.
