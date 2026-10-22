import { describe, it, expect } from 'vitest';
import { type Expr, parseExpr, enginesFor, simplifyExpr, walk } from './expr.js';
import { inlineFunctions, FunctionError } from './functions.js';
import { GEO_PRELUDE, GEO_MACROS } from './geo.js';
import {
  type Position, parseGeometry, GeometryError, MAX_GEOMETRY_VERTICES, EARTH_RADIUS_M,
  areaM2, lengthM, perimeterM, centroidOf, vertexMean, bboxOf, vertices,
} from './geometry.js';
import { toSql, toSqlColumns } from './backends/sql.js';
import { toWgsl } from './backends/wgsl.js';
import { toJs } from './backends/js.js';

/**
 * Constant geometries. Two kinds of reference:
 *
 * - **DuckDB spatial**, pinned. The CLI with the spatial extension computed the values marked
 *   below; the query is next to each. They are pinned rather than run because DuckDB-Wasm
 *   downloads extensions and hangs offline (docs/geometry.md). DuckDB's `_Spheroid` functions
 *   and `ST_Distance_Sphere` read (lat, lng), hence the `ST_FlipCoordinates`.
 * - **Independent algorithms**, in plain f64 here: winding number rather than crossing
 *   number, dense sampling of the great circle rather than a projection, turf's own walk
 *   for `along`. A shared mistake cannot make both sides agree.
 */

function resolveGeo(src: string): Expr {
  return simplifyExpr(inlineFunctions(parseExpr(src, { functions: GEO_PRELUDE }), GEO_PRELUDE));
}
function geo(src: string, c: Record<string, number> = {}): number[] {
  const emitted = toJs(resolveGeo(src), (name) => ({ width: 1, component: () => `c.${name}` }));
  const fn = new Function('c', 'p', `return [${emitted.components.join(', ')}];`) as (
    c: Record<string, number>, p: Record<string, number>,
  ) => unknown[];
  return fn(c, {}).map(Number);
}
const one = (src: string, c?: Record<string, number>) => geo(src, c)[0];
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);

const MANHATTAN = 'POLYGON((-74.02 40.70, -73.93 40.70, -73.91 40.80, -73.97 40.88, -74.01 40.76, -74.02 40.70), ' +
  '(-73.99 40.74, -73.96 40.74, -73.96 40.77, -73.99 40.77, -73.99 40.74))';
const MULTI = 'MULTIPOLYGON(((0 0, 2 0, 1 2, 0 0)), ((3 3, 5 3, 5 5, 3 5, 3 3)))';
const ROUTE = 'LINESTRING(-122.42 37.77, -122.40 37.79, -122.39 37.80, -122.27 37.80)';

