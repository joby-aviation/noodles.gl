import {
  bezierEasing,
  compileProgram,
  EASING_PRESETS,
  type EditorDoc,
  evaluateTrack,
  flattenSubnets,
  type Lowered,
  lowerDocument,
  type ParamValue,
  type ProgramPlan,
  parameterValues,
  resolveRef,
  targetCaps,
} from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { MaterializingCatalog } from '../catalog'
import { evaluateLayer, type LayerData, queryLayer } from '../execute'
import { triangulate } from '../triangulate'
import { type NodeDuck, openNodeDuck } from './duckdb-node'
import arrivalsJson from './fixtures/arrivals.json'
import earthquakesJson from './fixtures/earthquakes.json'
import hexesJson from './fixtures/hexes.json'
import networkJson from './fixtures/network.json'
import tripsJson from './fixtures/trips.json'

// JSON imports infer literal unions that do not overlap `ParamValue`; the files are documents.
const earthquakes = earthquakesJson as unknown as EditorDoc
const network = networkJson as unknown as EditorDoc
const trips = tripsJson as unknown as EditorDoc
const arrivals = arrivalsJson as unknown as EditorDoc

/**
 * The example documents, lowered and compiled against small local stand-ins for their data.
 * The stand-ins have the real files' columns — the USGS header, OpenFlights' headerless
 * layout, deck.gl's trip lists, OpenSky's segments — so a wrong column name in an example
 * fails here, not in front of someone.
 */

const FIXTURES: Record<string, string> = {
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.csv':
    'time,latitude,longitude,depth,mag,magType,nst,gap,dmin,rms,net,id,updated,place,type,horizontalError,depthError,magError,magNst,status,locationSource,magSource\n' +
    '2026-09-25T16:27:53.590Z,36.58,-121.19,7.9,2.07,md,24,52,0.01,0.15,nc,nc1,2026-09-25T16:29:30.199Z,"8 km NW of Pinnacles, CA",earthquake,0.37,1.2,0.2,21,automatic,nc,nc\n' +
    '2026-09-25T15:00:00.000Z,38.1,142.3,35.0,5.4,mww,,,,,us,us1,2026-09-25T16:00:00.000Z,"off the coast of Japan",earthquake,,,,,reviewed,us,us\n' +
    '2026-09-25T14:00:00.000Z,-20.5,-70.1,90.0,4.1,mb,,,,,us,us2,2026-09-25T16:00:00.000Z,"Chile",earthquake,,,,,reviewed,us,us\n',
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat':
    '507,"London Heathrow Airport","London","United Kingdom","LHR","EGLL",51.4706,-0.461941,83,0,"E","Europe/London","airport","OurAirports"\n' +
    '478,"Manchester Airport","Manchester","United Kingdom","MAN","EGCC",53.35,-2.27,257,0,"E","Europe/London","airport","OurAirports"\n' +
    '469,"Newcastle Airport","Newcastle","United Kingdom","NCL","EGNT",55.03,-1.69,266,0,"E","Europe/London","airport","OurAirports"\n' +
    '1382,"Charles de Gaulle","Paris","France","CDG","LFPG",49.01,2.55,392,1,"E","Europe/Paris","airport","OurAirports"\n' +
    '3797,"John F Kennedy","New York","United States","JFK","KJFK",40.64,-73.78,13,-5,"A","America/New_York","airport","OurAirports"\n' +
    '9999,"Nowhere Strip","Nowhere","United Kingdom",\\N,\\N,52.0,-1.0,0,0,"E",\\N,"airport","OurAirports"\n',
  'https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat':
    'BA,1355,LHR,507,MAN,478,,0,320\nBE,2297,LHR,507,MAN,478,,0,DH4\nBA,1355,LHR,507,NCL,469,,0,320\n' +
    'AF,137,CDG,1382,LHR,507,,0,320\nBA,1355,LHR,507,JFK,3797,,0,777\nLS,4,MAN,478,NCL,469,,0,733\n',
  'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/globe/2020-01-14.csv':
    'time1,time2,lon1,lat1,alt1,lon2,lat2,alt2\n' +
    '100,3700,2.0,49.0,1000,-0.5,51.45,300\n' + // arrives at LHR
    '200,5000,-2.3,53.3,500,-0.40,51.49,150\n' + // arrives at LHR
    '300,9000,-73.8,40.6,0,2.5,49.0,200\n', // arrives elsewhere
}

