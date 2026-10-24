import { describe, it, expect } from 'vitest';
import { plan, type Schema } from './planner.js';
import { analyze } from './analyze.js';
import { optimize } from './optimizer.js';
import { DEFAULT_COSTS, type CostConstants } from './cost.js';
import { estimateSelectivity, parseStatsRow, statsSql, type SourceStats } from './stats.js';
import { parseExpr } from './expr.js';
import { targetCaps } from './target.js';
import type { Graph } from './types.js';

/**
 * The planner's decisions are the product, so these tests pin the *decisions* rather than
 * the generated text: which stage a node lands in, and why.
 */

const schema: Schema = new Map([
  ['lng', 1], ['lat', 1], ['elevation', 1], ['pop', 1], ['speed', 1], ['cluster', 1], ['id', 1],
]);

/** Synthetic catalog: 1M rows, speed uniform on [0, 120] with 2% nulls. */
function makeStats(rows = 1_000_000): SourceStats {
  const col = (name: string, min: number, max: number, ndv: number, nullFrac = 0) =>
    [name, { name, duckType: 'FLOAT', ndv, min, max, nullFrac, isF64: false }] as const;
  return {
    rows,
    columns: new Map([
      col('speed', 0, 120, 1000, 0.02),
      col('pop', 10, 1e6, 100_000),
      col('lng', -180, 180, 500_000),
      col('lat', -80, 80, 500_000),
      col('elevation', 0, 900, 50_000),
      col('cluster', 0, 8, 9),
      col('id', 0, rows, rows),
    ]),
  };
}

const source = { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1_000_000 } } as const;

