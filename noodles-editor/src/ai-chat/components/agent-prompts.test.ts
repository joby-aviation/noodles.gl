import { describe, expect, it } from 'vitest'
import { AGENT_PROMPTS, buildAgentPrompt, type CodingAgent, rewriteTargets } from './agent-prompts'

const AGENTS: CodingAgent[] = ['claude_code', 'other']

describe('buildAgentPrompt', () => {
  it.each(AGENTS)('returns the published %s prompt when there is no request', agent => {
    expect(buildAgentPrompt(agent)).toBe(AGENT_PROMPTS[agent])
    expect(buildAgentPrompt(agent, '   ')).toBe(AGENT_PROMPTS[agent])
  })

  // A prompt edit that drops one of these would leave the generic change in
  // place next to the user's request
  it.each(AGENTS)('finds every sentence it rewrites in the %s prompt', agent => {
    for (const target of rewriteTargets(agent)) {
      expect(AGENT_PROMPTS[agent], target).toContain(target)
    }
  })

  it.each(AGENTS)('replaces the generic change with the request for %s', agent => {
    const prompt = buildAgentPrompt(agent, 'Color the arcs by fare')

    expect(prompt).not.toContain('make one small change')
    expect(prompt).not.toContain('such as its color')
    expect(prompt.trimEnd().endsWith('> Color the arcs by fare')).toBe(true)
  })

  it('keeps the request out of the Claude Code shell command', () => {
    const request = `Make it "pop" and use $HOME's colors`
    const prompt = buildAgentPrompt('claude_code', request)
    const command = prompt.split('\n').find(line => line.includes('claude -p'))

    expect(command).toBeDefined()
    expect(command).not.toContain(request)
    expect(command).toContain('.quick-start/task.md')
    // The second session runs with an allowlist, and needs Read to open the file
    expect(command).toContain('--allowedTools "mcp__webmcp Skill Read ')
  })

  it('quotes every line of a multi-line request', () => {
    const prompt = buildAgentPrompt('other', 'First line\nSecond line')

    expect(prompt).toContain('> First line\n> Second line')
  })
})
