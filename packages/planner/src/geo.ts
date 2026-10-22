/**
 * Geospatial functions: the point subset of PostGIS and turf.js, written in the expression
 * language and inlined like any user function.
 *
 *     "@km"   = "distance([lng, lat], [{{lng0}}, {{lat0}}])"
 *     "@near" = "st_dwithin([lng, lat], [{{lng0}}, {{lat0}}], 500.0)"
 *
 * **There is no geometry type.** A point is a vec2 `[lng, lat]` in degrees, which the IR
 * already has, so nothing is serialized, converted or boxed. Every function here compiles out
 * to arithmetic before the planner looks at it (see `functions.ts` for why inlining rather
 * than calling), which is what gives each one SQL, WGSL and JS forms, an `enginesFor` answer
 * and an `opCount` price with no per-function code in any backend. The swizzle simplifier in
 * `analyze` is what keeps them SQL-feasible: `st_x([lng, lat])` inlines to `lng`, not to a
 * swizzle SQL cannot express. Called with a vec *column* (`distance(P, Q)`) they are GPU/CPU
 * only, because SQL columns are scalars.
 *
 * Lines and polygons have no per-row form: they are variable-length, and the IR's values are
 * one to four f32s. A *literal* one is not a per-row value, though — it is a set of constants —
 * so the functions that take a geometry (`st_contains`, `st_distance`, `along`, …) are macros
 * (`FunctionDef.expand`) that read the WKT or GeoJSON at plan time and expand into arithmetic
 * over its vertices: a crossing-number sum, a minimum over segments. Measures of the literal
 * itself (`st_area`, `bbox`, `st_centroid`) fold to numbers. `geometry.ts` does the parsing and
 * the f64 measures; `docs/geometry.md` covers the tiers still missing (a geometry param, a
 * geometry column).
 *
 * Both vocabularies are offered because both have users. They differ in units, and each
 * keeps its own: PostGIS names take and return metres and radians, turf names kilometres and
 * degrees. Where the units match, one name is an alias of the other; where they differ, both
 * call one shared `__geo_` helper, so there is still only one formula to get wrong.
 *
 * Accuracy: this is a sphere of radius 6371008.8 m (the IUGG mean radius and turf's
 * `earthRadius`; DuckDB spatial's `ST_Distance_Sphere` uses 6371000, 1.4 ppm shorter), not
 * PostGIS's spheroid; distances differ from
 * `ST_Distance(geography)` by up to about 0.5%. On the GPU the inputs are f32, about 1 m at
 * the equator, so short distances there carry an absolute error of a metre or so.
 *
 * `pow(x, 2.0)` is spelled `x * x` throughout: WGSL's `pow` is undefined for a negative base,
 * and `sin` of a negative difference is negative half the time.
 */

import type { Expr, BinaryOp } from './expr.js';
import {
  type FunctionDef, type FunctionRegistry, type FunctionSpec, buildRegistry, addFunction, GEO_SOURCE_PREFIX,
} from './functions.js';
import {
  type Geometry, type Position, EARTH_RADIUS_M, parseGeometry, segments, haversineM, bearingRad,
  lengthM, perimeterM, areaM2, bboxOf, centroidOf, vertexMean, vertices, GeometryError,
} from './geometry.js';

export { EARTH_RADIUS_M };
/** The WGS84 semi-major axis, which EPSG:3857 uses as its sphere. */
export const WEB_MERCATOR_RADIUS_M = 6378137;
/** Web Mercator's latitude limit: the latitude at which the map is square. */
export const WEB_MERCATOR_MAX_LAT = 85.0511287798;

const DEG = 0.017453292519943295;
const HALF_DEG = 0.008726646259971648;

/**
 * In declaration order: `buildRegistry` parses each body in the scope built so far, so a
 * helper has to come before its first caller.
 */
