import { describe, it, expect } from 'vitest';
import { parseWrangle, expandWrangle, localName, WrangleError } from './wrangle.js';
import { plan, type Schema } from './planner.js';
import { analyze } from './analyze.js';
import { toWgsl } from './backends/wgsl.js';
import { targetCaps } from './target.js';
import type { Graph } from './types.js';

const schema: Schema = new Map([
  ['lng', 1], ['lat', 1], ['elevation', 1], ['pop', 1], ['speed', 1], ['cluster', 1], ['id', 1],
]);

const source = { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1000 } } as const;

describe('wrangle parsing', () => {
  it('parses attribute writes and locals', () => {
    const s = parseWrangle(`
      @P = [lng, lat, 0];
      var t = pop / 100.0;
      @pscale = sqrt(t);
    `);
    expect(s.map((x) => [x.kind, x.name])).toEqual([
      ['attribute', 'P'],
      ['local', 't'],
      ['attribute', 'pscale'],
    ]);
  });

  it('accepts a trailing statement with no semicolon', () => {
    expect(parseWrangle('@a = 1; @b = 2')).toHaveLength(2);
  });

  it('lets an expression wrap across lines', () => {
    const s = parseWrangle('@P = [lng,\n  lat,\n  0];');
    expect(s).toHaveLength(1);
    expect(s[0].name).toBe('P');
  });

  it('strips comments without shifting line numbers', () => {
    const s = parseWrangle('// header\n\n@a = 1;\n// note\n@b = 2;');
    expect(s.map((x) => x.line)).toEqual([3, 5]);
  });

  it('reports the line for a bad statement', () => {
    expect(() => parseWrangle('@a = 1;\nnonsense;')).toThrow(/Line 2/);
  });

  it('reports the line for a bad expression', () => {
    expect(() => parseWrangle('@a = 1;\n@b = sqrt(;')).toThrow(/Line 2/);
  });

  it('rejects an empty body and a body of only locals', () => {
    expect(() => parseWrangle('  \n // nothing \n ')).toThrow(WrangleError);
    expect(() => parseWrangle('var t = 1;')).toThrow(/assigns no attributes/);
  });
});

describe('local scoping', () => {
  it('renames locals to graph-unique names, on both sides', () => {
    const expanded = expandWrangle('wr', parseWrangle('var t = pop / 2.0; @Cd = [t, t, t];'));
    expect(expanded[0].name).toBe(localName('wr', 't'));
    expect(expanded[0].internal).toBe(true);
    // The reference in @Cd must point at the renamed local.
    const out = toWgsl(expanded[1].expr, (name) => ({ code: `a_${name}`, width: 1 }));
    expect(out.columns).toEqual([localName('wr', 't')]);
  });

  it('a self-reference reads the upstream attribute, not the new local', () => {
    // `var t = t + 1` must read an upstream `t`, matching how a VEX local shadows only
    // after its own definition.
    const expanded = expandWrangle('wr', parseWrangle('var t = t + 1.0; @a = t;'));
    const first = toWgsl(expanded[0].expr, (name) => ({ code: `a_${name}`, width: 1 }));
    expect(first.columns).toEqual(['t']);
    const second = toWgsl(expanded[1].expr, (name) => ({ code: `a_${name}`, width: 1 }));
    expect(second.columns).toEqual([localName('wr', 't')]);
  });

  it('two wrangles declaring the same local do not collide', () => {
    const a = expandWrangle('one', parseWrangle('var t = 1; @a = t;'));
    const b = expandWrangle('two', parseWrangle('var t = 2; @b = t;'));
    expect(a[0].name).not.toBe(b[0].name);
  });
});

