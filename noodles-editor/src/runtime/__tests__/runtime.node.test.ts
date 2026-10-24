import { type EditorDoc, type Lowered, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { ProgramRuntime } from '../program-runtime'
import { type NodeDuck, openNodeDuck } from './duckdb-node'

import networkJson from './fixtures/network.json'
import tripsJson from './fixtures/trips.json'

/**
 * Signal flow, measured. Each test changes one kind of parameter and counts what DuckDB was
 * actually asked to do — the claim is not that a prop change is "cheap" but that it executes
 * nothing, and that a requery touches one layer's statement and no other.
 */

const AIRPORTS =
  '507,"Heathrow","London","United Kingdom","LHR","EGLL",51.47,-0.46,83,0,"E","Europe/London","airport","OurAirports"\n' +
  '478,"Manchester","Manchester","United Kingdom","MAN","EGCC",53.35,-2.27,257,0,"E","Europe/London","airport","OurAirports"\n' +
  '469,"Newcastle","Newcastle","United Kingdom","NCL","EGNT",55.03,-1.69,266,0,"E","Europe/London","airport","OurAirports"\n' +
  '1382,"De Gaulle","Paris","France","CDG","LFPG",49.01,2.55,392,1,"E","Europe/Paris","airport","OurAirports"\n' +
  '1386,"Orly","Paris","France","ORY","LFPO",48.72,2.36,291,1,"E","Europe/Paris","airport","OurAirports"\n'
const ROUTES =
  'BA,1,LHR,507,MAN,478,,0,320\nBA,1,LHR,507,NCL,469,,0,320\nAF,2,CDG,1382,ORY,1386,,0,320\nLS,3,MAN,478,NCL,469,,0,733\n'

let duck: NodeDuck
beforeAll(async () => {
  duck = await openNodeDuck()
  duck.registerText('airports.dat', AIRPORTS)
  duck.registerText('routes.dat', ROUTES)
}, 30_000)

function localNetwork(): EditorDoc {
  const doc = structuredClone(networkJson) as unknown as EditorDoc
  for (const n of doc.nodes)
    if (n.op === 'file') n.params.url = String(n.params.url).split('/').pop()!
  return doc
}

async function start(doc: EditorDoc): Promise<{
  rt: ProgramRuntime
  lowered: Lowered
  values: (t?: number) => Record<string, number | string>
}> {
  const lowered = lowerDocument(doc)
  const values = (t = 0) => parameterValues(lowered, { T: t, F: t * 30 }).values
  const rt = new ProgramRuntime(duck)
  await rt.setGraph(lowered.graph, values())
  return { rt, lowered, values }
}

const executions = () => duck.counters.executions + duck.counters.execs

describe('routing a change to exactly its dependents', () => {
  it('draws every layer on load', async () => {
    const { rt } = await start(localNetwork())
    expect(rt.program()?.errors).toEqual([])
    const rows = Object.fromEntries(rt.layers().map(l => [l.id, l.data?.rows]))
    expect(rows).toEqual({ arcs: 3, dots: 3, labels: 3 })
  })

  it('a prop change executes nothing', async () => {
    const { rt, values } = await start(localNetwork())
    const before = executions()
    await rt.setValues({ ...values(), arcs__widthScale: 4 })
    expect(executions()).toBe(before)
    expect(rt.layers().find(l => l.id === 'arcs')!.props.widthScale).toBe(4)
  })

  it('a layer-query parameter requeries that layer only', async () => {
    const { rt, values } = await start(localNetwork())
    const route = rt.program()!.routes.short__value
    const report = await rt.setValues({ ...values(), short__value: 220 })
    if (route.some(r => r.route === 'requery')) {
      expect(report?.requeried).toEqual(['arcs'])
    } else {
      // The cost model may keep a dragged filter on the CPU: then nothing is queried at all.
      expect(report?.requeried).toEqual([])
      expect(report?.evaluated).toEqual(['arcs'])
    }
    // MAN–NCL is ~190 km; LHR–MAN (~243 km) and LHR–NCL are longer.
    expect(rt.layers().find(l => l.id === 'arcs')!.data!.rows).toBe(1)
  })

  it('a relation parameter rematerializes the relation and what reads it, and nothing else', async () => {
    const { rt, values } = await start(localNetwork())
    const materialized = rt.catalog.counters.materialized
    const report = await rt.setValues({ ...values(), region__text: 'France' })
    // region, both joins; the two file sources are memo hits.
    expect(rt.catalog.counters.materialized - materialized).toBe(3)
    expect(report?.requeried.sort()).toEqual(['arcs', 'dots', 'labels'])
    expect(
      rt
        .layers()
        .find(l => l.id === 'labels')!
        .data!.strings.get('iata')
    ).toEqual(['CDG', 'ORY'])
  })

  it('recompiling an unchanged graph executes nothing', async () => {
    const { rt, lowered, values } = await start(localNetwork())
    const before = executions()
    const report = await rt.setGraph(lowered.graph, values())
    expect(report.requeried).toEqual([])
    expect(executions()).toBe(before)
  })

  it('a structural edit elsewhere keeps the other layers’ data', async () => {
    const doc = localNetwork()
    const { rt, values } = await start(doc)
    const dots = rt.layers().find(l => l.id === 'dots')!.data
    const arc = doc.nodes.find(n => n.id === 'arcs')!
    arc.params.width = '1.0'
    const lowered = lowerDocument(doc)
    const report = await rt.setGraph(lowered.graph, values())
    expect(report.requeried).toEqual(['arcs'])
    expect(rt.layers().find(l => l.id === 'dots')!.data).toBe(dots)
  })
})

describe('animation', () => {
  it('moving a time series samples its segment table again and creates no table', async () => {
    const doc: EditorDoc = {
      version: 1,
      name: 'heads',
      nodes: [
        {
          id: 'verts',
          op: 'sql',
          x: 0,
          y: 0,
          params: {
            query:
              "SELECT * FROM (VALUES (1.0, 1, 0.0, 0.0, 0.0, 'a'), (1.0, 2, 10.0, 10.0, 0.0, 'a'), (2.0, 1, 0.0, 0.0, 5.0, 'b'), (2.0, 2, 10.0, 0.0, 15.0, 'b')) AS t(trip, k, t, lng, lat, name)",
          },
        },
        {
          id: 'heads',
          op: 'time-series',
          x: 0,
          y: 0,
          params: { pathId: 'trip', order: 'k', timestamp: 't', values: 'lng, lat' },
        },
        { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[lng, lat]' } },
        { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
      ],
      edges: [
        { id: 'e1', source: 'verts', sourcePort: 'out', target: 'heads', targetPort: 'in' },
        { id: 'e2', source: 'heads', sourcePort: 'out', target: 'dots', targetPort: 'in' },
        { id: 'e3', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
      ],
    }
    const { rt, lowered, values } = await start(doc)
    expect(rt.program()?.errors).toEqual([])
    // The sample is read once, so it stays a subquery the layer's column list reaches
    const sample = rt.program()!.relations.find(r => r.id === 'heads')!
    expect(sample.materialize).toBe(false)
    const [time] = lowered.slotParams['heads.time']
    const materialized = rt.catalog.counters.materialized
    await rt.setValues({ ...values(), [time]: 5 })
    expect(rt.catalog.counters.materialized).toBe(materialized)
    const dots = rt.layers().find(l => l.id === 'dots')!
    const position = dots.data!.attributes.get(dots.plan.plan.layer!.bindings[0].attribute)!
    const at = (row: number) => [0, 1].map(c => position.data[row * position.width + c])
    // Halfway along both paths
    expect([at(0), at(1)].sort()).toEqual([
      [0, 10],
      [5, 0],
    ])
  })

  it('playing the timeline moves the trails and the camera with zero queries', async () => {
    const doc = structuredClone(tripsJson) as unknown as EditorDoc
    const trips = doc.nodes.find(n => n.id === 'trips')!
    trips.op = 'sql'
    trips.params = {
      query:
        'SELECT * FROM (VALUES (0, [[-74.0, 40.72], [-73.99, 40.73]], [10.0, 20.0])) AS t(vendor, path, timestamps)',
    }
    const { rt, values } = await start(doc)
    expect(rt.program()?.errors).toEqual([])
    const before = executions()
    for (let frame = 1; frame <= 30; frame++) await rt.setValues(values(frame / 30))
    expect(executions()).toBe(before)
    const trails = rt.layers().find(l => l.id === 'trails')!
    expect(trails.props.currentTime).toBeCloseTo(60)
    expect(rt.view().bearing).not.toBeCloseTo(-10)
    expect(rt.counters.propUpdates).toBe(30)
  })
})

describe('previewing a node nothing draws', () => {
  it('compiles it on the first read and keeps it readable after an edit', async () => {
    const doc: EditorDoc = {
      version: 1,
      name: 'loose',
      nodes: [
        { id: 'csv', op: 'file', x: 0, y: 0, params: { url: 'routes.dat', format: 'csv' } },
        { id: 'deck', op: 'deck', x: 0, y: 0, params: {} },
      ],
      edges: [],
    }
    const { rt, lowered, values } = await start(doc)
    const ir = lowered.outputs.csv?.out ?? 'csv'
    expect(rt.program()?.nodes[ir]?.role).toBe('dead')
    const first = await rt.preview(ir, 2)
    // routes.dat has no header, so its first line names the columns
    expect(first.total).toBe(3)
    expect(first.rows).toHaveLength(2)
    // A structural edit elsewhere recompiles; the previewed node stays compiled
    await rt.setGraph(lowered.graph, values())
    expect(rt.program()?.nodes[ir]?.role).toBe('relation')
  })
})

describe('previewing list columns', () => {
  it('returns plain arrays, which survive being posted from the worker', async () => {
    duck.registerText(
      'stations.json',
      JSON.stringify([
        { name: 'Lafayette', coordinates: [-122.12, 37.89] },
        { name: 'Orinda', coordinates: [-122.18, 37.87] },
      ])
    )
    const doc: EditorDoc = {
      version: 1,
      name: 'lists',
      nodes: [
        { id: 'json', op: 'file', x: 0, y: 0, params: { url: 'stations.json', format: 'json' } },
        { id: 'deck', op: 'deck', x: 0, y: 0, params: {} },
      ],
      edges: [],
    }
    const { rt, lowered } = await start(doc)
    const preview = await rt.preview(lowered.outputs.json?.out ?? 'json', 5)
    expect(preview.rows[0]).toEqual({ name: 'Lafayette', coordinates: [-122.12, 37.89] })
    expect(() => structuredClone(preview.rows)).not.toThrow()
  })
})

describe('numeric list columns as vectors', () => {
  const STATIONS = [
    { name: 'Lafayette', coordinates: [-122.12, 37.89] },
    { name: 'Orinda', coordinates: [-122.18, 37.87] },
    { name: 'Rockridge', coordinates: [-122.25, 37.84] },
  ]

  function scatter(url: string, position: string, extra: EditorDoc['nodes'] = []): EditorDoc {
    const between = extra.map(n => n.id)
    const chain = ['json', ...between, 'dots']
    return {
      version: 1,
      name: 'stations',
      nodes: [
        { id: 'json', op: 'file', x: 0, y: 0, params: { url, format: 'json' } },
        ...extra,
        { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position } },
        { id: 'deck', op: 'deck', x: 0, y: 0, params: {} },
      ],
      edges: [
        ...chain.slice(1).map((target, i) => ({
          id: `e${i}`,
          source: chain[i],
          sourcePort: 'out',
          target,
          targetPort: 'in',
        })),
        { id: 'ed', source: 'dots', sourcePort: 'out', target: 'deck', targetPort: 'layers' },
      ],
    }
  }

  function positions(rt: ProgramRuntime): number[][] {
    const dots = rt.layers().find(l => l.id === 'dots')!
    const p = dots.data!.attributes.get(dots.plan.plan.layer!.bindings[0].attribute)!
    return Array.from({ length: dots.data!.rows }, (_, row) =>
      Array.from({ length: p.width }, (_, c) => p.data[row * p.width + c])
    )
  }

  beforeAll(() => {
    duck.registerText('stations.json', JSON.stringify(STATIONS))
  })

  it('draws a scatter whose position is a list column', async () => {
    const { rt } = await start(scatter('stations.json', 'coordinates'))
    expect(rt.program()?.errors).toEqual([])
    const got = positions(rt)
    expect(got).toHaveLength(3)
    STATIONS.forEach((s, i) => {
      expect(got[i][0]).toBeCloseTo(s.coordinates[0], 4)
      expect(got[i][1]).toBeCloseTo(s.coordinates[1], 4)
    })
  })

  it('reads a list item by index or swizzle in an attribute', async () => {
    const { rt } = await start(
      scatter('stations.json', 'P', [
        {
          id: 'pos',
          op: 'attribute',
          x: 0,
          y: 0,
          params: { name: 'P', expression: '[coordinates[0], coordinates.y + 1]' },
        },
      ])
    )
    expect(rt.program()?.errors).toEqual([])
    const got = positions(rt)
    expect(got[0][0]).toBeCloseTo(-122.12, 4)
    expect(got[0][1]).toBeCloseTo(38.89, 4)
  })

  it('reads a fixed-length array as a vector without measuring it', async () => {
    const doc = scatter('stations.json', 'xyz')
    doc.nodes[0] = {
      id: 'json',
      op: 'sql',
      x: 0,
      y: 0,
      params: {
        query:
          'SELECT * FROM (VALUES ([1.0, 2.0, 3.0]::DOUBLE[3]), ([4.0, 5.0, 6.0]::DOUBLE[3])) AS t(xyz)',
      },
    }
    const { rt } = await start(doc)
    expect(rt.program()?.errors).toEqual([])
    expect(positions(rt)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
  })

  it('leaves a list whose rows differ in length a list, and says so', async () => {
    duck.registerText(
      'ragged.json',
      JSON.stringify([
        { name: 'a', coordinates: [1, 2] },
        { name: 'b', coordinates: [1, 2, 3] },
      ])
    )
    const { rt } = await start(scatter('ragged.json', 'coordinates'))
    const errors = rt.program()?.errors ?? []
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/'coordinates' is a list or struct/)
  })

  it('previews the list, not its component columns', async () => {
    const { rt, lowered } = await start(scatter('stations.json', 'coordinates'))
    const preview = await rt.preview(lowered.outputs.json?.out ?? 'json', 5)
    expect(preview.rows[0]).toEqual({ name: 'Lafayette', coordinates: [-122.12, 37.89] })
    expect(preview.columns.find(c => c.name === 'coordinates')?.type).toBe('other')
  })
})