export const GEO_SPECS: Record<string, FunctionSpec> = {
  radians: { params: ['d'], body: `d * ${DEG}` },
  degrees: { params: ['r'], body: 'r * 57.29577951308232' },

  st_point: { params: ['lng', 'lat'], body: '[lng, lat]' },
  point: { params: ['lng', 'lat'], body: 'st_point(lng, lat)' },
  st_x: { params: ['p'], body: 'p.x' },
  st_y: { params: ['p'], body: 'p.y' },

  // Haversine. The scalar form is the real one; the point forms unpack into it. `min(…, 1.0)`
  // because rounding can put the square root a hair above 1 for antipodal points, and asin
  // of that is NaN.
  haversine_m: {
    params: ['lng1', 'lat1', 'lng2', 'lat2'],
    body:
      `${2 * EARTH_RADIUS_M} * asin(min(sqrt(` +
      `sin((lat2 - lat1) * ${HALF_DEG}) * sin((lat2 - lat1) * ${HALF_DEG}) + ` +
      `cos(radians(lat1)) * cos(radians(lat2)) * ` +
      `sin((lng2 - lng1) * ${HALF_DEG}) * sin((lng2 - lng1) * ${HALF_DEG})), 1.0))`,
  },
  // Point to point. `st_distance_sphere`, `st_distance` and `st_dwithin` are macros below,
  // because they also take a geometry literal, and call this when both arguments are points.
  __geo_sphere_m: { params: ['a', 'b'], body: 'haversine_m(a.x, a.y, b.x, b.y)' },
  /** turf.distance: kilometres. */
  distance: { params: ['a', 'b'], body: '__geo_sphere_m(a, b) / 1000.0' },

  // Initial great-circle bearing, in radians from north, in (-π, π].
  __geo_bearing: {
    params: ['a', 'b'],
    body:
      'atan2(sin(radians(b.x - a.x)) * cos(radians(b.y)), ' +
      'cos(radians(a.y)) * sin(radians(b.y)) - ' +
      'sin(radians(a.y)) * cos(radians(b.y)) * cos(radians(b.x - a.x)))',
  },
  /** turf.bearing: degrees in (-180, 180]. */
  bearing: { params: ['a', 'b'], body: 'degrees(__geo_bearing(a, b))' },
  /** ST_Azimuth: radians clockwise from north, in [0, 2π). `%` is floored on every backend. */
  st_azimuth: { params: ['a', 'b'], body: '__geo_bearing(a, b) % 6.283185307179586' },

  // Destination along a great circle, `d` in radians of arc and `az` in radians.
  //
  // Written as the destination's direction from the start: north (`__geo_dest_n`), east
  // (`__geo_dest_e`) and up (`__geo_dest_sin_lat`, which is sin φ₂). Longitude is
  // atan2(east, north) and latitude atan2(up, √(north² + east²)). The textbook forms are
  // atan2(sin θ sin δ cos φ₁, cos δ − sin φ₁ sin φ₂) and asin(sin φ₂), and on a short move at
  // high latitude both lose the move: the first subtracts two nearly equal numbers, and asin's
  // slope near 1 multiplies the error in sin φ₂ (5.8x at 80°). For 25 km north-ish at 80° N on
  // SwiftShader, whose trig is only as accurate as WGSL requires, they were off by 1.3% and
  // 30% of the move, and even Metal lost 17x more precision in the longitude than this form.
  __geo_dest_n: {
    params: ['p', 'd', 'az'],
    body: 'cos(radians(p.y)) * cos(d) - sin(radians(p.y)) * sin(d) * cos(az)',
  },
  __geo_dest_e: { params: ['p', 'd', 'az'], body: 'sin(az) * sin(d)' },
  __geo_dest_sin_lat: {
    params: ['p', 'd', 'az'],
    body: 'sin(radians(p.y)) * cos(d) + cos(radians(p.y)) * sin(d) * cos(az)',
  },
  __geo_destination: {
    params: ['p', 'd', 'az'],
    body:
      '[degrees(radians(p.x) + atan2(__geo_dest_e(p, d, az), __geo_dest_n(p, d, az))), ' +
      'degrees(atan2(__geo_dest_sin_lat(p, d, az), sqrt(' +
      '__geo_dest_n(p, d, az) * __geo_dest_n(p, d, az) + ' +
      '__geo_dest_e(p, d, az) * __geo_dest_e(p, d, az))))]',
  },
  /** ST_Project(geog, metres, azimuth radians). */
  st_project: { params: ['p', 'm', 'az'], body: `__geo_destination(p, m / ${EARTH_RADIUS_M}, az)` },
  /** turf.destination(point, kilometres, bearing degrees). */
  destination: {
    params: ['p', 'km', 'deg'],
    body: `__geo_destination(p, km / ${EARTH_RADIUS_M / 1000}, radians(deg))`,
  },

  // Great-circle midpoint, the direct formula (turf goes through distance and destination,
  // which lands on the same point with three times the trigonometry).
  __geo_bx: { params: ['a', 'b'], body: 'cos(radians(b.y)) * cos(radians(b.x - a.x))' },
  __geo_by: { params: ['a', 'b'], body: 'cos(radians(b.y)) * sin(radians(b.x - a.x))' },
  midpoint: {
    params: ['a', 'b'],
    body:
      '[degrees(radians(a.x) + atan2(__geo_by(a, b), cos(radians(a.y)) + __geo_bx(a, b))), ' +
      'degrees(atan2(sin(radians(a.y)) + sin(radians(b.y)), sqrt(' +
      '(cos(radians(a.y)) + __geo_bx(a, b)) * (cos(radians(a.y)) + __geo_bx(a, b)) + ' +
      '__geo_by(a, b) * __geo_by(a, b))))]',
  },

  // Web Mercator normalized to [-0.5, 0.5], the `project` node's space. The text is the
  // project sugar's, character for character, so the sugar can call these and plan the same.
  mercator_x: { params: ['lng'], body: 'lng / 360.0' },
  mercator_y: { params: ['lat'], body: `ln(tan(0.7853981634 + lat * ${HALF_DEG})) / 6.283185307` },

  // EPSG:3857 metres, as turf's toMercator / toWgs84. Latitude is clamped where the projection
  // is square, as turf clamps. Longitude is not wrapped, which turf does for |lng| > 180.
  // Written componentwise: `[x, y] * R` would put a vector below the root and cost SQL.
  // In f32, y has an absolute floor of about a metre near the equator — `ln(1 + ε)` with
  // 1 + ε rounded to 2^-23 — and WGSL has no log1p to avoid it.
  to_mercator: {
    params: ['p'],
    body:
      `[${WEB_MERCATOR_RADIUS_M}.0 * radians(p.x), ` +
      `${WEB_MERCATOR_RADIUS_M}.0 * ln(tan(0.7853981633974483 + ` +
      `clamp(p.y, ${-WEB_MERCATOR_MAX_LAT}, ${WEB_MERCATOR_MAX_LAT}) * ${HALF_DEG}))]`,
  },
  toMercator: { params: ['p'], body: 'to_mercator(p)' },
  from_mercator: {
    params: ['p'],
    body:
      `[degrees(p.x / ${WEB_MERCATOR_RADIUS_M}.0), ` +
      `degrees(2.0 * atan(exp(p.y / ${WEB_MERCATOR_RADIUS_M}.0)) - 1.5707963267948966)]`,
  },
  toWgs84: { params: ['p'], body: 'from_mercator(p)' },

  /** Inclusive, and with no antimeridian handling: a box across ±180 needs two calls. */
  point_in_bbox: {
    params: ['p', 'minx', 'miny', 'maxx', 'maxy'],
    body: 'p.x >= minx && p.x <= maxx && p.y >= miny && p.y <= maxy',
  },
};