// The trips file is JSON, which DuckDB-Wasm reads through an extension it downloads on first
// use; tests must not touch the network, so its rows come from SQL with the same schema.
const TRIPS_SQL = `SELECT * FROM (VALUES
  (0, [[-74.0, 40.72], [-73.99, 40.73], [-73.98, 40.74]], [10.0, 20.0, 30.0]),
  (1, [[-73.95, 40.70], [-73.951, 40.701]], [15.0, 25.0])) AS t(vendor, path, timestamps)`

const caps = targetCaps('deck-webgl2', undefined)
let duck: NodeDuck

beforeAll(async () => {
  duck = await openNodeDuck()
  for (const [url, text] of Object.entries(FIXTURES)) duck.registerText(localName(url), text)
}, 30_000)

function localName(url: string): string {
  return url.split('/').pop()!
}

/** Point every File node at its local stand-in; swap the JSON file for SQL. */
function localized(doc: EditorDoc): EditorDoc {
  const copy: EditorDoc = structuredClone(doc)
  for (const n of copy.nodes) {
    if (n.op !== 'file') continue
    const url = String(n.params.url)
    if (n.params.format === 'json') {
      n.op = 'sql'
      n.params = { query: TRIPS_SQL }
    } else {
      n.params.url = localName(url)
    }
  }
  return copy
}

async function compileDoc(
  doc: EditorDoc,
  time = 0
): Promise<{ lowered: Lowered; program: ProgramPlan; values: Record<string, number | string> }> {
  const lowered = lowerDocument(localized(doc))
  const { values } = parameterValues(lowered, { T: time, F: time * 30 })
  const program = await compileProgram(lowered.graph, new MaterializingCatalog(duck), {
    caps,
    values,
  })
  return { lowered, program, values }
}

/** A layer's instances as the runtime produces them: query, CPU stage, discard mask. */
async function data(
  p: ProgramPlan,
  layerId: string,
  values: Record<string, number | string>
): Promise<LayerData> {
  const lp = p.layers.find(l => l.id === layerId)
  if (!lp) throw new Error(`no layer ${layerId}: ${JSON.stringify(p.errors)}`)
  return evaluateLayer(lp, await queryLayer(duck, lp, values), values)
}

const column = (d: LayerData, name: string): number[] => {
  const a = d.attributes.get(name)
  if (!a) throw new Error(`no attribute ${name}; have ${[...d.attributes.keys()]}`)
  return Array.from({ length: d.rows }, (_, i) => a.data[i * a.width])
}
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

describe('earthquakes', () => {
  it('lowers a wire and a ch() reference to the same scalar value', async () => {
    const { lowered, program, values } = await compileDoc(earthquakes)
    expect(lowered.errors).toEqual([])
    expect(program.errors).toEqual([])
    // The filter value is wired from min_mag; the scale's input minimum references it.
    expect(values.strong__value).toBe(2.5)
    expect(values.size__inMin).toBe(2.5)
    expect(lowered.references).toEqual(
      expect.arrayContaining([
        { from: 'threshold.out', to: 'strong.value' },
        { from: 'threshold.value', to: 'size.inMin' },
      ])
    )
    const d = await data(program, 'dots', values)
    // The M2.07 row is below the threshold, wherever the planner put the filter.
    expect(d.rows).toBe(2)
  })

  it('recomputes only the scalar program when the number changes', () => {
    const doc = structuredClone(earthquakes)
    doc.nodes.find(n => n.id === 'threshold')!.params.value = 4.5
    const lowered = lowerDocument(localized(doc))
    const { values } = parameterValues(lowered, { T: 0, F: 0 })
    expect(values.strong__value).toBe(4.5)
    expect(values.size__inMin).toBe(4.5)
  })
})

