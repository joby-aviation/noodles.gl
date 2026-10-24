import { describe, it, expect } from 'vitest';
import { plan, PlanError } from './planner.js';
import { analyze } from './analyze.js';
import { SCHEMA, STATS } from './fixtures.js';
import type { Graph, RawNode } from './types.js';

/**
 * The escape hatch, and the honest accounting of what it costs.
 *
 * A `raw` node is the one node the planner cannot analyze, so the tests here are about the
 * boundary around it: that it pins its stage rather than being placed, that its *declarations*
 * are what the planner uses in place of the analysis it cannot do, that it still fuses into a
 * neighbouring kernel, and that the declarations it gets wrong are rejected rather than
 * producing quietly wrong code.
 */

const raw = (over: Partial<RawNode> = {}): RawNode => ({
  id: 'custom',
  type: 'raw',
  input: 'src',
  engine: 'gpu',
  code: 'heat = elevation / 900.0;',
  writes: [{ name: 'heat', width: 1 }],
  reads: ['elevation'],
  ...over,
});

function graph(node: RawNode, extra: Graph['nodes'] = []): Graph {
  return {
    params: { k: { value: 2, kind: 'value', changeRate: 8 } },
    nodes: [
      { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1_000_000 } },
      node,
      ...extra,
      {
        id: 'proj', type: 'project', input: extra.length ? extra[extra.length - 1].id : node.id,
        mode: 'mercator', x: 'lng', y: 'lat',
      },
      { id: 'out', type: 'render', input: 'proj', mode: 'points' },
    ],
  };
}

const opts = { policy: 'cost' as const, stats: STATS, params: { k: 2 } };

describe('analysis of a raw node', () => {
  it('declares exactly one feasible stage, so it cannot be moved', () => {
    const a = analyze(graph(raw({ engine: 'gpu' })), SCHEMA);
    const node = a.order.find((n) => n.id === 'custom')!;
    expect(node.kind).toBe('raw');
    expect([...node.feasible]).toEqual(['gpu']);

    const sql = analyze(graph(raw({ engine: 'sql', code: 'elevation / 900.0' })), SCHEMA);
    expect([...sql.order.find((n) => n.id === 'custom')!.feasible]).toEqual(['sql']);
  });

  it('adds its declared writes to the schema, with their widths', () => {
    const a = analyze(graph(raw({
      code: 'tint = vec3<f32>(1.0, 0.0, 0.0);',
      writes: [{ name: 'tint', width: 3 }],
      reads: [],
    })), SCHEMA);
    expect(a.widths.get('tint')).toBe(3);
  });

  it('uses the declared reads as its dependency set', () => {
    const a = analyze(graph(raw({ reads: ['elevation', 'pop'] })), SCHEMA);
    expect(a.order.find((n) => n.id === 'custom')!.reads.sort()).toEqual(['elevation', 'pop']);
  });

  it('uses the declared opCost, since opCount cannot walk opaque text', () => {
    const cheap = analyze(graph(raw({ opCost: 1 })), SCHEMA);
    const dear = analyze(graph(raw({ opCost: 100 })), SCHEMA);
    const ops = (a: ReturnType<typeof analyze>) => a.order.find((n) => n.id === 'custom')!.ops;
    expect(ops(dear)).toBeGreaterThan(ops(cheap));
  });

  it('rejects a declared read of an attribute nothing produces', () => {
    expect(() => analyze(graph(raw({ reads: ['nosuchcolumn'] })), SCHEMA))
      .toThrow(/declares a read of unknown attribute 'nosuchcolumn'/);
  });

  it('rejects a node that declares no writes', () => {
    expect(() => analyze(graph(raw({ writes: [] })), SCHEMA))
      .toThrow(/must declare at least one write/);
  });

  it('says in the notes that it was pinned rather than placed', () => {
    const a = analyze(graph(raw()), SCHEMA);
    expect(a.notes.join('\n')).toMatch(/custom: raw gpu node, pinned/);
  });
});