// --- independent references --------------------------------------------------
const RAD = Math.PI / 180;
/** Winding number, over every ring: nonzero inside. Holes wind the other way once normalized. */
function refInside(rings: Position[][], [x, y]: Position): boolean {
  let parity = 0;
  for (const r of rings) {
    let wn = 0;
    for (let i = 0; i + 1 < r.length; i++) {
      const [a, b] = [r[i], r[i + 1]];
      const side = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (a[1] <= y && b[1] > y && side > 0) wn++;
      else if (a[1] > y && b[1] <= y && side < 0) wn--;
    }
    if (wn !== 0) parity ^= 1;
  }
  return parity === 1;
}
function refHaversine(a: Position, b: Position): number {
  const h = Math.sin((b[1] - a[1]) * RAD / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin((b[0] - a[0]) * RAD / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
/**
 * Minimum haversine to 2000 points along each segment: straight in lng/lat as PostGIS
 * `geometry` and turf take an edge (and as `st_contains` does here), or `greatCircle`, as
 * `geography` does. The two part by the great circle's poleward bulge, L²·tan(lat)/8R.
 */
function refLineDistance(line: Position[], p: Position, greatCircle = false): number {
  const xyz = ([lng, lat]: Position) => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const [va, vb] = [xyz(a), xyz(b)];
    for (let k = 0; k <= 2000; k++) {
      const t = k / 2000;
      let q: Position = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      if (greatCircle) {
        const v = [0, 1, 2].map((j) => (1 - t) * va[j] + t * vb[j]);
        q = [Math.atan2(v[1], v[0]) / RAD, Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD];
      }
      best = Math.min(best, refHaversine(p, q));
    }
  }
  return best;
}
/** turf.along, as turf walks it: back from the vertex past the distance, on the reverse bearing. */
function refAlong(line: Position[], km: number): Position {
  const bearing = (a: Position, b: Position) => Math.atan2(
    Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD),
    Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) - Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD),
  ) / RAD;
  const destination = (p: Position, m: number, deg: number): Position => {
    const [l1, p1, t, d] = [p[0] * RAD, p[1] * RAD, deg * RAD, m / EARTH_RADIUS_M];
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    return [(l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))) / RAD, p2 / RAD];
  };
  let travelled = 0;
  for (let i = 0; i < line.length; i++) {
    if (km * 1000 >= travelled && i === line.length - 1) break;
    if (travelled >= km * 1000) {
      const overshot = km * 1000 - travelled;
      if (overshot === 0) return line[i];
      return destination(line[i], overshot, bearing(line[i], line[i - 1]) - 180);
    }
    travelled += refHaversine(line[i], line[i + 1]);
  }
  return line[line.length - 1];
}

describe('parsing a literal', () => {
  it('reads every WKT type, with Z and SRID=4326', () => {
    expect(parseGeometry('POINT(1 2)')).toEqual({ dim: 0, type: 'Point', points: [[1, 2]] });
    expect(parseGeometry('multipoint((1 2), (3 4))').dim).toBe(0);
    expect(parseGeometry('MULTIPOINT(1 2, 3 4)')).toEqual(parseGeometry('MULTIPOINT((1 2), (3 4))'));
    expect(parseGeometry('LINESTRING Z (0 0 5, 1 1 6)')).toEqual({ dim: 1, type: 'LineString', lines: [[[0, 0], [1, 1]]] });
    expect(parseGeometry('SRID=4326;MULTILINESTRING((0 0, 1 1), (2 2, 3 3))').dim).toBe(1);
    expect(parseGeometry(MANHATTAN)).toMatchObject({ dim: 2, type: 'Polygon' });
    expect(parseGeometry(MULTI)).toMatchObject({ dim: 2, type: 'MultiPolygon' });
    expect(parseGeometry('POINT(-1.5e1 .5)')).toEqual({ dim: 0, type: 'Point', points: [[-15, 0.5]] });
  });

  it('reads GeoJSON geometries, features and collections', () => {
    const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    expect(parseGeometry(JSON.stringify(square))).toEqual(parseGeometry('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))'));
    expect(parseGeometry(JSON.stringify({ type: 'Feature', properties: {}, geometry: square })).type).toBe('Polygon');
    const fc = { type: 'FeatureCollection', features: [square, square].map((geometry) => ({ type: 'Feature', geometry })) };
    expect(parseGeometry(JSON.stringify(fc))).toMatchObject({ type: 'MultiPolygon', polygons: [[expect.any(Array)], [expect.any(Array)]] });
  });

  it('rejects what it cannot mean', () => {
    const bad: [string, RegExp][] = [
      ['POLYGON((0 0, 1 0, 1 1, 0 0.5))', /not closed/],
      ['POLYGON((0 0, 1 0, 0 0))', /at least 4/],
      ['LINESTRING(0 0)', /at least 2/],
      ['POINT EMPTY', /EMPTY/],
      ['SRID=3857;POINT(0 0)', /SRID 3857/],
      ['POINT(0 95)', /latitude 95/],
      ['GEOMETRYCOLLECTION(POINT(0 0))', /GEOMETRYCOLLECTION/],
      ['CIRCLE(0 0)', /unknown geometry type/],
      ['POINT(0 0) POINT(1 1)', /unexpected/],
      ['{"type": "FeatureCollection", "features": [{"type": "Point", "coordinates": [0, 0]}, {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}]}', /mixing/],
      ['{"type": "Polygon"', /GeoJSON/],
    ];
    for (const [text, why] of bad) expect(() => parseGeometry(text), text).toThrow(why);
    const big = `LINESTRING(${Array.from({ length: MAX_GEOMETRY_VERTICES + 1 }, (_, i) => `${i * 0.001} 0`).join(', ')})`;
    expect(() => parseGeometry(big)).toThrow(GeometryError);
    expect(() => parseGeometry('POINT(0 0)', 'geojson')).toThrow(/Expected GeoJSON/);
  });
});