// ---------------------------------------------------------------------------
// Constant geometries
// ---------------------------------------------------------------------------
//
// A line or polygon literal is expanded into arithmetic over its vertices, with every
// quantity that depends only on the vertices computed here in f64 and written in as a
// number: a slope, a bearing, the cosine of a vertex's latitude. What is left per row is
// the part that reads the point. `geometry.ts` parses the literal and computes the measures
// that are constants outright.

const num = (value: number): Expr => ({ kind: 'num', value });
const bin = (op: BinaryOp, left: Expr, right: Expr): Expr => ({ kind: 'binary', op, left, right });
const call = (fn: string, ...args: Expr[]): Expr => ({ kind: 'call', fn, args });
const cond = (test: Expr, then: Expr, otherwise: Expr): Expr => ({ kind: 'cond', test, then, else: otherwise });
const vec = (...components: Expr[]): Expr => ({ kind: 'vec', components });
const sq = (e: Expr): Expr => bin('*', e, e);
/** `[lng, lat].x` folds to `lng` in `simplifyExpr`; a vec column keeps its swizzle. */
const channel = (p: Expr, c: 'x' | 'y'): Expr => ({ kind: 'swizzle', target: p, channels: c });
const point = (p: Position): Expr => vec(num(p[0]), num(p[1]));
const FALSE = bin('>', num(0), num(1));
const RAD = Math.PI / 180;