describe('network', () => {
  it('joins routes to a filtered site list twice and deduplicates airline pairs', async () => {
    const { program, values } = await compileDoc(network)
    expect(program.errors).toEqual([])
    expect(program.relations.find(r => r.id === 'region')?.materialize).toBe(true)
    const arcs = await data(program, 'arcs', values)
    const src = arcs.strings.get('src')!
    const dst = arcs.strings.get('dst')!
    const airlines = column(arcs, 'airlines')
    const pairs = src.map((s, i) => `${s}-${dst[i]}:${airlines[i]}`).sort()
    // LHR–MAN is flown by two airlines; CDG and JFK are outside the region.
    expect(pairs).toEqual(['LHR-MAN:2', 'LHR-NCL:1', 'MAN-NCL:1'])
    const labels = await data(program, 'labels', values)
    // The site with no IATA code is kept, with an empty label.
    expect([...labels.strings.get('iata')!].sort()).toEqual(['', 'LHR', 'MAN', 'NCL'])
  })

  it('routes the country text to the relation and the length slider to the layer', async () => {
    const { program } = await compileDoc(network)
    expect(program.routes.region__text).toEqual([{ route: 'rematerialize', target: 'region' }])
    expect(program.routes.short__value.map(r => r.target)).toEqual(['arcs'])
    expect(program.routes.arcs__widthScale).toEqual([{ route: 'prop', target: 'arcs' }])
  })
})

describe('trips and the demand grid', () => {
  it('drives the trails with the clock as a deck prop, and keyframes the camera', async () => {
    const { lowered, program } = await compileDoc(trips as EditorDoc, 10)
    expect(lowered.errors).toEqual([])
    expect(program.errors).toEqual([])
    expect(program.routes.trails__currentTime).toEqual([{ route: 'prop', target: 'trails' }])
    expect(program.routes.map__bearing).toEqual([{ route: 'prop', target: 'map' }])
    // Animated parameters are declared at the timeline's frame rate.
    expect(lowered.graph.params!.trails__currentTime.changeRate).toBe(30)
    expect(lowered.graph.params!.map__bearing.changeRate).toBe(30)
    const at = (t: number) => parameterValues(lowered, { T: t, F: t * 30 }).values
    expect(at(10).trails__currentTime).toBe(600)
    expect(at(0).map__bearing).toBeCloseTo(-10)
    expect(at(20).map__bearing).toBeCloseTo(25)
    expect(at(10).map__bearing).toBeCloseTo(7.5, 0)
  })

  it('bypasses the time window, so the grid counts every vertex', async () => {
    const { program, values } = await compileDoc(trips)
    expect(sum(column(await data(program, 'columns', values), 'n'))).toBe(5)
    expect(program.routes.window__min).toBeUndefined()
  })

  it('un-bypassed, the clock flows through SQL: the grid requeries per frame', async () => {
    const doc = structuredClone(trips)
    doc.nodes.find(n => n.id === 'window')!.flags = {}
    const { program, lowered } = await compileDoc(doc, 0)
    expect(program.errors).toEqual([])
    expect(program.routes.window__max.map(r => r.route)).toEqual(['requery'])
    const at = (t: number) => parameterValues(lowered, { T: t, F: 0 }).values
    // Vertex times are 10, 20, 30, 15 and 25; the clock runs at 60 per second.
    const early = await data(program, 'columns', at(0.4)) // window [-576, 24]: 10, 15, 20
    expect(sum(column(early, 'n'))).toBe(3)
    const later = await data(program, 'columns', at(10.2)) // window [12, 612]: drops 10
    expect(sum(column(later, 'n'))).toBe(4)
  })
})

