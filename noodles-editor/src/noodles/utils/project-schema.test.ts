import { describe, expect, it } from 'vitest'
import { NOODLES_VERSION } from './migrate-schema'
import { projectJsonSchema, projectSchema, schemaFileName } from './project-schema'

const examples = import.meta.glob('../../examples/**/noodles.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, unknown>>

const published = import.meta.glob('../../../../website/static/schema/*.json', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

const publishedFile = (name: string) =>
  Object.entries(published).find(([path]) => path.endsWith(`/${name}`))?.[1]

const schema = projectSchema(NOODLES_VERSION)

const minimal = () => ({
  version: NOODLES_VERSION,
  nodes: [
    { id: '/data', type: 'FileOp', position: { x: 0, y: 0 }, data: { inputs: {} } },
    { id: '/out', type: 'OutOp', position: { x: 300, y: 0 }, data: { inputs: {} } },
  ],
  edges: [
    {
      id: '/data.out.data->/out.par.vis',
      source: '/data',
      target: '/out',
      sourceHandle: 'out.data',
      targetHandle: 'par.vis',
    },
  ],
})

const keyframe = (id: string, position: number, value: unknown) => ({
  id,
  position,
  connectedRight: true,
  handles: [0.5, 1, 0.5, 0],
  value,
})

const withTrack = (keyframes: unknown[]) => ({
  ...minimal(),
  timeline: {
    sheetsById: {
      Noodles: {
        sequence: {
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: {
            basemap: {
              trackIdByPropPath: { 'viewState.zoom': 'track-1' },
              trackData: { 'track-1': { type: 'BasicKeyframedTrack', keyframes } },
            },
          },
        },
      },
    },
  },
})

const issues = (project: unknown) => {
  const result = schema.safeParse(project)
  return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'))
}

describe('project schema', () => {
  it('finds the example projects', () => {
    expect(Object.keys(examples).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(examples))('accepts %s', (_path, project) => {
    expect(issues(project)).toEqual([])
  })

  it('accepts a minimal project with no timeline or viewport', () => {
    expect(issues(minimal())).toEqual([])
  })

  it('accepts unlisted keys on nodes and edges', () => {
    const project = minimal()
    Object.assign(project.nodes[0], { width: 200, measured: { width: 200, height: 80 } })
    Object.assign(project.edges[0], { selectable: false })
    expect(issues(project)).toEqual([])
  })

  it('rejects another version', () => {
    expect(issues({ ...minimal(), version: NOODLES_VERSION - 1 })).toEqual(['version'])
  })

  it('rejects a node id that is not an absolute path', () => {
    const project = minimal()
    project.nodes[0].id = 'data'
    expect(issues(project)).toEqual(['nodes.0.id'])
  })

  it('rejects a handle without an out. or par. prefix', () => {
    const project = minimal()
    project.edges[0].targetHandle = 'vis'
    expect(issues(project)).toEqual(['edges.0.targetHandle'])
  })

  it('accepts a null source handle on a reference edge', () => {
    const project = minimal()
    Object.assign(project.edges[0], { type: 'ReferenceEdge', sourceHandle: null })
    expect(issues(project)).toEqual([])
  })

  it('accepts keyframes with number, string and object values', () => {
    const project = withTrack([
      keyframe('a', 0, 4),
      keyframe('b', 2, 'blue'),
      keyframe('c', 5, { r: 1, g: 0, b: 0, a: 1 }),
    ])
    expect(issues(project)).toEqual([])
  })

  it('rejects keyframes out of position order', () => {
    const project = withTrack([keyframe('a', 5, 4), keyframe('b', 2, 8)])
    expect(issues(project)).toEqual([
      'timeline.sheetsById.Noodles.sequence.tracksByObject.basemap.trackData.track-1.keyframes',
    ])
  })

  it('rejects bezier handle x outside 0 to 1', () => {
    const project = withTrack([{ ...keyframe('a', 0, 4), handles: [1.5, 0, 0.5, 0] }])
    expect(issues(project)).toEqual([
      'timeline.sheetsById.Noodles.sequence.tracksByObject.basemap.trackData.track-1.keyframes.0.handles.0',
    ])
  })
})

describe('published JSON Schema', () => {
  it.each([
    [schemaFileName(), false],
    [schemaFileName(NOODLES_VERSION), true],
  ])('website/static/schema/%s is current (run npm run generate:schema)', (name, versioned) => {
    const expected = `${JSON.stringify(projectJsonSchema(NOODLES_VERSION, { versioned }), null, 2)}\n`
    expect(publishedFile(name)).toBe(expected)
  })

  it('pins version and names its URL', () => {
    const json = projectJsonSchema(NOODLES_VERSION, { versioned: true }) as {
      $id: string
      properties: { version: { const: number } }
      required: string[]
    }
    expect(json.$id).toBe(
      `https://noodles.gl/schema/noodles-project.v${NOODLES_VERSION}.schema.json`
    )
    expect(json.properties.version.const).toBe(NOODLES_VERSION)
    expect(json.required).toEqual(expect.arrayContaining(['version', 'nodes', 'edges']))
  })
})
