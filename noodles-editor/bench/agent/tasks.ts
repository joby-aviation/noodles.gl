// Task files for the in-app agent benchmark. The frontmatter follows the eval
// harness in PR #509 (id, taskVersion, family, tags, budget, grader) so the two
// can share tasks later; tier, start, setup and turns are specific to driving
// the in-app assistant rather than a CLI agent. The prompt is the body.
//
// Pure (string in, task out) so the grader tests can run it in the browser.

import yaml from 'js-yaml'
import type { DocModification } from '../../src/ai-chat/doc-tools'
import type { Check } from './grade'

// T1 knowledge, T2 single edit, T3 multi-step build, T4 debug
export type Tier = 'T1' | 'T2' | 'T3' | 'T4'

export interface Task {
  id: string
  taskVersion: number
  family: string
  tier: Tier
  tags: string[]
  // An example under src/examples/, or 'blank' for /projects/new
  start: string
  budget: { maxTurns?: number; maxWallClockSeconds: number }
  setup: { modifications: DocModification[] }
  // Prompt first, then any scripted follow-ups
  turns: string[]
  grader: { checks: Check[]; rubric?: string }
  // Relative path of the file it came from, for error messages
  source: string
}

const TIERS: Tier[] = ['T1', 'T2', 'T3', 'T4']
const DEFAULT_WALL_CLOCK_SECONDS = 300

export function parseTask(text: string, source: string): Task {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) throw new Error(`${source}: missing --- frontmatter ---`)

  const meta = (yaml.load(match[1]) ?? {}) as Record<string, unknown>
  const prompt = match[2].trim()
  const fail = (message: string) => new Error(`${source}: ${message}`)

  if (typeof meta.id !== 'string') throw fail('id is required')
  if (!TIERS.includes(meta.tier as Tier)) throw fail(`tier must be one of ${TIERS.join(', ')}`)
  if (typeof meta.start !== 'string') throw fail('start is required')
  if (!prompt) throw fail('the body (the prompt) is empty')

  const grader = (meta.grader ?? {}) as Partial<Task['grader']>
  if (!Array.isArray(grader.checks) || grader.checks.length === 0) {
    throw fail('grader.checks needs at least one check')
  }

  const budget = (meta.budget ?? {}) as Partial<Task['budget']>
  const setup = (meta.setup ?? {}) as Partial<Task['setup']>
  const followUps = Array.isArray(meta.turns) ? meta.turns.map(String) : []

  return {
    id: meta.id,
    taskVersion: typeof meta.taskVersion === 'number' ? meta.taskVersion : 1,
    family: typeof meta.family === 'string' ? meta.family : (meta.tier as string),
    tier: meta.tier as Tier,
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    start: meta.start,
    budget: {
      maxTurns: budget.maxTurns,
      maxWallClockSeconds: budget.maxWallClockSeconds ?? DEFAULT_WALL_CLOCK_SECONDS,
    },
    setup: { modifications: setup.modifications ?? [] },
    turns: [prompt, ...followUps],
    grader: { checks: grader.checks, rubric: grader.rubric },
    source,
  }
}
