/**
 * Constant geometries: a WKT or GeoJSON literal written in an expression, parsed at plan time.
 *
 *     st_contains(st_geomfromtext('POLYGON((-74.02 40.70, -73.93 40.70, …))'), [lng, lat])
 *
 * The IR has no geometry value, and does not get one here. A line or a polygon that is the
 * same for every row is not a per-row value at all: it is a set of constants. `geo.ts` expands
 * each call against one into ordinary arithmetic over those constants — an edge-crossing sum,
 * a minimum over segments — so it runs wherever the point functions run. This module is the
 * part that never reaches a backend: reading the literal, and the measures of it that are
 * themselves constants (area, length, bounds, centroid), computed once in f64.
 *
 * Coordinates are `[lng, lat]` in degrees, the PostGIS axis order and GeoJSON's. Z and M
 * values are accepted and dropped. An SRID other than 4326 is rejected, since every function
 * that reads a geometry assumes degrees.
 */

/** Mean Earth radius in metres: turf's `earthRadius`, and the radius of every sphere here. */
export const EARTH_RADIUS_M = 6371008.8;

/**
 * The most vertices one literal may have. Each edge becomes about ten operators per row in
 * the expanded tree, so this bounds a single call at roughly ten thousand: large for SQL text
 * and a shader, small for a GPU. A detailed boundary is a SQL-spatial job (docs/geometry.md).
 */
export const MAX_GEOMETRY_VERTICES = 1024;

export type Position = readonly [number, number];

/** A geometry by dimension: points, lines, or polygons (each a list of rings, outer first). */
export type Geometry =
  | { dim: 0; type: 'Point' | 'MultiPoint'; points: Position[] }
  | { dim: 1; type: 'LineString' | 'MultiLineString'; lines: Position[][] }
  | { dim: 2; type: 'Polygon' | 'MultiPolygon'; polygons: Position[][][] };

export class GeometryError extends Error {}

const cache = new Map<string, Geometry>();

