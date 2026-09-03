import { describe, expect, it } from 'vitest'
import { toolDefinitions } from '../tool-definitions'
import {
  FIND_TOOLS_NAME,
  maxUnlockedTools,
  scoreTools,
  TIER0_TOOL_NAMES,
  ToolRouter,
} from './tool-router'

const CLAUDE_WINDOW = 200_000
const NANO_WINDOW = 6144
const MID_WINDOW = 32_000

describe('TIER0_TOOL_NAMES', () => {
  it('is the five always-on tools', () => {
    expect([...TIER0_TOOL_NAMES].sort()).toEqual([
      'apply_modifications',
      'find_tools',
      'get_node_info',
      'get_node_output',
      'list_nodes',
    ])
  })

  it('references real definitions apart from the router-owned find_tools', () => {
    const defined = new Set(toolDefinitions.map(d => d.name))
    for (const name of TIER0_TOOL_NAMES) {
      if (name === FIND_TOOLS_NAME) continue
      expect(defined.has(name), name).toBe(true)
    }
  })
})

describe('ToolRouter.getTools', () => {
  it('starts with exactly tier 0, whatever the window size', () => {
    for (const window of [NANO_WINDOW, MID_WINDOW, CLAUDE_WINDOW]) {
      const names = new ToolRouter(window).getTools().map(t => t.name)
      expect(names.sort()).toEqual([...TIER0_TOOL_NAMES].sort())
    }
  })

  it('includes a schema for every tool it offers', () => {
    for (const tool of new ToolRouter(CLAUDE_WINDOW).getTools()) {
      expect(tool.inputSchema.type, tool.name).toBe('object')
      expect(tool.description.length, tool.name).toBeGreaterThan(0)
    }
  })
})

describe('ToolRouter.findTools', () => {
  it('unlocks get_documentation for a docs query', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const result = router.findTools({ query: 'read the documentation' })

    expect(result.success).toBe(true)
    const data = result.data as { unlocked: string[] }
    expect(data.unlocked).toContain('get_documentation')
    expect(router.isCallable('get_documentation')).toBe(true)
    expect(router.getTools().map(t => t.name)).toContain('get_documentation')
  })

  it('unlocks search_code for a source code query', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const data = router.findTools({ query: 'search source code' }).data as { unlocked: string[] }
    expect(data.unlocked).toContain('search_code')
  })

  it('unlocks the timeline tools for an animation query', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const data = router.findTools({ query: 'animation keyframes timeline' }).data as {
      unlocked: string[]
    }
    expect(data.unlocked).toContain('set_keyframe')
  })

  it('unlocks example tools for an examples query', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const data = router.findTools({ query: 'example projects' }).data as { unlocked: string[] }
    expect(data.unlocked.some(n => n.includes('example'))).toBe(true)
  })

  it('returns full input schemas so the model can call immediately', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const data = router.findTools({ query: 'documentation' }).data as {
      tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>
    }
    const docs = data.tools.find(t => t.name === 'get_documentation')
    expect(docs?.inputSchema.properties).toHaveProperty('query')
  })

  it('honours the limit and caps it at 8', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const one = router.findTools({ query: 'code', limit: 1 }).data as { unlocked: string[] }
    expect(one.unlocked).toHaveLength(1)

    const huge = new ToolRouter(CLAUDE_WINDOW).findTools({ query: 'code data node', limit: 99 })
      .data as { unlocked: string[] }
    expect(huge.unlocked.length).toBeLessThanOrEqual(8)
  })

  it('rejects an empty query', () => {
    const result = new ToolRouter(CLAUDE_WINDOW).findTools({ query: '  ' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('non-empty')
  })

  it('reports no matches without unlocking anything', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const result = router.findTools({ query: 'zzzz qqqq' })
    expect(result.success).toBe(true)
    expect((result.data as { matches: unknown[] }).matches).toEqual([])
    expect(router.getUnlocked()).toEqual([])
  })

  it('never returns a tier 0 tool, which is already callable', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    const data = router.findTools({ query: 'list nodes graph', limit: 8 }).data as {
      unlocked?: string[]
    }
    for (const name of data.unlocked ?? []) {
      expect(TIER0_TOOL_NAMES).not.toContain(name)
    }
  })
})

