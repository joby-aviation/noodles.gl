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
