# CUJ evals

The eval harness specified in
[`dev-docs/specs/agent-ready-docs/07-cuj-evals.md`](../dev-docs/specs/agent-ready-docs/07-cuj-evals.md):
it measures how well a **greenfield LLM session** — fresh workspace, no
conversation history — executes the program's critical user journeys against
whatever resources exist in the repo at a given moment. Phase 0 implements two
tasks (one artifact task, one knowledge task — the two grading paths) and the
T0 baseline. The implementation journal lives at
`dev-docs/specs/agent-ready-docs/journal/2026-07-06-eval-harness-phase0.md`.

## Layout

```
evals/
  tasks/          one file per task: YAML frontmatter (id, tags, budget,
                  grader config) + the verbatim prompt; fixtures/ holds task
                  inputs and answer keys
  rubrics/        per-family rubric YAML (anchors/checklist only — no bare
                  scales) + the versioned judge prompt scaffold
  harness/        run.ts (sessions + Layer-1 mechanical, frozen at run time),
                  grade.ts (judge orchestration + Layer-3 process metrics,
                  re-runnable from stored artifacts), report.ts (scorecard),
                  selftest.ts (token-free checks)
  results/        committed run artifacts (pruned) + index.json series rows
```

`evals/` sits at repo root, outside `noodles-editor` — the harness runs
*against* the repo, not inside the app, and never imports Vite-built code
(plain Node + `tsx` only; the registry comes from the TS-compiler-API parser
in `noodles-editor/scripts/parse-operators.ts`).

## Provider

The season runs on **AWS Bedrock**. Model pins live in
`harness/lib/config.ts` and are recorded verbatim in every results row —
they are `us.`-prefixed cross-region inference-profile ids (raw model ids
404 on invocation): sessions under test `us.anthropic.claude-sonnet-4-6` /
`us.anthropic.claude-sonnet-5` / `us.anthropic.claude-opus-4-8` (the T0
baseline runs all three; cross-tier claims only ever compare within one
session model), judge `us.anthropic.claude-opus-4-8`, small-fast
`us.anthropic.claude-haiku-4-5-20251001-v1:0`.

`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` must be set
(plus `AWS_SESSION_TOKEN` for temporary credentials): the harness fails fast
listing whichever are missing, never prompts, and never falls back to the
Anthropic API. Sessions are spawned through the `claude` CLI with
`CLAUDE_CODE_USE_BEDROCK=1`; judge calls use the classic `AnthropicBedrock`
client from `@anthropic-ai/bedrock-sdk` (the `AnthropicBedrockMantle`
endpoint does not serve the pinned models in this account/region — see the
journal).

## Running

```bash
cd evals && npm install

# token-free self-tests (also Verification item 3's cap check)
npm run selftest

# one milestone task, 3 sessions, one session model
npm run run -- --task author-scatterplot --model anthropic.claude-sonnet-5 \
  --sessions 3 --series 2026-07-06.t0.<commit12>

# grade everything in a series (3 judge samples per run, median)
npm run grade -- --series 2026-07-06.t0.<commit12>

# regrade after a rubricVersion bump (appends kind: "regrade" rows;
# artifacts and frozen mechanical results are never touched)
npm run grade -- --series 2026-07-06.t0.<commit12> --regrade

# scorecard: median [range] per task per session model
npm run report
```

Workspaces are built under `/tmp/noodles-evals` (override: `EVALS_WORK_ROOT`)
from a `git archive origin/main` extraction — no `.git`, so a session can't
reach other branches — with the dogfooding artifacts stripped defensively
(`evals/`, `dev-docs/specs/agent-ready-docs/`, `skills/`, `.claude/skills`,
AGENTS.md skill-pointer lines; 07 D7 / 04's eval-isolation note). A post-run
isolation audit scans every tool call for the harness checkout, the spec dir,
or `evals/`, and its verdict is recorded in the results row. The first run
builds an installed template workspace (one `npm install`); later runs copy it
(hardlinked `node_modules`).

## Grading (three layers, strictly ordered)

1. **Mechanical** (run time, frozen, `validatorVersion: interim-1`): interim
   `validateProject()` — schema + registry handle-lint inline until 04's
   composite CLI exists — plus Playwright load (no console errors), non-blank
   screenshot (pixel variance), required node types; knowledge tasks: answers
   file parses + deterministic matcher accuracy. **A mechanical failure caps
   the run's total at 40%.**
2. **Rubric LLM judge** (grade time, re-runnable): 3 independent samples,
   median per dimension, weights from the rubric YAML, evidence citation
   required per score and machine-checked to resolve (`L<n>` /
   `file:line`). The judge never sees the tier or session model.
3. **Process metrics** (counted, not judged): hallucinated handle names vs the
   registry snapshot, lookup-preceded-edge ratio, identical-lookup repetition,
   tool-error counts.

### Interim-validator notes (deviations 04's real validator should revisit)

- The canonical edge-id formula is a **warning**, not an error: committed,
  working examples (`custom-maplibre-layer-test`) carry non-canonical ids and
  the app loads them fine.
- Operators whose `createInputs`/`createOutputs` use object spreads
  (`...createBaseViewFields()`) get no field-level lint on that side (the
  static parser can't resolve spreads); the type check still applies.
- Console errors matching tile/CDN fetch noise are ignored — the eval
  container's egress policy can block basemap hosts on any project, including
  known-good ones.

### Layer-3 approximations (documented per "count what's countable")

- A "schema lookup for operator type X" at T0 is any prior Read/Grep/Glob/Bash
  tool call whose input mentions `X` or `operators.ts` (there is no richer
  lookup surface below T3).
- The "edge written" point is the last Write/Edit call (per-edge write indices
  aren't recoverable from whole-file writes).

## Results

`results/index.json` holds one row per grading event (07 D6 + phase-0
amendments): `{rowId, series, runId, artifactsRef, commit, tier, taskId,
taskVersion, validatorVersion, kind: fresh|regrade, regradeOf?, gradedAt,
rubricVersion, judgeModel, sessionModel, provider, region, isolationAudit,
scores: {mechanical, judge, total, process}, cost, lane}`. Run directories are
pruned to transcript (`.jsonl` + judge-facing `.txt`), final artifact files,
one screenshot, and the frozen `mechanical.json`/`session-meta.json`;
`registry.json` is stored once per series.

The **total** on the 0–4 scale is an equal blend of the mechanical and judge
components, then the Layer-1 cap. The scorecard always shows the components
next to it; the blend is a phase-0 definition and calibration (step 5) may
revisit it.

Deferred to step 5: judge calibration (both maintainers hand-grade the T0
transcripts; ≥80% exact+adjacent agreement per dimension) and the
regrade-after-rubric-bump round-trip. Until calibration passes, treat judge
components as uncalibrated instrument readings.
