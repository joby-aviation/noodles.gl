import { describe, it, expect } from 'vitest';
import { plan, type PhysicalPlan, type Schema } from './planner.js';
import { analyze } from './analyze.js';
import { optimize } from './optimizer.js';
import { DEFAULT_COSTS } from './cost.js';
import { targetCaps } from './target.js';
import type { Graph } from './types.js';
import type { SourceStats } from './stats.js';

/**
 * Invariants of *generated* code — the properties that must hold for the SQL and WGSL to be
 * runnable at all, independent of what they compute. These are the ones that fail loudly on
 * real engines and silently in a structural test.
 */

const schema: Schema = new Map([
  ['lng', 1], ['lat', 1], ['elevation', 1], ['pop', 1], ['speed', 1], ['cluster', 1], ['id', 1],
]);

const caps = targetCaps('webgpu-native', undefined);
/**
 * Real adapters report 10 storage buffers per stage; the spec minimum (and so the no-device
 * default) is 8. Policies that fuse everything into one kernel need the higher limit, so the
 * policy sweeps use this and the 8-limit rejection is asserted on its own.
 */
const roomyCaps = { ...caps, maxStorageBuffersPerStage: 10 };
const source = { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1_000_000 } } as const;

function stats(rows = 1_000_000): SourceStats {
  const col = (name: string, min: number, max: number, ndv: number, nullFrac = 0) =>
    [name, { name, duckType: 'FLOAT', ndv, min, max, nullFrac, isF64: false }] as const;
  return {
    rows,
    columns: new Map([
      col('speed', 0, 120, 1000, 0.02), col('pop', 10, 1e6, 100_000),
      col('lng', -180, 180, 5e5), col('lat', -80, 80, 5e5),
      col('elevation', 0, 900, 5e4), col('cluster', 0, 8, 9), col('id', 0, rows, rows),
    ]),
  };
}

