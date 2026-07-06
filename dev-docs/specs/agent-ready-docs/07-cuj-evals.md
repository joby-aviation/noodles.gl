# Sub-plan 07: CUJ Eval Harness

A system of rubrics and graders that measures how well a **greenfield LLM session** — fresh container, no conversation history — executes the program's critical user journeys against whatever resources exist in the repo at that moment. Run it today to establish the baseline; re-run and regrade after every roadmap landing. The output is the program's success metric: a longitudinal score per CUJ that should climb as sub-plans 01–06 land — and an attribution of *which* investment moved it.

## Goals

- Executable eval tasks derived from the roadmap CUJs, runnable headlessly.
- Layered grading: mechanical checks first (does it validate/load/render), rubric-based LLM judging second (did it work *well*), process metrics throughout (did it guess or look things up).
- A baseline run against today's repo, then a regrade at each roadmap milestone, with results versioned in the repo so the curve is inspectable.
- Attribution: resource tiers and ablations so "the MCP server improved SQL-pipeline success by X" is a measurement, not a vibe.

## Non-goals

- Per-PR CI gating (too slow/expensive; this runs on demand and at milestones).
- Benchmarking models against each other — the variable under test is the **resources**, so the model and prompt scaffold stay pinned per eval season.
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
    authoring.yaml        # shared rubric dimensions + weights per task family
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

Each task file contains: the user prompt (verbatim, realistic), input data (or a pointer into `src/examples/`), what the agent may use at each tier, time/turn budget, and grader configuration. Initial set:

| Task | CUJ | Prompt sketch | Key mechanical checks |
|---|---|---|---|
| `author-scatterplot` | 3 | "Plot California earthquakes as a scatterplot sized by magnitude" + the CSV | file validates; loads in app; screenshot non-blank; ScatterplotLayerOp + basemap + renderer present |
| `modify-arcs` | 3 | "Make the arcs in this project red and 2× thicker" + `uk-commute` | validates; `timeline`/`viewport`/unknown keys byte-identical; edit hit the correct upstream node |
| `debug-blank-viz` | 3 | A seeded-broken project (disconnected renderer + bad accessor) + "why is this blank?" | both defects identified; fix validates and renders |
| `sql-h3-pipeline` | 3 | "Aggregate these points into H3 hexagons colored by count, using SQL" | validates; DuckDbOp + H3HexagonLayerOp wired; renders |
| `contextualize-operator` | 2 | 10 factual questions with ground-truth answers ("what are TripsLayer's inputs and defaults?", "what does `sizeUnits: 'common'` mean?", "what changed about MapStyleOp?") | answer accuracy vs answer key |
| `animate-camera` | 3/4 | "Animate the camera from SF to LA over 5 seconds" | valid keyframes present (direct `timeline` JSON edits are a legitimate path); track paths resolve; keyframes sorted, ids unique; animation scrubs in the app |
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
| T5 | + live app with unified tools / WebMCP | 05 landed |

Tiers are enforced by environment construction, not by asking the agent to abstain: T0–T2 get no MCP config and no `skills/` directory (the runner strips them from the checkout as needed); T3+ get the pieces added. **Ablation mode** runs a tier with exactly one resource removed (e.g. T4 minus skills) to attribute improvements to a specific investment rather than to everything-so-far.

### D4. Grading: three layers, strictly ordered