/** A balanced tree, so a thousand edges nest ten deep, not a thousand: SQL and WGSL both have depth limits. */
function balanced(items: readonly Expr[], join: (a: Expr, b: Expr) => Expr): Expr {
  if (items.length === 1) return items[0];
  const mid = items.length >> 1;
  return join(balanced(items.slice(0, mid), join), balanced(items.slice(mid), join));
}

function describe(e: Expr): string {
  switch (e.kind) {
    case 'col': return `the column '${e.name}'`;
    case 'param': return `the parameter {{${e.name}}}`;
    default: return `a ${e.kind} expression`;
  }
}

/** A geometry literal, or undefined for anything else (a point expression). */
function literal(e: Expr): Geometry | undefined {
  return e.kind === 'str' ? parseGeometry(e.value) : undefined;
}

function geometryArg(e: Expr): Geometry {
  const g = literal(e);
  if (g) return g;
  throw new GeometryError(
    `expects a geometry literal — 'POLYGON((…))', st_geomfromtext('…') or st_geomfromgeojson('…') — ` +
    `not ${describe(e)}. A geometry that varies per row needs SQL spatial; see docs/geometry.md`,
  );
}

/** A point argument, with a literal POINT turned into `[x, y]`. */
function pointArg(e: Expr): Expr {
  const g = literal(e);
  if (!g) return e;
  if (g.type !== 'Point') throw new GeometryError(`expects a point here, got a ${g.type}`);
  return point(g.points[0]);
}

function polygonArg(e: Expr): Geometry & { dim: 2 } {
  const g = geometryArg(e);
  if (g.dim !== 2) throw new GeometryError(`needs a Polygon or MultiPolygon, got a ${g.type}`);
  return g;
}

function lineArg(e: Expr): Geometry & { dim: 1 } {
  const g = geometryArg(e);
  if (g.type !== 'LineString') throw new GeometryError(`needs a LineString, got a ${g.type}`);
  return g as Geometry & { dim: 1 };
}

/** A number known at plan time: a literal, or a negated one. */
function constant(e: Expr): number {
  if (e.kind === 'num') return e.value;
  if (e.kind === 'unary' && e.op === '-') return -constant(e.operand);
  throw new GeometryError(`needs constant arguments, got ${describe(e)}; for a box that moves, use point_in_bbox`);
}

/**
 * Crossing number: how many edges a ray from the point toward +x crosses, odd inside. Each
 * edge is taken lower end first and half-open in y, so a ray through a vertex counts it once;
 * horizontal edges never cross and are dropped. Holes and the parts of a MultiPolygon are
 * just more edges. A point on the boundary lands on either side.
 */
function inside(g: Geometry & { dim: 2 }, p: Expr): Expr {
  const px = channel(p, 'x');
  const py = channel(p, 'y');
  const crossings: Expr[] = [];
  for (const [a, b] of segments(g)) {
    if (a[1] === b[1]) continue;
    const [lo, hi] = a[1] < b[1] ? [a, b] : [b, a];
    const slope = (hi[0] - lo[0]) / (hi[1] - lo[1]);
    crossings.push(bin('&&',
      bin('&&', bin('>=', py, num(lo[1])), bin('<', py, num(hi[1]))),
      bin('<', px, bin('+', num(lo[0]), bin('*', bin('-', py, num(lo[1])), num(slope))))));
  }
  if (crossings.length === 0) return FALSE;
  // Booleans sum as 0 and 1 on every backend.
  return bin('==', bin('%', balanced(crossings, (l, r) => bin('+', l, r)), num(2)), num(1));
}

/**
 * Haversine from the point to a constant, metres, with the constant's cosine precomputed.
 * The same formula as `haversine_m`.
 */
function sphereTo(p: Expr, q: Position): Expr {
  const px = channel(p, 'x');
  const py = channel(p, 'y');
  const h = bin('+',
    sq(call('sin', bin('*', bin('-', py, num(q[1])), num(RAD / 2)))),
    bin('*', bin('*', call('cos', bin('*', py, num(RAD))), num(Math.cos(q[1] * RAD))),
      sq(call('sin', bin('*', bin('-', px, num(q[0])), num(RAD / 2))))));
  return bin('*', num(2 * EARTH_RADIUS_M), call('asin', call('min', call('sqrt', h), num(1))));
}

