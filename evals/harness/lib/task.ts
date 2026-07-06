// Task file loading: markdown with a YAML frontmatter block (see
// evals/tasks/*.md). The frontmatter is the machine-readable half (id, tags,
// budgets, grader config); the body carries the verbatim prompt.

import * as fs from 'node:fs'
import * as path from 'node:path'
import YAML from 'yaml'
import { TASKS_ROOT } from './config'

export interface TaskFixture {
  from: string
  to: string
}

export interface TaskDefinition {
  id: string
  taskVersion: number
  cuj: number
  family: string
  tags: string[]
  budget: { maxTurns: number; maxWallClockSeconds: number }
  workspace?: {
    fixtures?: TaskFixture[]
    /** existing project (workspace-relative) the task modifies; snapshotted
     * before the session so checks can diff before/after */
    project?: string
  }
  grader: {
    rubric: string
    artifact: string
    mechanical: {
      validateProject?: string
      load?: { route: string; screenshot: string }
      requiredNodeTypes?: string[]
      answers?: { file: string; key: string }
      /** task-specific checks, dispatched from lib/task-checks by this id */
      custom?: string
    }
  }
  body: string
  prompt: string
}

export function loadTask(taskId: string): TaskDefinition {
  const file = path.join(TASKS_ROOT, `${taskId}.md`)
  const raw = fs.readFileSync(file, 'utf-8')
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw new Error(`Task file ${file} has no YAML frontmatter`)
  const meta = YAML.parse(match[1])
  const body = match[2].trim()

  // The prompt is the blockquote under "## Prompt (verbatim)".
  const promptSection = body.match(/## Prompt \(verbatim\)\n+((?:>.*\n?)+)/)
  if (!promptSection) throw new Error(`Task file ${file} has no "## Prompt (verbatim)" blockquote`)
  const prompt = promptSection[1]
    .split('\n')
    .map(line => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim()

  return { ...meta, body, prompt }
}
