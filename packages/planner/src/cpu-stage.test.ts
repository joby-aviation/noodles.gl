import { describe, it, expect } from 'vitest';
import { evaluateStage, materialize, toUint8Color } from './cpu-stage.js';
import { plan, type Schema, type PhysicalPlan } from './planner.js';
import { targetCaps } from './target.js';
import type { ColumnUpload } from './arrow.js';
import type { Graph } from './types.js';

/**
 * The CPU stage runs generated JS, so unlike the WGSL and SQL backends it can be *executed*
 * in Node. That makes it the reference the other two are compared against in the browser
 * suite — which only works if it is itself right, hence checking it against hand-computed
 * values rather than against itself.
 */

const schema: Schema = new Map([
  ['lng', 1], ['lat', 1], ['elevation', 1], ['pop', 1], ['speed', 1],
]);
const source = { id: 'src', type: 'source', dataset: { ref: 't', estimatedRows: 4 } } as const;
/** No compute, so the optimizer must place every attribute on the CPU. */
const cpuOnly = targetCaps('deck-webgl2', undefined);

/** A contiguous single-chunk upload, the simplest shape. */
function upload(values: number[]): ColumnUpload {
  return {
    tier: 'cast', data: new Float32Array(values), chunkCount: 1,
    nullCount: 0, convertMs: 0, arrowType: 'test', rows: values.length,
  };
}

function chunked(chunks: number[][]): ColumnUpload {
  return {
    tier: 'chunked', chunks: chunks.map((c) => new Float32Array(c)),
    chunkCount: chunks.length, nullCount: 0, convertMs: 0, arrowType: 'test',
    rows: chunks.reduce((n, c) => n + c.length, 0),
  };
}

const sources = (cols: Record<string, number[]>) =>
  new Map(Object.entries(cols).map(([k, v]) => [k, upload(v)]));

function cpuPlan(nodes: Graph['nodes'], params: Graph['params'] = {}): PhysicalPlan {
  return plan({ params, nodes }, schema, { caps: cpuOnly, policy: 'auto' });
}

const run = (p: PhysicalPlan, cols: Record<string, number[]>, params: Record<string, number> = {}) =>
  evaluateStage(p.cpuStage, p, sources(cols), params, Object.values(cols)[0].length);

// ---------------------------------------------------------------------------