/**
 * Squared distance from the point to segment ab in degrees of latitude. The nearest point is
 * found in the equirectangular frame at the point's own latitude (x scaled by cos(lat)); the
 * distance to it is then measured at the mean latitude of the two, which is what keeps the
 * east–west part honest when the nearest point is well north or south. Measured against the
 * haversine to the true nearest point (geometry.test.ts): 1.2e-6 relative within 50 km. Edges
 * are straight in lng/lat, as PostGIS `geometry` and turf take them; a great-circle edge
 * bulges poleward of that by L²·tan(lat)/8R, 1.7 m for 10 km at 38°.
 */
function segmentD2(a: Position, b: Position, p: Expr): Expr {
  const [px, py] = [channel(p, 'x'), channel(p, 'y')];
  const cosAt = (lat: Expr) => call('cos', bin('*', lat, num(RAD)));
  const w = b[0] - a[0];
  const h = b[1] - a[1];
  const v = bin('-', py, num(a[1]));
  if (w === 0 && h === 0) {
    const mean = cosAt(bin('*', bin('+', py, num(a[1])), num(0.5)));
    return bin('+', sq(bin('*', bin('-', px, num(a[0])), mean)), sq(v));
  }
  const k = cosAt(py);
  const u = bin('*', bin('-', px, num(a[0])), k);
  const ex = bin('*', num(w), k);
  // t = clamp(((p - a) · e) / |e|², 0, 1): the nearest point's position along the segment.
  const t = call('clamp',
    bin('/', bin('+', bin('*', u, ex), bin('*', v, num(h))), bin('+', sq(ex), num(h * h))),
    num(0), num(1));
  const dx = bin('-', bin('-', px, num(a[0])), bin('*', t, num(w)));
  const dy = bin('-', v, bin('*', t, num(h)));
  // The nearest point's latitude is a.y + t·h, so the mean is p.y − dy/2.
  const mean = cosAt(bin('-', py, bin('*', dy, num(0.5))));
  return bin('+', sq(bin('*', dx, mean)), sq(dy));
}

/** Distance from the point to the geometry, metres. Zero inside a polygon. */
function distanceTo(g: Geometry, p: Expr): Expr {
  if (g.dim === 0) return balanced(g.points.map((q) => sphereTo(p, q)), (l, r) => call('min', l, r));
  const nearest = balanced(segments(g).map(([a, b]) => segmentD2(a, b, p)), (l, r) => call('min', l, r));
  const metres = bin('*', call('sqrt', nearest), num(RAD * EARTH_RADIUS_M));
  return g.dim === 2 ? cond(inside(g, p), num(0), metres) : metres;
}

/** Point to point, or point to a geometry literal, in either order. */
function sphereDistance(args: readonly Expr[]): Expr {
  const [ga, gb] = [literal(args[0]), literal(args[1])];
  if (ga && gb && (ga.type !== 'Point' || gb.type !== 'Point')) {
    throw new GeometryError('between two geometry literals is a constant; at least one side must be a point expression');
  }
  if (ga && ga.type !== 'Point') return distanceTo(ga, args[1]);
  if (gb && gb.type !== 'Point') return distanceTo(gb, args[0]);
  return call('__geo_sphere_m', pointArg(args[0]), pointArg(args[1]));
}

/** A polygon and a point, in either order: the only pairing with a per-row answer. */
function polygonAndPoint(args: readonly Expr[]): [Geometry & { dim: 2 }, Expr] {
  const [ga, gb] = [literal(args[0]), literal(args[1])];
  if (ga && ga.dim === 2) return [ga, pointArg(args[1])];
  if (gb && gb.dim === 2) return [gb, pointArg(args[0])];
  throw new GeometryError(
    'needs a Polygon or MultiPolygon literal and a point; for a line or points, use st_dwithin with a distance',
  );
}