function scatterGraph(changeRates: { size?: number; cut?: number } = {}): Graph {
  return {
    params: {
      cut: { value: 60, kind: 'value', changeRate: changeRates.cut ?? 0 },
      k: { value: 2, kind: 'value', changeRate: changeRates.size ?? 0 },
    },
    nodes: [
      source,
      { id: 'f', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
      { id: 'p', type: 'project', input: 'f', mode: 'identity', x: 'lng', y: 'lat', z: 'elevation' },
      { id: 's', type: 'attribute', input: 'p', name: 'pscale', expr: 'sqrt(pop) * {{k}}' },
      { id: 'out', type: 'render', input: 's', mode: 'points' },
    ],
  };
}

function stageOfNode(p: ReturnType<typeof plan>, nodeId: string): string {
  return p.explain.placement.find((x) => x.nodeId === nodeId)?.stage ?? 'absent';
}

function analyzeAndOptimize(gpuBudgetBytes: number, rows: number) {
  const analysis = analyze(scatterGraph(), schema);
  return optimize(analysis, {
    costs: DEFAULT_COSTS,
    caps: { ...targetCaps('webgpu-native', undefined), gpuBudgetBytes },
    stats: makeStats(rows),
    params: { cut: 0, k: 2 },
    policy: 'cost',
  });
}

describe('selectivity estimation', () => {
  const stats = makeStats();

  it('interpolates a range predicate and discounts nulls', () => {
    // speed > 60 over [0,120] keeps half the rows, times the 98% that are non-null.
    const s = estimateSelectivity(parseExpr('speed > {{cut}}'), stats, { cut: 60 });
    expect(s).toBeCloseTo(0.49, 2);
  });

  it('moves when the parameter moves', () => {
    const e = parseExpr('speed > {{cut}}');
    const low = estimateSelectivity(e, stats, { cut: 0 });
    const high = estimateSelectivity(e, stats, { cut: 119 });
    expect(low).toBeGreaterThan(0.9);
    expect(high).toBeLessThan(0.05);
  });

  it('uses 1/ndv for equality', () => {
    expect(estimateSelectivity(parseExpr('cluster == 3'), stats, {})).toBeCloseTo(1 / 9, 4);
  });

  it('normalizes a reversed comparison', () => {
    const forward = estimateSelectivity(parseExpr('speed > 60'), stats, {});
    const reversed = estimateSelectivity(parseExpr('60 < speed'), stats, {});
    expect(reversed).toBeCloseTo(forward, 6);
  });

  it('multiplies conjunctions and complements disjunctions', () => {
    const and = estimateSelectivity(parseExpr('speed > 60 && cluster == 3'), stats, {});
    expect(and).toBeCloseTo(0.49 * (1 / 9), 3);
    const or = estimateSelectivity(parseExpr('speed > 60 || speed > 60'), stats, {});
    expect(or).toBeGreaterThan(0.49);
    expect(or).toBeLessThanOrEqual(1);
  });

  it('falls back for shapes it cannot reason about, without going out of range', () => {
    const s = estimateSelectivity(parseExpr('sqrt(pop) > ln(elevation)'), stats, {});
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('builds a statistics query naming every column', () => {
    const sql = statsSql('"src"', ['speed', 'pop']);
    expect(sql).toContain('approx_count_distinct("speed")');
    expect(sql).toContain('min("pop")::DOUBLE');
    expect(statsSql('"src"', ['speed'], false)).toContain('count(DISTINCT "speed")');
  });

  it('parses a statistics row, including an all-null column', () => {
    const parsed = parseStatsRow(
      { __rows: 100, ndv_0: 0, min_0: null, max_0: null, nn_0: 0 },
      ['x'],
      new Map([['x', 'DOUBLE']]),
    );
    const x = parsed.columns.get('x')!;
    // ndv 0 would make 1/ndv infinite, so it is floored at 1.
    expect(x.ndv).toBe(1);
    expect(x.nullFrac).toBe(1);
    expect(x.isF64).toBe(true);
  });
});

describe('cost-based placement', () => {
  const caps = targetCaps('webgpu-native', undefined);

  it('is exhaustive: every stage boundary pair is priced', () => {
    const analysis = analyze(scatterGraph(), schema);
    const result = optimize(analysis, {
      costs: DEFAULT_COSTS, caps, stats: makeStats(), params: { cut: 60, k: 2 }, policy: 'cost',
    });
    const n = analysis.order.length;
    // (n+1)(n+2)/2 pairs with sqlEnd <= cpuEnd.
    expect(result.candidates).toHaveLength(((n + 1) * (n + 2)) / 2);
    expect(result.candidates.filter((c) => c.legal).length).toBeGreaterThan(1);
  });

  it('chooses the minimum-cost legal plan', () => {
    const analysis = analyze(scatterGraph(), schema);
    const result = optimize(analysis, {
      costs: DEFAULT_COSTS, caps, stats: makeStats(), params: { cut: 60, k: 2 }, policy: 'cost',
    });
    const legal = result.candidates.filter((c) => c.legal);
    const min = Math.min(...legal.map((c) => c.cost!.totalMs));
    const chosen = legal.find(
      (c) => c.assignment.sqlEnd === result.chosen.sqlEnd && c.assignment.cpuEnd === result.chosen.cpuEnd,
    );
    expect(chosen!.cost!.totalMs).toBeCloseTo(min, 9);
    expect(result.method).toBe('cost');
  });

  it('pushes a selective filter into SQL', () => {
    const p = plan(scatterGraph(), schema, {
      policy: 'cost', stats: makeStats(), params: { cut: 119, k: 2 }, caps,
    });
    expect(stageOfNode(p, 'f')).toBe('sql');
    expect(p.sql).toContain('WHERE');
  });

  it('drags a frequently dragged parameter onto the GPU', () => {
    // Same graph, same data. The only difference is how often `k` changes.
    const still = plan(scatterGraph({ size: 0 }), schema, {
      policy: 'cost', stats: makeStats(), params: { cut: 60, k: 2 }, caps,
    });
    const dragged = plan(scatterGraph({ size: 50 }), schema, {
      policy: 'cost', stats: makeStats(), params: { cut: 60, k: 2 }, caps,
    });
    // A high change rate must not move `pscale` *away* from the GPU, and with a large
    // enough rate the GPU has to win outright.
    expect(stageOfNode(dragged, 's')).toBe('gpu');
    expect(dragged.uniformParams).toContain('k');
    // Sanity: the amortized term is what differs, so the objective must be larger.
    expect(dragged.explain.estimated!.interactMs)
      .toBeGreaterThan(still.explain.estimated!.interactMs);
  });

  it('prefers a real SQL filter over a GPU discard mask', () => {
    // Regression: with only build cost modelled, a discard mask looked cheaper than a
    // filter, because keeping 3x the rows costs nothing at build time. Drawing them every
    // frame is what makes it expensive, so the render term has to be present for the
    // planner to prefer actually removing rows.
    const p = plan(scatterGraph({ cut: 0.2 }), schema, {
      policy: 'cost', stats: makeStats(), params: { cut: 60, k: 2 }, caps,
    });
    expect(stageOfNode(p, 'f')).toBe('sql');
    expect(p.maskAttribute).toBeUndefined();
  });

  it('charges rendering over the horizon, so row count matters after the build', () => {
    const analysis = analyze(scatterGraph(), schema);
    const result = optimize(analysis, {
      costs: DEFAULT_COSTS, caps, stats: makeStats(), params: { cut: 60, k: 2 }, policy: 'cost',
    });
    const masked = result.candidates.find((c) => c.legal && c.assignment.sqlEnd === 0);
    const filtered = result.candidates.find((c) => c.legal && c.assignment.sqlEnd >= 1);
    expect(masked!.sqlRows).toBeGreaterThan(filtered!.sqlRows!);
    // Fewer instances must show up as a lower interaction cost.
    expect(filtered!.cost!.interactMs).toBeLessThan(masked!.cost!.interactMs);
  });

  it('a zero render cost removes that pressure, isolating the term', () => {
    // The term only decides the outcome when the filter's parameter changes often enough
    // that a requery looks expensive. With `cut` at 2/s the mask wins on build cost alone,
    // and only the per-frame render charge pulls the filter back into SQL — which is the
    // exact case that produced a 300k-instance masked plan before this term existed.
    const graph = scatterGraph({ cut: 2 });
    const analysis = analyze(graph, schema);
    const shared = { caps, stats: makeStats(), params: { cut: 60, k: 2 }, policy: 'cost' as const };

    const withRender = optimize(analysis, { ...shared, costs: DEFAULT_COSTS });
    const without = optimize(analysis, {
      ...shared,
      costs: { ...DEFAULT_COSTS, renderPerInstanceMs: 0, renderFixedMs: 0 } as CostConstants,
    });

    expect(withRender.chosen.sqlEnd).toBeGreaterThan(without.chosen.sqlEnd);
    expect(without.chosen.sqlEnd).toBe(0);
  });

  it('falls back to rules, and says so, when there are no statistics', () => {
    const p = plan(scatterGraph(), schema, { policy: 'cost', caps });
    expect(p.explain.method).toBe('policy');
    expect(p.notes.join(' ')).toMatch(/no source statistics/);
  });
});

describe('capability constraints', () => {
  it('a target without compute has no GPU stage, so ramp() runs on the CPU', () => {
    const g: Graph = {
      params: {},
      nodes: [
        source,
        { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat', z: '0' },
        { id: 'c', type: 'colorscale', input: 'p', expr: 'elevation', ramp: 'viridis', domain: ['0', '900'] },
        { id: 'out', type: 'render', input: 'c', mode: 'points' },
      ],
    };
    const webgl2 = plan(g, schema, {
      policy: 'cost', stats: makeStats(), caps: targetCaps('deck-webgl2', undefined),
    });
    expect(stageOfNode(webgl2, 'c')).toBe('cpu');
    expect(webgl2.kernels).toHaveLength(0);
    expect(webgl2.cpuStage.some((s) => s.name === 'Cd')).toBe(true);

    // The same graph on a compute-capable target keeps it on the GPU.
    const native = plan(g, schema, {
      policy: 'cost', stats: makeStats(), caps: targetCaps('webgpu-native', undefined),
    });
    expect(stageOfNode(native, 'c')).toBe('gpu');
    expect(native.kernels).toHaveLength(1);
  });

  it('rejects a plan that exceeds the GPU memory budget', () => {
    const tiny = { ...targetCaps('webgpu-native', undefined), gpuBudgetBytes: 1024 };
    expect(() =>
      plan(scatterGraph(), schema, { policy: 'cost', stats: makeStats(50_000_000), caps: tiny }),
    ).toThrow(/No legal plan|over the .* budget/);
  });

  it('names every rejected candidate and its budget shortfall when nothing fits', () => {
    // An error that just says "no plan" is useless; it has to say what it tried.
    let message = '';
    try {
      analyzeAndOptimize(8 * 1024 * 1024, 10_000_000);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/No legal plan for target 'webgpu-native'/);
    expect(message).toMatch(/over the 8\.0 MB budget/);
    // One line per candidate, so the whole search is visible.
    expect(message.split('\n').length).toBeGreaterThan(5);
  });

  it('accepts the same graph once the budget is large enough', () => {
    const result = analyzeAndOptimize(512 * 1024 * 1024, 10_000_000);
    expect(result.candidates.some((c) => c.legal)).toBe(true);
  });

  it('a heatmap is infeasible without compute, and the error explains why', () => {
    const g: Graph = {
      params: {},
      nodes: [
        source,
        { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat', z: '0' },
        { id: 'w', type: 'attribute', input: 'p', name: 'weight', expr: 'pop / 1000.0' },
        { id: 'b', type: 'bin2d', input: 'w', resolution: 256, weight: 'weight', ramp: 'magma' },
        { id: 'out', type: 'render', input: 'b', mode: 'heatmap' },
      ],
    };
    expect(() =>
      plan(g, schema, { policy: 'cost', stats: makeStats(), caps: targetCaps('deck-webgl2', undefined) }),
    ).toThrow(/no compute shaders/);
  });

  describe('deck-webgpu storage-buffer limit follows the device', () => {
    // A frequently dragged filter wants to be in the kernel, but fusing it with the
    // projection, scale and ramp needs 10 storage buffers. At WebGPU's default of 8 the
    // optimizer has to push it out; on a device created at the adapter's limits it stays.
    const g: Graph = {
      params: {
        cut: { value: 60, kind: 'value', changeRate: 8 },
        k: { value: 2, kind: 'value', changeRate: 8 },
      },
      nodes: [
        source,
        { id: 'f', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
        { id: 'st', type: 'stats', input: 'f', column: 'pop', ops: ['min', 'max'] },
        { id: 'p', type: 'project', input: 'f', mode: 'mercator', x: 'lng', y: 'lat', z: 'elevation' },
        { id: 'r', type: 'scale', input: 'p', name: 'pscale', expr: 'pop', kind: 'log', domain: 'auto', statsFrom: 'st', range: ['1', '{{k}}'] },
        { id: 'c', type: 'colorscale', input: 'r', expr: 'elevation', ramp: 'viridis', domain: ['0', '900'] },
        { id: 'out', type: 'render', input: 'c', mode: 'points' },
      ],
    };
    const device = (maxStorageBuffersPerShaderStage: number) => ({
      limits: {
        maxBufferSize: 1024 * 1024 * 1024,
        maxStorageBufferBindingSize: 256 * 1024 * 1024,
        maxStorageBuffersPerShaderStage,
      },
    });
    const planOn = (caps: ReturnType<typeof targetCaps>) =>
      plan(g, schema, { policy: 'cost', stats: makeStats(), params: { cut: 60, k: 2 }, caps });

    it('keeps the filter in the fused kernel when the device allows 10', () => {
      const p = planOn(targetCaps('deck-webgpu', device(10)));
      expect(stageOfNode(p, 'f')).toBe('gpu');
      expect(p.kernels).toHaveLength(1);
    });

    it('moves the filter out of the kernel at the spec default of 8', () => {
      for (const caps of [targetCaps('deck-webgpu', device(8)), targetCaps('deck-webgpu', undefined)]) {
        const p = planOn(caps);
        expect(stageOfNode(p, 'f')).not.toBe('gpu');
        // It moved because the kernel did not fit, not because it was cheaper.
        expect(p.explain.candidates.some(
          (c) => !c.legal && /over the per-stage limit of 8/.test(c.reason ?? ''),
        )).toBe(true);
      }
    });
  });
});

describe('cost constants', () => {
  it('a cheaper GPU shifts work toward the GPU', () => {
    const stats = makeStats();
    const slowGpu: CostConstants = { ...DEFAULT_COSTS, kernelPerRowPerOpMs: 1e-2 };
    const caps = targetCaps('webgpu-native', undefined);
    const withSlowGpu = plan(scatterGraph(), schema, {
      policy: 'cost', stats, caps, costs: slowGpu, params: { cut: 60, k: 2 },
    });
    const withFastGpu = plan(scatterGraph(), schema, {
      policy: 'cost', stats, caps, costs: DEFAULT_COSTS, params: { cut: 60, k: 2 },
    });
    // Making the GPU 25000x more expensive per op must not leave placement unchanged.
    expect(withSlowGpu.explain.chosen.cpuEnd).toBeGreaterThanOrEqual(
      withFastGpu.explain.chosen.cpuEnd,
    );
  });
});