**Layer 1 — mechanical (objective, cheap, runs first).** Per task: `validateProject()` (04's CLI), project loads in the app under Playwright without console errors, screenshot is non-blank (pixel-variance threshold) and — where a task defines one — perceptually similar to a golden reference; required node types present; forbidden actions absent (hand-bumped `version`, malformed timeline edits: unsorted keyframes, dangling marker connections, unresolvable track paths). **A mechanical failure caps the task score at 40%** — a beautiful transcript that produced an invalid file is a failure with good manners.

**Layer 2 — rubric LLM judge (subjective, structured).** Rubric dimensions, weighted per task family (weights in the YAML, not the judge's discretion):

- *Correctness of result* — does the artifact do what was asked (beyond mechanically valid)?
- *Tool-use discipline* — did the session **look up** schemas/handles before writing edges, or guess? (Scored from the transcript: every edge written should be preceded by a schema lookup at tiers where one is available; at T0, by reading `operators.ts`.)
- *Edit hygiene* — smallest change that satisfies the request; preserved what it didn't understand; recomputed edge ids.
- *Graph design conformance* — the AGENTS.md/skill rules: 5–8 nodes, CodeOp consolidation, descriptive names, standard pipeline shape.
- *Efficiency* — turns, tokens, wall-clock, dead ends (informational weight at first; don't optimize agents into recklessness).
- *Honesty* — did the final answer claim things the artifacts contradict?

Judge mechanics: the judge receives the task, rubric, artifacts, and transcript; scores each dimension 0–4 **with a cited quote/line per score**; three independent judge samples, median taken; judge model and prompt pinned per season and recorded in results. Judges never see the tier label (blind to the hypothesis).

**Judge calibration (before any cross-tier claim).** An LLM judge is itself an instrument that needs calibrating, and the T0 baseline transcripts are the calibration set: both maintainers independently hand-grade them against the same rubric YAML — blind to each other's scores and to the judge's — then per-dimension agreement between the human consensus and the LLM judge is computed (with the 0–4 scale, exact + adjacent agreement is enough; no need for anything fancier at this sample size). Any dimension below the agreement threshold is not trusted as-is: rewrite it by **anchoring** (add concrete per-score exemplars to the rubric — "a 2 on tool-use discipline looks like this transcript excerpt") or **decomposing** (split a mushy dimension like "correctness of result" into narrower yes/no sub-questions), then re-run the judge on the same transcripts until agreement clears the bar. Calibration results (per-dimension agreement, threshold, rubric revisions made) are recorded alongside the series; cross-tier claims may only cite dimensions that passed. Where the two humans disagree with *each other* beyond the threshold, the dimension is underspecified for humans too — that's a rubric bug, not a judge bug, and it gets the same anchoring treatment.

**Layer 3 — process metrics (counted, not judged).** Hallucinated field/handle names per run (extractable: every `out.X`/`par.X` written, checked against the registry), validation-failure→retry cycles, lookups performed vs available. These are the diagnostic layer: when T3 beats T0, these say *why*.

### D5. Runner

`harness/run.ts` drives greenfield sessions via the Claude Agent SDK (headless), one fresh workspace per task per tier: construct the tier environment (checkout + strip/add resources + start dev server for tasks that need loading), inject the task prompt, capture everything, hand off to `grade.ts`. Sessions get a hard budget (turns + wall-clock) so a lost agent registers as a low score rather than a hung run. Cost note: the full matrix is ~7 tasks × 3 judge samples + sessions ≈ tens of dollars per season — fine at milestone cadence, which is exactly why this isn't per-PR CI.

`report.ts` emits the scorecard: per-task and aggregate scores at each tier over time — the **docs ROI curve** — plus the process-metric deltas. Results directories are committed (artifacts pruned to transcript + final files + one screenshot).

### D6. Longitudinal tracking and PR surfacing (the Coveralls model)

Two speeds, because the two signals have wildly different costs:

**Fast lane — deterministic docs metrics, every PR.** No agent sessions required: docs Remarks coverage (N/M from the 01 index counter), prose-staleness queue length, skill/schema drift status are all computable in seconds from the checkout. A `docs-metrics` job in `test.yml` computes them and a GitHub Action posts/updates a **sticky PR comment** (upsert by marker, exactly like Coveralls):

> **Docs metrics** · Remarks coverage: 16/130 (**+2**) · stale-prose queue: 7 (−1) · drift checks: ✅

This is the per-PR heartbeat. It costs nothing and makes documentation-regressing PRs visible at review time.

**Slow lane — eval grades, on demand + milestones.** Full greenfield eval runs stay off the per-PR path (cost, latency, variance). A `run-evals.yml` workflow with two triggers:

- `workflow_dispatch` with tier/task inputs — the milestone run.
- A PR **label** (`run-evals`) — runs a **smoke subset** (2 designated tasks, 1 judge sample instead of 3) against the PR's checkout, for PRs that plausibly move the needle (skills, reference pages, MCP server, prompts).

Either way the workflow appends a machine-readable row to the series and comments the delta on the PR/commit:

> **CUJ evals (smoke, T4)** · author-scatterplot: 3.1 → **3.4** · contextualize-operator: 2.2 → **2.6** · vs baseline `evals/results/index.json@main` · [full artifacts](link)

**Series storage.** Every run appends to `evals/results/index.json` — one row per run: `{date, commit, tier, taskVersion, rubricVersion, model, scores: {task: {mechanical, judge, process}}, cost}`. The row is the unit of tracking; the per-run directories hold the evidence. `report.ts` renders the series as the longitudinal table/chart, and a tiny endpoint JSON (`website/static/evals/latest.json`) feeds a shields.io badge in the README — the outward-facing Coveralls number.

**Noise discipline.** Verification step 1 measures run-to-run variance at T0; the reporter treats any delta inside that band as "no change" and says so explicitly. A Coveralls-style comment that flaps ±0.1 on every PR trains everyone to ignore it — the noise band is what keeps the signal credible. Smoke-lane results are labeled as smoke and never overwrite milestone rows in the series.

### D7. Anti-gaming and drift

- Tasks and rubrics are versioned; score series break on task changes.
- The eval tasks must NOT be committed verbatim into skills/docs (that's training on the test set). Spot-check: skill/doc changes that mention eval fixtures by name get flagged in review.
- Add one **held-out variation** per task family per season (same skill, different dataset/geometry) to detect overfitting of the resources to the published tasks.

## Implementation steps

1. Scaffold `evals/` with `run.ts` (Agent SDK session + artifact capture), the T0 environment builder, and two tasks: `author-scatterplot` and `contextualize-operator` (one artifact task, one knowledge task — the two grading paths).
2. Mechanical graders: Playwright load + screenshot check reusing the app's existing Playwright setup; validation via 04's `validateProject()` (interim: schema + handle-lint inline until 04 lands).
3. `judge-prompt.md` + first rubric YAML; `grade.ts` orchestration (3 samples, median, evidence required).
4. **Run the T0 baseline for the two tasks; commit results.** This is the program's "before" photo — do it before any roadmap sub-plan merges.
5. Add the remaining tasks; complete the T0 baseline across all of them; record the noise band.
6. Surfacing (D6): the sticky-comment `docs-metrics` job in `test.yml`; `run-evals.yml` with dispatch + label triggers and the delta comment; `evals/results/index.json` series + badge endpoint.
7. Re-run at each roadmap landing (tier unlock) + the matching ablation; `report.ts` longitudinal output linked from this spec directory.

## Verification

1. Two T0 baseline runs on the same commit produce scores within noise of each other (run-to-run variance is known before any cross-tier claim is made).
2. Judge calibration on the T0 transcripts: both maintainers independently hand-grade against the rubric YAML; per-dimension agreement with the LLM judge is computed; every dimension used in a cross-tier claim clears the agreement threshold (rewritten via anchoring or decomposition if not, per D4).
3. A deliberately broken artifact (invalid handles) scores ≤ 40% regardless of judge output.
4. Judge evidence citations resolve to real transcript/file locations on spot-check.

## Dependencies

- None to start — **T0 is defined as the absence of the other sub-plans.** Consumes 04's `validateProject()` when it exists; tier definitions track each sub-plan's landing.

## Open questions

- Whether to also score cost-normalized quality (score per dollar) once the curve exists.
- Whether `live-drive` can run headlessly pre-WebMCP via the WS bridge (likely yes with `?externalControl=true` + the proxy), or waits for 05.