/**
 * The point `s` metres along a line, on the great circle of the segment it falls in: turf's
 * `along`. The segment is found by a balanced comparison of `s` against the cumulative lengths.
 * Within segment i, with φ₁ its start latitude, θ its bearing and δ = (s − startᵢ) / R:
 *
 *     north = cos φ₁ cos δ − sin φ₁ cos θ sin δ
 *     east  = sin θ sin δ
 *     up    = sin φ₁ cos δ + cos φ₁ cos θ sin δ
 *     λ₂    = λ₁ + atan2(east, north)
 *     φ₂    = atan2(up, √(north² + east²))
 *
 * which is `__geo_destination` with every term of the constant start written in as a number.
 * See there for why it is not the textbook asin form.
 */
function along(g: Geometry & { dim: 1 }, metres: Expr): Expr {
  const segs: { a: Position; start: number; az: number }[] = [];
  let total = 0;
  for (const [a, b] of segments(g)) {
    const len = haversineM(a, b);
    if (len === 0) continue;
    segs.push({ a, start: total, az: bearingRad(a, b) });
    total += len;
  }
  if (segs.length === 0) return point(g.lines[0][0]);
  const s = call('clamp', metres, num(0), num(total));

  const leaf = ({ a, start, az }: typeof segs[number], c: 'x' | 'y'): Expr => {
    const [sinP, cosP] = [Math.sin(a[1] * RAD), Math.cos(a[1] * RAD)];
    const d = bin('/', bin('-', s, num(start)), num(EARTH_RADIUS_M));
    const north = bin('-', bin('*', num(cosP), call('cos', d)), bin('*', num(sinP * Math.cos(az)), call('sin', d)));
    const east = bin('*', num(Math.sin(az)), call('sin', d));
    if (c === 'y') {
      const up = bin('+', bin('*', num(sinP), call('cos', d)), bin('*', num(cosP * Math.cos(az)), call('sin', d)));
      const flat = call('sqrt', bin('+', bin('*', north, north), bin('*', east, east)));
      return bin('*', call('atan2', up, flat), num(1 / RAD));
    }
    return bin('*', bin('+', num(a[0] * RAD), call('atan2', east, north)), num(1 / RAD));
  };
  const pick = (lo: number, hi: number, c: 'x' | 'y'): Expr => {
    if (hi - lo === 1) return leaf(segs[lo], c);
    const mid = (lo + hi) >> 1;
    return cond(bin('<', s, num(segs[mid].start)), pick(lo, mid, c), pick(mid, hi, c));
  };
  return vec(pick(0, segs.length, 'x'), pick(0, segs.length, 'y'));
}

/** A geometry passed through as a literal, or a POINT as `[x, y]` so the point functions take it. */
function fromText(format: 'wkt' | 'geojson') {
  return ([text]: readonly Expr[]): Expr => {
    if (text.kind !== 'str') throw new GeometryError(`takes a string literal, got ${describe(text)}`);
    const g = parseGeometry(text.value, format);
    return g.type === 'Point' ? point(g.points[0]) : text;
  };
}

