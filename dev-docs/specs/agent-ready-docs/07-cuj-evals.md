# Sub-plan 07: CUJ Eval Harness

A system of rubrics and graders that measures how well a **greenfield LLM session** — fresh container, no conversation history — executes the program's critical user journeys against whatever resources exist in the repo at that moment. Run it today to establish the baseline; re-run and regrade after every roadmap landing. The output is the program's success metric: a longitudinal score per CUJ that should climb as sub-plans 01–06 land — and an attribution of *which* investment moved it.

## Goals

- Executable eval tasks derived from the roadmap CUJs, runnable headlessly.
- Layered grading: mechanical checks first (does it validate/load/render), rubric-based LLM judging second (did it work *well*), process metrics throughout (did it guess or look things up).
- A baseline run against today's repo, then a regrade at each roadmap milestone, with results versioned in the repo so the curve is inspectable.
- Attribution: resource tiers and ablations so "the MCP server improved SQL-pipeline success by X" is a measurement, not a vibe.

## Non-goals

- Per-PR CI gating (too slow/expensive; this runs on demand and at milestones).
- Benchmarking models against each other — the variable under test is the **resources**, so the model and prompt scaffold stay pinned per eval season. (Phase-0 nuance: the T0 baseline is run under **three** pinned session models — `us.anthropic.claude-sonnet-4-6`, `us.anthropic.claude-sonnet-5`, `us.anthropic.claude-opus-4-8`, Bedrock inference-profile ids recorded verbatim — to record model sensitivity once, at the season's start. Cross-tier claims still only ever compare rows sharing a `sessionModel`; the non-goal stands.)
- Grading the in-app chat assistant (worthwhile, but a different harness; revisit after 05 unifies the tool surfaces).

## Requirements

1. WHEN the harness runs a task THEN the session SHALL start greenfield (fresh clone/container, no prior context) with exactly the resources of the configured tier, and every artifact (produced files, full transcript, screenshots, tool-call log) SHALL be captured.
2. WHEN a run completes THEN mechanical graders SHALL score objective outcomes before any LLM judge runs, and a mechanical failure SHALL cap the total score regardless of judge opinion.
3. WHEN an LLM judge scores a rubric dimension THEN it SHALL cite specific evidence (transcript excerpt, file line, screenshot) for every score, and judge prompts/rubrics SHALL be versioned alongside results.
4. WHEN results are recorded THEN they SHALL include the repo commit, resource tier, task version, rubric version, model id, and cost — enough to reproduce and to compare runs honestly.
5. WHEN a roadmap sub-plan lands THEN re-running the same tasks at the new tier SHALL require no harness changes beyond the tier definition.

## Design

### D1. Layout

```
evals/
  README.md               # how to run, how to read results
  tasks/                  # one file per task: prompt, inputs, tier requirements, grader config
    author-scatterplot.md
    modify-arcs.md
    debug-blank-viz.md
    sql-h3-pipeline.md
    contextualize-operator.md
    animate-camera.md
    live-drive.md         # (tier 5+ only)
  rubrics/
    authoring.yaml        # per task family: anchored or checklist dimensions + weights (no bare scales)
    contextualization.yaml
    judge-prompt.md       # the judge scaffold, versioned
  harness/
    run.ts                # task runner: spawn session, collect artifacts
    grade.ts              # mechanical checks + judge orchestration
    report.ts             # scorecard + longitudinal comparison
  results/
    2026-07-xx.t0.<commit>/   # one directory per run: scores.json + artifacts/
```

`evals/` sits at repo root, outside `noodles-editor` — the harness runs *against* the repo, not inside the app.

### D2. Tasks (derived from the CUJs)

Each task file contains: the user prompt (verbatim, realistic), input data (or a pointer into `src/examples/`), what the agent may use at each tier, time/turn budget, grader configuration, and **`tags`** (e.g. `data-source`, `animation`, `live`) — the machine-readable task traits that rubric `applicable_when` clauses match against. Initial set:

| Task | CUJ | Prompt sketch | Key mechanical checks |
|---|---|---|---|
| `author-scatterplot` | 3 | "Plot California earthquakes as a scatterplot sized by magnitude" + the CSV | file validates; loads in app; screenshot non-blank; ScatterplotLayerOp + basemap + renderer present |
| `modify-arcs` | 3 | "Make the arcs in this project red and 2× thicker" + `uk-commute` | validates; `timeline`/`viewport`/unknown keys byte-identical; edit hit the correct upstream node |
| `debug-blank-viz` | 3 | A seeded-broken project (disconnected renderer + bad accessor) + "why is this blank?" | both defects identified; fix validates and renders |
| `sql-h3-pipeline` | 3 | "Aggregate these points into H3 hexagons colored by count, using SQL" | validates; DuckDbOp + H3HexagonLayerOp wired; renders |
| `contextualize-operator` | 2 | 25–30 factual questions with ground-truth answers, spread across question kinds: field schemas and defaults ("what are TripsLayer's inputs and defaults?"), enum semantics ("what does `sizeUnits: 'common'` mean?"), operator history ("what changed about MapStyleOp?"), and format invariants ("what must an edge id look like?", "which prefix do input handles carry?") | answer accuracy vs answer key |
| `animate-camera` | 3/4 | "Animate the camera from SF to LA over 5 seconds" | valid keyframes present (direct `timeline` JSON edits are a legitimate path); track paths resolve; keyframes sorted, ids unique; animation scrubs in the app |
| `code-refs-containers` | 3 | "Compute a derived column with a CodeOp, reference the cutoff via `op()`, group the pipeline into a container, and **promote the cutoff as a parameter on the container**" (added in phase 0 for the containers/references gap; **taskVersion 2** added promoted parameters — the feature had no coverage anywhere — breaking the v1 series per D7; v1 rows remain historical) | validates (validator accepts `data.customInputs`-declared inputs); CodeOp with resolving `op()` reference; path-prefixed container children; container declares a numeric promoted parameter that actually feeds the cutoff; renders |
| `author-hiking-time` | 3 | "Build a Naismith's-Rule hiking-time calculator from the reference document" (public, non-proprietary — ships with an open-sourced harness; **the designated smoke-lane task** for D6's smoke subset: no data files, no basemap, no egress; terminates in a ViewerOp, covering the calculator/prototyping journey plus SwitchOp and reference-doc→graph fidelity) | validates; distance CodeOp (turf.distance, km); piecewise terrain-factor heuristic; multi-term formula with Langmuir descent logic; sensible NumberOp constants; ViewerOp wired to the formula; ≥2 PointOps, ≥2 SwitchOps; loads and renders |
| `live-drive` | 4 | (tier 5+) "In the running app, change the point color and tell me the FPS" | correct tool calls; graph actually mutated; no guessed handle names |

Seeded-broken fixtures and answer keys live under `evals/tasks/fixtures/`. Tasks are **versioned**; a changed task starts a new comparison series (never silently edit a task mid-season).

### D3. Resource tiers (the independent variable)

| Tier | Resources available to the session | Corresponds to |
|---|---|---|
| T0 | The repo as-is (AGENTS.md, docs/, source) | **today — the baseline** |
| T1 | + generated reference pages | 01 landed |
| T2 | + machine-readable surface (`/r/`, schema, llms.txt) | 02 landed |
| T3 | + `noodles-mcp` connected | 03 landed |
| T4 | + skills installed | 04 landed |
| T5 | + live app with WebMCP tools | 05 follow-ups landed (PR #508 shipped the tool surface early; ladder order still governs when T5 unlocks) |

Tiers are enforced by environment construction, not by asking the agent to abstain. At tiers below T4 — including T3, where MCP is present but skills are not — the runner strips all three dogfooding artifacts from the checkout: `skills/`, the `.claude/skills` symlinks, and the AGENTS.md pointer line (see 04's eval-isolation note); T0–T2 additionally get no MCP config. T3+ get the pieces added per the ladder. The T5 environment must also **grant agent write access explicitly**. Once 05 F1 lands, the documented mechanism is the session-only `?agentAccess=read-write` param (never persisted, no UI or prior state required). Interim, after PR #508 and before F1: `?externalControl=true` alone grants writes, so the builder needs no extra step — but pin which regime a run used, since the grant mechanism is part of the environment definition.

**Tiers unlock in ladder order regardless of merge order.** The ladder encodes 01→02→03→04→05 cumulatively, but the roadmap doesn't merge in that order (05 phase 0 lands in Phase A; 04 ships with graceful degradation and may precede 03). A tier is unlocked only when every rung below it has landed; resource states that exist between merges are off-ladder and belong to ablation mode, not to new tier definitions. Relatedly, the **agent-context-improving quick wins** (the AGENTS.md refresh, registering the dormant chat tools) improve the T0 baseline without unlocking any tier — that's baseline drift that would silently pollute the next tier's delta, so those PRs are explicitly run as `run-evals`-labeled smoke PRs: their effect gets measured at merge time instead of absorbed into whichever tier lands next.

**Ablation mode** runs an off-ladder resource combination that the cumulative ladder can never produce — removing the most-recently-added resource is a no-op (T4 minus skills *is* T3, which the milestone runs already measure). The combos that earn the mode its keep remove a *lower* rung while keeping what sits above it: "T4 minus MCP" (skills present, MCP absent) answers "do the skills work without the tool they teach?"; "T3 minus reference pages" answers whether the MCP server's value survives without the prose it serves.

### D4. Grading: three layers, strictly ordered

**Layer 1 — mechanical (objective, cheap, runs first).** Per task: `validateProject()` (04's CLI), project loads in the app under Playwright without console errors, screenshot is non-blank (pixel-variance threshold) and — where a task defines one — perceptually similar to a golden reference; required node types present; forbidden actions absent (hand-bumped `version`, malformed timeline edits: unsorted keyframes, dangling marker connections, unresolvable track paths). **A mechanical failure caps the task score at 40%** — a beautiful transcript that produced an invalid file is a failure with good manners.

**Layer 2 — rubric LLM judge (subjective, structured).** Rubric dimensions, weighted per task family (weights in the YAML, not the judge's discretion). Dimensions: *correctness of result*, *tool-use discipline*, *edit hygiene*, *graph design conformance*, *efficiency* (informational weight at first — don't optimize agents into recklessness), *honesty* (does the final answer claim things the artifacts contradict?).

**No bare scales.** A dimension named "tool-use discipline: 0–4" invites every grader — human or LLM — to invent their own scale, which is exactly the disagreement calibration then has to repair. So the rubric format forbids it: every dimension declares `style: anchors` (a description per level, for holistic judgments) or `style: checklist` (binary sub-criteria aggregated to the score, for countable behaviors), and `grade.ts` rejects a rubric containing a dimension with neither. Worked excerpt of `rubrics/authoring.yaml`, one of each style:

```yaml
dimensions:
  tool_use_discipline:
    style: checklist          # binary sub-criteria, but each requires reading
    weight: 0.20              # comprehension — the countable half lives in Layer 3
    aggregate: proportion     # score = 4 × passed / applicable; N/A criteria excluded
    criteria:
      - id: applied-what-it-read
        text: The content of the agent's lookups demonstrably shaped its edits —
          values, enum members, or defaults from a fetched schema appear in what
          it wrote. A lookup performed and then ignored fails this.
      - id: authoritative-source-choice
        text: When multiple sources were available at this tier, the agent
          preferred the authoritative one (registry, reference page, operators.ts)
          over inferring from example projects or apparent memory.
      - id: purposeful-verification
        text: Inspections (get_node_output, reading data files) fed visible
          decisions rather than being performed ritually — the agent's next step
          depends on what the inspection returned.
        applicable_when: tag:data-source   # matches task tags; never free text

  edit_hygiene:
    style: anchors            # holistic judgment → per-level descriptions
    weight: 0.20
    levels:
      0: Rewrote or reserialized the whole file (formatting/key-order churn on
         untouched sections), or dropped keys it did not understand (timeline,
         viewport, or unknown keys missing from the output).
      1: Preserved unknown keys but made broad unrequested changes, e.g. renamed
         node ids or reorganized node positions beyond the ask.
      2: Changes confined to the right nodes, but collateral defects remain, e.g.
         edge ids not recomputed after a handle change, or default-valued inputs
         serialized redundantly.
      3: Minimal diff that satisfies the request with all invariants maintained;
         at most cosmetic noise.
      4: Level 3, and the diff is the smallest plausible one — a reviewer reading
         only the diff can reconstruct the request.
```

Checklist dimensions double as evidence prompts (the judge cites the transcript line satisfying or violating each criterion); anchor levels give the judge, and the calibrating humans, the same yardstick to disagree about — specific sentences, not vibes. `applicable_when` is **tag-matched against the task file's `tags`, resolved by `grade.ts` before the judge runs** — if the judge decided applicability from a free-text description, the judgment the checklist format exists to remove would sneak back in through the side door.

Judge mechanics: the judge receives the task, rubric, artifacts, and transcript; scores each dimension 0–4 **with a cited quote/line per score**; three independent judge samples, median taken; judge model and prompt pinned per season and recorded in results. Judges never see the tier label (blind to the hypothesis).

**Judge calibration (before any cross-tier claim).** An LLM judge is itself an instrument that needs calibrating, and the T0 baseline transcripts are the calibration set: both maintainers independently hand-grade them against the same rubric YAML — blind to each other's scores and to the judge's — then per-dimension agreement between the human consensus and the LLM judge is computed (with the 0–4 scale, exact + adjacent agreement is enough; no need for anything fancier at this sample size). Any dimension below the agreement threshold is not trusted as-is. Since every dimension is already anchored or checklisted (see the rubric format above), a calibration failure means the wording itself is ambiguous: **sharpen the anchors** with exemplars from the actual T0 transcripts ("a 2 on edit hygiene looks like this diff"), **split criteria** that graders read differently, or **demote a dimension from anchors to checklist** when the holistic judgment turns out to be countable after all — then re-run the judge on the same transcripts until agreement clears the bar. A calibration validates a **(rubricVersion, judgeModel) pair**, not a rubric alone — the same anchors read by a different judge model are an uncalibrated instrument, so recalibration is required when **either** changes (a new season that re-pins the judge model recalibrates even if the rubric didn't move). The default agreement bar is **pre-committed here, before any scores exist: ≥ 80% exact+adjacent agreement per dimension** (on the 0–4 scale, adjacent = ±1); changing the bar is a spec change to this file, not a calibration-time choice — picking the threshold after seeing the scores is a small self-grading hazard this sentence exists to close. Calibration results (per-dimension agreement, the pair validated, rubric revisions made) are recorded alongside the series; cross-tier claims may only cite dimensions that passed. Where the two humans disagree with *each other* beyond the threshold, the dimension is underspecified for humans too — that's a rubric bug, not a judge bug, and it gets the same anchoring treatment.

**Layer 3 — process metrics (counted, not judged).** The boundary rule: anything a parser can compute from the transcript belongs here, not in the judge's rubric — a judge spending its attention on countable facts is wasted attention, and a count is more trustworthy than a judgment of the same fact. Extracted per run: **lookup-preceded-edge ratio** (fraction of written edges where both endpoint operators had a prior schema lookup in-session — this is the mechanical half of tool-use discipline; the judge keeps only the judgment-requiring remainder above), hallucinated field/handle names (every `out.X`/`par.X` written, checked against the registry), identical-lookup repetition (same fetch 3+ times), data-source-inspected-before-accessors (ordering check), validation-failure→retry cycles, lookups performed vs available. These are the diagnostic layer: when T3 beats T0, these say *why* — and they appear in the scorecard alongside the scores, not buried in artifacts.

### D5. Runner

`harness/run.ts` drives greenfield sessions via the Claude Agent SDK (headless), each in a fresh workspace: construct the tier environment (checkout + strip/add resources + start dev server for tasks that need loading), inject the task prompt, capture everything, hand off to `grade.ts`. Sessions get a hard budget (turns + wall-clock) so a lost agent registers as a low score rather than a hung run.

**Milestone runs are 3 sessions per task per tier** (each its own `runId` and artifacts directory); a single agent session is itself a noisy sample, and one sample per task means every cross-tier delta is confounded with luck. The smoke lane stays at **1 session** — it's a directional signal, labeled as such, not a measurement. Cost note: a tier milestone is ~7 tasks × 3 sessions ≈ 21 agent sessions plus ~63 judge samples — low hundreds of dollars per milestone at the high end, still milestone-cadence money rather than per-PR money, which is exactly why this isn't CI.

`report.ts` emits the scorecard: for each milestone, the **median and range per task across its 3 sessions** (the range doubles as a live, per-task noise estimate — a cross-tier delta smaller than the overlapping ranges is reported as no change), plus aggregate scores at each tier over time — the **docs ROI curve** — and the process-metric deltas. Results directories are committed (artifacts pruned to transcript + final files + one screenshot).

**Regrade semantics.** Running and grading are decoupled, and that's load-bearing: a session run produces artifacts (transcript, final files, screenshots, tool-call log) plus its Layer-1 mechanical results, which are **frozen facts recorded at run time** (did it validate, load, render — properties of the run, not of any rubric), stamped with the **validatorVersion** in force when they were measured — `validateProject()` gains rules over seasons, so mechanical scores across the series come from different instruments; that's unavoidable (regrades never re-run the app), but recording it lets a historical comparison say so instead of implying one instrument measured everything. `grade.ts` consumes only these stored inputs and MUST be re-runnable at any time without spawning new sessions — judge calls are the only cost of a regrade; the app is never re-executed. When `rubricVersion` bumps (a calibration fix, an anchor sharpened, a criterion split), all prior **milestone** runs are regraded under the new rubric. This is what keeps `index.json` one continuous, comparable series instead of fracturing at every rubric repair: scores are only comparable within a rubricVersion, and regrading brings the whole history forward to the current one. Smoke-lane rows are not regraded (ephemeral by design). Task-version changes still break the series (D7) — no rubric can make artifacts from two different tasks comparable.

### D6. Longitudinal tracking and PR surfacing (the Coveralls model)

Two speeds, because the two signals have wildly different costs:

**Fast lane — deterministic docs metrics, every PR.** No agent sessions required: docs Remarks coverage (N/M from the 01 index counter), prose-staleness queue length, skill/schema drift status are all computable in seconds from the checkout. A `docs-metrics` job in `test.yml` computes them and a GitHub Action posts/updates a **sticky PR comment** (upsert by marker, exactly like Coveralls):

> **Docs metrics** · Remarks coverage: 16/130 (**+2**) · stale-prose queue: 7 (−1) · drift checks: ✅

This is the per-PR heartbeat. It costs nothing and makes documentation-regressing PRs visible at review time.

**Slow lane — eval grades, on demand + milestones.** Full greenfield eval runs stay off the per-PR path (cost, latency, variance). A `run-evals.yml` workflow with two triggers:

- `workflow_dispatch` with tier/task inputs — the milestone run.
- A PR **label** (`run-evals`) — runs a **smoke subset** (2 designated tasks, 1 judge sample instead of 3) against the PR's checkout, for PRs that plausibly move the needle (skills, reference pages, MCP server, prompts).

Either way the workflow appends a machine-readable row to the series and comments the delta on the PR/commit. Smoke comments carry single scores (one session — directional, and labeled as such); milestone reports show median [range] per task per D5:

> **CUJ evals (smoke, T4 — single session, directional)** · author-scatterplot: 3.1 → **3.4** · contextualize-operator: 2.2 → **2.6** · vs baseline `evals/results/index.json@main` · [full artifacts](link)

> **CUJ evals (milestone, T4)** · author-scatterplot: 3.2 [2.9–3.4] vs T3 2.7 [2.5–3.0] · contextualize-operator: 3.0 [2.8–3.1] vs T3 2.4 [2.2–2.7] · [full report](link)

**Series storage.** `index.json` separates **run identity** from **grading events**. A run (one session, one set of artifacts) has a stable `runId`; grading appends rows: `{runId, artifactsRef, commit, tier, taskVersion, validatorVersion, kind: "fresh" | "regrade", regradeOf?, gradedAt, rubricVersion, judgeModel, sessionModel, provider, region, isolationAudit, scores: {task: {mechanical, judge, process}}, cost}` (`validatorVersion` is copied from the run's frozen mechanical results — it never changes on regrade). `sessionModel`, `provider`, and `region` were added in phase 0: Requirement 4 already demanded the model id, but the schema as first written carried only `judgeModel`, and the season runs on AWS Bedrock, where provider and region are part of reproducing a row — model ids are recorded verbatim in provider form (e.g. `anthropic.claude-sonnet-5`). `isolationAudit` records the post-run check that no tool call touched the harness checkout, `evals/`, or this spec directory (D7's first bullet, made mechanical). **Season archival** (phase-0 amendment): an open season keeps its run artifacts in-tree because regrades require them; when a season closes — the curve is complete (all tier milestones + ablations graded, calibration settled, rubric-bump regrades applied) or a forced re-pin ends it early — its heavy evidence (transcripts, screenshots) moves to a GitHub Release asset via `archive-season`, the grading rows and scorecards stay in-tree, and the season becomes a closed instrument: no further regrades without restoring the tarball. Milestones after T0 run one primary session model (the multi-model spread was a T0-only sensitivity recording), bounding storage growth to roughly 13MB per milestone. A fresh run creates its artifacts directory plus its first grading row (`kind: "fresh"`); a rubricVersion bump appends `kind: "regrade"` rows pointing at the same `runId`/artifacts, with `regradeOf` naming the superseded row. `report.ts` renders the series using the latest grading per run by default (one comparable line, current rubric) and can pin a `rubricVersion` to audit what a past report claimed. The calibration record (D4) names the **(rubricVersion, judgeModel) pair** it validated — series rows record both fields, so "is the current series running on a calibrated instrument" is a mechanical check, and a season that re-pins the judge model shows as uncalibrated until recalibrated. `report.ts` renders the series as the longitudinal table/chart, and a tiny endpoint JSON (`website/static/evals/latest.json`) feeds a shields.io badge in the README — the outward-facing Coveralls number.

**Noise discipline.** The per-task range across each milestone's 3 sessions is the noise band, first established at T0; the reporter treats any cross-tier delta inside overlapping ranges as "no change" and says so explicitly. A Coveralls-style comment that flaps ±0.1 on every PR trains everyone to ignore it — the noise band is what keeps the signal credible. Smoke-lane results (1 session, directional only) are labeled as smoke and never overwrite milestone rows in the series.

### D7. Anti-gaming and drift

- **The standing question, asked of every PR that adds agent-visible convenience: "does this change what a greenfield agent sees?"** If yes, it takes one of exactly three sanctioned paths: **measured** — run as a `run-evals`-labeled smoke PR (the agent-context quick wins, D3); **stripped** — excluded by the tier builder at tiers where it shouldn't exist (the dogfooding artifacts, D3 and 04's eval-isolation note); or **forbidden** — never committed at all (eval tasks verbatim in skills/docs, below). Silent absorption into the baseline is the one unsanctioned option — it's how a measurement program stops measuring without anyone deciding to stop.
- Tasks and rubrics are versioned. Task changes break the score series (new comparison starts); rubric changes do NOT break it — they trigger a regrade of prior milestone runs instead (D5), so a rubric fix never tempts anyone to keep a broken rubric for continuity's sake.
- The eval tasks must NOT be committed verbatim into skills/docs (that's training on the test set). Spot-check: skill/doc changes that mention eval fixtures by name get flagged in review.
- Add one **held-out variation** per task family per season (same skill, different dataset/geometry) to detect overfitting of the resources to the published tasks.

## Implementation steps

1. Scaffold `evals/` with `run.ts` (Agent SDK session + artifact capture), the T0 environment builder, and two tasks: `author-scatterplot` and `contextualize-operator` (one artifact task, one knowledge task — the two grading paths).
2. Mechanical graders: Playwright load + screenshot check reusing the app's existing Playwright setup; validation via 04's `validateProject()` (interim: schema + handle-lint inline until 04 lands, stamped `validatorVersion: "interim-1"` in frozen mechanical results — its deliberate softenings vs 04's rule set are listed in `evals/README.md`).
3. `judge-prompt.md` + first rubric YAML; `grade.ts` orchestration (3 samples, median, evidence required).
4. **Run the T0 baseline for the two tasks; commit results.** This is the program's "before" photo — do it before any roadmap sub-plan merges.
5. Add the remaining tasks; complete the T0 baseline across all of them; record the noise band; run judge calibration on the T0 transcripts (both maintainers hand-grade, compute per-dimension agreement, anchor/decompose failing dimensions per D4) before any tier comparison is published.
6. Surfacing (D6): the sticky-comment `docs-metrics` job in `test.yml`; `run-evals.yml` with dispatch + label triggers and the delta comment; `evals/results/index.json` series + badge endpoint.
7. Re-run at each roadmap landing (tier unlock) + the matching ablation; `report.ts` longitudinal output linked from this spec directory.

## Verification

1. The T0 baseline's 3 sessions per task establish the per-task noise band (median + range) before any cross-tier claim is made, and the reporter demonstrably classifies within-band deltas as "no change".
2. Judge calibration on the T0 transcripts: both maintainers independently hand-grade against the rubric YAML; per-dimension agreement with the LLM judge is computed; every dimension used in a cross-tier claim clears the agreement threshold (rewritten via anchoring or decomposition if not, per D4).
3. A deliberately broken artifact (invalid handles) scores ≤ 40% regardless of judge output.
4. Judge evidence citations resolve to real transcript/file locations on spot-check.
5. Regrade round-trip: running `grade.ts` over a stored run's artifacts with no session spawned (a) reproduces scores within the judge-sampling noise band under the same rubricVersion, and (b) after a rubricVersion bump, appends `kind: "regrade"` rows for prior milestone runs while leaving their artifacts and mechanical results untouched.

## Dependencies

- None to start — **T0 is defined as the absence of the other sub-plans.** Consumes 04's `validateProject()` when it exists (the composite: 03's registry lint plus 04's runtime checks); tier definitions track each sub-plan's landing.

## Open questions

- Whether to also score cost-normalized quality (score per dollar) once the curve exists.
- ~~Whether `live-drive` can run headlessly pre-WebMCP~~ Resolved by PR #508: the `@mcp-b/webmcp-local-relay` gives a headless-compatible stdio path against a localhost tab (`?externalControl=true` + the relay embed). The WS proxy is no longer the plan.