describe('arrivals', () => {
  it('keeps flights ending near the chosen airport and expands each into N vertices', async () => {
    const { program, values } = await compileDoc(arrivals)
    expect(program.errors).toEqual([])
    const lp = program.layers.find(l => l.id === 'trails')!
    const d = await data(program, 'trails', values)
    expect(d.rows).toBe(2 * 24)
    expect([...d.starts!]).toEqual([0, 24])
    // Ordered by flight, then step. The trail covers the last 15% of the flight and ends at the
    // airport end of the segment.
    const t = column(d, 't')
    expect(t[0]).toBeCloseTo(100 + 0.85 * 3600, 1)
    expect(t[23]).toBeCloseTo(3700)
    const P = d.attributes.get('P')!
    expect(P.width).toBe(3)
    expect(P.data[23 * 3 + 1]).toBeCloseTo(51.45, 4)
    // Descending: first vertex at least 3 km up, last at the airport's reported altitude.
    expect(P.data[2]).toBeGreaterThanOrEqual(3000)
    expect(P.data[23 * 3 + 2]).toBeCloseTo(300, 0)
    // Steps are read by the relation and by the wrangle through ch().
    expect(program.routes.steps__count.map(x => x.route).sort()).toEqual(
      expect.arrayContaining(['rematerialize'])
    )
    expect(lp.plan.layer?.pathId).toBe('flight')
  })

  it('switching the airport code rematerializes only the airport side', async () => {
    const doc = structuredClone(arrivals)
    doc.nodes.find(n => n.id === 'airport')!.params.text = 'CDG'
    const { program, values } = await compileDoc(doc)
    expect((await data(program, 'trails', values)).rows).toBe(24)
  })
})

describe('geometry operators', () => {
  // Around the Region Filter's default polygon (lower Manhattan): three inside, one 843 m east
  // of it, one 1264 m west, one 1686 m east.
  const POINTS = `SELECT * FROM (VALUES (-74.0, 40.73), (-73.98, 40.75), (-73.99, 40.72),
    (-73.96, 40.73), (-74.03, 40.73), (-73.95, 40.73)) AS t(lng, lat)`
  const doc = (
    region: Record<string, ParamValue>,
    distance?: Record<string, ParamValue>
  ): EditorDoc => ({
    version: 1,
    name: 'geometry',
    nodes: [
      { id: 'pts', op: 'sql', x: 0, y: 0, params: { query: POINTS } },
      { id: 'area', op: 'region', x: 0, y: 0, params: region },
      { id: 'dist', op: 'geo-distance', x: 0, y: 0, params: distance ?? {} },
      { id: 'pos', op: 'position', x: 0, y: 0, params: {} },
      { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: 'P', radius: 'dist' } },
      { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
    ],
    edges: [
      ['pts', 'area'],
      ['area', 'dist'],
      ['dist', 'pos'],
      ['pos', 'dots'],
    ]
      .map(([source, target], i) => ({
        id: `e${i}`,
        source,
        sourcePort: 'out',
        target,
        targetPort: 'in',
      }))
      .concat([
        { id: 'e9', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
      ]),
  })
  const rows = async (d: EditorDoc) => {
    const { lowered, program, values } = await compileDoc(d)
    expect(lowered.errors).toEqual([])
    expect(program.errors).toEqual([])
    return data(program, 'dots', values)
  }

  it('keeps rows inside, outside and near the polygon', async () => {
    expect((await rows(doc({ mode: 'inside' }))).rows).toBe(3)
    expect((await rows(doc({ mode: 'outside' }))).rows).toBe(3)
    expect((await rows(doc({ mode: 'near', metres: 1000 }))).rows).toBe(4)
    expect((await rows(doc({ mode: 'near', metres: 1500 }))).rows).toBe(5)
  })

  it('binds the distance as a value, so dragging it never replans', async () => {
    const { lowered, program } = await compileDoc(doc({ mode: 'near', metres: 1000 }))
    expect(lowered.graph.params!.area__metres.value).toBe(1000)
    expect(program.routes.area__metres.map(r => r.target)).toEqual(['dots'])
    expect(program.routes.area__metres.some(r => r.route === 'rematerialize')).toBe(false)
  })

  it('measures the distance to the polygon, zero inside', async () => {
    const polygon =
      'POLYGON((-74.02 40.70, -73.97 40.71, -73.97 40.76, -74.01 40.76, -74.02 40.70))'
    const d = await rows(doc({ mode: 'near', metres: 5000 }, { geometry: polygon, units: 'km' }))
    const km = column(d, 'dist').sort((a, b) => a - b)
    expect(km.slice(0, 3)).toEqual([0, 0, 0])
    expect(km[3]).toBeCloseTo(0.843, 2)
    expect(km[5]).toBeCloseTo(1.686, 2)
  })

  it('reports a bad geometry on the node', () => {
    // lat/lng order: San Francisco's longitude read as a latitude. (New York's, −74, is a
    // valid latitude, which is why the check alone cannot catch every swap.)
    const bad = lowerDocument(
      doc({
        mode: 'inside',
        geometry: 'POLYGON((37.7 -122.5, 37.8 -122.5, 37.8 -122.4, 37.7 -122.5))',
      })
    )
    expect(bad.errors).toContainEqual(
      expect.objectContaining({ nodeId: 'area', message: expect.stringMatching(/latitude -122.5/) })
    )
    const line = lowerDocument(doc({ mode: 'inside', geometry: 'LINESTRING(0 0, 1 1)' }))
    expect(line.errors).toContainEqual(
      expect.objectContaining({
        nodeId: 'area',
        message: expect.stringMatching(/needs a polygon, got a LineString/),
      })
    )
  })

  it('escapes quotes in GeoJSON properties', async () => {
    const feature = JSON.stringify({
      type: 'Feature',
      properties: { name: "Hell's Kitchen" },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-74.02, 40.7],
            [-73.97, 40.71],
            [-73.97, 40.76],
            [-74.01, 40.76],
            [-74.02, 40.7],
          ],
        ],
      },
    })
    expect((await rows(doc({ mode: 'inside', geometry: feature }))).rows).toBe(3)
  })
})