describe('measures of a literal, against DuckDB spatial', () => {
  it('centroid, planar as ST_Centroid', () => {
    // SELECT ST_Centroid(ST_GeomFromText(…))
    const pinned: [string, Position][] = [
      [MANHATTAN, [-73.96257183908047, 40.77234195402299]],
      [MULTI, [3.0, 2.888888888888889]],
      [ROUTE, [-122.34959029062227, 37.79608194187555]],
      ['MULTIPOINT(1 2, 3 5, -4 0)', [0, 2.3333333333333335]],
    ];
    for (const [wkt, [x, y]] of pinned) {
      const c = centroidOf(parseGeometry(wkt));
      expect(c[0], wkt).toBeCloseTo(x, 12);
      expect(c[1], wkt).toBeCloseTo(y, 12);
    }
  });

  it('area, perimeter and length on the sphere, within 0.5% of the spheroid', () => {
    // ST_Area_Spheroid / ST_Perimeter_Spheroid / ST_Length_Spheroid(ST_FlipCoordinates(…))
    expect(rel(areaM2(parseGeometry(MANHATTAN)), 108768498.04659271)).toBeLessThan(0.005);
    expect(rel(areaM2(parseGeometry('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))')), 12308778361.469452)).toBeLessThan(0.005);
    const outer = 'POLYGON((-74.02 40.70, -73.93 40.70, -73.91 40.80, -73.97 40.88, -74.01 40.76, -74.02 40.70))';
    expect(rel(perimeterM(parseGeometry(outer)), 49526.11017586911)).toBeLessThan(0.005);
    expect(rel(lengthM(parseGeometry(ROUTE)), 14819.451386983397)).toBeLessThan(0.005);
  });

  it('area is the sphere formula exactly for a box, and ignores winding', () => {
    const box = (s: string) => areaM2(parseGeometry(s));
    const exact = EARTH_RADIUS_M ** 2 * RAD * (Math.sin(41 * RAD) - Math.sin(40 * RAD));
    expect(box('POLYGON((0 40, 1 40, 1 41, 0 41, 0 40))')).toBeCloseTo(exact, 0);
    expect(box('POLYGON((0 40, 0 41, 1 41, 1 40, 0 40))')).toBeCloseTo(exact, 0);
    expect(areaM2(parseGeometry(ROUTE))).toBe(0);
    expect(lengthM(parseGeometry(MANHATTAN))).toBe(0);
  });

  it('counts, bounds and the turf centres', () => {
    expect(vertices(parseGeometry(MANHATTAN))).toHaveLength(11); // ST_NPoints
    expect(bboxOf(parseGeometry(MANHATTAN))).toEqual([-74.02, 40.7, -73.91, 40.88]); // ST_Extent
    // turf.centroid leaves each ring's closing vertex out.
    expect(vertexMean(parseGeometry('POLYGON((0 0, 3 0, 0 3, 0 0))'))).toEqual([1, 1]);
  });
});

