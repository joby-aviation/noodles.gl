import { describe, expect, it } from 'vitest'
import { NOODLES_VERSION } from './migrate-schema'
import {
  DOCUMENT_VERSION,
  documentJsonSchema,
  documentSchema,
  documentSchemaFileName,
  projectJsonSchema,
  projectSchema,
  schemaFileName,
} from './project-schema'

// The examples are documents; the converter's fixtures are the operator-graph projects they
// were before
const examples = import.meta.glob('../../examples/**/noodles.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, unknown>>

const graphProjects = import.meta.glob('../../runtime/migrate/__fixtures__/*.json', {
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

describe('operator-graph project schema', () => {
  it('finds the converter fixtures', () => {
    expect(Object.keys(graphProjects).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(graphProjects))('accepts %s', (_path, project) => {
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

  it('accepts saved table cell keyframes holding arrays and nulls', () => {
    const project = withTrack([
      keyframe('a', 0, { samples: [1, 2], label: null }),
      keyframe('b', 2, [1, 2, 3, 4]),
    ])
    expect(issues(project)).toEqual([])
  })

  it('rejects a null keyframe value', () => {
    expect(issues(withTrack([keyframe('a', 0, null)]))).toEqual([
      'timeline.sheetsById.Noodles.sequence.tracksByObject.basemap.trackData.track-1.keyframes.0.value',
    ])
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

describe('document schema', () => {
  const doc = documentSchema()
  const docIssues = (value: unknown) => {
    const result = doc.safeParse(value)
    return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'))
  }
  const minimalDoc = () => ({
    version: DOCUMENT_VERSION,
    name: 'quakes',
    nodes: [
      { id: 'n1', op: 'file', name: 'quakes', x: 0, y: 0, params: { url: '@/data.csv' } },
      {
        id: 'n2',
        op: 'scatter',
        x: 300,
        y: 0,
        params: { position: '[lng, lat]', radiusScale: { expr: '4 + 2 * sin(T)' } },
      },
      { id: 'n3', op: 'deck', x: 600, y: 0, params: { zoom: { ref: 'n2/radiusScale' } } },
    ],
    edges: [
      { id: 'e1', source: 'n1', sourcePort: 'out', target: 'n2', targetPort: 'in' },
      { id: 'e2', source: 'n2', sourcePort: 'out', target: 'n3', targetPort: 'layers', index: 0 },
    ],
  })
  const keyed = (keyframes: unknown[]) => ({
    ...minimalDoc(),
    timeline: { length: 10, fps: 30, tracks: [{ target: 'n2.radiusScale', keyframes }] },
  })
  const kf = (id: string, time: number, value: unknown) => ({
    id,
    time,
    value,
    interpolation: 'bezier',
    handles: { left: [0.33, 0.33], right: [0.67, 0.67] },
  })

  it('finds the example documents', () => {
    expect(Object.keys(examples).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(examples))('accepts %s', (_path, project) => {
    expect(docIssues(project)).toEqual([])
  })

  it('accepts literals, expressions, references and host values as parameters', () => {
    const value = minimalDoc()
    Object.assign(value.nodes[0].params, {
      code: ['return d'],
      bounds: [
        [0, 0],
        [1, 1],
      ],
      on: true,
    })
    expect(docIssues(value)).toEqual([])
  })

  it('rejects an operator-graph project, and another version', () => {
    expect(docIssues(minimal())).toEqual(expect.arrayContaining(['version', 'name']))
    expect(docIssues({ ...minimalDoc(), version: 2 })).toEqual(['version'])
  })

  it('rejects a key it does not list on a node or an edge', () => {
    const value = minimalDoc()
    Object.assign(value.nodes[0], { parms: {} })
    Object.assign(value.edges[0], { sourceHandle: 'out.data' })
    expect(docIssues(value)).toEqual(['nodes.0', 'edges.0'])
  })

  it('rejects a name with a slash, which paths would misread', () => {
    const value = minimalDoc()
    value.nodes[0].name = 'a/b'
    expect(docIssues(value)).toEqual(['nodes.0.name'])
  })

  it('accepts number and text keyframes, and rejects others', () => {
    expect(docIssues(keyed([kf('a', 0, 4), kf('b', 2, 'blue')]))).toEqual([])
    expect(docIssues(keyed([kf('a', 0, [1, 2])]))).toEqual(['timeline.tracks.0.keyframes.0.value'])
  })

  it('rejects keyframes out of time order and a track with no parameter', () => {
    expect(docIssues(keyed([kf('a', 5, 4), kf('b', 2, 8)]))).toEqual([
      'timeline.tracks.0.keyframes',
    ])
    const value = keyed([])
    value.timeline.tracks[0].target = 'n2'
    expect(docIssues(value)).toEqual(['timeline.tracks.0.target'])
  })
})

describe('published JSON Schema', () => {
  const asFile = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

  it.each([
    [schemaFileName(), documentJsonSchema()],
    [
      documentSchemaFileName(DOCUMENT_VERSION),
      documentJsonSchema(DOCUMENT_VERSION, { versioned: true }),
    ],
    [schemaFileName(NOODLES_VERSION), projectJsonSchema(NOODLES_VERSION)],
  ])('website/static/schema/%s is current (run npm run generate:schema)', (name, expected) => {
    expect(publishedFile(name)).toBe(asFile(expected))
  })

  it('names each URL and pins each version', () => {
    const stable = documentJsonSchema() as {
      $id: string
      properties: { version: { const: number } }
    }
    expect(stable.$id).toBe('https://noodles.gl/schema/noodles-project.schema.json')
    expect(stable.properties.version.const).toBe(DOCUMENT_VERSION)
    const pinned = documentJsonSchema(DOCUMENT_VERSION, { versioned: true }) as { $id: string }
    expect(pinned.$id).toBe(
      `https://noodles.gl/schema/noodles-document.v${DOCUMENT_VERSION}.schema.json`
    )
    const graph = projectJsonSchema(NOODLES_VERSION) as {
      $id: string
      properties: { version: { const: number } }
      required: string[]
    }
    expect(graph.$id).toBe(
      `https://noodles.gl/schema/noodles-project.v${NOODLES_VERSION}.schema.json`
    )
    expect(graph.properties.version.const).toBe(NOODLES_VERSION)
    expect(graph.required).toEqual(expect.arrayContaining(['version', 'nodes', 'edges']))
  })
})
