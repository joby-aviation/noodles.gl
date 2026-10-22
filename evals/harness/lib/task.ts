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
  cuj?: number
  family: string
  tags: string[]
  budget: { maxTurns: number; maxWallClockSeconds: number }
  workspace?: {
    /** 'repo' (default): the installed template checkout. 'empty': an empty
     * directory, for tasks whose prompt sets everything up from nothing. */
    mode?: 'repo' | 'empty'
    fixtures?: TaskFixture[]
    /** existing project (workspace-relative) the task modifies; snapshotted
     * before the session so checks can diff before/after */
    project?: string
  }
  session?: {
    /** run the claude CLI with a fresh, per-run CLAUDE_CONFIG_DIR, so a
     * prompt that adds MCP servers or reads user settings starts clean and
     * never touches the operator's own config */
    isolatedConfig?: boolean
  }
  /** read the verbatim prompt from this file (relative to tasks/) instead of
   * the body's blockquote, for prompts that are published artifacts */
  promptFile?: string
  grader: {
    rubric: string
    artifact: string
    mechanical: {
      validateProject?: string
      load?: {
        route: string
        screenshot: string
        openTimeline?: boolean
        /** read every rendered *LayerOp's output in the loaded app through the
         * WebMCP get_node_output tool (route opened with ?externalControl=true);
         * frozen as node-outputs.json and handed to the custom checks */
        probeLayers?: boolean
      }
      /** check the newest image the session itself wrote (copied to
       * agent-screenshot.<ext>) for non-blankness */
      agentScreenshot?: boolean
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

  if (typeof meta.promptFile === 'string') {
    const prompt = fs.readFileSync(path.join(TASKS_ROOT, meta.promptFile), 'utf-8').trim()
    return { ...meta, body, prompt }
  }

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
