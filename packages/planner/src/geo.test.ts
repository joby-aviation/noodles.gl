import { describe, it, expect } from 'vitest';
import { type Expr, parseExpr, enginesFor, simplifyExpr, walk } from './expr.js';
import { buildRegistry, inlineFunctions } from './functions.js';
import { GEO_PRELUDE, GEO_SPECS, EARTH_RADIUS_M, WEB_MERCATOR_RADIUS_M } from './geo.js';
import { desugar, type Graph } from './types.js';
import { analyze } from './analyze.js';
import { toSql, toSqlColumns } from './backends/sql.js';
import { toWgsl } from './backends/wgsl.js';
import { toJs } from './backends/js.js';

/**
 * The geo prelude is arithmetic, so it is checked the way arithmetic is: executed, against an
 * independent reference. The references below are turf's algorithms written out separately in
 * plain f64 JS — `distance` via atan2 rather than asin, `midpoint` via distance, bearing and
 * destination rather than the direct formula — so a shared typo cannot make both agree.
 */

/** Resolve an expression exactly as `analyze` does: parse, inline, simplify. */
function resolveGeo(src: string): Expr {
  return simplifyExpr(inlineFunctions(parseExpr(src, { functions: GEO_PRELUDE }), GEO_PRELUDE));
}

/** Evaluate through the JS backend. Every column is a scalar read from `c`. */
function geo(src: string, c: Record<string, number> = {}): number[] {
  const emitted = toJs(resolveGeo(src), (name) => ({ width: 1, component: () => `c.${name}` }));
  const fn = new Function('c', 'p', `return [${emitted.components.join(', ')}];`) as (
    c: Record<string, number>, p: Record<string, number>,
  ) => number[];
  return fn(c, {});
}
/** A comparison at the root is a JS boolean; the CPU stage stores it into a Float32Array as 0/1. */
const one = (src: string, c?: Record<string, number>) => Number(geo(src, c)[0]);
const pair = { lng1: 0, lat1: 0, lng2: 0, lat2: 0 };
const at = (a: number[], b: number[]) => ({ lng1: a[0], lat1: a[1], lng2: b[0], lat2: b[1] });

// --- turf, independently ---------------------------------------------------
const R = (d: number) => (d * Math.PI) / 180;
const D = (r: number) => (r * 180) / Math.PI;
const EARTH_KM = 6371.0088;
function refDistanceKm(a: number[], b: number[]): number {
  const dLat = R(b[1] - a[1]);
  const dLon = R(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(R(a[1])) * Math.cos(R(b[1]));
  return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * EARTH_KM;
}
function refBearing(a: number[], b: number[]): number {
  const [l1, p1, l2, p2] = [R(a[0]), R(a[1]), R(b[0]), R(b[1])];
  return D(Math.atan2(
    Math.sin(l2 - l1) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1),
  ));
}
function refDestination(p: number[], km: number, deg: number): number[] {
  const [l1, p1, brg, d] = [R(p[0]), R(p[1]), R(deg), km / EARTH_KM];
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg));
  const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [D(l2), D(p2)];
}
function refMidpoint(a: number[], b: number[]): number[] {
  return refDestination(a, refDistanceKm(a, b) / 2, refBearing(a, b));
}