describe('references, expressions and cycles', () => {
  const doc = (): EditorDoc => ({
    version: 1,
    name: 'refs',
    nodes: [
      { id: 'a', op: 'number', x: 0, y: 0, params: { value: 3 } },
      { id: 'b', op: 'number', x: 0, y: 0, params: { value: { expr: "ch('a/value') * 2 + T" } } },
      { id: 'sub', op: 'subnet', x: 0, y: 0, params: {} },
      {
        id: 'c',
        op: 'number',
        parent: 'sub',
        x: 0,
        y: 0,
        params: { value: { ref: '../a/value' } },
      },
      { id: 'd', op: 'number', parent: 'sub', x: 0, y: 0, params: { value: { ref: '/b/value' } } },
      { id: 'loop1', op: 'number', x: 0, y: 0, params: { value: { ref: 'loop2/value' } } },
      { id: 'loop2', op: 'number', x: 0, y: 0, params: { value: { ref: 'loop1/value' } } },
    ],
    edges: [],
  })

  it('resolves sibling, parent and absolute paths', () => {
    const d = doc()
    const c = d.nodes.find(n => n.id === 'c')!
    expect(resolveRef(d, c, '../a/value')).toBe('a.value')
    expect(resolveRef(d, c, '/b/value')).toBe('b.value')
    expect(resolveRef(d, c, 'value')).toBe('c.value')
    expect(() => resolveRef(d, c, 'nope/value')).toThrow(/no node 'nope'/)
  })

  it('evaluates expressions over references and the clock, and reports a cycle', () => {
    const lowered = lowerDocument(doc())
    const { slots, errors } = parameterValues(lowered, { T: 1.5, F: 45 })
    expect(slots.get('b.value')).toBe(7.5)
    expect(slots.get('c.value')).toBe(3)
    expect(slots.get('d.value')).toBe(7.5)
    expect([...errors.values()].some(m => /cycle/.test(m))).toBe(true)
    expect(lowered.scalars.animated('b.value')).toBe(true)
    expect(lowered.scalars.animated('c.value')).toBe(false)
  })
})