describe('predicates, expanded', () => {
  const grid = (x0: number, y0: number, dx: number, dy: number, nx: number, ny: number, ox: number, oy: number) => {
    const out: Position[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push([x0 + i * dx + ox, y0 + j * dy + oy]);
    return out;
  };

  it('st_contains classifies a grid as DuckDB spatial does, hole included', () => {
    // string_agg(ST_Contains(g, ST_Point(-74.03 + i * 0.0093 + 0.00037, 40.69 + j * 0.0097 + 0.00041)), ORDER BY j, i)
    // over i < 14, j < 21.
    const pinned = '000000000000000011111111100000111111111000001111111111000011111111110000111111111100001110001111000001100011110000011000111110000111111111100000111111111000001111111110000011111111100000011111110000000111111000000001111100000000001111000000000011100000000000110000000000000000000000000000000000';
    const got = grid(-74.03, 40.69, 0.0093, 0.0097, 14, 21, 0.00037, 0.00041)
      .map(([lng, lat]) => one(`st_contains('${MANHATTAN}', [lng, lat])`, { lng, lat })).join('');
    expect(got).toBe(pinned);
  });

  it('st_intersects takes either order and a MultiPolygon', () => {
    // The same over MULTI, i, j < 17 from -0.5 + k * 0.37 + (0.011, 0.013).
    const pinned = '0000000000000000000000000000000000001111100000000000001110000000000000011100000000000000010000000000000000100000000000000000000000000000000000000000000000000000000000000000000000001111100000000000011111000000000000111110000000000001111100000000000011111000000000000000000000000000000000000';
    const pts = grid(-0.5, -0.5, 0.37, 0.37, 17, 17, 0.011, 0.013);
    expect(pts.map(([lng, lat]) => one(`st_intersects('${MULTI}', [lng, lat])`, { lng, lat })).join('')).toBe(pinned);
    expect(pts.map(([lng, lat]) => one(`st_intersects([lng, lat], '${MULTI}')`, { lng, lat })).join('')).toBe(pinned);
  });

  it('agrees with a winding-number test, on every alias', () => {
    const rings = parseGeometry(MANHATTAN) as { polygons: Position[][][] };
    const pts = grid(-74.04, 40.68, 0.0031, 0.0029, 50, 75, 0.00013, 0.00017);
    for (const src of [
      `st_within([lng, lat], '${MANHATTAN}')`,
      `point_in_polygon([lng, lat], st_geomfromtext('${MANHATTAN}'))`,
      `booleanPointInPolygon([lng, lat], '${MANHATTAN}')`,
      `!st_disjoint([lng, lat], '${MANHATTAN}')`,
    ]) {
      const wrong = pts.filter(([lng, lat]) => (one(src, { lng, lat }) === 1) !== refInside(rings.polygons[0], [lng, lat]));
      expect(wrong, src).toEqual([]);
    }
  });

  it('builds an envelope from constants', () => {
    expect(one('st_contains(st_makeenvelope(-1.0, -1.0, 1.0, 1.0), [lng, lat])', { lng: 0.9, lat: -0.9 })).toBe(1);
    expect(one('st_contains(st_makeenvelope(-1.0, -1.0, 1.0, 1.0), [lng, lat])', { lng: 1.1, lat: 0 })).toBe(0);
  });
});

describe('distances, expanded', () => {
  const line: Position[] = [[-122.42, 37.77], [-122.40, 37.79], [-122.39, 37.80], [-122.27, 37.80]];

  it('to a line: within 1e-5 of the haversine to the nearest point out to 50 km', () => {
    let worst = 0;
    let bulge = 0;
    for (let i = 0; i < 60; i++) {
      // A spiral around the route: every side, every segment nearest at some point.
      const r = 0.002 + i * 0.0075;
      const p: Position = [-122.35 + r * Math.cos(i * 2.4), 37.79 + r * Math.sin(i * 2.4)];
      const want = refLineDistance(line, p);
      const got = one(`st_distance('${ROUTE}', [lng, lat])`, { lng: p[0], lat: p[1] });
      if (want < 50_000) worst = Math.max(worst, rel(got, want));
      bulge = Math.max(bulge, Math.abs(got - refLineDistance(line, p, true)));
    }
    expect(worst).toBeLessThan(1e-5); // measured 1.2e-6
    // The longest edge is 10.5 km at 37.8°: a bulge of 1.7 m.
    expect(bulge).toBeLessThan(1.8);
  });

  it('in kilometres for turf, in metres for PostGIS', () => {
    const c = { lng: -122.35, lat: 37.9 };
    const m = one(`st_distance_sphere('${ROUTE}', [lng, lat])`, c);
    expect(one(`pointToLineDistance([lng, lat], '${ROUTE}')`, c)).toBeCloseTo(m / 1000, 9);
    expect(one(`point_to_line_distance([lng, lat], '${ROUTE}')`, c)).toBeCloseTo(m / 1000, 9);
    expect(one(`st_dwithin([lng, lat], '${ROUTE}', ${m + 1})`, c)).toBe(1);
    expect(one(`st_dwithin([lng, lat], '${ROUTE}', ${m - 1})`, c)).toBe(0);
  });

  it('to a polygon is zero inside and the boundary distance outside', () => {
    expect(one(`st_distance('${MANHATTAN}', [lng, lat])`, { lng: -73.95, lat: 40.75 })).toBe(0);
    // Inside the hole is outside the polygon: nearest is the hole's edge at lng -73.96.
    const inHole = one(`st_distance('${MANHATTAN}', [lng, lat])`, { lng: -73.965, lat: 40.755 });
    expect(rel(inHole, refHaversine([-73.965, 40.755], [-73.96, 40.755]))).toBeLessThan(1e-4);
  });

  it('to points is exact haversine', () => {
    const c = { lng: 2.35, lat: 48.86 };
    expect(one(`st_distance('MULTIPOINT(-73.97 40.78, 13.4 52.52)', [lng, lat])`, c))
      .toBeCloseTo(refHaversine([2.35, 48.86], [13.4, 52.52]), 6);
    // DuckDB: ST_Distance_Sphere(ST_Point(40.78, -73.97), ST_Point(48.86, 2.35)), lat first,
    // on a 6371000 m sphere; rescaled to ours.
    const duck = 5830085.292910763 * (EARTH_RADIUS_M / 6371000);
    expect(one(`st_distance(st_geomfromtext('POINT(-73.97 40.78)'), [lng, lat])`, c)).toBeCloseTo(duck, 4);
  });
});

describe('linear referencing, expanded', () => {
  const line: Position[] = [[-122.42, 37.77], [-122.40, 37.79], [-122.39, 37.80], [-122.27, 37.80]];

  it('along matches turf to a millimetre, including past either end', () => {
    for (const km of [-1, 0, 0.5, 2.8, 2.81, 4.2, 9, 14.7, 20]) {
      const [x, y] = geo(`along('${ROUTE}', km)`, { km });
      const [rx, ry] = refAlong(line, Math.max(0, km));
      expect(refHaversine([x, y], [rx, ry]), `km ${km}`).toBeLessThan(0.001);
    }
  });

  it('interpolates by fraction, and knows its ends', () => {
    const total = lengthM(parseGeometry(ROUTE)) / 1000;
    const [x, y] = geo(`st_lineinterpolatepoint('${ROUTE}', 0.3)`);
    const [rx, ry] = refAlong(line, 0.3 * total);
    expect(refHaversine([x, y], [rx, ry])).toBeLessThan(0.001);
    expect(geo(`st_startpoint('${ROUTE}')`)).toEqual([-122.42, 37.77]);
    expect(geo(`st_endpoint('${ROUTE}')`)).toEqual([-122.27, 37.80]);
  });
});

describe('expanded geometry: where it runs', () => {
  const PER_ROW = [
    `st_contains('${MANHATTAN}', [lng, lat])`,
    `st_distance('${ROUTE}', [lng, lat])`,
    `st_distance('${MANHATTAN}', [lng, lat])`,
    `st_distance('MULTIPOINT(0 0, 1 1)', [lng, lat])`,
    `along('${ROUTE}', lng)`,
  ];

  it('is SQL- and GPU-feasible from scalar columns, and leaves no geometry behind', () => {
    for (const src of PER_ROW) {
      const e = resolveGeo(src);
      expect([...enginesFor(e)].sort(), src).toEqual(['gpu', 'sql']);
      walk(e, (n) => {
        expect(n.kind, src).not.toBe('str');
        if (n.kind === 'call') expect(GEO_PRELUDE.has(n.fn), `${src}: ${n.fn}`).toBe(false);
      });
      expect(() => (e.kind === 'vec' ? toSqlColumns(e, 'v') : toSql(e)), src).not.toThrow();
      expect(() => toWgsl(e, (n) => ({ code: `a_${n}`, width: 1 })), src).not.toThrow();
    }
  });

  it('is GPU-only against a vec column', () => {
    expect([...enginesFor(resolveGeo(`st_contains('${MANHATTAN}', P)`))]).toEqual(['gpu']);
  });

  it('folds measures to constants', () => {
    for (const src of [`st_area('${MANHATTAN}')`, `st_length('${ROUTE}')`, `bbox('${MULTI}')`, `st_centroid('${MULTI}')`]) {
      walk(resolveGeo(src), (n) => expect(['num', 'vec'], src).toContain(n.kind));
    }
    expect(geo(`bbox('${MULTI}')`)).toEqual([0, 0, 5, 5]);
    expect(geo(`center('${MULTI}')`)).toEqual([2.5, 2.5]);
    expect(geo(`st_xmax('${MULTI}') - st_ymin('${MULTI}')`)).toEqual([5]);
  });

  it('names the problem when the geometry is not a literal', () => {
    const errs: [string, RegExp][] = [
      ['st_contains(region, [lng, lat])', /geometry literal.*the column 'region'/],
      [`st_contains('${ROUTE}', [lng, lat])`, /st_contains\(\): needs a Polygon or MultiPolygon, got a LineString/],
      [`along('${MULTI}', 1.0)`, /along\(\): needs a LineString/],
      [`st_distance('${ROUTE}', '${MULTI}')`, /two geometry literals/],
      ['st_makeenvelope(x, 0.0, 1.0, 1.0)', /constant arguments/],
      ["st_geomfromtext('{\"type\": \"Point\", \"coordinates\": [0, 0]}')", /Expected WKT/],
      [`st_contains('POLYGON((0 0, 1 0, 1 1))', [lng, lat])`, /st_contains\(\).*at least 4/],
    ];
    for (const [src, why] of errs) {
      expect(() => resolveGeo(src), src).toThrow(FunctionError);
      expect(() => resolveGeo(src), src).toThrow(why);
    }
  });

  it('every macro is covered here', () => {
    const covered = new Set<string>();
    const file = [
      'st_geomfromtext', 'st_geomfromgeojson', 'st_makeenvelope', 'st_contains', 'st_within', 'st_intersects',
      'st_disjoint', 'point_in_polygon', 'booleanPointInPolygon', 'st_distance_sphere', 'st_distance', 'st_dwithin',
      'pointToLineDistance', 'point_to_line_distance', 'along', 'st_lineinterpolatepoint', 'st_startpoint',
      'st_endpoint', 'st_area', 'area', 'st_length', 'st_perimeter', 'st_npoints', 'st_xmin', 'st_ymin', 'st_xmax',
      'st_ymax', 'bbox', 'st_centroid', 'centroid', 'center',
    ];
    file.forEach((f) => covered.add(f));
    expect([...GEO_MACROS].sort()).toEqual([...covered].sort());
    // The measures not exercised above, once each.
    expect(geo(`st_geomfromgeojson('{"type": "Point", "coordinates": [3, 4]}')`)).toEqual([3, 4]);
    expect(one(`area('${MANHATTAN}')`)).toBe(areaM2(parseGeometry(MANHATTAN)));
    expect(one(`st_perimeter('${MANHATTAN}')`)).toBe(perimeterM(parseGeometry(MANHATTAN)));
    expect(one(`st_npoints('${MANHATTAN}')`)).toBe(11);
    expect(geo(`centroid('POLYGON((0 0, 3 0, 0 3, 0 0))')`)).toEqual([1, 1]);
    expect(geo(`[st_xmin('${MULTI}'), st_ymax('${MULTI}')]`)).toEqual([0, 5]);
  });
});