describe('emitting raw wgsl', () => {
  // The raw node's output has to be read by something, or it is dead and gets no buffer.
  const consumer = {
    id: 'shade', type: 'colorscale' as const, input: 'custom', expr: 'heat * 900.0',
    ramp: 'viridis' as const, domain: ['0', '900'] as [string, string],
  };

  const physical = plan(graph(raw(), [consumer]), SCHEMA, opts);
  const kernel = physical.kernels[0];

  it('splices the code into the kernel', () => {
    expect(kernel.code).toContain('heat = elevation / 900.0;');
  });

  it('binds the declared reads under the names the author used', () => {
    // The whole point of the preamble: raw code refers to `elevation`, not to `r3`.
    expect(kernel.code).toMatch(/let elevation = /);
  });

  it('declares each write as a var of the right WGSL type', () => {
    expect(kernel.code).toMatch(/var heat: f32;/);
    const vec = plan(graph(raw({
      code: 'tint = vec3<f32>(elevation / 900.0, 0.0, 0.0);',
      writes: [{ name: 'tint', width: 3 }],
    }), [{ ...consumer, input: 'custom', expr: 'tint.x * 900.0' }]), SCHEMA, opts);
    expect(vec.kernels[0].code).toMatch(/var tint: vec3<f32>;/);
  });

  it('fuses with its neighbours instead of forcing its own dispatch', () => {
    // Fusion depends on the stage assignment, not on whether the planner can read the code.
    expect(physical.kernels).toHaveLength(1);
    expect(kernel.nodeIds).toContain('custom');
    expect(kernel.nodeIds.length).toBeGreaterThan(1);
  });

  it('labels the spliced block with the node id', () => {
    expect(kernel.code).toMatch(/\/\/ custom: raw wgsl/);
  });

  it('exposes a declared param as a plain local', () => {
    const withParam = plan(graph(raw({
      code: 'heat = (elevation / 900.0) * k;',
      params: ['k'],
    }), [consumer]), SCHEMA, opts);
    expect(withParam.kernels[0].code).toMatch(/let k = params\.p_k;/);
    expect(withParam.uniformParams).toContain('k');
  });

  it('keeps a write nothing else reads in a register rather than a buffer', () => {
    // Same rule as a wrangle local: no consumer, no binding slot.
    const dead = plan(graph(raw({
      code: 'heat = elevation / 900.0;\nunused = heat * 2.0;',
      writes: [{ name: 'heat', width: 1 }, { name: 'unused', width: 1 }],
    }), [consumer]), SCHEMA, opts);
    expect(dead.kernels[0].writes).not.toContain('unused');
    expect(dead.attributes.map((a) => a.name)).not.toContain('unused');
  });

  it('predicts the same binding count the emitter actually produces', () => {
    // The optimizer rejects candidates over the per-stage binding limit, so its count and
    // `buildKernel`'s must agree — two implementations of one rule.
    const chosen = physical.explain.candidates.find(
      (c) => c.legal && c.assignment.sqlEnd === physical.explain.chosen.sqlEnd
        && c.assignment.cpuEnd === physical.explain.chosen.cpuEnd,
    );
    const actual = kernel.reads.length + kernel.writes.length + (kernel.usesRamp ? 1 : 0);
    expect(chosen?.storageBindings).toBe(actual);
  });

  it('rejects a name that collides with a generated identifier', () => {
    for (const bad of ['i', 'params', 'rowInfo']) {
      expect(() => plan(graph(raw({
        code: `${bad} = 1.0;`, writes: [{ name: bad, width: 1 }], reads: [],
      }), [{ ...consumer, expr: `${bad} * 1.0` }]), SCHEMA, opts), bad)
        .toThrow(PlanError);
    }
  });

  it('rejects object-form code on the gpu, where there is one block not one per write', () => {
    expect(() => plan(graph(raw({ code: { heat: 'elevation' } }), [consumer]), SCHEMA, opts))
      .toThrow(/must be a string of WGSL statements/);
  });
});

describe('emitting raw sql', () => {
  const sqlRaw = raw({
    engine: 'sql',
    code: 'CAST(elevation AS DOUBLE) / 900.0',
    writes: [{ name: 'heat', width: 1 }],
  });
  const consumer = {
    id: 'shade', type: 'colorscale' as const, input: 'custom', expr: 'heat * 900.0',
    ramp: 'viridis' as const, domain: ['0', '900'] as [string, string],
  };

  it('appears in the select list, parenthesised and cast', () => {
    const physical = plan(graph(sqlRaw, [consumer]), SCHEMA, opts);
    expect(physical.sql).toContain('CAST((CAST(elevation AS DOUBLE) / 900.0) AS FLOAT) AS "heat"');
  });

  it('declares the result as an arrow-sourced attribute', () => {
    const physical = plan(graph(sqlRaw, [consumer]), SCHEMA, opts);
    const attr = physical.attributes.find((a) => a.name === 'heat');
    expect(attr?.provenance).toBe('arrow');
  });

  it('requires the object form once there are two writes', () => {
    expect(() => plan(graph(raw({
      engine: 'sql',
      code: 'elevation',
      writes: [{ name: 'a', width: 1 }, { name: 'b', width: 1 }],
    }), [{ ...consumer, expr: 'a * 1.0' }]), SCHEMA, opts))
      .toThrow(/'code' must be an object keyed by write name \(a, b\)/);
  });

  it('accepts the object form and emits one item per write', () => {
    const physical = plan(graph(raw({
      engine: 'sql',
      code: { a: 'elevation * 2.0', b: 'pop / 10.0' },
      writes: [{ name: 'a', width: 1 }, { name: 'b', width: 1 }],
    }), [{ ...consumer, expr: 'a + b' }]), SCHEMA, opts);
    expect(physical.sql).toContain('AS "a"');
    expect(physical.sql).toContain('AS "b"');
  });

  it('reports a write missing from the object form', () => {
    expect(() => plan(graph(raw({
      engine: 'sql',
      code: { a: 'elevation' },
      writes: [{ name: 'a', width: 1 }, { name: 'b', width: 1 }],
    }), [{ ...consumer, expr: 'a * 1.0' }]), SCHEMA, opts))
      .toThrow(/no expression for declared write 'b'/);
  });

  it('refuses a vector write, rather than inventing a component naming', () => {
    expect(() => plan(graph(raw({
      engine: 'sql', code: 'elevation', writes: [{ name: 'v', width: 3 }],
    }), [{ ...consumer, expr: 'v.x' }]), SCHEMA, opts))
      .toThrow(/raw sql produces scalars only/);
  });
});
