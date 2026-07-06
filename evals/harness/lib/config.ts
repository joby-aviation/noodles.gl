// Provider + season configuration. Everything the season pins lives here so a
// provider decision touches exactly one file. Recorded verbatim in every
// results row (07 D6 + the phase-0 amendments: sessionModel/provider/region).

import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROVIDER = 'bedrock' as const

// Pinned Bedrock model ids — recorded verbatim in results rows.
export const SESSION_MODELS = [
  'anthropic.claude-sonnet-4-6',
  'anthropic.claude-sonnet-5',
  'anthropic.claude-opus-4-8',
] as const
export const JUDGE_MODEL = 'anthropic.claude-opus-4-8'
export const SMALL_FAST_MODEL = 'anthropic.claude-haiku-4-5'

export const TIER = 'T0'
export const VALIDATOR_VERSION = 'interim-1'
export const JUDGE_SAMPLES = 3

const REQUIRED_ENV = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'] as const

// Fail fast, list what's missing, never prompt, never fall back to the
// Anthropic API (provider directive, journal 2026-07-06).
export function assertProviderEnv(): void {
  const missing = REQUIRED_ENV.filter(name => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `Bedrock provider requires environment variables that are not set: ${missing.join(', ')}. ` +
        'Set them and re-run; the harness does not fall back to the Anthropic API.'
    )
  }
}

// Environment for spawned greenfield sessions: start clean of the parent
// harness's Claude Code state, add only what Bedrock needs. Network/proxy and
// system vars pass through.
export function sessionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k.startsWith('CLAUDE_') || k.startsWith('ANTHROPIC_')) continue
    env[k] = v
  }
  env.CLAUDE_CODE_USE_BEDROCK = '1'
  env.ANTHROPIC_SMALL_FAST_MODEL = SMALL_FAST_MODEL
  env.DISABLE_AUTOUPDATER = '1'
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
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
