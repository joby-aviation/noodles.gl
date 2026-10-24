import { describe, it, expect } from 'vitest';
import { plan, type Schema } from './planner.js';
import { analyze } from './analyze.js';
import { optimize } from './optimizer.js';
import { DEFAULT_COSTS } from './cost.js';
import { compactable, parseExpr } from './expr.js';
import { targetCaps, withCompaction } from './target.js';
import type { SourceStats } from './stats.js';
import type { Graph } from './types.js';

/**
 * GPU compaction as a placement: a GPU-stage filter that removes rows instead of masking them.
 * These pin the decisions the benchmark in FINDINGS §12 argues for — compaction when a
 * selective filter is dragged, a mask or SQL where it is not worth it — and the legality rules
 * that keep the runtime from being handed a plan it cannot draw.
 */

const schema: Schema = new Map([['x', 1], ['y', 1], ['v', 1]]);

function stats(rows: number): SourceStats {
  const col = (name: string, min: number, max: number) =>
    [name, { name, duckType: 'FLOAT', ndv: rows, min, max, nullFrac: 0, isF64: false }] as const;
  return { rows, columns: new Map([col('x', -1, 1), col('y', -1, 1), col('v', 0, 100)]) };
}

function graph(rows: number, predicate = 'v > {{cut}}', mode: 'points' | 'bin2d' = 'points', rate = 8): Graph {
  return {
    params: { cut: { value: 95, kind: 'value', changeRate: rate } },
    nodes: [
      { id: 'src', type: 'source', dataset: { ref: 't', estimatedRows: rows } },
      { id: 'f', type: 'filter', input: 'src', predicate },
      { id: 'p', type: 'attribute', input: 'f', name: 'P', expr: '[x, y, 0]' },
      mode === 'points'
        ? { id: 'out', type: 'render', input: 'p', mode: 'points', position: 'P' }
        : { id: 'out', type: 'render', input: 'p', mode: 'bin2d', position: 'P' },
    ] as Graph['nodes'],
  };
}

const compacting = withCompaction(targetCaps('webgpu-native', undefined));

function planWith(g: Graph, rows: number, cut: number, caps = compacting) {
  return plan(g, schema, { policy: 'cost', stats: stats(rows), params: { cut }, caps });
}

describe('compactable', () => {
  it('accepts arithmetic, comparisons and boolean logic over scalars', () => {
    for (const ok of ['v > {{cut}}', 'v * 2 + 1 >= x', '!(v < 3) && (x != 0 || y == 1)', '-x > y / 2']) {
      expect(compactable(parseExpr(ok)), ok).toBe(true);
    }
  });

  it('refuses functions, modulo, conditionals, strings and non-boolean roots', () => {
    for (const no of ['sqrt(v) > 2', 'v % 2 == 0', '(v > 1 ? x : y) > 0', 'v + 1', "v == 'a'"]) {
      expect(compactable(parseExpr(no)), no).toBe(false);
    }
  });
});

describe('compaction placement', () => {
  it('is never offered without the capability', () => {
    const analysis = analyze(graph(4e6), schema);
    const result = optimize(analysis, {
      costs: DEFAULT_COSTS, caps: targetCaps('webgpu-native', undefined), stats: stats(4e6),
      params: { cut: 95 }, policy: 'cost',
    });
    expect(result.candidates.some((c) => c.assignment.compact)).toBe(false);
  });

  it('wins a selective, dragged filter over both SQL and the mask', () => {
    // 4M rows keeping 5%, cut at 8 changes/s: the case where the benchmark measured
    // compaction at 1.8 ms a tick against 27.7 ms for the SQL plan the planner chose.
    const p = planWith(graph(4e6), 4e6, 95);
    expect(p.explain.chosen.compact).toBe(true);
    expect(p.compaction?.predicate).toBeDefined();
    expect(p.compaction?.params).toEqual(['cut']);
    expect(p.compaction?.reads).toEqual(['v']);
    // No mask: the filter left the kernel entirely.
    expect(p.maskAttribute).toBeUndefined();
    expect(p.kernels[0].writes).not.toContain('__mask');
    expect(p.kernels[0].params).not.toContain('cut');
    // `v` is read only by the compaction, and must still be selected and uploaded.
    expect(p.sql).toContain('"v"');
    expect(p.attributes.some((a) => a.name === 'v')).toBe(true);
  });

  it('prices a compaction-only rebind below the mask, which re-runs the kernel', () => {
    const analysis = analyze(graph(4e6), schema);
    const result = optimize(analysis, {
      costs: DEFAULT_COSTS, caps: compacting, stats: stats(4e6), params: { cut: 95 }, policy: 'cost',
    });
    const at = (compact: boolean) => result.candidates.find(
      (c) => c.legal && c.assignment.sqlEnd === 0 && c.assignment.cpuEnd === 0 && Boolean(c.assignment.compact) === compact,
    )!;
    const rebind = (c: typeof result.candidates[number]) => c.cost!.terms.find((t) => t.label.startsWith('rebind cut'))!;
    expect(rebind(at(true)).label).toContain('compaction');
    expect(rebind(at(true)).ms).toBeLessThan(rebind(at(false)).ms);
    // And it draws only the survivors.
    const render = (c: typeof result.candidates[number]) => c.cost!.terms.find((t) => t.label.startsWith('render'))!;
    expect(render(at(true)).ms).toBeLessThan(render(at(false)).ms / 5);
  });

  it('leaves a filter that never moves in SQL', () => {
    // No interaction to amortize, so the compile and the extra buffers buy nothing.
    const p = planWith(graph(4e6, 'v > {{cut}}', 'points', 0), 4e6, 95);
    expect(p.explain.chosen.compact).toBeFalsy();
    expect(p.explain.placement.find((x) => x.nodeId === 'f')?.stage).toBe('sql');
  });

  it('rejects predicates the engine cannot evaluate, with the reason', () => {
    const analysis = analyze(graph(4e6, 'sqrt(v) > {{cut}}'), schema);
    const result = optimize(analysis, {
      costs: DEFAULT_COSTS, caps: compacting, stats: stats(4e6), params: { cut: 9 }, policy: 'cost',
    });
    const compact = result.candidates.filter((c) => c.assignment.compact);
    expect(compact.length).toBeGreaterThan(0);
    expect(compact.every((c) => !c.legal && /operation the compaction engine lacks/.test(c.reason!))).toBe(true);
  });

  it('rejects outputs without an indexed draw', () => {
    const analysis = analyze(graph(4e6, 'v > {{cut}}', 'bin2d'), schema);
    const result = optimize(analysis, {
      costs: DEFAULT_COSTS, caps: compacting, stats: stats(4e6), params: { cut: 95 }, policy: 'cost',
    });
    expect(result.candidates.filter((c) => c.assignment.compact).every((c) => !c.legal)).toBe(true);
  });

  it('is labelled in the explain output', () => {
    const p = planWith(graph(4e6), 4e6, 95);
    const chosen = p.explain.candidates.find((c) => c.assignment.compact && c.legal)!;
    expect(chosen.label).toContain('+compact');
    expect(p.explain.placement.find((x) => x.nodeId === 'f')?.why).toMatch(/GPU compaction/);
  });

  it('has no effect on the rule-based policies', () => {
    for (const policy of ['sql-first', 'gpu-first', 'auto'] as const) {
      const p = plan(graph(4e6), schema, { policy, stats: stats(4e6), params: { cut: 95 }, caps: compacting });
      expect(p.explain.chosen.compact, policy).toBeFalsy();
      expect(p.compaction, policy).toBeUndefined();
    }
  });
});
