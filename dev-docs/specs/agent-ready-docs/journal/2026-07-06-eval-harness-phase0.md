# Developer journal — eval harness phase 0 (07 steps 1–4)

Implementation journal for the CUJ eval harness, per `../07-cuj-evals.md`. Dated entries record
intent before the work and deviations as they're discovered. This directory is part of
`dev-docs/specs/agent-ready-docs/`, which the eval workspace builder strips — greenfield sessions
never see it.

## 2026-07-06 — intent, scope, and locked decisions

Implementing spec steps 1–4 on `claude/eval-harness-phase0-c8wgcm` (based on the spec branch,
stacks on #507): scaffold `evals/`, runner + mechanical graders + judge orchestration for
`author-scatterplot` and `contextualize-operator`, then the T0 baseline, committed.

**Provider (decided at plan review): AWS Bedrock, region `us-east-1`.**
- Sessions under test run via the `claude` CLI with `CLAUDE_CODE_USE_BEDROCK=1`;
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION` must be present — the harness fails
  fast listing missing vars and never falls back to the Anthropic API.
- The T0 baseline runs under **three pinned session models** — `anthropic.claude-sonnet-4-6`,
  `anthropic.claude-sonnet-5`, `anthropic.claude-opus-4-8` — 3 sessions per task per model
  (18 sessions). Cross-tier claims will only ever compare within one session model; the spec's
  model-benchmarking non-goal stands.
- Judge: `anthropic.claude-opus-4-8` via `@anthropic-ai/bedrock-sdk`, 3 samples per run, median.
  `ANTHROPIC_SMALL_FAST_MODEL=anthropic.claude-haiku-4-5` for sessions.
- Pre-flight smoke-calls every pinned model before any real run; unavailable model ⇒ stop and
  report, no substitution.

**Spec amendments this PR makes (deviation → update spec + call out):**
1. D6 row schema gains `sessionModel`, `provider`, `region` (Requirement 4 already demanded the
   model id; the written schema only carried `judgeModel`).
2. Interim validator note: until 04's `validateProject()` exists, Layer 1 uses an inline
   schema + handle-lint stamped `validatorVersion: "interim-1"` (already sanctioned by step 2).
3. D2 gains a containers/references authoring task (CodeOp transform + `op()` reference +
   ContainerOp grouping) slated for step 5 — coverage gap flagged at plan review: no task touched
   containers, none required writing reactive references.

**Isolation design (07 D7 first bullet):** workspaces are `git archive origin/main` extractions
(no `.git`, so no path to the spec branch), with `evals/`, `dev-docs/specs/agent-ready-docs/`,
`skills/`, `.claude/skills`, and AGENTS.md skill-pointer lines stripped defensively (none exist
on main today; the strip list is 04's eval-isolation note in action). A fresh `git init` commit
makes git usable inside the workspace. Post-run, an isolation audit scans the transcript for any
tool call touching the harness checkout, `evals/`, or the spec dir; the result is recorded per run.

**Budgets (D5):** author-scatterplot 40 turns / 25 min; contextualize-operator 30 turns / 20 min.
Enforced by `--max-turns` + process timeout; a timeout grades as-is (low score, not a hung run).

**Fixtures:** `author-scatterplot` gets a ~2k-row subsample of the california-earthquakes CSV,
dropped at `noodles-editor/src/examples/quake-magnitude-viz/data.csv` in the workspace. The
existing `california-earthquakes` example stays — it's a legitimate T0 resource (repo-as-is).
`contextualize-operator` gets 25–30 questions across the four spec kinds; the format-invariants
set includes reference-syntax and container-path questions to partially cover the gap above.

**Grading split (D5 regrade semantics):** `run.ts` performs Layer 1 (mechanical) at run time and
freezes the results with the validator version; `grade.ts` consumes stored artifacts only and can
be re-run without spawning sessions or the app.

Deferred to step 5 (and said so in the PR): judge calibration (Verification item 2) and the
regrade-after-rubric-bump round-trip (item 5b).

## 2026-07-06 — pre-flight result: Bedrock unavailable in this container (blocker for the baseline)

The pre-flight failed before any real run, exactly as designed. Evidence:
- `claude -p --model anthropic.claude-*` with `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_REGION=us-east-1`
  → authentication error for all three session models.
- Direct SigV4 calls (bypassing the CLI) to `bedrock-runtime.us-east-1.amazonaws.com`
  `/model/anthropic.claude-haiku-4-5/converse` and to STS `GetCallerIdentity`
  → HTTP 403 `InvalidClientTokenId` from AWS itself.
- Root cause: the container's `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are 14-char proxy
  placeholders (`prox…`), not real credentials, and the egress proxy does not re-sign AWS
  requests. `AWS_REGION` and `AWS_SESSION_TOKEN` are unset.

Per the provider directive (fail fast, list what's missing, no fallback to the Anthropic API,
no silent substitution): the T0 baseline run is **blocked on real AWS credentials** (key id,
secret, region — plus session token if temporary). Harness construction continues — nothing
below requires a model call until the dry-run session — and the provider config is centralized
in one module (`harness/lib/config.ts`) so a provider decision only touches one place.

One directive detail confirmed rather than deviated: `AnthropicBedrockMantle` does exist as a
named export of `@anthropic-ai/bedrock-sdk@0.32.0` — the judge client uses it as specified.

## 2026-07-06 — interim-validator softenings found by self-testing against committed examples

Running `validateProject()` (interim-1) over every example project on main surfaced two places
where the rule set as written in 03/04 flunks real, working data. Both are deliberate,
documented softenings of interim-1 (listed in `evals/README.md`; 04's composite validator owns
re-escalating them):

1. **Canonical edge-id formula → warning.** `custom-maplibre-layer-test` carries edge ids
   without handle prefixes (`/a.maplibre->/b.basemap`) and the app loads it fine — the app only
   needs ids unique. Failing Layer 1 on a formatting nit the app tolerates would mis-measure
   "does it validate/load".
2. **Spread-built field sets get no field-level lint.** Operators like OrbitViewOp build
   `createInputs()` with `...createBaseViewFields()`; the TS-compiler-API parser
   (`scripts/parse-operators.ts`) drops spreads silently, so those schemas are marked "open"
   in the harness registry and unknown-input/unknown-field checks are skipped for that side —
   otherwise the validator flags real inputs (`clear`, `clearColor`) as unknown. The type-level
   check still applies. (Upstream fix belongs to 01/03's generator work, which will resolve
   spreads properly.)

Also noted for 04: the spec'd `kf_*`/`tm_*` id prefixes don't match real data — keyframe ids in
committed projects are random base62 (`xHJJWLB41a`); interim-1 checks uniqueness + sort order,
not prefix shape.

## 2026-07-06 — credentials arrived; pre-flight green after two model-routing discoveries

The maintainer supplied temporary STS credentials (region **us-west-2**, superseding the earlier
us-east-1 choice; expiry 17:00Z). Pre-flight results, in order:

1. **Model ids must be `us.`-prefixed inference-profile ids.** Raw ids
   (`anthropic.claude-opus-4-8`) appear in ListFoundationModels but 404 on invocation;
   ListInferenceProfiles shows the ACTIVE profiles. Pins are now
   `us.anthropic.claude-sonnet-4-6` / `us.anthropic.claude-sonnet-5` /
   `us.anthropic.claude-opus-4-8` (sessions), `us.anthropic.claude-opus-4-8` (judge), and
   `us.anthropic.claude-haiku-4-5-20251001-v1:0` (small-fast — the haiku profile only exists in
   dated form). Recorded verbatim in results rows, as the amended D6 requires.
2. **`AnthropicBedrockMantle` cannot serve the pinned models here** — its endpoint
   (`bedrock-mantle.us-west-2.api.aws/anthropic`) returns 404 "model does not exist" for every
   naming form of the pins (raw, `us.`-prefixed, bare), and a persistent 500 for
   `anthropic.claude-haiku-4-5`. The classic `AnthropicBedrock` client (bedrock-runtime
   InvokeModel) serves all four pinned models. **Deviation from the provider directive**: judge
   calls use `AnthropicBedrock` instead of `AnthropicBedrockMantle` — same `messages.create`
   surface, same SigV4 credentials, verified working; reported to the maintainer rather than
   substituted silently.
3. The claude CLI on Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`) answers with all three session-model
   profiles. The parent container's Claude Code env vars (`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`,
   `ANTHROPIC_BASE_URL`) must not leak into sessions — `sessionEnv()` already strips all
   `CLAUDE_*`/`ANTHROPIC_*` vars, which the pre-flight confirmed is required, not just hygiene.

Pipeline smoke (no agent) also passed: template + workspace build, vite + Playwright load of
`california-earthquakes`, non-blank screenshot (pixel stddev 31). It surfaced that the egress
policy blocks more than basemap tiles (duckdb WASM extension host), so the console-error filter
is now URL-aware: an error is environment noise iff every URL it mentions is non-localhost — a
failing localhost fetch (missing data.csv) still counts against the project.

## 2026-07-06 — baseline observations (instrument notes, not score commentary)

- The dry-run session hit `--dangerously-skip-permissions cannot be used with root` — the eval
  container runs as root, so `sessionEnv()` sets `IS_SANDBOX=1`. Two grader false-positive
  classes were fixed and self-tested before the baseline: the isolation audit flagged the
  session's own workspace (`/tmp/noodles-evals/...` matches an `evals/` pattern — workspace
  paths are masked before matching), and egress-blocked console errors carry either no URL or
  localhost stack frames (filter now strips frames, checks `msg.location()`, and treats
  tunnel/proxy errors as environment noise).
- **`screenshotNonBlank` is a weak check as implemented**: the capture is the whole app page,
  and the node-editor UI alone provides pixel variance, so a broken viz can still pass it. In
  the first baseline lane the console-error check did the real detection (FileOp left at
  `format: json` for a CSV → runtime error; also one hallucinated `radiusMinPixels` input
  caught by the schema lint). Tightening the capture to the deck canvas element is queued for
  the next validatorVersion — not changed mid-series.
- **Budget-capped sessions are real T0 signal, kept as scored**: two of three
  `contextualize-operator` sessions on sonnet-5 ended `error_max_turns` at the pinned 30-turn
  budget without writing `answers.json` (mechanical 0, capped) — the model spent its budget
  verifying thoroughly rather than answering. sonnet-4-6 (22–34 turns) and opus-4-8 (25–29)
  fit. D5 pins budgets precisely so this registers as a low score, and lighter lookups at
  higher tiers are expected to move exactly this number. Also noted: the CLI's reported
  `num_turns` can exceed `--max-turns` by one (31 vs 30) — counting nuance, recorded as-is.

## 2026-07-06 — T0 findings: where the headroom is, and what the ceilings mean

Steps 1–4 are complete with this entry (scaffold → mechanical graders → judge orchestration →
committed T0 baseline for the two phase-0 tasks). Step 5 — the remaining five tasks, the full
T0 baseline across them, and judge calibration — is the next unit of work, and it must finish
**before the first cross-tier claim is published** (D4 makes calibration a precondition; the
practical deadline is the first tier-unlock milestone run, i.e. before 01's landing gets a T1
comparison).

Reading the baseline (scorecard in `evals/results/2026-07-06.t0.83ff1c128a7a/scorecard.md`):

1. **Score headroom lives in the failing cells, and both failures are the program's target
   failure classes.** sonnet-4-6 authoring (1.60): all three sessions left FileOp's `format`
   at its `json` default for a CSV — a guessed default instead of a checked one — and one
   hallucinated `radiusMinPixels` from deck.gl memory (caught by the handle-lint). sonnet-5
   knowledge (1.23): two of three sessions spent the 30-turn budget verifying in an 8k-line
   `operators.ts` and never wrote `answers.json`. Reference pages (01), the machine-readable
   surface (02), and MCP lookups (03) are hypothesized to move exactly these two numbers.

2. **Saturated cells (opus at 4.00 on both tasks) still carry measurable improvement — on the
   efficiency axis, not the score axis.** A 4.00 at T0 costs opus ~26 turns / ~22 lookups /
   ~$1.12 per authoring session, most of it grepping `operators.ts` for field schemas. If a
   tier landing keeps the score at 4.00 but halves turns/lookups/cost, that is a real,
   reportable gain — so the scorecard now carries per-cell medians for turns, lookups, and
   session cost alongside the scores (report.ts change, same rubric/validator, no regrade
   needed — these are Layer-3/meta facts already frozen per run). The spec's open question on
   cost-normalized quality (score per dollar) becomes answerable the moment there are two
   tiers to compare.

3. **The efficiency columns also explain the failures.** sonnet-4-6's failed authoring runs
   took 9 turns / 7 lookups — fast, cheap, and wrong — against opus's 26/22 slow-and-right.
   The lookup deficit *is* the tool-use-discipline story the rubric and Layer 3 exist to
   catch; at higher tiers the bet is that being right stops requiring being slow.

4. **"Too easy?" — split verdict, revisit at step 5.** author-scatterplot is easy *for opus*
   but flunked a current mid-tier model on a real schema gap; the step-5 tasks
   (debug-blank-viz, sql-h3-pipeline, animate-camera, code-refs-containers) are structurally
   harder and should pull opus off the ceiling. contextualize-operator's high scores are
   working-as-intended (the questions are deliberately lookup-verifiable; the pressure is the
   budget), and its judge 4.00s are provisional until calibration — anchored judges are known
   to be generous at the top, and a calibration-driven anchor sharpening would regrade the
   whole series forward (D5). If opus still pins 4.00 across all seven tasks after step 5,
   *that* is the "tasks too easy" verdict, answered with harder task versions (explicit
   taskVersion bumps, new comparison series per D7).

## 2026-07-06 — step-5 harness half complete: full 7-task T0 baseline

The five remaining tasks landed (with custom Layer-1 checks, seeded/golden fixtures, and
polarity self-tests) and the 45-session baseline ran and graded clean — 63 total T0 runs in the
series, ~$53 of session cost, every isolation audit passing. Scorecard:
`evals/results/2026-07-06.t0.83ff1c128a7a/scorecard.md`. What the new tasks measured:

- **The difficulty gradient the phase-0 pair lacked now exists.** Ceilings: `animate-camera`
  (4.00 everywhere — every model found cesium-hubble and imitated its tracks; keyframe
  authoring is not a T0 gap) and `modify-arcs` (3.85–4.00 — every model dodged the shared-
  ColorOp trap). Mid: `author-scatterplot`, `debug-blank-viz`, `contextualize-operator`
  (model-separating). Floors: `sql-h3-pipeline` (0.30–0.47, all models) and
  `code-refs-containers` (1.10–1.60 median, one lone 4.00).
- **Research-until-death is the dominant T0 failure mode on unverifiable tasks.** All nine
  sql-h3 sessions — opus included — exhausted their budgets (turn cap, or for opus on
  code-refs the 25-minute wall clock) without writing ANY artifact: no model falls back to
  best-effort authoring when it can't verify. The mechanical checks only require coherent
  wiring, so the task is completable by an agent that knows the pattern — docs/MCP teaching
  the pattern is precisely the intervention these cells measure.
- **Opus inverted on code-refs-containers** (all three sessions failed at ~$2.2 each, while a
  sonnet-4-6 session that "winged it" scored the only 4.00) — thoroughness becomes a liability
  when the resources can't answer the question being researched.
- `debug-blank-viz`'s two-defect design worked: weaker sessions consistently found the accessor
  bug and shipped without noticing the disconnected renderer; opus found both, 3/3.
- One transient judge-output parse failure across 190+ judge samples; the retry graded clean.

Calibration: worksheets now cover all 63 runs (`c01`–`c63`); the shared 12-sheet sample
(stratified across rubric families, tasks, models, and pass/fail outcomes) is published in
`evals/calibration/README.md` — codes only, so the outcome stratification doesn't leak run
identities. Remaining step-5 work is the human half: both maintainers grade the shared sample,
then `calibrate.ts --agreement` decides which dimensions are trusted (and item 5b's
regrade-after-bump follows if any anchor gets sharpened).
