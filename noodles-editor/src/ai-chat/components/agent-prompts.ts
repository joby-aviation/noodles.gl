// The quick start prompts for coding agents, with the user's own request in place
// of the generic "make one small change". The website copies the same files
// without a request, so they stay the source of truth and this only rewrites the
// sentences that name the change.
import agentPrompt from '../../../../website/static/agent-prompt.txt?raw'
import claudeCodePrompt from '../../../../website/static/claude-code-prompt.txt?raw'

export type CodingAgent = 'claude_code' | 'other'

const GENERIC_GOAL = 'make one small change to it'
const REQUEST_GOAL = 'make the change I ask for at the end'
const GENERIC_CHANGE = 'Make one small visible change to a layer, such as its color.'

// Claude Code runs the change in a second session through `claude -p "..."`, so
// the request goes through a file: pasted into the command, a quote or a `$` in
// it would break the shell line. That session also needs Read to open the file.
const REWRITES: Record<CodingAgent, Array<[string, string]>> = {
  claude_code: [
    [GENERIC_GOAL, REQUEST_GOAL],
    ['--allowedTools "mcp__webmcp Skill ', '--allowedTools "mcp__webmcp Skill Read '],
    [GENERIC_CHANGE, 'Read .quick-start/task.md and make that change to the map.'],
  ],
  other: [
    [GENERIC_GOAL, REQUEST_GOAL],
    [GENERIC_CHANGE, 'Make the change in "My request" at the end of this prompt.'],
  ],
}

const REQUEST_INTRO: Record<CodingAgent, string> = {
  claude_code:
    'My request. Before step 5, save it word for word to `.quick-start/task.md` (create the folder if needed):',
  other: 'My request:',
}

export const AGENT_PROMPTS: Record<CodingAgent, string> = {
  claude_code: claudeCodePrompt,
  other: agentPrompt,
}

export function buildAgentPrompt(agent: CodingAgent, request?: string): string {
  const base = AGENT_PROMPTS[agent]
  const trimmed = request?.trim()
  if (!trimmed) return base

  const rewritten = REWRITES[agent].reduce((text, [from, to]) => text.replace(from, to), base)
  const quoted = trimmed
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  return `${rewritten.trimEnd()}\n\n${REQUEST_INTRO[agent]}\n\n${quoted}\n`
}

// For the test: every sentence a rewrite looks for, so editing a prompt file
// cannot silently leave the generic change in place
export function rewriteTargets(agent: CodingAgent): string[] {
  return REWRITES[agent].map(([from]) => from)
}