/** Deterministic points, so a failure reproduces. */
function points(n: number, seed = 7): number[][] {
  let s = seed;
  const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, () => [next() * 360 - 180, next() * 160 - 80]);
}
const pairs = points(80).map((a, i, all) => [a, all[(i + 17) % all.length]]);
const rel = (got: number, want: number) => Math.abs(got - want) / Math.max(Math.abs(want), 1e-12);
/** Longitudes are equal modulo 360: neither turf nor this wraps them. */
const lngDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('geo prelude: exact anchors', () => {
  it('measures one degree of longitude at the equator and pole to pole', () => {
    expect(one('distance([lng1, lat1], [lng2, lat2])', { ...pair, lng2: 1 }))
      .toBeCloseTo((2 * Math.PI * EARTH_RADIUS_M) / 360 / 1000, 9);
    expect(one('st_distance_sphere([lng1, lat1], [lng2, lat2])', { ...pair, lat1: -90, lat2: 90 }))
      .toBeCloseTo(Math.PI * EARTH_RADIUS_M, 3);
  });

  it('does not return NaN for antipodal points', () => {
    for (const [a, b] of [[[0, 0], [180, 0]], [[45, 30], [-135, -30]], [[10, 89.999], [-170, -89.999]]]) {
      const m = one('st_distance_sphere([lng1, lat1], [lng2, lat2])', at(a, b));
      expect(Number.isNaN(m)).toBe(false);
      expect(m).toBeCloseTo(Math.PI * EARTH_RADIUS_M, -1);
    }
  });

  it('reads bearings in turf degrees and ST_Azimuth radians', () => {
    const b = (to: number[]) => one('bearing([lng1, lat1], [lng2, lat2])', at([0, 0], to));
    const az = (to: number[]) => one('st_azimuth([lng1, lat1], [lng2, lat2])', at([0, 0], to));
    expect(b([0, 1])).toBeCloseTo(0, 12);
    expect(b([1, 0])).toBeCloseTo(90, 12);
    expect(b([-1, 0])).toBeCloseTo(-90, 12);
    expect(b([0, -1])).toBeCloseTo(180, 12);
    // ST_Azimuth is [0, 2π): west is 3π/2, not -π/2.
    expect(az([-1, 0])).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(az([1, 0])).toBeCloseTo(Math.PI / 2, 12);
  });

  it('projects a point and lands where distance says it should', () => {
    const km = (2 * Math.PI * EARTH_RADIUS_M) / 360 / 1000;
    const [x, y] = geo('destination([lng, lat], km, deg)', { lng: 0, lat: 0, km, deg: 90 });
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    // ST_Project is the same body in metres and radians.
    const pg = geo('st_project([lng, lat], m, az)', { lng: 12, lat: 34, m: 5e5, az: 1.1 });
    const tf = geo('destination([lng, lat], km, deg)', { lng: 12, lat: 34, km: 500, deg: D(1.1) });
    expect(pg[0]).toBeCloseTo(tf[0], 10);
    expect(pg[1]).toBeCloseTo(tf[1], 10);
  });

  it('finds midpoints on the equator', () => {
    for (const [a, b, want] of [[[0, 0], [90, 0], [45, 0]], [[-10, 0], [10, 0], [0, 0]]]) {
      const got = geo('midpoint([lng1, lat1], [lng2, lat2])', at(a, b));
      got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 12));
    }
  });

  it('projects to EPSG:3857 and back', () => {
    const [x] = geo('to_mercator([lng, lat])', { lng: 180, lat: 0 });
    expect(x).toBeCloseTo(20037508.342789244, 6);
    // Clamped at the square: the pole lands on the max extent rather than at infinity.
    const [, y] = geo('toMercator([lng, lat])', { lng: 0, lat: 90 });
    expect(y).toBeCloseTo(Math.PI * WEB_MERCATOR_RADIUS_M, 0);
    for (const [lng, lat] of points(20)) {
      const [px, py] = geo('to_mercator([lng, lat])', { lng, lat });
      const [bl, bt] = geo('toWgs84([x, y])', { x: px, y: py });
      expect(bl).toBeCloseTo(lng, 9);
      expect(bt).toBeCloseTo(lat, 9);
    }
  });

  it('answers the predicates with 0 and 1', () => {
    const near = { ...pair, lng2: 0.001 }; // ~111 m
    expect(one('st_dwithin([lng1, lat1], [lng2, lat2], 200.0)', near)).toBe(1);
    expect(one('st_dwithin([lng1, lat1], [lng2, lat2], 100.0)', near)).toBe(0);
    expect(one('point_in_bbox([lng, lat], -1, -1, 1, 1)', { lng: 0.5, lat: 1 })).toBe(1);
    expect(one('point_in_bbox([lng, lat], -1, -1, 1, 1)', { lng: 1.5, lat: 0 })).toBe(0);
  });
});

