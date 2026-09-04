import { describe, expect, it } from 'vitest'
import type { ContextLoader } from './context-loader'
import { MCPTools } from './mcp-tools'
import type { DocsIndex, DocTopic } from './types'

function topic(partial: Partial<DocTopic> & { id: string; content: string }): DocTopic {
  return {
    title: partial.id,
    section: 'ai-assistant',
    file: `${partial.id}.md`,
    headings: [],
    codeExamples: [],
    relatedTopics: [],
    ...partial,
  }
}

// A stand-in for the real bundle. Only getDocsIndex is exercised here, so the
// rest of ContextLoader stays unbuilt.
function toolsWithDocs(topics: DocTopic[]): MCPTools {
  const index: DocsIndex = {
    version: '1.0.0',
    topics: Object.fromEntries(topics.map(t => [t.id, t])),
  }
  const loader = { getDocsIndex: () => index } as unknown as ContextLoader
  return new MCPTools(loader)
}

const WORKFLOW_TOPICS = [
  topic({
    id: 'workflow-timeline-animation',
    title: 'Animating fields on the timeline',
    content:
      '# Animating fields on the timeline\n\nAny animatable field can be keyframed. Use set_keyframe to add a keyframe, and get_timeline to read the sequence length and FPS. Values interpolate between keyframes so opacity can fade in over time.',
    headings: [{ level: 2, text: 'Interpolation', anchor: 'interpolation' }],
  }),
  topic({
    id: 'workflow-debugging',
    title: 'Debugging a visualization',
    content:
      '# Debugging a visualization\n\nNoodles fails quietly. Check get_console_errors first, then walk the pipeline with get_node_output.',
  }),
  topic({
    id: 'users-intro',
    title: 'Introduction',
    section: 'users',
    content:
      '# Introduction\n\nNoodles.gl is a node based editor. It can animate a timeline, among many other things.',
  }),
]

describe('getDocumentation search', () => {
  it('finds a topic from a natural multi-word question', async () => {
    // The old implementation matched the whole query as one substring, so a
    // phrasing like this shared no literal run of characters with any page
    const tools = toolsWithDocs(WORKFLOW_TOPICS)
    const result = await tools.getDocumentation({ query: 'how do I animate opacity over time' })

    expect(result.success).toBe(true)
    const data = result.data as { results: Array<{ id: string }> }
    expect(data.results[0].id).toBe('workflow-timeline-animation')
  })

  it('ranks a title match above an incidental body mention', async () => {
    const tools = toolsWithDocs(WORKFLOW_TOPICS)
    const data = (await tools.getDocumentation({ query: 'timeline animation' })).data as {
      results: Array<{ id: string }>
    }
    expect(data.results[0].id).toBe('workflow-timeline-animation')
    expect(data.results.map(r => r.id)).toContain('users-intro')
  })

  it('returns ids and headings instead of whole pages', async () => {
    const tools = toolsWithDocs(WORKFLOW_TOPICS)
    const data = (await tools.getDocumentation({ query: 'keyframe' })).data as {
      results: Array<{ id: string; headings: string[]; excerpt: string; fullLength: number }>
      hint: string
    }

    const match = data.results[0]
    expect(match.headings).toEqual(['Interpolation'])
    expect(match.fullLength).toBeGreaterThan(0)
    expect(data.hint).toContain('id')
  })

  it('bounds the excerpt for a long page', async () => {
    const long = topic({
      id: 'long',
      content: `${'filler prose. '.repeat(400)}the needle is here${' more filler. '.repeat(400)}`,
    })
    const data = (await toolsWithDocs([long]).getDocumentation({ query: 'needle' })).data as {
      results: Array<{ excerpt: string; fullLength: number }>
    }

    const match = data.results[0]
    expect(match.excerpt).toContain('needle')
    expect(match.excerpt.length).toBeLessThan(1000)
    expect(match.fullLength).toBeGreaterThan(match.excerpt.length)
  })

  it('honours the section filter', async () => {
    const tools = toolsWithDocs(WORKFLOW_TOPICS)
    const data = (await tools.getDocumentation({ query: 'timeline', section: 'users' })).data as {
      results: Array<{ id: string }>
    }
    expect(data.results.map(r => r.id)).toEqual(['users-intro'])
  })

  it('reports no match rather than failing', async () => {
    const data = (await toolsWithDocs(WORKFLOW_TOPICS).getDocumentation({ query: 'zzzz qqqq' }))
      .data as { results: unknown[]; message: string }
    expect(data.results).toEqual([])
    expect(data.message).toContain('No documentation matched')
  })

  it('ignores stop words so a query of only stop words matches nothing', async () => {
    const data = (
      await toolsWithDocs(WORKFLOW_TOPICS).getDocumentation({ query: 'how do I use it' })
    ).data as { results: unknown[] }
    expect(data.results).toEqual([])
  })
})

describe('getDocumentation by id', () => {
  it('returns the topic in full', async () => {
    const tools = toolsWithDocs(WORKFLOW_TOPICS)
    const result = await tools.getDocumentation({ id: 'workflow-debugging' })

    expect(result.success).toBe(true)
    const data = result.data as DocTopic
    expect(data.content).toBe(WORKFLOW_TOPICS[1].content)
  })

  it('names the recovery path for an unknown id', async () => {
    const result = await toolsWithDocs(WORKFLOW_TOPICS).getDocumentation({ id: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Search by query')
  })
})

describe('getDocumentation guards', () => {
  it('requires a query or an id', async () => {
    const result = await toolsWithDocs(WORKFLOW_TOPICS).getDocumentation({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('either a query or an id')
  })

  it('reports a missing docs index', async () => {
    const result = await new MCPTools().getDocumentation({ query: 'anything' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Docs index not loaded')
  })
})