describe('subnets', () => {
  it('collapsing nodes into a subnet with a promoted parameter changes nothing downstream', async () => {
    const flat = earthquakes
    const nested: EditorDoc = structuredClone(flat)
    // Put `strong` and `pos` inside a subnet, wired through its input and output.
    nested.nodes.push(
      {
        id: 'sub',
        op: 'subnet',
        name: 'prep',
        x: 260,
        y: 120,
        params: { minimum: 2.5 },
        promoted: [{ name: 'minimum', node: 'strong', param: 'value' }],
      },
      { id: 'sin', op: 'subnet-input', parent: 'sub', x: 0, y: 0, params: { index: 0 } },
      { id: 'sout', op: 'subnet-output', parent: 'sub', x: 0, y: 0, params: { index: 0 } }
    )
    for (const n of nested.nodes) if (n.id === 'strong' || n.id === 'pos') n.parent = 'sub'
    nested.edges = nested.edges.filter(e => !['e1', 'e2', 'e4'].includes(e.id))
    nested.edges.push(
      { id: 's1', source: 'quakes', sourcePort: 'out', target: 'sub', targetPort: 'in0' },
      { id: 's2', source: 'sin', sourcePort: 'out', target: 'strong', targetPort: 'in' },
      { id: 's3', source: 'pos', sourcePort: 'out', target: 'sout', targetPort: 'in' },
      { id: 's4', source: 'sub', sourcePort: 'out0', target: 'size', targetPort: 'in' }
    )
    const f = flattenSubnets(nested)
    expect(f.nodes.find(n => n.id === 'strong')?.parent).toBeUndefined()
    expect(f.edges.find(e => e.target === 'strong' && e.targetPort === 'in')?.source).toBe('quakes')

    const a = await compileDoc(flat)
    const b = await compileDoc(nested)
    expect(b.lowered.errors).toEqual([])
    expect(b.values.strong__value).toBe(2.5)
    expect(b.program.relations.map(r => r.hash)).toEqual(a.program.relations.map(r => r.hash))
    expect(b.program.layers.map(l => l.plan.sql)).toEqual(a.program.layers.map(l => l.plan.sql))
  })
})

describe('keyframe interpolation (ported from Noodles)', () => {
  it('holds before the first key and after the last, and eases between', () => {
    const track = {
      target: 'x.y',
      keyframes: [
        {
          id: '1',
          time: 1,
          value: 0,
          interpolation: 'bezier' as const,
          handles: EASING_PRESETS[4].handles,
        },
        { id: '2', time: 3, value: 10, interpolation: 'hold' as const },
        { id: '3', time: 5, value: 20, interpolation: 'linear' as const },
      ],
    }
    expect(evaluateTrack(track, 0)).toBe(0)
    expect(evaluateTrack(track, 2)).toBeCloseTo(5, 5) // ease-in-out is symmetric
    expect(evaluateTrack(track, 1.5)).toBeLessThan(2.5) // and slow at the start
    expect(evaluateTrack(track, 4)).toBe(10) // hold
    expect(evaluateTrack(track, 9)).toBe(20)
    expect(bezierEasing(0.5, { left: [0, 0], right: [1, 1] })).toBeCloseTo(0.5, 3)
  })
})

describe('hex cells with holes', () => {
  const hexes = hexesJson as unknown as EditorDoc

  it('groups vertices into cells and rings, with holes only where value is high', async () => {
    const { lowered, program, values } = await compileDoc(hexes)
    expect(lowered.errors).toEqual([])
    expect(program.errors).toEqual([])
    const d = await data(program, 'hexes', values)
    const cells = d.starts!.length
    const holes = d.rings!.length - cells
    expect(cells).toBeGreaterThan(50)
    expect(holes).toBeGreaterThan(0)
    expect(holes).toBeLessThan(cells)
    // Six vertices a ring, so every ring start is six rows after the last.
    expect([...d.rings!].every((r, i, all) => i === 0 || r - all[i - 1] === 6)).toBe(true)
    // A hexagon is 4 triangles; its hole adds 8 more for the annulus (12 vertices, 2 rings).
    const position = program.layers
      .find(l => l.id === 'hexes')!
      .plan.layer!.bindings.find(b => b.channel === 'position')!.attribute
    const P = d.attributes.get(position)!
    const tri = triangulate(P.data, P.width, d.rows, d.starts!, d.rings!)
    expect(tri.indices.length / 3).toBe(cells * 4 + holes * 8)
  })

  it('the range filter removes whole cells in SQL, not single vertices', async () => {
    const { program, values } = await compileDoc(hexes)
    const all = await data(program, 'hexes', { ...values, busy__min: 0 })
    const some = await data(program, 'hexes', values)
    expect(some.starts!.length).toBeLessThan(all.starts!.length)
    expect(some.rows % 6).toBe(0)
  })
})