describe('geo prelude: against turf, independently', () => {
  it('distance', () => {
    for (const [a, b] of pairs) {
      expect(rel(one('distance([lng1, lat1], [lng2, lat2])', at(a, b)), refDistanceKm(a, b))).toBeLessThan(1e-9);
    }
  });

  it('bearing', () => {
    for (const [a, b] of pairs) {
      expect(one('bearing([lng1, lat1], [lng2, lat2])', at(a, b))).toBeCloseTo(refBearing(a, b), 9);
    }
  });

  it('destination', () => {
    for (const [i, [a]] of pairs.entries()) {
      const [km, deg] = [(i * 211) % 5000 + 1, (i * 37) % 360 - 180];
      const [x, y] = geo('destination([lng, lat], km, deg)', { lng: a[0], lat: a[1], km, deg });
      const [rx, ry] = refDestination(a, km, deg);
      expect(lngDiff(x, rx)).toBeLessThan(1e-9);
      expect(y).toBeCloseTo(ry, 9);
    }
  });

  it('midpoint, by the direct formula, matches turf going through destination', () => {
    // Near-antipodal pairs have no well-defined midpoint; turf and the direct formula pick
    // different ones.
    for (const [a, b] of pairs.filter(([a, b]) => refDistanceKm(a, b) < 19000)) {
      const [x, y] = geo('midpoint([lng1, lat1], [lng2, lat2])', at(a, b));
      const [rx, ry] = refMidpoint(a, b);
      expect(lngDiff(x, rx)).toBeLessThan(1e-7);
      expect(y).toBeCloseTo(ry, 7);
    }
  });
});

describe('geo prelude: where it can run', () => {
  const engines = (src: string) => [...enginesFor(resolveGeo(src))].sort();

  it('stays SQL-feasible when points are built from scalar columns', () => {
    expect(engines('distance([lng, lat], [{{lng0}}, {{lat0}}])')).toEqual(['gpu', 'sql']);
    expect(engines('st_dwithin([lng, lat], [{{lng0}}, {{lat0}}], {{m}})')).toEqual(['gpu', 'sql']);
    // A point-valued result at the root is fine: SQL splits a top-level vector into columns.
    expect(engines('midpoint([a, b], [c, d])')).toEqual(['gpu', 'sql']);
    // …and a component of one simplifies away entirely.
    expect(engines('st_y(destination([lng, lat], 10, 45))')).toEqual(['gpu', 'sql']);
  });

  it('is GPU/CPU-only when a point is a vector column', () => {
    // `P.x` is a swizzle of a column; SQL columns are scalars, so there is nothing to simplify.
    expect(engines('distance(P, Q)')).toEqual(['gpu']);
  });

  it('leaves no geo call and no swizzle of a literal behind', () => {
    const e = resolveGeo('midpoint(st_point(lng, lat), destination([lng, lat], km, bearing([lng, lat], [x, y])))');
    walk(e, (n) => {
      if (n.kind === 'call') expect(GEO_PRELUDE.has(n.fn), n.fn).toBe(false);
      if (n.kind === 'swizzle') expect(n.target.kind).not.toBe('vec');
    });
  });

  it('compiles every function on every backend it claims', () => {
    // Point parameters get a literal built from scalar columns; everything else a column.
    const POINT = /^(a|b|p)$/;
    for (const [name, spec] of Object.entries(GEO_SPECS)) {
      const args = spec.params.map((p, i) => (POINT.test(p) ? `[x${i}, y${i}]` : `s${i}`));
      const e = resolveGeo(`${name}(${args.join(', ')})`);
      // Every point above is built from scalars, so every function must reach all three.
      expect([...enginesFor(e)].sort(), name).toEqual(['gpu', 'sql']);
      expect(() => (e.kind === 'vec' ? toSqlColumns(e, 'v') : toSql(e)), name).not.toThrow();
      expect(() => toWgsl(e, (n) => ({ code: `a_${n}`, width: 1 })), name).not.toThrow();
      expect(toJs(e, (n) => ({ width: 1, component: () => `c.${n}` })).components.length).toBeGreaterThan(0);
    }
  });
});