type Expand = (args: readonly Expr[]) => Expr;
const MACROS: Record<string, { params: string[]; expand: Expand }> = {
  st_geomfromtext: { params: ['wkt'], expand: fromText('wkt') },
  st_geomfromgeojson: { params: ['geojson'], expand: fromText('geojson') },
  st_makeenvelope: {
    params: ['xmin', 'ymin', 'xmax', 'ymax'],
    expand: (args) => {
      const [x0, y0, x1, y1] = args.map(constant);
      return { kind: 'str', value: `POLYGON((${x0} ${y0}, ${x1} ${y0}, ${x1} ${y1}, ${x0} ${y1}, ${x0} ${y0}))` };
    },
  },

  // Predicates: a polygon literal and a per-row point.
  st_contains: { params: ['g', 'p'], expand: ([g, p]) => inside(polygonArg(g), pointArg(p)) },
  st_within: { params: ['p', 'g'], expand: ([p, g]) => inside(polygonArg(g), pointArg(p)) },
  st_intersects: { params: ['a', 'b'], expand: (args) => inside(...polygonAndPoint(args)) },
  st_disjoint: { params: ['a', 'b'], expand: (args) => ({ kind: 'unary', op: '!', operand: inside(...polygonAndPoint(args)) }) },
  point_in_polygon: { params: ['p', 'g'], expand: ([p, g]) => inside(polygonArg(g), pointArg(p)) },
  booleanPointInPolygon: { params: ['p', 'g'], expand: ([p, g]) => inside(polygonArg(g), pointArg(p)) },

  // Distances, metres (PostGIS) and kilometres (turf).
  st_distance_sphere: { params: ['a', 'b'], expand: sphereDistance },
  /** Geography semantics, on the sphere: metres between lng/lat points, not planar degrees. */
  st_distance: { params: ['a', 'b'], expand: sphereDistance },
  st_dwithin: { params: ['a', 'b', 'm'], expand: ([a, b, m]) => bin('<=', sphereDistance([a, b]), m) },
  pointToLineDistance: {
    params: ['p', 'line'],
    expand: ([p, l]) => bin('/', distanceTo(geometryArg(l), pointArg(p)), num(1000)),
  },
  point_to_line_distance: {
    params: ['p', 'line'],
    expand: ([p, l]) => bin('/', distanceTo(geometryArg(l), pointArg(p)), num(1000)),
  },

  // Linear referencing.
  /** turf.along(line, km). */
  along: { params: ['line', 'km'], expand: ([l, km]) => along(lineArg(l), bin('*', km, num(1000))) },
  /** ST_LineInterpolatePoint(line, fraction 0–1), on the sphere as for geography. */
  st_lineinterpolatepoint: {
    params: ['line', 'f'],
    expand: ([l, f]) => {
      const line = lineArg(l);
      return along(line, bin('*', call('clamp', f, num(0), num(1)), num(lengthM(line))));
    },
  },
  st_startpoint: { params: ['line'], expand: ([l]) => point(lineArg(l).lines[0][0]) },
  st_endpoint: { params: ['line'], expand: ([l]) => { const [line] = lineArg(l).lines; return point(line[line.length - 1]); } },

  // Measures of the literal itself: constants, computed once.
  st_area: { params: ['g'], expand: ([g]) => num(areaM2(geometryArg(g))) },
  /** turf.area, square metres; on the 6371008.8 m sphere, where turf uses 6378137 m. */
  area: { params: ['g'], expand: ([g]) => num(areaM2(geometryArg(g))) },
  st_length: { params: ['g'], expand: ([g]) => num(lengthM(geometryArg(g))) },
  st_perimeter: { params: ['g'], expand: ([g]) => num(perimeterM(geometryArg(g))) },
  st_npoints: { params: ['g'], expand: ([g]) => num(vertices(geometryArg(g)).length) },
  st_xmin: { params: ['g'], expand: ([g]) => num(bboxOf(geometryArg(g))[0]) },
  st_ymin: { params: ['g'], expand: ([g]) => num(bboxOf(geometryArg(g))[1]) },
  st_xmax: { params: ['g'], expand: ([g]) => num(bboxOf(geometryArg(g))[2]) },
  st_ymax: { params: ['g'], expand: ([g]) => num(bboxOf(geometryArg(g))[3]) },
  /** turf.bbox: `[minx, miny, maxx, maxy]`. */
  bbox: { params: ['g'], expand: ([g]) => vec(...bboxOf(geometryArg(g)).map(num)) },
  /** PostGIS: the planar area-, length- or point-weighted centroid. */
  st_centroid: { params: ['g'], expand: ([g]) => point(centroidOf(geometryArg(g))) },
  /** turf.centroid: the mean vertex. */
  centroid: { params: ['g'], expand: ([g]) => point(vertexMean(geometryArg(g))) },
  /** turf.center: the middle of the bounding box. */
  center: {
    params: ['g'],
    expand: ([g]) => { const b = bboxOf(geometryArg(g)); return point([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]); },
  },
};

/**
 * The prelude every graph's registry starts from. Built once: parsing is the only cost, and
 * a `FunctionDef` is never mutated after it is made.
 */
export const GEO_PRELUDE: FunctionRegistry = (() => {
  const registry = buildRegistry(GEO_SPECS, new Map(), GEO_SOURCE_PREFIX);
  for (const [name, { params, expand }] of Object.entries(MACROS)) {
    addFunction(registry, { name, params, expand, source: `${GEO_SOURCE_PREFIX}${name}` } satisfies FunctionDef);
  }
  return registry;
})();

/** The names of the functions that take a geometry literal. */
export const GEO_MACROS: readonly string[] = Object.keys(MACROS);