describe('wrangle in a graph', () => {
  const graph: Graph = {
    params: { k: { value: 2, kind: 'value' } },
    nodes: [
      source,
      {
        id: 'wr',
        type: 'wrangle',
        input: 'src',
        ramp: 'viridis',
        body: `
          @P = [lng / 360.0, lat / 180.0, elevation * 0.001];
          var t = clamp(fit(ln(pop), 2.3, 13.9, 0.0, 1.0), 0.0, 1.0);
          @Cd = ramp(t);
          @pscale = sqrt(t) * {{k}};
        `,
      },
      { id: 'out', type: 'render', input: 'wr', mode: 'points' },
    ],
  };

  it('expands into one attribute node per statement', () => {
    const analysis = analyze(graph, schema);
    expect(analysis.order.map((n) => n.name)).toEqual([
      'P', localName('wr', 't'), 'Cd', 'pscale',
    ]);
  });

  it('fuses back into a single kernel', () => {
    const p = plan(graph, schema, { caps: targetCaps('webgpu-native', undefined) });
    expect(p.kernels).toHaveLength(1);
    expect(p.kernels[0].nodeIds).toHaveLength(4);
    expect(p.kernels[0].usesRamp).toBe(true);
    // Only the attributes the renderer reads are written; the local is not one of them.
    expect(p.kernels[0].writes).toEqual(['P', 'Cd', 'pscale']);
  });

  it('keeps a local in a register instead of giving it a buffer', () => {
    const p = plan(graph, schema, { caps: targetCaps('webgpu-native', undefined) });
    const local = localName('wr', 't');

    // No buffer, no binding, no upload: nothing outside the kernel reads it.
    expect(p.attributes.some((a) => a.name === local)).toBe(false);
    expect(p.kernels[0].writes).not.toContain(local);
    expect(p.kernels[0].reads).not.toContain(local);
    expect(p.kernels[0].code).not.toContain(`b_${local}`);

    // But it is still computed exactly once and read by both consumers.
    const lets = p.kernels[0].code.match(/^\s+let v\d+ =/gm) ?? [];
    expect(lets).toHaveLength(4);
  });

  it('stays inside the default per-stage storage buffer limit', () => {
    // Four source columns + three written attributes + the ramp LUT is exactly 8, the
    // WebGPU default. Materializing the local as well would have made it 9 and failed at
    // pipeline creation.
    const caps = { ...targetCaps('webgpu-native', undefined), maxStorageBuffersPerStage: 8 };
    const p = plan(graph, schema, { caps });
    const k = p.kernels[0];
    expect(k.reads.length + k.writes.length + (k.usesRamp ? 1 : 0)).toBeLessThanOrEqual(8);
  });

  it('rejects a plan that would exceed the per-stage binding limit', () => {
    const caps = { ...targetCaps('webgpu-native', undefined), maxStorageBuffersPerStage: 3 };
    expect(() => plan(graph, schema, { caps })).toThrow(/storage buffers.*over the per-stage limit/);
  });

  it('places each statement independently', () => {
    // `ramp()` has no SQL form, so @Cd cannot be pushed into SQL even under sql-first —
    // and everything after it is forced out too, because SQL is a prefix.
    const p = plan(graph, schema, {
      policy: 'sql-first', caps: targetCaps('webgpu-native', undefined),
    });
    const stage = (id: string) => p.explain.placement.find((x) => x.nodeId === id)?.stage;
    expect(stage('wr#P')).toBe('sql');
    expect(stage('wr#Cd')).toBe('gpu');
  });

  it('reports the expansion in the notes', () => {
    const p = plan(graph, schema, { caps: targetCaps('webgpu-native', undefined) });
    expect(p.notes.join(' ')).toMatch(/wrangle expanded to 4 attribute node\(s\)/);
  });
});

describe('DAG topology', () => {
  it('drops branches that do not reach the output', () => {
    const g: Graph = {
      params: {},
      nodes: [
        source,
        { id: 'used', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
        { id: 'dead', type: 'attribute', input: 'src', name: 'unused', expr: 'sqrt(pop)' },
        { id: 'out', type: 'render', input: 'used', mode: 'points' },
      ],
    };
    const p = plan(g, schema, { caps: targetCaps('webgpu-native', undefined) });
    expect(p.explain.placement.map((x) => x.nodeId)).toEqual(['used']);
    expect(p.notes.join(' ')).toMatch(/dead-code elimination/);
  });

  it('merges attribute namespaces from multiple inputs', () => {
    const g: Graph = {
      params: {},
      nodes: [
        source,
        { id: 'a', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
        { id: 'b', type: 'attribute', input: 'src', name: 'pscale', expr: 'sqrt(pop)' },
        // Reads attributes produced on two separate branches.
        { id: 'm', type: 'attribute', input: 'a', inputs: ['a', 'b'], name: 'Cd', expr: '[pscale, P.x, 0]' },
        { id: 'out', type: 'render', input: 'm', mode: 'points' },
      ],
    };
    const p = plan(g, schema, { caps: targetCaps('webgpu-native', undefined) });
    expect(p.kernels[0].nodeIds).toEqual(['a', 'b', 'm']);
    expect(p.attributes.map((x) => x.name)).toContain('Cd');
  });

  it('detects a cycle instead of hanging', () => {
    const g: Graph = {
      params: {},
      nodes: [
        source,
        { id: 'a', type: 'attribute', input: 'b', name: 'P', expr: '[lng, lat, 0]' },
        { id: 'b', type: 'attribute', input: 'a', name: 'q', expr: 'pop' },
        { id: 'out', type: 'render', input: 'a', mode: 'points' },
      ],
    };
    expect(() => plan(g, schema, { caps: targetCaps('webgpu-native', undefined) })).toThrow(/Cycle/);
  });

  it('rejects an unknown input id', () => {
    const g: Graph = {
      params: {},
      nodes: [
        source,
        { id: 'a', type: 'attribute', input: 'nope', name: 'P', expr: '[lng, lat, 0]' },
        { id: 'out', type: 'render', input: 'a', mode: 'points' },
      ],
    };
    expect(() => plan(g, schema, { caps: targetCaps('webgpu-native', undefined) })).toThrow(/Unknown node id/);
  });
});