/** The scatter-shaped graph, with optional extras. */
function graph(extra: Partial<{ params: Graph['params']; nodes: Graph['nodes'] }> = {}): Graph {
  return {
    params: {
      cut: { value: 60, kind: 'value', changeRate: 0.2 },
      k: { value: 2, kind: 'value', changeRate: 8 },
      ...extra.params,
    },
    nodes: extra.nodes ?? [
      source,
      { id: 'f', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
      { id: 'st', type: 'stats', input: 'f', column: 'pop', ops: ['min', 'max'] },
      { id: 'p', type: 'project', input: 'f', mode: 'mercator', x: 'lng', y: 'lat', z: 'elevation' },
      { id: 'r', type: 'scale', input: 'p', name: 'pscale', expr: 'pop', kind: 'log', domain: 'auto', statsFrom: 'st', range: ['1', '{{k}}'] },
      { id: 'c', type: 'colorscale', input: 'r', expr: 'elevation', ramp: 'viridis', domain: ['0', '900'] },
      { id: 'out', type: 'render', input: 'c', mode: 'points' },
    ],
  };
}

const build = (g = graph(), policy?: 'cost' | 'auto' | 'sql-first' | 'gpu-first') =>
  plan(g, schema, { policy: policy ?? 'cost', stats: stats(), caps: roomyCaps, params: { cut: 60, k: 2 } });

// ---------------------------------------------------------------------------

describe('SQL bind order', () => {
  /** Distinct numbered placeholders; each must correspond to exactly one declared bind. */
  const placeholders = (sql: string) => new Set(sql.match(/\$\d+/g) ?? []).size;

  it('has exactly one declared parameter per placeholder', () => {
    // A mismatch here is the "Expected 1 parameters, but none were supplied" class of bug,
    // and it is silent until the query runs.
    for (const policy of ['cost', 'auto', 'sql-first'] as const) {
      const p = build(graph(), policy);
      expect(placeholders(p.sql), policy).toBe(p.sqlParams.length);
      for (const s of p.stats) {
        expect(placeholders(s.sql), `${policy} stats ${s.nodeId}`).toBe(s.params.length);
      }
    }
  });

  it('names only declared parameters in the bind list', () => {
    const p = build();
    for (const name of p.sqlParams) expect(Object.keys(p.params)).toContain(name);
    for (const s of p.stats) {
      for (const name of s.params) expect(Object.keys(p.params)).toContain(name);
    }
  });

  it('numbers parameters consistently across the SELECT list and the WHERE clause', () => {
    // Numbering, not textual order, is the contract — which is what makes a repeated
    // argument in an op template safe. One numbering must cover the whole statement.
    const g: Graph = {
      params: { a: { value: 1, kind: 'value' }, b: { value: 2, kind: 'value' } },
      nodes: [
        source,
        { id: 'attr', type: 'attribute', input: 'src', name: 'weighted', expr: 'pop * {{a}}' },
        { id: 'f', type: 'filter', input: 'attr', predicate: 'speed > {{b}}' },
        { id: 'p', type: 'attribute', input: 'f', name: 'P', expr: '[lng, lat, 0]' },
        { id: 'out', type: 'render', input: 'p', mode: 'points' },
      ],
    };
    const p = plan(g, schema, { policy: 'sql-first', caps });
    expect(p.sqlParams).toEqual(['a', 'b']);
    // `a` is used in the SELECT list and `b` in the WHERE clause; both must be numbered from
    // the same sequence, so exactly $1 and $2 appear and nothing is skipped or repeated.
    expect(new Set(p.sql.match(/\$\d+/g))).toEqual(new Set(['$1', '$2']));
    const whereClause = p.sql.slice(p.sql.indexOf('WHERE'));
    expect(whereClause).toContain('$2');
    expect(whereClause).not.toContain('$1');
  });

  it('stats queries inherit the WHERE clause and its binds', () => {
    const p = build();
    const st = p.stats.find((s) => s.nodeId === 'st')!;
    expect(st.sql).toContain('WHERE');
    expect(st.params).toEqual(['cut']);
  });

  it('emits no placeholder when nothing is parameterized', () => {
    const g: Graph = {
      params: {},
      nodes: [
        source,
        { id: 'p', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
        { id: 'out', type: 'render', input: 'p', mode: 'points' },
      ],
    };
    const p = plan(g, schema, { caps });
    expect(placeholders(p.sql)).toBe(0);
    expect(p.sqlParams).toEqual([]);
  });
});

describe('generated SQL is well formed', () => {
  it('has balanced parentheses and quotes under every policy', () => {
    for (const policy of ['cost', 'auto', 'sql-first', 'gpu-first'] as const) {
      const p = build(graph(), policy);
      expect(balanced(p.sql), policy).toBe(true);
      expect((p.sql.match(/"/g) ?? []).length % 2, `${policy} quotes`).toBe(0);
      for (const s of p.stats) expect(balanced(s.sql), `${policy} stats`).toBe(true);
    }
  });

  it('names the relation it was given, not a hardcoded table', () => {
    const p = plan(graph(), schema, { caps, relation: '"my"."table"' });
    expect(p.sql).toContain('FROM "my"."table"');
    expect(p.sql).not.toContain('FROM "src"');
    for (const s of p.stats) expect(s.sql).toContain('FROM "my"."table"');
  });

  it('rejects gpu-first when the fused kernel would exceed the binding limit', () => {
    // Not a bug: pushing every node into one kernel needs 10 storage buffers, and the spec
    // minimum is 8. The error has to name the count and the limit, because the alternative is
    // a WebGPU validation failure at first draw with no explanation.
    expect(() => plan(graph(), schema, {
      policy: 'gpu-first', stats: stats(), caps, params: { cut: 60, k: 2 },
    })).toThrow(/10 storage buffers.*over the per-stage limit of 8/s);
  });

  it('selects only source columns something downstream reads', () => {
    const p = build();
    // `id` and `cluster` are referenced by nothing.
    expect(p.sql).not.toMatch(/"id"/);
    expect(p.sql).not.toMatch(/"cluster"/);
    for (const needed of ['lng', 'lat', 'elevation', 'pop']) {
      expect(p.sql, needed).toContain(`"${needed}"`);
    }
  });
});

describe('generated WGSL is well formed', () => {
  /** Reserved words a user could plausibly pick for an attribute or parameter. */
  const RESERVED = ['meta', 'type', 'filter', 'from', 'mod', 'match', 'where', 'enum', 'private', 'shared'];

  const kernelOf = (p: PhysicalPlan) => p.kernels[0]?.code ?? '';

  it('declares no reserved word as an identifier', () => {
    const code = kernelOf(build());
    for (const word of RESERVED) {
      expect(declaresIdentifier(code, word), `kernel declares '${word}'`).toBe(false);
    }
  });

  it('survives a parameter named after a reserved word', () => {
    // A parameter becomes a struct member, and a reserved word is not a legal member name.
    const g: Graph = {
      params: { type: { value: 2, kind: 'value' } },
      nodes: [
        source,
        { id: 'p', type: 'attribute', input: 'src', name: 'P', expr: '[lng, lat, 0]' },
        { id: 's', type: 'attribute', input: 'p', name: 'pscale', expr: 'pop * {{type}}' },
        { id: 'out', type: 'render', input: 's', mode: 'points' },
      ],
    };
    const p = plan(g, schema, { caps });
    const code = kernelOf(p);
    expect(code).toContain('struct Params');
    // Whatever the mangling, the struct must not declare a bare reserved word.
    const structBody = code.slice(code.indexOf('struct Params'), code.indexOf('};'));
    expect(/^\s*type\s*:/m.test(structBody), 'declares reserved member "type"').toBe(false);
  });

  it('survives an attribute named after a reserved word', () => {
    const g: Graph = {
      params: {},
      nodes: [
        source,
        { id: 'a', type: 'attribute', input: 'src', name: 'filter', expr: 'pop * 2' },
        { id: 'p', type: 'attribute', input: 'a', name: 'P', expr: '[lng, lat, filter]' },
        { id: 'out', type: 'render', input: 'p', mode: 'points' },
      ],
    };
    const p = plan(g, schema, { caps });
    const code = kernelOf(p);
    for (const word of RESERVED) {
      expect(declaresIdentifier(code, word), `declares '${word}'`).toBe(false);
    }
  });

  it('has balanced braces and parentheses', () => {
    const code = kernelOf(build());
    expect(balanced(code)).toBe(true);
    expect((code.match(/\{/g) ?? []).length).toBe((code.match(/\}/g) ?? []).length);
  });

  it('declares one binding per slot, contiguous from zero', () => {
    const code = kernelOf(build());
    const slots = [...code.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]));
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots[0]).toBe(0);
    expect(slots.at(-1)).toBe(slots.length - 1);
  });

  it('bounds-checks the row index before touching a buffer', () => {
    const code = kernelOf(build());
    const guard = code.indexOf('if (i >= rowInfo.x)');
    expect(guard).toBeGreaterThan(0);
    // Every buffer access must come after the guard.
    expect(code.indexOf('[i]', guard)).toBeGreaterThan(guard);
    expect(code.slice(0, guard)).not.toMatch(/b_\w+\[i/);
  });

  it('writes every attribute it declares as read_write, and no more', () => {
    const p = build();
    const k = p.kernels[0];
    const declared = [...k.code.matchAll(/read_write>\s*(b_\w+)/g)].map((m) => m[1]);
    const expected = k.writes.map((w) => `b_${w.replace(/[^A-Za-z0-9_]/g, '_')}`);
    expect(declared.sort()).toEqual(expected.sort());
  });
});

describe('the two binding-count implementations agree', () => {
  /**
   * `optimizer.ts` predicts a kernel's storage-buffer count to enforce the per-stage limit;
   * `planner.ts` then emits the real bindings. Those are separate implementations of the same
   * rule, and if they drift the optimizer will happily choose a plan that cannot be compiled.
   */
  const cases: [string, Graph][] = [
    ['scatter', graph()],
    ['no ramp', graph({
      nodes: [
        source,
        { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat', z: '0' },
        { id: 's', type: 'attribute', input: 'p', name: 'pscale', expr: 'sqrt(pop)' },
        { id: 'out', type: 'render', input: 's', mode: 'points' },
      ],
    })],
    ['with a gpu mask', graph({
      nodes: [
        source,
        { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat', z: '0' },
        { id: 'f', type: 'filter', input: 'p', predicate: 'speed > 10' },
        { id: 'c', type: 'colorscale', input: 'f', expr: 'elevation', ramp: 'magma', domain: ['0', '900'] },
        { id: 'out', type: 'render', input: 'c', mode: 'points' },
      ],
    })],
    ['wrangle with a local', graph({
      nodes: [
        source,
        {
          id: 'w', type: 'wrangle', input: 'src', ramp: 'turbo',
          body: '@P = [lng, lat, 0]; var t = pop / 1000.0; @Cd = ramp(t); @pscale = sqrt(t);',
        },
        { id: 'out', type: 'render', input: 'w', mode: 'points' },
      ],
    })],
  ];

  it.each(cases)('%s', (_name, g) => {
    const p = plan(g, schema, { policy: 'cost', stats: stats(), caps, params: { cut: 60, k: 2 } });
    const kernel = p.kernels[0];
    if (!kernel) return;

    const actual = kernel.reads.length + kernel.writes.length + (kernel.usesRamp ? 1 : 0);

    // The prediction the optimizer used for the assignment it chose.
    const analysis = analyze(g, schema);
    const result = optimize(analysis, {
      costs: DEFAULT_COSTS, caps, stats: stats(), params: { cut: 60, k: 2 }, policy: 'cost',
    });
    const chosen = result.candidates.find(
      (c) => c.assignment.sqlEnd === result.chosen.sqlEnd && c.assignment.cpuEnd === result.chosen.cpuEnd,
    );
    expect(chosen?.legal).toBe(true);
    expect(chosen?.storageBindings, 'optimizer prediction vs emitted bindings').toBe(actual);
    expect(actual).toBeLessThanOrEqual(caps.maxStorageBuffersPerStage);
  });

  it('the prediction is what the limit is enforced against', () => {
    // Planning at exactly the predicted count must succeed and at one below must not, which
    // is only true if the enforced number is the same one the emitter will produce.
    const g = graph();
    const p = plan(g, schema, { policy: 'cost', stats: stats(), caps, params: { cut: 60, k: 2 } });
    const k = p.kernels[0];
    const actual = k.reads.length + k.writes.length + (k.usesRamp ? 1 : 0);

    const at = plan(g, schema, {
      policy: 'cost', stats: stats(), params: { cut: 60, k: 2 },
      caps: { ...caps, maxStorageBuffersPerStage: actual },
    });
    expect(at.kernels[0]).toBeDefined();

    // Below the limit the optimizer must either reject outright or route around it by moving
    // nodes off the GPU — never emit a kernel that exceeds the cap.
    const below = (() => {
      try {
        return plan(g, schema, {
          policy: 'cost', stats: stats(), params: { cut: 60, k: 2 },
          caps: { ...caps, maxStorageBuffersPerStage: actual - 1 },
        });
      } catch {
        return undefined;
      }
    })();
    if (below?.kernels[0]) {
      const k2 = below.kernels[0];
      expect(k2.reads.length + k2.writes.length + (k2.usesRamp ? 1 : 0))
        .toBeLessThanOrEqual(actual - 1);
    }
  });
});

describe('determinism', () => {
  it('planning the same graph twice yields an identical plan', () => {
    // The topological sort breaks ties by declaration order precisely so the explain pane is
    // stable between runs; a Set or Map iteration leak here would make plans jitter.
    const a = build();
    const b = build();
    expect(a.sql).toBe(b.sql);
    expect(a.sqlParams).toEqual(b.sqlParams);
    expect(a.kernels[0]?.code).toBe(b.kernels[0]?.code);
    expect(a.explain.chosen).toEqual(b.explain.chosen);
    expect(a.attributes).toEqual(b.attributes);
  });

  it('is insensitive to the declaration order of independent nodes', () => {
    const nodes: Graph['nodes'] = [
      source,
      { id: 'a', type: 'attribute', input: 'src', name: 'x1', expr: 'pop * 2' },
      { id: 'b', type: 'attribute', input: 'src', name: 'x2', expr: 'elevation * 3' },
      { id: 'p', type: 'attribute', input: 'a', inputs: ['a', 'b'], name: 'P', expr: '[x1, x2, 0]' },
      { id: 'out', type: 'render', input: 'p', mode: 'points' },
    ];
    const forward = plan({ params: {}, nodes }, schema, { caps });
    const swapped = plan(
      { params: {}, nodes: [nodes[0], nodes[2], nodes[1], nodes[3], nodes[4]] }, schema, { caps },
    );
    // Both must produce a working plan writing the same attributes, even if the kernel
    // statement order differs.
    expect(new Set(forward.kernels[0].writes)).toEqual(new Set(swapped.kernels[0].writes));
  });
});

// ---------------------------------------------------------------------------

function balanced(code: string): boolean {
  const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
  const stack: string[] = [];
  for (const ch of code) {
    if ('([{'.includes(ch)) stack.push(ch);
    else if (ch in pairs && stack.pop() !== pairs[ch]) return false;
  }
  return stack.length === 0;
}

function declaresIdentifier(code: string, word: string): boolean {
  // A declaration or bare use, not a member access (`params.type`) or a mangled name.
  return new RegExp(`(?:^|[^.\\w])${word}(?![\\w])\\s*[:=;)]`, 'm').test(code);
}