/** Parse WKT (or EWKT with SRID 4326) or GeoJSON, whichever `text` is. Cached by text. */
export function parseGeometry(text: string, format: 'wkt' | 'geojson' | 'auto' = 'auto'): Geometry {
  const trimmed = text.trim();
  const json = trimmed.startsWith('{');
  if (format === 'wkt' && json) throw new GeometryError('Expected WKT, got what looks like GeoJSON');
  if (format === 'geojson' && !json) throw new GeometryError('Expected GeoJSON, got what looks like WKT');
  const key = `${json ? 'j' : 'w'}${trimmed}`;
  let g = cache.get(key);
  if (!g) {
    g = validate(json ? fromGeoJson(trimmed) : fromWkt(trimmed));
    cache.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// WKT
// ---------------------------------------------------------------------------

function fromWkt(src: string): Geometry {
  let text = src;
  const srid = /^SRID=(\d+);/i.exec(text);
  if (srid) {
    if (srid[1] !== '4326') {
      throw new GeometryError(`SRID ${srid[1]} is not supported: geometries are lng/lat degrees (4326)`);
    }
    text = text.slice(srid[0].length);
  }
  const tokens = text.match(/[A-Za-z]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[(),]|\S/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (t: string) => {
    if (peek() !== t) throw new GeometryError(`WKT: expected '${t}' at token ${pos} ('${peek() ?? 'end'}')`);
    pos++;
  };

  const position = (): Position => {
    const values: number[] = [];
    while (peek() !== undefined && /^[-+.\d]/.test(peek())) values.push(Number(next()));
    if (values.length < 2) throw new GeometryError(`WKT: a coordinate needs at least x and y, at token ${pos}`);
    return [values[0], values[1]];
  };
  /** `(x y, x y, …)`; for MULTIPOINT each position may also be wrapped, `((x y), (x y))`. */
  const positions = (wrapped = false): Position[] => {
    expect('(');
    const out: Position[] = [];
    for (;;) {
      if (wrapped && peek() === '(') { next(); out.push(position()); expect(')'); } else out.push(position());
      if (peek() === ',') { next(); continue; }
      break;
    }
    expect(')');
    return out;
  };
  const list = <T>(item: () => T): T[] => {
    expect('(');
    const out = [item()];
    while (peek() === ',') { next(); out.push(item()); }
    expect(')');
    return out;
  };

  const word = next()?.toUpperCase();
  if (peek() && /^(Z|M|ZM)$/i.test(peek())) next();
  if (peek()?.toUpperCase() === 'EMPTY') throw new GeometryError(`WKT: ${word} EMPTY has nothing to test against`);
  let g: Geometry;
  switch (word) {
    case 'POINT': g = { dim: 0, type: 'Point', points: positions() }; break;
    case 'MULTIPOINT': g = { dim: 0, type: 'MultiPoint', points: positions(true) }; break;
    case 'LINESTRING': g = { dim: 1, type: 'LineString', lines: [positions()] }; break;
    case 'MULTILINESTRING': g = { dim: 1, type: 'MultiLineString', lines: list(() => positions()) }; break;
    case 'POLYGON': g = { dim: 2, type: 'Polygon', polygons: [list(() => positions())] }; break;
    case 'MULTIPOLYGON': g = { dim: 2, type: 'MultiPolygon', polygons: list(() => list(() => positions())) }; break;
    case 'GEOMETRYCOLLECTION':
      throw new GeometryError('WKT: GEOMETRYCOLLECTION is not supported; use one MULTI* type');
    default:
      throw new GeometryError(`WKT: unknown geometry type '${word ?? ''}'`);
  }
  if (g.type === 'Point' && g.points.length !== 1) throw new GeometryError('WKT: POINT takes one coordinate');
  if (pos !== tokens.length) throw new GeometryError(`WKT: unexpected '${peek()}' after the geometry`);
  return g;
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

interface GeoJsonLike {
  type?: string;
  coordinates?: unknown;
  geometry?: GeoJsonLike | null;
  features?: GeoJsonLike[];
}

function fromGeoJson(src: string): Geometry {
  let doc: GeoJsonLike;
  try {
    doc = JSON.parse(src) as GeoJsonLike;
  } catch (err) {
    throw new GeometryError(`GeoJSON: ${(err as Error).message}`);
  }
  return geoJsonGeometry(doc);
}

function geoJsonGeometry(doc: GeoJsonLike): Geometry {
  const pos = (c: unknown): Position => {
    if (!Array.isArray(c) || c.length < 2 || typeof c[0] !== 'number' || typeof c[1] !== 'number') {
      throw new GeometryError(`GeoJSON: expected a position [lng, lat], got ${JSON.stringify(c)}`);
    }
    return [c[0], c[1]];
  };
  const arr = (c: unknown, what: string): unknown[] => {
    if (!Array.isArray(c) || c.length === 0) throw new GeometryError(`GeoJSON: expected a non-empty array of ${what}`);
    return c;
  };
  const line = (c: unknown) => arr(c, 'positions').map(pos);
  const polygon = (c: unknown) => arr(c, 'rings').map(line);
  switch (doc.type) {
    case 'Point': return { dim: 0, type: 'Point', points: [pos(doc.coordinates)] };
    case 'MultiPoint': return { dim: 0, type: 'MultiPoint', points: line(doc.coordinates) };
    case 'LineString': return { dim: 1, type: 'LineString', lines: [line(doc.coordinates)] };
    case 'MultiLineString': return { dim: 1, type: 'MultiLineString', lines: arr(doc.coordinates, 'lines').map(line) };
    case 'Polygon': return { dim: 2, type: 'Polygon', polygons: [polygon(doc.coordinates)] };
    case 'MultiPolygon': return { dim: 2, type: 'MultiPolygon', polygons: arr(doc.coordinates, 'polygons').map(polygon) };
    case 'Feature':
      if (!doc.geometry) throw new GeometryError('GeoJSON: Feature has no geometry');
      return geoJsonGeometry(doc.geometry);
    case 'FeatureCollection': {
      // Merged into one MULTI geometry, which is what a region or a route drawn as several
      // features means. Mixed dimensions have no single meaning, so they are an error.
      const parts = (doc.features ?? []).map((f) => geoJsonGeometry(f));
      if (parts.length === 0) throw new GeometryError('GeoJSON: FeatureCollection is empty');
      const dim = parts[0].dim;
      if (parts.some((p) => p.dim !== dim)) {
        throw new GeometryError('GeoJSON: a FeatureCollection mixing points, lines and polygons is not one geometry');
      }
      if (dim === 0) return { dim, type: 'MultiPoint', points: parts.flatMap((p) => (p.dim === 0 ? p.points : [])) };
      if (dim === 1) return { dim, type: 'MultiLineString', lines: parts.flatMap((p) => (p.dim === 1 ? p.lines : [])) };
      return { dim, type: 'MultiPolygon', polygons: parts.flatMap((p) => (p.dim === 2 ? p.polygons : [])) };
    }
    case 'GeometryCollection':
      throw new GeometryError('GeoJSON: GeometryCollection is not supported; use one Multi* type');
    default:
      throw new GeometryError(`GeoJSON: unknown type '${doc.type ?? ''}'`);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(g: Geometry): Geometry {
  const all = vertices(g);
  if (all.length > MAX_GEOMETRY_VERTICES) {
    throw new GeometryError(
      `${g.type} has ${all.length} vertices; a literal geometry is expanded per row and is limited to ` +
      `${MAX_GEOMETRY_VERTICES} (simplify it, or see docs/geometry.md for SQL spatial)`,
    );
  }
  for (const [x, y] of all) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new GeometryError(`${g.type} has a non-finite coordinate`);
    if (Math.abs(y) > 90) {
      throw new GeometryError(`${g.type} has latitude ${y}: coordinates are [lng, lat] in degrees`);
    }
  }
  if (g.dim === 1) {
    for (const l of g.lines) if (l.length < 2) throw new GeometryError(`${g.type}: a line needs at least 2 positions`);
  }
  if (g.dim === 2) {
    for (const rings of g.polygons) {
      for (const r of rings) {
        if (r.length < 4) throw new GeometryError(`${g.type}: a ring needs at least 4 positions, first repeated last`);
        const [a, b] = [r[0], r[r.length - 1]];
        if (a[0] !== b[0] || a[1] !== b[1]) {
          throw new GeometryError(`${g.type}: ring is not closed (${a.join(' ')} ≠ ${b.join(' ')})`);
        }
      }
    }
  }
  return g;
}

/** Every position, closing positions included (PostGIS's `ST_NPoints` count). */
export function vertices(g: Geometry): Position[] {
  if (g.dim === 0) return g.points;
  if (g.dim === 1) return g.lines.flat();
  return g.polygons.flat(2);
}

/** Every segment: of each line, or of each ring. */
export function segments(g: Geometry): [Position, Position][] {
  const paths = g.dim === 1 ? g.lines : g.dim === 2 ? g.polygons.flat() : [];
  const out: [Position, Position][] = [];
  for (const p of paths) for (let i = 0; i + 1 < p.length; i++) out.push([p[i], p[i + 1]]);
  return out;
}

// ---------------------------------------------------------------------------
// Constant measures, in f64
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/** Haversine, metres. The same formula as `geo.ts`'s `haversine_m`, evaluated here once. */
export function haversineM(a: Position, b: Position): number {
  const s1 = Math.sin((b[1] - a[1]) * DEG / 2);
  const s2 = Math.sin((b[0] - a[0]) * DEG / 2);
  const h = s1 * s1 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * s2 * s2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(Math.sqrt(h), 1));
}

/** Initial great-circle bearing from `a` to `b`, radians from north. */
export function bearingRad(a: Position, b: Position): number {
  const [l1, p1, l2, p2] = [a[0] * DEG, a[1] * DEG, b[0] * DEG, b[1] * DEG];
  return Math.atan2(
    Math.sin(l2 - l1) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1),
  );
}

/** Great-circle length of the lines, metres. Zero for points and polygons, as `ST_Length`. */
export function lengthM(g: Geometry): number {
  if (g.dim !== 1) return 0;
  return segments(g).reduce((s, [a, b]) => s + haversineM(a, b), 0);
}

/** Great-circle length of every ring, metres. Zero for points and lines, as `ST_Perimeter`. */
export function perimeterM(g: Geometry): number {
  if (g.dim !== 2) return 0;
  return segments(g).reduce((s, [a, b]) => s + haversineM(a, b), 0);
}

/**
 * Area on the sphere, square metres: outer rings minus holes. turf's ring formula
 * (Chamberlain and Duquette), which is exact for a box whose edges follow parallels and
 * meridians. turf itself uses a 6378137 m radius here, so `turf.area` reads 0.22% higher.
 */
export function areaM2(g: Geometry): number {
  if (g.dim !== 2) return 0;
  let total = 0;
  for (const [outer, ...holes] of g.polygons) {
    total += Math.abs(ringArea(outer));
    for (const h of holes) total -= Math.abs(ringArea(h));
  }
  return total;
}

function ringArea(r: readonly Position[]): number {
  const n = r.length - 1; // the closing position repeats the first
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const lower = r[i];
    const middle = r[(i + 1) % n];
    const upper = r[(i + 2) % n];
    sum += (upper[0] - lower[0]) * DEG * Math.sin(middle[1] * DEG);
  }
  return (sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

/** `[minx, miny, maxx, maxy]`, turf's `bbox` order. */
export function bboxOf(g: Geometry): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of vertices(g)) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
}

/**
 * PostGIS's `ST_Centroid` of a geometry: planar, in degrees. Area-weighted for polygons
 * (holes subtract), length-weighted for lines, the mean for points.
 */
export function centroidOf(g: Geometry): Position {
  if (g.dim === 2) {
    // Relative to the first vertex: the shoelace products of raw coordinates near (−74, 40)
    // cancel away about seven digits.
    const [ox, oy] = g.polygons[0][0][0];
    let a = 0; let cx = 0; let cy = 0;
    for (const rings of g.polygons) {
      rings.forEach((r, i) => {
        // Signed shoelace, with the sign forced so the outer ring adds and holes subtract
        // whichever way each was wound.
        let ra = 0; let rx = 0; let ry = 0;
        for (let k = 0; k + 1 < r.length; k++) {
          const [x0, y0] = [r[k][0] - ox, r[k][1] - oy]; const [x1, y1] = [r[k + 1][0] - ox, r[k + 1][1] - oy];
          const cross = x0 * y1 - x1 * y0;
          ra += cross; rx += (x0 + x1) * cross; ry += (y0 + y1) * cross;
        }
        const sign = (i === 0 ? 1 : -1) * Math.sign(ra);
        a += sign * ra / 2; cx += sign * rx / 6; cy += sign * ry / 6;
      });
    }
    if (a !== 0) return [ox + cx / a, oy + cy / a];
  }
  if (g.dim === 1) {
    let len = 0; let cx = 0; let cy = 0;
    for (const [p, q] of segments(g)) {
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      len += l; cx += l * (p[0] + q[0]) / 2; cy += l * (p[1] + q[1]) / 2;
    }
    if (len > 0) return [cx / len, cy / len];
  }
  return meanOf(vertices(g));
}

/**
 * turf's `centroid`: the mean of the vertices, each ring's closing position left out. Not the
 * area centroid; a polygon with a dense edge leans toward it.
 */
export function vertexMean(g: Geometry): Position {
  if (g.dim !== 2) return meanOf(vertices(g));
  return meanOf(g.polygons.flat().flatMap((r) => r.slice(0, -1)));
}

function meanOf(ps: readonly Position[]): Position {
  const n = ps.length;
  return [ps.reduce((s, p) => s + p[0], 0) / n, ps.reduce((s, p) => s + p[1], 0) / n];
}
