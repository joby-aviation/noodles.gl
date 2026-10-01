import { describe, expect, it } from 'vitest'
import type { ContextLoader } from './context-loader'
import { MCPTools } from './mcp-tools'
import { getOperatorRegistry } from './runtime-operator-registry'
import type { DocsIndex, DocTopic, NoodlesProject, ProjectModification } from './types'

function topic(partial: Partial<DocTopic> & { id: string; content: string }): DocTopic {
  return {
    title: partial.id,
    section: 'ai-assistant',
    file: `${partial.id}.md`,
    url: null,
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

  it('includes URLs for publicly hosted docs', async () => {
    const topics = [
      topic({
        id: 'users-intro',
        title: 'Introduction guide',
        section: 'users',
        file: 'users/intro.md',
        url: 'https://noodles.gl/users/intro',
        content: '# Introduction\n\nUser guide intro.',
      }),
      topic({
        id: 'workflow-timeline',
        title: 'Timeline workflow guide',
        section: 'ai-assistant',
        file: 'ai-chat/workflow-timeline.md',
        url: null,
        content: '# Timeline workflow\n\nInternal AI docs guide.',
      }),
    ]
    const data = (await toolsWithDocs(topics).getDocumentation({ query: 'guide' })).data as {
      results: Array<{ id: string; url: string | null }>
    }

    const userDoc = data.results.find(r => r.id === 'users-intro')
    expect(userDoc?.url).toBe('https://noodles.gl/users/intro')

    const workflowDoc = data.results.find(r => r.id === 'workflow-timeline')
    expect(workflowDoc?.url).toBe(null)
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

  it('includes URL in full topic retrieval', async () => {
    const topics = [
      topic({
        id: 'users-intro',
        title: 'Introduction',
        section: 'users',
        file: 'users/intro.md',
        url: 'https://noodles.gl/users/intro',
        content: '# Introduction\n\nFull user guide.',
      }),
    ]
    const result = await toolsWithDocs(topics).getDocumentation({ id: 'users-intro' })

    expect(result.success).toBe(true)
    const data = result.data as DocTopic
    expect(data.url).toBe('https://noodles.gl/users/intro')
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

describe('node ids', () => {
  const project = {
    nodes: [
      { id: '/pickup-layer', type: 'ScatterplotLayerOp', position: { x: 0, y: 0 }, data: {} },
      { id: '/analysis/map-range', type: 'MapRangeOp', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [],
  } as unknown as NoodlesProject

  function tools() {
    const t = new MCPTools()
    t.setProject(project)
    return t
  }

  it('resolves a missing slash and a bare basename', async () => {
    expect((await tools().getNodeInfo({ nodeId: 'pickup-layer' })).data).toMatchObject({
      id: '/pickup-layer',
    })
    expect((await tools().getNodeInfo({ nodeId: 'map-range' })).data).toMatchObject({
      id: '/analysis/map-range',
    })
  })

  it('suggests ids when a node is not found', async () => {
    const result = await tools().getNodeInfo({ nodeId: '/pickup' })
    expect(result.error).toMatch(/Did you mean: \/pickup-layer/)
  })

  it('says so when the project is empty', async () => {
    const t = new MCPTools()
    t.setProject({ nodes: [], edges: [] } as unknown as NoodlesProject)
    expect((await t.getNodeInfo({ nodeId: '/threshold' })).error).toMatch(/no nodes yet/)
  })
})

describe('applyModifications validation', () => {
  const project = {
    nodes: [
      { id: '/pickup-layer', type: 'ScatterplotLayerOp', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      {
        id: '/data.out.data->/pickup-layer.par.data',
        source: '/data',
        target: '/pickup-layer',
      },
    ],
  } as unknown as NoodlesProject

  function tools() {
    const t = new MCPTools()
    t.setProject(project)
    return t
  }

  it('rejects an update_node with no id and says what to send', async () => {
    const result = await tools().applyModifications({
      modifications: [{ type: 'update_node', data: { color: 'red' } }],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('modifications[0] (update_node): data.id is required')
  })

  it('moves inputs written beside the id to where the editor reads them', async () => {
    const result = await tools().applyModifications({
      modifications: [
        { type: 'update_node', data: { id: '/pickup-layer', inputs: { radius: 5 } } },
      ],
    })
    const [update] = (result.data as { modifications: ProjectModification[] }).modifications
    expect(update.data).toEqual({ id: '/pickup-layer', data: { inputs: { radius: 5 } } })
  })

  // The argument name get_node_info takes, carried over to the edit
  it('reads nodeId as the id', async () => {
    const result = await tools().applyModifications({
      modifications: [
        { type: 'update_node', data: { nodeId: '/pickup-layer', inputs: { radius: 5 } } },
      ],
    })
    const [update] = (result.data as { modifications: ProjectModification[] }).modifications
    expect(update.data).toEqual({ id: '/pickup-layer', data: { inputs: { radius: 5 } } })
  })

  it('rejects an update_node that changes nothing', async () => {
    const result = await tools().applyModifications({
      modifications: [{ type: 'update_node', data: { id: '/pickup-layer', color: 'red' } }],
    })
    expect(result.error).toMatch(/changes nothing.*data\.data\.inputs/)
  })

  it('reports every problem in the batch and queues nothing', async () => {
    const result = await tools().applyModifications({
      modifications: [
        { type: 'delete_node', data: { id: '/nope' } },
        { type: 'add_node', data: { id: '/pickup-layer', type: 'NumberOp' } },
        { type: 'delete_edge', data: { id: '/x->/y' } },
      ],
    })
    expect(result.error).toContain('modifications[0] (delete_node): Node not found: /nope')
    expect(result.error).toContain('modifications[1] (add_node): /pickup-layer already exists')
    expect(result.error).toContain('modifications[2] (delete_edge): Edge not found')
  })

  it('rewrites bare ids and derives a missing edge id', async () => {
    const result = await tools().applyModifications({
      modifications: [
        { type: 'add_node', data: { id: 'color', type: 'ColorOp' } },
        {
          type: 'add_edge',
          data: {
            source: 'color',
            target: 'pickup-layer',
            sourceHandle: 'out.color',
            targetHandle: 'par.getFillColor',
          },
        },
        {
          type: 'update_node',
          data: { id: 'pickup-layer', data: { inputs: { radius: 5 } } },
        },
      ],
    })
    expect(result.success).toBe(true)
    const [node, edge, update] = (result.data as { modifications: ProjectModification[] })
      .modifications
    expect(node.data.id).toBe('/color')
    expect(edge.data).toMatchObject({
      id: '/color.out.color->/pickup-layer.par.getFillColor',
      source: '/color',
      target: '/pickup-layer',
    })
    expect(update.data.id).toBe('/pickup-layer')
  })

  it('lets a later call in the same run build on nodes an earlier call queued', async () => {
    const t = tools()
    await t.applyModifications({
      modifications: [{ type: 'add_node', data: { id: '/color', type: 'ColorOp' } }],
    })
    const result = await t.applyModifications({
      modifications: [
        {
          type: 'add_edge',
          data: {
            id: '/color.out.color->/pickup-layer.par.getFillColor',
            source: '/color',
            target: '/pickup-layer',
          },
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})

describe('applyModifications field validation', () => {
  // Field checks need the registry, which only a loader supplies
  function tools() {
    const loader = { getOperatorRegistry } as unknown as ContextLoader
    const t = new MCPTools(loader)
    t.setProject({
      nodes: [{ id: '/deck', type: 'DeckRendererOp', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    } as unknown as NoodlesProject)
    return t
  }

  const queued = (result: { data?: unknown }) =>
    (result.data as { modifications: ProjectModification[] }).modifications

  it('corrects a display name to the operator type', async () => {
    const result = await tools().applyModifications({
      modifications: [{ type: 'add_node', data: { id: '/quakes', type: 'File' } }],
    })
    expect(result.success).toBe(true)
    expect(queued(result)[0].data).toMatchObject({ id: '/quakes', type: 'FileOp' })
  })

  it('rejects the build the benchmark ceiling reported as done, and says why', async () => {
    const result = await tools().applyModifications({
      modifications: [
        { type: 'add_node', data: { id: '/quakes', type: 'FileOp' } },
        { type: 'add_node', data: { id: '/heat', type: 'HeatmapLayerOp' } },
        {
          type: 'add_edge',
          data: {
            source: '/quakes',
            target: '/heat',
            sourceHandle: 'out.data',
            targetHandle: 'par.data',
          },
        },
        {
          type: 'add_edge',
          data: {
            source: '/heat',
            target: '/deck',
            sourceHandle: 'out.vis',
            targetHandle: 'par.layers',
          },
        },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain(
      'modifications[3] (add_edge): /heat (HeatmapLayerOp) has no output vis'
    )
    expect(result.error).toContain('out.layer')
  })

  it('queues the same build once the handles are right', async () => {
    const result = await tools().applyModifications({
      modifications: [
        { type: 'add_node', data: { id: '/quakes', type: 'File' } },
        {
          type: 'add_node',
          data: { id: '/heat', type: 'HeatmapLayer', data: { inputs: { radiusPixels: 40 } } },
        },
        {
          type: 'add_edge',
          data: { source: '/quakes', target: '/heat', sourceHandle: 'data', targetHandle: 'data' },
        },
        {
          type: 'add_edge',
          data: {
            source: '/heat',
            target: '/deck',
            sourceHandle: 'out.layer',
            targetHandle: 'par.layers',
          },
        },
      ],
    })
    expect(result.error).toBeUndefined()
    const edges = queued(result).filter(mod => mod.type === 'add_edge')
    expect(edges[0].data).toMatchObject({
      id: '/quakes.out.data->/heat.par.data',
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    })
  })

  it('checks an update against the type queued by an earlier call', async () => {
    const t = tools()
    await t.applyModifications({
      modifications: [{ type: 'add_node', data: { id: '/points', type: 'ScatterplotLayerOp' } }],
    })
    const result = await t.applyModifications({
      modifications: [
        { type: 'update_node', data: { id: '/points', data: { inputs: { color: '#f00' } } } },
      ],
    })
    expect(result.error).toContain('/points (ScatterplotLayerOp) has no input color')
    expect(result.error).toContain('getFillColor')
  })
})
