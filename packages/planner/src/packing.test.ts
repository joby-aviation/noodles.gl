import { describe, it, expect } from 'vitest';
import { plan, type Schema } from './planner.js';
import { analyze } from './analyze.js';
import { optimize, sameAssignment } from './optimizer.js';
import { packedColorName, positionFormat, rowBytes, unpackRgba8 } from './packing.js';
import { DEFAULT_COSTS } from './cost.js';
import { scatterGraph, wrangleGraph, heatmapGraph, SCHEMA, STATS } from './fixtures.js';
import { targetCaps } from './target.js';
import type { Graph } from './types.js';

const schema: Schema = new Map([['lng', 1], ['lat', 1], ['elevation', 1], ['tint', 1]]);
const source = { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1000 } } as const;

function scatter(color: Graph['nodes'][number]): Graph {
  return {
    params: {},
    nodes: [
      source,
      { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat', z: '0' },
      color,
      { id: 'out', type: 'render', input: color.id, mode: 'points' },
    ],
  };
}

const ramp = scatter({ id: 'c', type: 'colorscale', input: 'p', expr: 'elevation', ramp: 'viridis', domain: ['0', '900'] });

describe('packed RGBA8 color', () => {
  it('a kernel-written color is declared rgba8 and stored as one u32 a row', () => {
    const p = plan(ramp, schema, 'auto');
    const cd = p.attributes.find((a) => a.name === 'Cd')!;
    expect(cd).toMatchObject({ provenance: 'derived', width: 3, format: 'rgba8' });
    expect(rowBytes(cd)).toBe(4);
    const code = p.kernels[0].code;
    expect(code).toMatch(/var<storage, read_write> b_Cd: array<u32>/);
    expect(code).toMatch(/b_Cd\[i\] = pack4x8unorm\(vec4<f32>\(v\d+, 1\.0\)\)/);
    // Position is untouched: still f32 components.
    expect(code).toMatch(/b_P: array<f32>/);
  });

  it('a 4-component color packs without an appended alpha', () => {
    const p = plan(scatter({ id: 'c', type: 'attribute', input: 'p', name: 'Cd', expr: '[elevation, 0.5, 0.25, 1.0]' }), schema, 'gpu-first');
    expect(p.attributes.find((a) => a.name === 'Cd')).toMatchObject({ width: 4, format: 'rgba8' });
    expect(p.kernels[0].code).toMatch(/b_Cd\[i\] = pack4x8unorm\(v\d+\)/);
  });

  it('a color computed in SQL stays f32: packing it would cost a JS pass', () => {
    const p = plan(scatter({ id: 'c', type: 'attribute', input: 'p', name: 'Cd', expr: '[elevation, 0.5, 0.25]' }), schema, 'sql-first');
    const cd = p.attributes.find((a) => a.name === 'Cd')!;
    expect(cd.provenance).toBe('arrow');
    expect(cd.format).toBeUndefined();
  });

  it('a scalar or a source column of the color name is not packed', () => {
    const scalar = plan(scatter({ id: 'c', type: 'attribute', input: 'p', name: 'Cd', expr: 'elevation' }), schema, 'gpu-first');
    expect(scalar.attributes.find((a) => a.name === 'Cd')!.format).toBeUndefined();
    const withColumn: Schema = new Map([...schema, ['Cd', 1]]);
    expect(packedColorName(analyze(ramp, withColumn))).toBeUndefined();
  });

  it('a raw wgsl write of the color packs too', () => {
    const p = plan(scatter({
      id: 'c', type: 'raw', input: 'p', engine: 'gpu', reads: ['tint'],
      writes: [{ name: 'Cd', width: 3 }], code: 'Cd = vec3<f32>(tint, 0.5, 0.25);',
    }), schema, 'auto');
    expect(p.attributes.find((a) => a.name === 'Cd')!.format).toBe('rgba8');
    expect(p.kernels[0].code).toMatch(/b_Cd\[i\] = pack4x8unorm\(vec4<f32>\(v\d+, 1\.0\)\)/);
  });

  it('the optimizer prices the packed color at 4 bytes a row, as emit allocates it', () => {
    // Two implementations of one rule: the byte estimate and the emitted declaration.
    const analysis = analyze(ramp, schema);
    const caps = targetCaps('webgpu-native', undefined);
    const result = optimize(analysis, { costs: DEFAULT_COSTS, caps, params: {}, policy: 'gpu-first' });
    const chosen = result.candidates.find((c) => c.legal && c.cost && c.assignment.sqlEnd === 0 && c.assignment.cpuEnd === 0)!;
    const rows = 1000;
    // P (vec3 f32) + Cd (packed) on the GPU, plus the scalar source columns uploaded.
    const emitted = plan(ramp, schema, 'gpu-first').attributes
      .filter((a) => a.provenance === 'derived')
      .reduce((sum, a) => sum + rows * rowBytes(a), 0);
    expect(emitted).toBe(rows * (12 + 4));
    const uploads = rows * 4 * 2; // lng, lat
    const elevation = rows * 4;
    expect(chosen.cost!.gpuBytes).toBe(emitted + uploads + elevation);
  });

  it('unpackRgba8 inverts pack4x8unorm byte order', () => {
    // r=255, g=128, b=0, a=255 -> 0xff0080ff little-endian.
    const out = unpackRgba8(new Uint32Array([0xff0080ff]), 3);
    expect(out[0]).toBe(1);
    expect(out[1]).toBeCloseTo(128 / 255, 6);
    expect(out[2]).toBe(0);
  });
});

describe('hilo positions', () => {
  const caps = (id: 'webgpu-native' | 'deck-webgpu') => targetCaps(id, undefined);

  it('a position computed in SQL is selected as DOUBLE and declared hilo', () => {
    const p = plan(ramp, schema, { policy: 'sql-first' });
    const P = p.attributes.find((a) => a.name === 'P')!;
    expect(P).toMatchObject({ provenance: 'arrow', width: 3, format: 'hilo' });
    expect(rowBytes(P)).toBe(24);
    expect(p.sql).toContain('AS DOUBLE) AS "P_0"');
    // Other SQL columns stay FLOAT.
    expect(p.sql).toMatch(/CAST\("elevation" AS FLOAT\)/);
  });

  it('a kernel that reads a hilo position adds the halves', () => {
    // ramp() has no SQL form, so under sql-first P is computed in SQL and the kernel reads it.
    const g = scatter({ id: 'c', type: 'attribute', input: 'p', name: 'Cd', expr: 'ramp(P.x)' });
    const p = plan(g, schema, 'sql-first');
    expect(p.attributes.find((a) => a.name === 'P')!.format).toBe('hilo');
    expect(p.kernels[0].code).toMatch(/b_P\[i \* 6u \+ 0u\] \+ b_P\[i \* 6u \+ 3u\]/);
  });

  it('a kernel-written position is f32 natively and hilo, low half zero, for deck', () => {
    const native = plan(ramp, schema, { policy: 'gpu-first', caps: caps('webgpu-native') });
    expect(native.attributes.find((a) => a.name === 'P')!.format).toBeUndefined();
    const deck = plan(ramp, schema, { policy: 'gpu-first', caps: caps('deck-webgpu') });
    expect(deck.attributes.find((a) => a.name === 'P')).toMatchObject({ provenance: 'derived', format: 'hilo' });
    expect(deck.kernels[0].code).toMatch(/b_P\[i \* 6u \+ 3u\] = 0\.0;/);
    expect(deck.kernels[0].code).toMatch(/b_P\[i \* 6u \+ 0u\] = v\d+\[0\];/);
  });

  it('a layer output keeps f32 positions: its consumers read columns on the CPU', () => {
    const analysis = analyze({
      params: {},
      nodes: [
        source,
        { id: 'p', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
        { id: 'out', type: 'layer', input: 'p', kind: 'scatter', channels: { position: 'P' } },
      ],
      output: 'out',
    } as Graph, schema);
    expect(analysis.layer).toBeDefined();
    expect(positionFormat(analysis, caps('deck-webgpu'), 'sql')).toBeUndefined();
  });

  it('the optimizer prices a SQL position at 24 bytes a row, as emit allocates it', () => {
    const analysis = analyze(ramp, schema);
    const result = optimize(analysis, { costs: DEFAULT_COSTS, caps: caps('webgpu-native'), params: {}, policy: 'sql-first' });
    const chosen = result.candidates.find((c) => sameAssignment(c.assignment, result.chosen))!;
    const emitted = plan(ramp, schema, 'sql-first');
    const rows = 1000;
    const bytes = emitted.attributes.reduce((sum, a) => sum + rows * rowBytes(a), 0);
    expect(emitted.attributes.find((a) => a.name === 'P')!.format).toBe('hilo');
    expect(chosen.cost!.gpuBytes).toBe(bytes);
  });
});

describe('the optimizer prices exactly the buffers emit allocates', () => {
  // Two implementations of one rule. The estimate gates the memory budget and weighs SQL
  // against the GPU; it used to charge source columns read only inside SQL (52 bytes a row
  // against 40 for a sql-first scatter), kernel-register locals, and miss the discard mask.
  const aggregate: Graph = {
    params: {},
    nodes: [
      { ...source, dataset: { ref: 'test', estimatedRows: 1_000_000 } },
      { id: 'cell', type: 'attribute', input: 'src', name: 'cell', expr: 'floor(lng / 10.0)' },
      { id: 'agg', type: 'aggregate', input: 'cell', groupBy: ['cell'], aggs: [{ name: 'n', expr: 'count()' }, { name: 'meanEl', expr: 'avg(elevation)' }] },
      { id: 'p', type: 'attribute', input: 'agg', name: 'P', expr: '[cell, n, 0.0]' },
      { id: 'c', type: 'colorscale', input: 'p', expr: 'meanEl', ramp: 'viridis', domain: ['0', '900'] },
      { id: 'out', type: 'render', input: 'c', mode: 'points' },
    ],
  };
  const raw: Graph = {
    params: {},
    nodes: [
      { ...source, dataset: { ref: 'test', estimatedRows: 1_000_000 } },
      { id: 'p', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0.0]' },
      {
        id: 'r', type: 'raw', input: 'p', engine: 'gpu', reads: ['elevation'],
        writes: [{ name: 'Cd', width: 3 }, { name: 'tmp', width: 1 }],
        code: 'tmp = elevation / 900.0; Cd = vec3<f32>(tmp, 0.5, 0.25);',
      },
      { id: 'out', type: 'render', input: 'r', mode: 'points' },
    ],
  };
  const graphs = { scatter: scatterGraph(), wrangle: wrangleGraph(), heatmap: heatmapGraph(), aggregate, raw };
  const policies = ['cost', 'auto', 'sql-first', 'gpu-first'] as const;
  const targets = ['webgpu-native', 'deck-webgpu', 'deck-webgl2'] as const;
  let checked = 0;

  for (const [name, graph] of Object.entries(graphs)) {
    for (const id of targets) {
      it(`${name} on ${id}`, () => {
        for (const policy of policies) {
          let p;
          try {
            p = plan(graph, SCHEMA, { policy, stats: STATS, caps: targetCaps(id, undefined) });
          } catch {
            continue; // a fixed policy can be illegal on a target; that is tested elsewhere
          }
          const rows = p.explain.estimatedRows;
          const chosen = p.explain.candidates.find((c) => sameAssignment(c.assignment, p.explain.chosen))!;
          const emitted = p.attributes
            .filter((a) => a.type !== 'str')
            .reduce((sum, a) => sum + rows * rowBytes(a), 0) + (p.compaction ? rows * 8 : 0);
          expect(chosen.cost!.gpuBytes, `${name} ${policy} ${id}`).toBe(emitted);
          checked++;
        }
      });
    }
  }

  it('checked enough plans to mean something', () => {
    expect(checked).toBeGreaterThanOrEqual(15);
  });
});