describe('geo prelude: scope', () => {
  it('is in every graph without being declared', () => {
    const graph: Graph = {
      params: { lng0: { value: -73.97 }, lat0: { value: 40.78 } },
      nodes: [
        { id: 'src', type: 'source', dataset: { ref: 't' } },
        { id: 'd', type: 'attribute', input: 'src', name: 'km', expr: 'distance([lng, lat], [{{lng0}}, {{lat0}}])' },
        { id: 'w', type: 'wrangle', input: 'd', body: '@m = st_distance_sphere([lng, lat], [0.0, 0.0]);' },
        { id: 'out', type: 'render', input: 'w', mode: 'points' },
      ],
    };
    const a = analyze(graph, new Map([['lng', 1], ['lat', 1]]));
    const km = a.order.find((n) => n.id === 'd')!;
    expect([...km.feasible].sort()).toEqual(['cpu', 'gpu', 'sql']);
  });

  it('cannot be redefined, from graph functions or a wrangle', () => {
    expect(() => buildRegistry({ distance: { params: ['a', 'b'], body: 'a - b' } }, new Map(GEO_PRELUDE)))
      .toThrow(/'distance' is a built-in geo function/);
    const graph: Graph = {
      params: {},
      nodes: [
        { id: 'src', type: 'source', dataset: { ref: 't' } },
        { id: 'w', type: 'wrangle', input: 'src', body: 'fn bearing(a, b) = 0.0;\n@x = 1.0;' },
        { id: 'out', type: 'render', input: 'w', mode: 'points' },
      ],
    };
    expect(() => desugar(graph)).toThrow(/'bearing' is a built-in geo function/);
  });

  it('project(mercator) plans the same tree it did when the formula was spelled out', () => {
    const graph: Graph = {
      params: {},
      nodes: [
        { id: 'src', type: 'source', dataset: { ref: 't' } },
        { id: 'p', type: 'project', input: 'src', mode: 'mercator', x: 'lng + 1', y: 'lat', z: 'h', worldScale: '{{s}}' },
        { id: 'out', type: 'render', input: 'p', mode: 'points' },
      ],
    };
    const out = desugar(graph);
    const node = out.nodes.find((n) => n.id === 'p')!;
    if (node.type !== 'attribute' || typeof node.expr !== 'string') throw new Error('expected an attribute');
    const now = simplifyExpr(inlineFunctions(parseExpr(node.expr, { functions: out.functions }), out.functions));
    const before = parseExpr(
      '[((lng + 1) / 360.0) * ({{s}}), ' +
      '(ln(tan(0.7853981634 + (lat) * 0.008726646259971648)) / 6.283185307) * ({{s}}), (h) * ({{s}})]',
    );
    expect(now).toEqual(before);
  });

  it('distance operator: the old hand-written haversine, up to the radius', () => {
    const old = parseExpr(
      '12742.0 * asin(sqrt(pow(sin((lat2 - lat1) * 0.00872664626), 2.0) + cos(lat1 * 0.01745329252) * ' +
      'cos(lat2 * 0.01745329252) * pow(sin((lng2 - lng1) * 0.00872664626), 2.0)))',
    );
    const oldFn = new Function('c', `return ${toJs(old, (n) => ({ width: 1, component: () => `c.${n}` })).components[0]};`) as
      (c: Record<string, number>) => number;
    for (const [a, b] of pairs.filter(([a, b]) => refDistanceKm(a, b) < 19000)) {
      // 6371.0088 / 6371, and the old constants were rounded to 11 digits.
      expect(rel(one('distance([lng1, lat1], [lng2, lat2])', at(a, b)) / oldFn(at(a, b)), EARTH_KM / 6371)).toBeLessThan(1e-9);
    }
  });
});