describe('context-window gating', () => {
  it('allows fewer concurrent unlocks on smaller windows', () => {
    expect(maxUnlockedTools(NANO_WINDOW)).toBe(2)
    expect(maxUnlockedTools(MID_WINDOW)).toBe(6)
    expect(maxUnlockedTools(CLAUDE_WINDOW)).toBe(Number.POSITIVE_INFINITY)
  })

  it('keeps a nano-sized window at tier 0 plus two tools at most', () => {
    const router = new ToolRouter(NANO_WINDOW)
    router.findTools({ query: 'documentation code examples operator schema', limit: 8 })
    expect(router.getUnlocked()).toHaveLength(2)
    expect(router.getTools()).toHaveLength(TIER0_TOOL_NAMES.length + 2)
  })

  it('evicts the oldest unlock FIFO when a small window is full', () => {
    const router = new ToolRouter(NANO_WINDOW)
    router.findTools({ query: 'documentation', limit: 1 })
    const first = router.getUnlocked()[0]
    router.findTools({ query: 'search source code', limit: 1 })
    router.findTools({ query: 'render statistics', limit: 1 })

    expect(router.getUnlocked()).toHaveLength(2)
    expect(router.isCallable(first)).toBe(false)
  })

  it('does not evict on a large window', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    router.findTools({ query: 'documentation', limit: 1 })
    router.findTools({ query: 'search source code', limit: 1 })
    router.findTools({ query: 'render statistics', limit: 1 })
    expect(router.getUnlocked()).toHaveLength(3)
  })

  it('refreshes FIFO position when a tool is unlocked again', () => {
    const router = new ToolRouter(NANO_WINDOW)
    router.findTools({ query: 'documentation', limit: 1 })
    const docs = router.getUnlocked()[0]
    router.findTools({ query: 'search source code', limit: 1 })
    // Re-unlocking docs moves it to newest, so the code tool is evicted next
    router.findTools({ query: 'documentation', limit: 1 })
    router.findTools({ query: 'render statistics', limit: 1 })
    expect(router.isCallable(docs)).toBe(true)
  })
})

describe('isCallable', () => {
  it('accepts tier 0 and find_tools without any lookup', () => {
    const router = new ToolRouter(CLAUDE_WINDOW)
    for (const name of TIER0_TOOL_NAMES) expect(router.isCallable(name), name).toBe(true)
  })

  it('rejects a tool that has not been unlocked', () => {
    expect(new ToolRouter(CLAUDE_WINDOW).isCallable('search_code')).toBe(false)
  })
})

describe('scoreTools', () => {
  it('is deterministic across calls', () => {
    const a = scoreTools('documentation examples').map(m => m.name)
    const b = scoreTools('documentation examples').map(m => m.name)
    expect(a).toEqual(b)
  })

  it('ignores stop words entirely', () => {
    expect(scoreTools('how do I get the a of it')).toEqual([])
  })

  it('ranks a direct name match first', () => {
    expect(scoreTools('search_code')[0]?.name).toBe('search_code')
  })

  it('treats a plural as a name match, since that is how queries are phrased', () => {
    // "keyframes" used to score as a near-miss against the keyframe tools, which
    // let broader tools outrank the ones the model was actually asking for. The
    // plural cannot pick between set_ and delete_, so both must lead.
    expect(
      scoreTools('keyframes')
        .slice(0, 2)
        .map(m => m.name)
        .sort()
    ).toEqual(['delete_keyframe', 'set_keyframe'])
    expect(scoreTools('examples')[0]?.name).toMatch(/example/)
  })
})
