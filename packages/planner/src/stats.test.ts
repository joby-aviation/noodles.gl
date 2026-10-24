import { describe, it, expect } from 'vitest';
import {
  statsSql, parseStatsRow, estimateSelectivity, attributeBytes, referencedColumns,
  DEFAULT_SELECTIVITY, type SourceStats,
} from './stats.js';
import { parseExpr } from './expr.js';

/**
 * Cardinality estimation is the planner's most consequential guess: it decides whether a
 * filter is worth pushing into SQL, and it is the number the explain pane reports against
 * reality. The assumptions (uniformity, independence) are known to be wrong in specific
 * ways, so these tests pin the *documented* behavior including where it degrades.
 */

function col(
  name: string,
  min: number,
  max: number,
  ndv: number,
  nullFrac = 0,
  duckType = 'FLOAT',
) {
  return [name, { name, min, max, ndv, nullFrac, duckType, isF64: /DOUBLE|DECIMAL/.test(duckType) }] as const;
}

const stats: SourceStats = {
  rows: 1_000_000,
  columns: new Map([
    col('speed', 0, 120, 1000, 0.02),
    col('pop', 10, 1e6, 100_000, 0, 'DOUBLE'),
    col('cluster', 0, 8, 9),
    col('flat', 5, 5, 1),
    col('empty', 0, 0, 1, 1),
  ]),
};

const sel = (src: string, params: Record<string, number> = {}) =>
  estimateSelectivity(parseExpr(src), stats, params);

describe('range predicates', () => {
  it('interpolates linearly on [min, max]', () => {
    // speed > 30 over [0,120] keeps 3/4, times the 98% non-null.
    expect(sel('speed > 30')).toBeCloseTo(0.75 * 0.98, 6);
    expect(sel('speed > 60')).toBeCloseTo(0.5 * 0.98, 6);
    expect(sel('speed < 30')).toBeCloseTo(0.25 * 0.98, 6);
  });

  it('discounts nulls, because SQL comparisons drop them', () => {
    // A column with no nulls at the same threshold keeps strictly more.
    expect(sel('cluster > 4')).toBeGreaterThan(sel('speed > 60'));
    expect(sel('cluster > 4')).toBeCloseTo(0.5, 6);
  });

  it('treats >= and > the same, as a continuous estimate must', () => {
    expect(sel('speed >= 60')).toBeCloseTo(sel('speed > 60'), 9);
    expect(sel('speed <= 60')).toBeCloseTo(sel('speed < 60'), 9);
  });

  it('clamps out-of-range thresholds instead of going negative', () => {
    expect(sel('speed > 1000')).toBe(0);
    expect(sel('speed > -50')).toBeCloseTo(0.98, 6);
    expect(sel('speed < -50')).toBe(0);
  });

  it('normalizes a reversed comparison', () => {
    expect(sel('60 < speed')).toBeCloseTo(sel('speed > 60'), 9);
    expect(sel('60 > speed')).toBeCloseTo(sel('speed < 60'), 9);
    expect(sel('60 <= speed')).toBeCloseTo(sel('speed >= 60'), 9);
  });

  it('handles a degenerate column where min equals max', () => {
    // Everything is 5: `> 4` keeps all, `> 5` keeps none.
    expect(sel('flat > 4')).toBe(1);
    expect(sel('flat > 5')).toBe(0);
    expect(sel('flat < 6')).toBe(1);
    expect(sel('flat < 5')).toBe(0);
  });

  it('an all-null column keeps nothing', () => {
    expect(sel('empty > -1')).toBe(0);
  });
});

describe('equality and negation', () => {
  it('uses 1/ndv for equality and its complement for inequality', () => {
    expect(sel('cluster == 3')).toBeCloseTo(1 / 9, 9);
    expect(sel('cluster != 3')).toBeCloseTo(1 - 1 / 9, 9);
  });

  it('negation complements the operand', () => {
    expect(sel('!(cluster == 3)')).toBeCloseTo(1 - 1 / 9, 9);
  });
});