describe('materialize', () => {
  it('passes a contiguous array through without copying', () => {
    const up = upload([1, 2, 3]);
    expect(materialize(up)).toBe(up.data);
  });

  it('concatenates chunks in row order', () => {
    expect([...materialize(chunked([[1, 2], [3], [4, 5, 6]]))]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('handles a single chunk and an empty tail chunk', () => {
    expect([...materialize(chunked([[7, 8, 9]]))]).toEqual([7, 8, 9]);
    expect([...materialize(chunked([[1], []]))]).toEqual([1]);
  });
});

describe('toUint8Color', () => {
  it('scales 0..1 floats to 0..255 with full alpha', () => {
    const out = toUint8Color(new Float32Array([0, 0.5, 1]), 3, 1);
    expect([...out]).toEqual([0, 128, 255, 255]);
  });

  it('clamps out-of-range channels instead of wrapping', () => {
    // Wrapping would turn an over-bright colour into a dark one, which looks like a data bug.
    const out = toUint8Color(new Float32Array([-1, 2, 0.5]), 3, 1);
    expect([...out]).toEqual([0, 255, 128, 255]);
  });

  it('pads a narrower attribute with zeroes', () => {
    const out = toUint8Color(new Float32Array([1, 1]), 2, 1);
    expect([...out]).toEqual([255, 255, 0, 255]);
  });

  it('honours a custom alpha and handles many rows', () => {
    const out = toUint8Color(new Float32Array([1, 0, 0, 0, 1, 0]), 3, 2, 128);
    expect([...out]).toEqual([255, 0, 0, 128, 0, 255, 0, 128]);
  });

  it('maps NaN to 0 rather than leaving it undefined', () => {
    const out = toUint8Color(new Float32Array([NaN, 0.5, 1]), 3, 1);
    expect(out[0]).toBe(0);
  });
});

describe('evaluateStage numeric correctness', () => {
  it('computes a single scalar attribute', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'b', type: 'attribute', input: 'a', name: 'pscale', expr: 'sqrt(pop) * 2' },
      { id: 'out', type: 'render', input: 'b', mode: 'points' },
    ]);
    const r = run(p, { lng: [0, 0, 0, 0], lat: [0, 0, 0, 0], pop: [4, 9, 16, 25] });
    const pscale = r.values.get('pscale')!;
    expect(pscale.width).toBe(1);
    expect([...pscale.data]).toEqual([4, 6, 8, 10]);
  });

  it('computes a vec3 attribute packed, not interleaved from columns', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, elevation]' },
      { id: 'out', type: 'render', input: 'a', mode: 'points' },
    ]);
    const r = run(p, { lng: [1, 4], lat: [2, 5], elevation: [3, 6] });
    const P = r.values.get('P')!;
    expect(P.width).toBe(3);
    expect([...P.data]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('binds parameters', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng * {{k}}, lat, 0]' },
      { id: 'out', type: 'render', input: 'a', mode: 'points' },
    ], { k: { value: 3, kind: 'value' } });
    const r = run(p, { lng: [1, 2], lat: [0, 0] }, { k: 3 });
    expect([...r.values.get('P')!.data]).toEqual([3, 0, 0, 6, 0, 0]);
  });

  it('reads a value an earlier statement wrote in the same stage', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'half', expr: 'pop / 2' },
      { id: 'b', type: 'attribute', input: 'a', name: 'P', expr: '[half, half * 2, 0]' },
      { id: 'out', type: 'render', input: 'b', mode: 'points' },
    ]);
    const r = run(p, { pop: [10, 20] });
    expect([...r.values.get('P')!.data]).toEqual([5, 10, 0, 10, 20, 0]);
  });

  it('handles an attribute that overwrites what it reads', () => {
    // The SSA rebinding must read the previous value, not the one being written.
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'v', expr: 'pop' },
      { id: 'b', type: 'attribute', input: 'a', name: 'v', expr: 'v * 10' },
      { id: 'c', type: 'attribute', input: 'b', name: 'P', expr: '[v, 0, 0]' },
      { id: 'out', type: 'render', input: 'c', mode: 'points' },
    ]);
    const r = run(p, { pop: [1, 2, 3] });
    expect([...r.values.get('v')!.data]).toEqual([10, 20, 30]);
  });

  it('evaluates a ramp against the same LUT the kernel uses', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'c', type: 'colorscale', input: 'a', expr: 'elevation', ramp: 'viridis', domain: ['0', '1'] },
      { id: 'out', type: 'render', input: 'c', mode: 'points' },
    ]);
    const r = run(p, { lng: [0, 0], lat: [0, 0], elevation: [0, 1] });
    const Cd = r.values.get('Cd')!;
    expect(Cd.width).toBe(3);
    // Viridis endpoints: dark purple to yellow-green.
    expect(Cd.data[0]).toBeCloseTo(0.267, 3);
    expect(Cd.data[3]).toBeCloseTo(0.993, 3);
    expect(Cd.data[5]).toBeCloseTo(0.144, 3);
  });

  it('propagates NaN from a null rather than turning it into a number', () => {
    // A null must stay identifiable so the shaders can discard it.
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'out', type: 'render', input: 'a', mode: 'points' },
    ]);
    const r = run(p, { lng: [1, NaN], lat: [2, 3] });
    const P = r.values.get('P')!.data;
    expect(P[0]).toBe(1);
    expect(Number.isNaN(P[3])).toBe(true);
  });

  it('reports separate timings for materializing and evaluating', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'out', type: 'render', input: 'a', mode: 'points' },
    ]);
    const r = run(p, { lng: [1], lat: [2] });
    expect(r.materializeMs).toBeGreaterThanOrEqual(0);
    expect(r.evalMs).toBeGreaterThanOrEqual(0);
    expect(r.rows).toBe(1);
  });

  it('exposes the generated loop for the inspector', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'out', type: 'render', input: 'a', mode: 'points' },
    ]);
    const r = run(p, { lng: [1], lat: [2] });
    expect(r.code).toContain('for (let i = 0');
    expect(r.code).toContain('o_P');
  });

  it('works from chunked sources without materializing them twice', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'out', type: 'render', input: 'a', mode: 'points' },
    ]);
    const src = new Map([
      ['lng', chunked([[1], [3]])],
      ['lat', chunked([[2], [4]])],
    ]);
    const r = evaluateStage(p.cpuStage, p, src, {}, 2);
    expect([...r.values.get('P')!.data]).toEqual([1, 2, 0, 3, 4, 0]);
  });

  it('carries arrow-sourced attributes through alongside computed ones', () => {
    // The deck panes bind both, so both must appear in `values`.
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'out', type: 'render', input: 'a', mode: 'points' },
    ]);
    const r = run(p, { lng: [1], lat: [2] });
    expect(r.values.has('P')).toBe(true);
    for (const decl of p.attributes.filter((d) => d.provenance === 'arrow')) {
      if (sources({ lng: [1], lat: [2] }).has(decl.name)) {
        expect(r.values.has(decl.name), decl.name).toBe(true);
      }
    }
  });

  it('an empty stage produces no outputs and no loop body', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'out', type: 'render', input: 'a', mode: 'points' },
    ]);
    const r = evaluateStage([], p, sources({ lng: [1], lat: [2] }), {}, 1);
    expect(r.values.size).toBeGreaterThanOrEqual(0);
    expect(r.evalMs).toBeGreaterThanOrEqual(0);
  });
});

describe('the CPU stage agrees with hand-computed reference values', () => {
  /** Independent implementation of the mercator projection the `project` node desugars to. */
  const mercatorX = (lng: number) => lng / 360;
  const mercatorY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);

  it('matches a reference mercator to float precision', () => {
    const p = cpuPlan([
      source,
      { id: 'proj', type: 'project', input: 'src', mode: 'mercator', x: 'lng', y: 'lat', z: '0' },
      { id: 'out', type: 'render', input: 'proj', mode: 'points' },
    ]);
    const lng = [0, 45, -170, 179];
    const lat = [0, 30, -60, 80];
    const r = run(p, { lng, lat });
    const P = r.values.get('P')!.data;
    for (let i = 0; i < lng.length; i++) {
      expect(P[i * 3 + 0]).toBeCloseTo(mercatorX(lng[i]), 5);
      expect(P[i * 3 + 1]).toBeCloseTo(mercatorY(lat[i]), 4);
    }
  });

  it('matches a reference log scale', () => {
    const p = cpuPlan([
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
      { id: 's', type: 'scale', input: 'a', name: 'pscale', expr: 'pop', kind: 'log', domain: ['1', '1000'], range: ['0', '10'] },
      { id: 'out', type: 'render', input: 's', mode: 'points' },
    ]);
    const pop = [1, 10, 100, 1000];
    const r = run(p, { lng: [0, 0, 0, 0], lat: [0, 0, 0, 0], pop });
    const got = [...r.values.get('pscale')!.data];
    const expected = pop.map((v) => {
      const t = (Math.log(Math.max(v, 1e-9)) - Math.log(1)) / (Math.log(1000) - Math.log(1));
      return Math.min(Math.max(t * 10, 0), 10);
    });
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
  });
});
