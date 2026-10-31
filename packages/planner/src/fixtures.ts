/**
 * Shared test and benchmark fixtures.
 *
 * Deliberately part of the library source rather than the demo: tests and benchmarks need a
 * realistic graph and catalog, and depending on the demo's synthetic generator for that would
 * reintroduce exactly the coupling the source-provider API removed. Nothing here is exported
 * from the public entry points.
 */

import type { Schema } from './analyze.js';
import type { SourceStats } from './stats.js';
import type { Graph } from './types.js';
import type { ColumnUpload } from './arrow.js';

/** The demo's synthetic schema, as the planner sees it. */
export const SCHEMA: Schema = new Map([
  ['id', 1], ['cluster', 1], ['lng', 1], ['lat', 1],
  ['elevation', 1], ['speed', 1], ['pop', 1], ['hour', 1],
]);

/**
 * A catalog matching the synthetic generator's distributions, including the 2% NULL `speed`
 * column and the DOUBLE columns that force a narrowing pass.
 */
export function makeStats(rows = 1_000_000): SourceStats {
  const col = (
    name: string, min: number, max: number, ndv: number, nullFrac = 0, duckType = 'FLOAT',
  ) => [name, {
    name, min, max, ndv, nullFrac, duckType, isF64: /DOUBLE|DECIMAL/.test(duckType),
  }] as const;

  return {
    rows,
    columns: new Map([
      col('id', 0, rows, rows, 0, 'INTEGER'),
      col('cluster', 0, 8, 9, 0, 'INTEGER'),
      col('lng', -179, 179, 500_000, 0, 'DOUBLE'),
      col('lat', -80, 80, 500_000, 0, 'DOUBLE'),
      col('elevation', 0, 900, 50_000),
      col('speed', 0, 120, 1000, 0.02),
      col('pop', 10, 1e6, 100_000, 0, 'DOUBLE'),
      col('hour', 0, 24, 20_000),
    ]),
  };
}

export const STATS = makeStats();

export const SOURCE_NODE = {
  id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1_000_000 },
} as const;

/** The demo's scatter graph, as a value tests can mutate. */
export function scatterGraph(): Graph {
  return {
    params: {
      cut: { value: 60, kind: 'value', changeRate: 0.2 },
      k: { value: 1.6, kind: 'value', changeRate: 8 },
      exag: { value: 0.4, kind: 'value', changeRate: 8 },
    },
    nodes: [
      SOURCE_NODE,
      { id: 'fast', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
      { id: 'popStats', type: 'stats', input: 'fast', column: 'pop', ops: ['min', 'max'] },
      {
        id: 'proj', type: 'project', input: 'fast', mode: 'mercator',
        x: 'lng', y: 'lat', z: 'elevation * {{exag}} * 0.0006',
      },
      {
        id: 'radius', type: 'scale', input: 'proj', name: 'pscale', expr: 'pop', kind: 'log',
        domain: 'auto', statsFrom: 'popStats', range: ['{{k}} * 0.4', '{{k}} * 3.5'],
      },
      {
        id: 'color', type: 'colorscale', input: 'radius', expr: 'elevation',
        ramp: 'viridis', domain: ['0', '900'],
      },
      { id: 'out', type: 'render', input: 'color', mode: 'points', position: 'P', color: 'Cd', size: 'pscale' },
    ],
  };
}

/** The same visual result expressed as one wrangle body. */
export function wrangleGraph(): Graph {
  return {
    params: {
      cut: { value: 60, kind: 'value', changeRate: 0.2 },
      k: { value: 1.6, kind: 'value', changeRate: 8 },
      exag: { value: 0.4, kind: 'value', changeRate: 8 },
    },
    nodes: [
      SOURCE_NODE,
      { id: 'fast', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
      {
        id: 'wr', type: 'wrangle', input: 'fast', ramp: 'turbo',
        body: `
          @P = [lng / 360.0,
                ln(tan(0.7853981634 + lat * 0.008726646259971648)) / 6.283185307,
                elevation * {{exag}} * 0.0006];
          var t = clamp(fit(ln(pop), 2.3, 13.9, 0.0, 1.0), 0.0, 1.0);
          @Cd = ramp(t);
          @pscale = ({{k}} * 0.4) + t * ({{k}} * 3.1);
        `,
      },
      { id: 'out', type: 'render', input: 'wr', mode: 'points', position: 'P', color: 'Cd', size: 'pscale' },
    ],
  };
}

/** A heatmap graph, for the bin2d path. */
export function heatmapGraph(): Graph {
  return {
    params: { cut: { value: 0, kind: 'value', changeRate: 0.2 } },
    nodes: [
      SOURCE_NODE,
      { id: 'fast', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
      { id: 'proj', type: 'project', input: 'fast', mode: 'mercator', x: 'lng', y: 'lat', z: '0' },
      { id: 'weight', type: 'attribute', input: 'proj', name: 'weight', expr: 'clamp(fit(ln(pop), 2.3, 13.9, 0.02, 1.0), 0.02, 1.0)' },
      { id: 'bins', type: 'bin2d', input: 'weight', resolution: 512, weight: 'weight', ramp: 'magma', ceiling: 'auto' },
      { id: 'out', type: 'render', input: 'bins', mode: 'heatmap', position: 'P' },
    ],
  };
}

/** Deterministic pseudo-random column data, so benchmarks are comparable run to run. */
export function syntheticColumn(rows: number, seed: number): Float32Array {
  const out = new Float32Array(rows);
  let state = seed | 1;
  for (let i = 0; i < rows; i++) {
    // xorshift32: cheap, deterministic, and good enough to defeat branch prediction.
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    out[i] = ((state >>> 0) / 4294967296);
  }
  return out;
}

/** Contiguous uploads for the columns the scatter graph reads. */
export function sourceUploads(rows: number): Map<string, ColumnUpload> {
  const make = (data: Float32Array): ColumnUpload => ({
    tier: 'cast', data, chunkCount: 1, nullCount: 0, convertMs: 0, arrowType: 'bench', rows,
  });
  const scaled = (seed: number, lo: number, hi: number) => {
    const c = syntheticColumn(rows, seed);
    for (let i = 0; i < rows; i++) c[i] = lo + c[i] * (hi - lo);
    return c;
  };
  return new Map([
    ['lng', make(scaled(1, -179, 179))],
    ['lat', make(scaled(2, -80, 80))],
    ['elevation', make(scaled(3, 0, 900))],
    ['pop', make(scaled(4, 10, 1e6))],
    ['speed', make(scaled(5, 0, 120))],
  ]);
}