describe('composition', () => {
  it('multiplies conjunctions, assuming independence', () => {
    expect(sel('speed > 60 && cluster == 3')).toBeCloseTo(0.5 * 0.98 * (1 / 9), 9);
  });

  it('complements disjunctions rather than summing past 1', () => {
    // Two predicates that each keep ~0.9 must not add to 1.8.
    const s = sel('cluster > 1 && cluster > 1');
    expect(sel('cluster < 7 || cluster > 1')).toBeLessThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('an OR of the same predicate is at least the predicate', () => {
    const one = sel('speed > 60');
    expect(sel('speed > 60 || speed > 60')).toBeGreaterThanOrEqual(one);
  });

  it('stays within [0, 1] for a deeply nested predicate', () => {
    const s = sel('(speed > 10 && cluster != 2) || (pop > 500 && speed < 100)');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('parameters', () => {
  it('resolves {{param}} so the estimate moves with the slider', () => {
    const e = 'speed > {{cut}}';
    expect(sel(e, { cut: 0 })).toBeCloseTo(0.98, 6);
    expect(sel(e, { cut: 120 })).toBe(0);
    expect(sel(e, { cut: 60 })).toBeCloseTo(0.49, 6);
  });

  it('falls back when a parameter has no value', () => {
    // This was a real bug: planning ran before defaults were seeded, so every predicate
    // silently became the 0.33 magic constant.
    expect(sel('speed > {{missing}}')).toBe(DEFAULT_SELECTIVITY);
  });

  it('handles a negated literal', () => {
    expect(sel('speed > -0')).toBeCloseTo(0.98, 6);
  });
});

describe('shapes the estimator cannot reason about', () => {
  it.each([
    'sqrt(pop) > ln(speed)',
    'speed * 2 > 30',
    'speed > 10 ? 1 : 0',
    'pop',
  ])('%s falls back without leaving [0, 1]', (src) => {
    const s = sel(src);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('an unknown column falls back rather than throwing', () => {
    expect(sel('nosuchcolumn > 5')).toBe(DEFAULT_SELECTIVITY);
  });
});

describe('statsSql', () => {
  it('asks for every statistic per column', () => {
    const sql = statsSql('"src"', ['speed', 'pop']);
    expect(sql).toContain('count(*) AS "__rows"');
    for (const [i, name] of ['speed', 'pop'].entries()) {
      expect(sql).toContain(`approx_count_distinct("${name}") AS "ndv_${i}"`);
      expect(sql).toContain(`min("${name}")::DOUBLE AS "min_${i}"`);
      expect(sql).toContain(`max("${name}")::DOUBLE AS "max_${i}"`);
      expect(sql).toContain(`count("${name}") AS "nn_${i}"`);
    }
    expect(sql).toContain('FROM "src"');
  });

  it('has an exact-distinct fallback with balanced parens', () => {
    // The first version built this by string-replacing the function name, which produced
    // `count(DISTINCT ("col")` — unbalanced and unrunnable.
    const sql = statsSql('"src"', ['speed'], false);
    expect(sql).toContain('count(DISTINCT "speed") AS "ndv_0"');
    expect(balanced(sql)).toBe(true);
    expect(balanced(statsSql('"src"', ['a', 'b', 'c']))).toBe(true);
  });

  it('degrades to a row count when there are no numeric columns', () => {
    expect(statsSql('"src"', [])).toBe('SELECT count(*) AS "__rows" FROM "src"');
  });

  it('quotes identifiers containing a double quote', () => {
    expect(statsSql('"src"', ['we"ird'])).toContain('"we""ird"');
  });
});

describe('parseStatsRow', () => {
  const types = new Map([['a', 'FLOAT'], ['b', 'DOUBLE']]);

  it('reads a normal row', () => {
    const parsed = parseStatsRow(
      { __rows: 100, ndv_0: 50, min_0: 1, max_0: 9, nn_0: 100, ndv_1: 7, min_1: 0, max_1: 1, nn_1: 90 },
      ['a', 'b'], types,
    );
    expect(parsed.rows).toBe(100);
    expect(parsed.columns.get('a')).toMatchObject({ ndv: 50, min: 1, max: 9, nullFrac: 0, isF64: false });
    expect(parsed.columns.get('b')!.nullFrac).toBeCloseTo(0.1, 9);
    expect(parsed.columns.get('b')!.isF64).toBe(true);
  });

  it('accepts bigint counts, which DuckDB returns for count(*)', () => {
    const parsed = parseStatsRow(
      { __rows: 10n, ndv_0: 4n, min_0: 0, max_0: 1, nn_0: 10n },
      ['a'], types,
    );
    expect(parsed.rows).toBe(10);
    expect(parsed.columns.get('a')!.ndv).toBe(4);
  });

  it('floors ndv at 1 so 1/ndv cannot be infinite', () => {
    const parsed = parseStatsRow(
      { __rows: 5, ndv_0: 0, min_0: null, max_0: null, nn_0: 0 }, ['a'], types,
    );
    const a = parsed.columns.get('a')!;
    expect(a.ndv).toBe(1);
    expect(a.nullFrac).toBe(1);
    expect(Number.isFinite(a.min)).toBe(true);
  });

  it('survives missing keys and a zero row count', () => {
    const parsed = parseStatsRow({}, ['a'], types);
    expect(parsed.rows).toBe(0);
    expect(parsed.columns.get('a')!.nullFrac).toBe(0);
  });

  it('defaults an undeclared type to DOUBLE, the conservative choice', () => {
    // Guessing FLOAT would skip a needed narrowing pass and corrupt the upload.
    const parsed = parseStatsRow({ __rows: 1, ndv_0: 1, min_0: 0, max_0: 0, nn_0: 1 }, ['z'], new Map());
    expect(parsed.columns.get('z')!.isF64).toBe(true);
  });
});

describe('helpers', () => {
  it('attributeBytes counts f32 components', () => {
    expect(attributeBytes(100, 3)).toBe(1200);
    expect(attributeBytes(0, 3)).toBe(0);
  });

  it('referencedColumns unions and dedupes across expressions', () => {
    const cols = referencedColumns([parseExpr('a + b'), parseExpr('b * c')]);
    expect([...cols].sort()).toEqual(['a', 'b', 'c']);
  });
});

function balanced(sql: string): boolean {
  let depth = 0;
  for (const ch of sql) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}
