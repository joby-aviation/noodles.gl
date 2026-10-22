import { describe, it, expect } from 'vitest';
import { plan, PlanError, type Schema } from './planner.js';
import type { Graph } from './types.js';

const schema: Schema = new Map([
  ['lng', 1], ['lat', 1], ['elevation', 1], ['pop', 1], ['speed', 1], ['cluster', 1], ['id', 1],
]);

function graph(nodes: Graph['nodes'], params: Graph['params'] = {}): Graph {
  return { params, nodes };
}

const source = { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 100 } } as const;

describe('engine assignment', () => {
  const g = graph(
    [
      source,
      { id: 'f', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
      { id: 'p', type: 'project', input: 'f', mode: 'identity', x: 'lng', y: 'lat', z: 'elevation' },
      { id: 'c', type: 'colorscale', input: 'p', expr: 'elevation', ramp: 'viridis', domain: ['0', '900'] },
      { id: 'out', type: 'render', input: 'c', mode: 'points' },
    ],
    { cut: { value: 0, kind: 'value' } },
  );

  it('pushes a SQL-expressible filter into the WHERE clause', () => {
    const p = plan(g, schema);
    expect(p.sql).toContain('WHERE');
    expect(p.sqlParams).toEqual(['cut']);
    expect(p.assignments.find((a) => a.nodeId === 'f')!.engine).toBe('sql');
  });

  it('keeps volume-preserving per-row math on the GPU under the auto policy', () => {
    const p = plan(g, schema, 'auto');
    expect(p.assignments.find((a) => a.nodeId === 'p')!.engine).toBe('gpu');
    expect(p.assignments.find((a) => a.nodeId === 'c')!.engine).toBe('gpu');
  });

  it('sql-first pushes the projectable math into SQL and leaves only ramp() on the GPU', () => {
    const p = plan(g, schema, 'sql-first');
    expect(p.assignments.find((a) => a.nodeId === 'p')!.engine).toBe('sql');
    // ramp() has no SQL form, so the colorscale stays a kernel regardless of policy.
    expect(p.assignments.find((a) => a.nodeId === 'c')!.engine).toBe('gpu');
    // P built in SQL arrives as three scalar columns needing interleaving.
    expect(p.attributes.find((a) => a.name === 'P')!.sourceColumns).toEqual(['P_0', 'P_1', 'P_2']);
  });

  it('gpu-first turns the filter into a discard mask instead of a WHERE clause', () => {
    const p = plan(g, schema, 'gpu-first');
    expect(p.sql).not.toContain('WHERE');
    expect(p.maskAttribute).toBe('__mask');
    expect(p.assignments.find((a) => a.nodeId === 'f')!.engine).toBe('gpu');
  });
});

describe('fusion and pushdown', () => {
  const g = graph(
    [
      source,
      { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat', z: '0' },
      { id: 's', type: 'attribute', input: 'p', name: 'pscale', expr: 'sqrt(pop) * {{k}}' },
      { id: 'c', type: 'colorscale', input: 's', expr: 'elevation', ramp: 'magma', domain: ['0', '1'] },
      { id: 'out', type: 'render', input: 'c', mode: 'points' },
    ],
    { k: { value: 1, kind: 'value' } },
  );

  it('fuses every GPU node into one kernel', () => {
    const p = plan(g, schema);
    expect(p.kernels).toHaveLength(1);
    expect(p.kernels[0].nodeIds).toEqual(['p', 's', 'c']);
    expect(p.kernels[0].writes).toEqual(['P', 'pscale', 'Cd']);
    expect(p.kernels[0].usesRamp).toBe(true);
  });

  it('selects only the columns something downstream reads', () => {
    const p = plan(g, schema);
    // cluster, id and speed are never referenced.
    expect(p.sql).toContain('"lng"');
    expect(p.sql).toContain('"pop"');
    expect(p.sql).not.toContain('"cluster"');
    expect(p.sql).not.toContain('"id"');
  });

  it('routes a kernel-only parameter to a uniform, not a requery', () => {
    const p = plan(g, schema);
    expect(p.uniformParams).toContain('k');
    expect(p.sqlParams).not.toContain('k');
  });

  it('generates WGSL that declares the uniform struct and reads the right buffers', () => {
    const code = plan(g, schema).kernels[0].code;
    expect(code).toContain('struct Params');
    expect(code).toContain('k: f32');
    expect(code).toContain('var<storage, read> b_pop');
    expect(code).toContain('var<storage, read_write> b_P');
    expect(code).toContain('fn sampleRamp');
    // `meta` is a WGSL reserved keyword; the row count must not use it.
    expect(code).not.toMatch(/\bmeta\b/);
  });
});

describe('stats nodes', () => {
  it('publish bindable parameters and inherit the WHERE clause', () => {
    const g = graph(
      [
        source,
        { id: 'f', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
        { id: 'st', type: 'stats', input: 'f', column: 'pop', ops: ['min', 'max'] },
        { id: 'p', type: 'project', input: 'f', mode: 'identity', x: 'lng', y: 'lat', z: '0' },
        { id: 'r', type: 'scale', input: 'p', name: 'pscale', expr: 'pop', domain: 'auto', statsFrom: 'st', range: ['1', '9'] },
        { id: 'out', type: 'render', input: 'r', mode: 'points' },
      ],
      { cut: { value: 0, kind: 'value' } },
    );
    const p = plan(g, schema);
    expect(p.stats).toHaveLength(1);
    expect(p.stats[0].sql).toContain('WHERE');
    expect(p.stats[0].params).toEqual(['cut']);
    expect(p.stats[0].outputs.map((o) => o.param)).toEqual(['st_min', 'st_max']);
    // The scale reads them as uniforms inside the kernel.
    expect(p.uniformParams).toContain('st_min');
    expect(p.uniformParams).toContain('st_max');
  });
});

describe('errors are actionable', () => {
  it('rejects an unknown attribute and lists what is available', () => {
    const g = graph([
      source,
      { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'nope', y: 'lat' },
      { id: 'out', type: 'render', input: 'p', mode: 'points' },
    ]);
    expect(() => plan(g, schema)).toThrow(/unknown attribute 'nope'.*Available/s);
  });

  it('rejects an aggregate placed after the SQL stage closed', () => {
    const g = graph([
      source,
      { id: 'c', type: 'colorscale', input: 'src', expr: 'elevation', ramp: 'viridis', domain: ['0', '1'] },
      { id: 'agg', type: 'aggregate', input: 'c', groupBy: ['cluster'], aggs: [{ name: 'n', expr: 'count()' }] },
      { id: 'out', type: 'render', input: 'agg', mode: 'points' },
    ]);
    expect(() => plan(g, schema)).toThrow(/cannot run after the SQL stage has closed/);
  });

  it('rejects an undeclared parameter', () => {
    const g = graph([
      source,
      { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng * {{ghost}}', y: 'lat' },
      { id: 'out', type: 'render', input: 'p', mode: 'points' },
    ]);
    expect(() => plan(g, schema)).toThrow(/'ghost' is referenced but not declared/);
  });

  it('rejects a render node with no position attribute', () => {
    const g = graph([
      source,
      { id: 'out', type: 'render', input: 'src', mode: 'points' },
    ]);
    expect(() => plan(g, schema)).toThrow(/needs attribute 'P'/);
  });

  it('rejects two different ramps, which would need two LUTs', () => {
    const g = graph([
      source,
      { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat' },
      { id: 'c1', type: 'colorscale', input: 'p', name: 'Cd', expr: 'elevation', ramp: 'viridis', domain: ['0', '1'] },
      { id: 'c2', type: 'colorscale', input: 'c1', name: 'Cd2', expr: 'pop', ramp: 'magma', domain: ['0', '1'] },
      { id: 'out', type: 'render', input: 'c2', mode: 'points' },
    ]);
    expect(() => plan(g, schema)).toThrow(/different ramps/);
  });

  it('rejects heatmap mode without a bin2d node', () => {
    const g = graph([
      source,
      { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat' },
      { id: 'out', type: 'render', input: 'p', mode: 'heatmap' },
    ]);
    expect(() => plan(g, schema)).toThrow(PlanError);
  });
});

describe('aggregate graphs', () => {
  it('reshapes the schema to group keys plus aggregates', () => {
    const g = graph([
      source,
      { id: 'agg', type: 'aggregate', input: 'src', groupBy: ['cluster'], aggs: [{ name: 'n', expr: 'count()' }, { name: 'meanPop', expr: 'avg(pop)' }] },
      { id: 'p', type: 'attribute', input: 'agg', name: 'P', expr: '[cluster, n, 0]' },
      { id: 'out', type: 'render', input: 'p', mode: 'points' },
    ]);
    const p = plan(g, schema);
    expect(p.sql).toMatch(/GROUP BY "cluster"/);
    expect(p.assignments.find((a) => a.nodeId === 'agg')!.engine).toBe('sql');
    // Referencing a column dropped by the aggregate must fail, not silently pass.
    const bad = graph([
      source,
      { id: 'agg', type: 'aggregate', input: 'src', groupBy: ['cluster'], aggs: [{ name: 'n', expr: 'count()' }] },
      { id: 'p', type: 'attribute', input: 'agg', name: 'P', expr: '[lng, lat, 0]' },
      { id: 'out', type: 'render', input: 'p', mode: 'points' },
    ]);
    expect(() => plan(bad, schema)).toThrow(/unknown attribute 'lng'/);
  });
});
