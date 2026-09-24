// Provider + season configuration. Everything the season pins lives here so a
// provider decision touches exactly one file. Recorded verbatim in every
// results row (07 D6 + the phase-0 amendments: sessionModel/provider/region).

import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Season 2 measures multiple providers. Provider is derived per model id
// (see providerFor): us.anthropic.* runs the claude CLI against Bedrock;
// gpt-* runs the OpenAI Codex CLI (codex exec) against the OpenAI API;
// local/* runs codex exec against an OpenAI-compatible local server
// (openclaw) at OPENCLAW_BASE_URL — the part after the slash is the server's
// model name (e.g. local/qwen3-coder).
export type Provider = 'bedrock' | 'openai' | 'local'

export function providerFor(model: string): Provider {
  if (model.startsWith('us.anthropic.')) return 'bedrock'
  if (model.startsWith('gpt-')) return 'openai'
  if (model.startsWith('local/')) return 'local'
  throw new Error(`no provider mapping for model id "${model}"`)
}

// Pinned model ids — recorded verbatim in results rows. Anthropic entries are
// us.-prefixed cross-region inference profile IDs: raw model IDs appear in
// ListFoundationModels but invocation 404s without the profile prefix. The
// haiku profile only exists in dated form (there is no undated
// us.anthropic.claude-haiku-4-5 in ListInferenceProfiles). OpenAI entries are
// the GPT-5.6 family (released 2026-07-09): sol (flagship), terra (mid),
// luna (fast).
export const SESSION_MODELS = [
  'us.anthropic.claude-sonnet-4-6',
  'us.anthropic.claude-sonnet-5',
  'us.anthropic.claude-opus-4-8',
  'us.anthropic.claude-fable-5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const
export const JUDGE_MODEL = 'us.anthropic.claude-opus-4-8'
export const SMALL_FAST_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'

// Codex exec reports token usage but not dollars; cost is computed from the
// published GPT-5.6 API prices (USD per million tokens, 2026-07-09 launch).
export const OPENAI_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'gpt-5.6-sol': { input: 5, output: 30 },
  'gpt-5.6-terra': { input: 2.5, output: 15 },
  'gpt-5.6-luna': { input: 1, output: 6 },
}

export const TIER = 'T0'

// The season currently being measured. archive-season refuses to archive it
// without --force: an open season's regrades require its artifacts in-tree.
// Season 1 closes when the curve is complete (T1-T5 milestones + ablations
// graded, calibration settled, rubric-bump regrades applied) or on a forced
// re-pin — see evals/README.md "Storage & retention".
export const CURRENT_SERIES = '2026-08-18.t0.c62c28c99a5d'

// The measured app surface for this season. #514/#515/#516 squash-merged to
// main on 2026-08-18 (their branches are deleted), so the season measures
// origin/main again — code-refs@2's required fixes are in it. The sha12 in
// CURRENT_SERIES names this ref's commit at pin time (main@c62c28c).
// EVALS_WORKSPACE_REF still overrides for ad-hoc runs.
export const MEASURED_REF = 'origin/main'
// interim-2 added the container-bridge exemption to the handle-prefix rules
// (app-generated ContainerOp bridge edges). interim-3 makes the unknown-input
// check aware of promoted parameters (node.data.customInputs declares dynamic
// input names). Runs graded under earlier versions keep their frozen results —
// per 07 D5, mechanical scores across a series may come from different
// validator versions, and the rows record which.
export const VALIDATOR_VERSION = 'interim-3'
export const JUDGE_SAMPLES = 3

const REQUIRED_ENV: Record<Provider, readonly string[]> = {
  bedrock: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
  openai: ['OPENAI_API_KEY'],
  local: ['OPENCLAW_BASE_URL'],
}

// Fail fast, list what's missing, never prompt, never fall back to another
// provider (provider directive, journal 2026-07-06). With a model given
// (run.ts) only that session provider's env is required — a local/openclaw
// run must not demand AWS credentials. Without one (grade.ts, judging) the
// judge's Bedrock env is required.
export function assertProviderEnv(model?: string): void {
  const providers: Provider[] = model ? [providerFor(model)] : ['bedrock']
  const missing = providers.flatMap(p => REQUIRED_ENV[p].filter(name => !process.env[name]))
  if (missing.length > 0) {
    throw new Error(
      `Provider requires environment variables that are not set: ${missing.join(', ')}. ` +
        'Set them and re-run; the harness does not fall back to another provider.'
    )
  }
  // Temporary AWS credentials advertise their expiry — fail here with a clear
  // message instead of letting every spawned session die with the SDK's
  // "Could not load credentials from any providers" (cost of learning this
  // the hard way: one dead smoke run, 2026-08-18).
  if (!providers.includes('bedrock')) return
  const exp = process.env.AWS_CREDENTIAL_EXPIRATION
  if (exp && !Number.isNaN(Date.parse(exp)) && Date.parse(exp) <= Date.now()) {
    throw new Error(
      `AWS session credentials expired at ${exp}. Refresh AWS_ACCESS_KEY_ID/` +
        'AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN (and AWS_CREDENTIAL_EXPIRATION) and re-run.'
    )
  }
}

// Base environment for any spawned greenfield session: start clean of the
// parent harness's Claude/OpenAI state. Network/proxy and system vars pass
// through.
function baseSessionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k.startsWith('CLAUDE_') || k.startsWith('ANTHROPIC_') || k.startsWith('OPENAI_') || k.startsWith('CODEX_')) continue
    env[k] = v
  }
  return env
}

// Claude CLI sessions: add only what Bedrock needs.
export function sessionEnv(): Record<string, string> {
  const env = baseSessionEnv()
  env.CLAUDE_CODE_USE_BEDROCK = '1'
  env.ANTHROPIC_SMALL_FAST_MODEL = SMALL_FAST_MODEL
  env.DISABLE_AUTOUPDATER = '1'
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  // The eval container runs as root; the CLI refuses --dangerously-skip-
  // permissions as root unless it knows it's inside a sandbox.
  env.IS_SANDBOX = '1'
  return env
}

// Codex CLI sessions: add only the API key. codex exec reads CODEX_API_KEY
// (its non-interactive auth path); the harness's user-facing variable stays
// OPENAI_API_KEY, mapped here. local/openclaw sessions authenticate with
// OPENCLAW_API_KEY only if the local server wants one.
export function codexSessionEnv(provider: 'openai' | 'local' = 'openai'): Record<string, string> {
  const env = baseSessionEnv()
  if (provider === 'local') {
    if (process.env.OPENCLAW_API_KEY) env.OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY
    return env
  }
  const key = process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY
  if (key) env.CODEX_API_KEY = key
  return env
}

const here = path.dirname(fileURLToPath(import.meta.url))
export const EVALS_ROOT = path.resolve(here, '..', '..')
export const REPO_ROOT = path.resolve(EVALS_ROOT, '..')
export const RESULTS_ROOT = path.join(EVALS_ROOT, 'results')
export const TASKS_ROOT = path.join(EVALS_ROOT, 'tasks')
export const RUBRICS_ROOT = path.join(EVALS_ROOT, 'rubrics')

// Workspaces live outside the repo: greenfield sessions must never see the
// harness checkout (07 D7 first bullet).
export const WORK_ROOT = process.env.EVALS_WORK_ROOT ?? '/tmp/noodles-evals'
