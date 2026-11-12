/**
 * Catalog statistics and cardinality estimation.
 *
 * This is the input that turns the planner from a rule engine into a cost engine. The
 * estimation is deliberately textbook System-R: range interpolation, `1/ndv` for
 * equality, independence for conjunctions. Those assumptions are wrong in specific,
 * well-known ways, so they are named in comments rather than hidden — and the EXPLAIN
 * pane reports estimated against actual row counts so the error is visible instead of
 * asserted.
 */

import { type Expr, columnsOf } from './expr.js';

export interface ColumnStats {
  name: string;
  /** DuckDB type name, e.g. FLOAT, DOUBLE, INTEGER. */
  duckType: string;
  /** Distinct values, approximate. */
  ndv: number;
  min: number;
  max: number;
  /** Fraction of rows that are NULL, in [0, 1]. */
  nullFrac: number;
  /** True for DOUBLE columns, which must be narrowed on the CPU (WGSL has no f64). */
  isF64: boolean;
}

export interface SourceStats {
  rows: number;
  columns: Map<string, ColumnStats>;
}

/** The magic constant every query planner has. Named so it is obvious when it is used. */
export const DEFAULT_SELECTIVITY = 0.33;

const F64_TYPES = /^(DOUBLE|DECIMAL)/i;

/**
 * Build the statistics query for a relation. One pass, all columns.
 *
 * `approx_count_distinct` is a HyperLogLog sketch — far cheaper than `count(DISTINCT)`
 * and accurate enough for a `1/ndv` estimate. `statsFallbackSql` covers builds where it
 * is unavailable.
 */
export function statsSql(relation: string, columns: string[], approx = true): string {
  if (columns.length === 0) return `SELECT count(*) AS "__rows" FROM ${relation}`;
  const ndv = (c: string) =>
    approx ? `approx_count_distinct(${q(c)})` : `count(DISTINCT ${q(c)})`;
  const items = columns.flatMap((c, i) => [
    `${ndv(c)} AS "ndv_${i}"`,
    `min(${q(c)})::DOUBLE AS "min_${i}"`,
    `max(${q(c)})::DOUBLE AS "max_${i}"`,
    `count(${q(c)}) AS "nn_${i}"`,
  ]);
  return `SELECT count(*) AS "__rows", ${items.join(', ')} FROM ${relation}`;
}

/** Turn one statistics row into a `SourceStats`. */
export function parseStatsRow(
  row: Record<string, unknown>,
  columns: string[],
  types: Map<string, string>,
): SourceStats {
  const rows = num(row['__rows'], 0);
  const out = new Map<string, ColumnStats>();
  columns.forEach((name, i) => {
    const nonNull = num(row[`nn_${i}`], rows);
    const duckType = types.get(name) ?? 'DOUBLE';
    out.set(name, {
      name,
      duckType,
      // A column of all NULLs has ndv 0, which would make 1/ndv infinite.
      ndv: Math.max(1, num(row[`ndv_${i}`], 1)),
      min: num(row[`min_${i}`], 0),
      max: num(row[`max_${i}`], 0),
      nullFrac: rows > 0 ? 1 - nonNull / rows : 0,
      isF64: F64_TYPES.test(duckType),
    });
  });
  return { rows, columns: out };
}

// ---------------------------------------------------------------------------
// Selectivity
// ---------------------------------------------------------------------------

/**
 * Estimate the fraction of rows a predicate keeps, in [0, 1].
 *
 * Only the shapes a planner can reason about are handled; everything else falls back to
 * DEFAULT_SELECTIVITY. `params` supplies current values for `{{param}}` references,
 * which is what makes the estimate move when a slider moves — a filter at its minimum
 * keeps everything, and the optimizer should know that.
 */
export function estimateSelectivity(
  e: Expr,
  stats: SourceStats,
  params: Record<string, number> = {},
): number {
  return clamp01(selectivity(e, stats, params));
}

function selectivity(e: Expr, stats: SourceStats, params: Record<string, number>): number {
  switch (e.kind) {
    case 'binary': {
      if (e.op === '&&') {
        // Independence. Correlated predicates make this an underestimate, which is the
        // classic way a planner underestimates a join's input size.
        return selectivity(e.left, stats, params) * selectivity(e.right, stats, params);
      }
      if (e.op === '||') {
        const a = selectivity(e.left, stats, params);
        const b = selectivity(e.right, stats, params);
        return a + b - a * b;
      }
      return comparison(e.op, e.left, e.right, stats, params);
    }

    case 'unary':
      // `!p` keeps what p rejects.
      return e.op === '!' ? 1 - selectivity(e.operand, stats, params) : DEFAULT_SELECTIVITY;

    case 'cond':
      return DEFAULT_SELECTIVITY;

    default:
      return DEFAULT_SELECTIVITY;
  }
}

function comparison(
  op: string,
  left: Expr,
  right: Expr,
  stats: SourceStats,
  params: Record<string, number>,
): number {
  // Normalize to `column <op> constant`, flipping the operator if reversed.
  let col = asColumn(left, stats);
  let value = asConstant(right, params);
  let effectiveOp = op;
  if (!col || value === undefined) {
    const flippedCol = asColumn(right, stats);
    const flippedValue = asConstant(left, params);
    if (!flippedCol || flippedValue === undefined) return DEFAULT_SELECTIVITY;
    col = flippedCol;
    value = flippedValue;
    effectiveOp = flip(op);
  }

  const notNull = 1 - col.nullFrac;
  const span = col.max - col.min;

  switch (effectiveOp) {
    case '==':
      // Uniform distribution over distinct values.
      return (1 / col.ndv) * notNull;
    case '!=':
      return (1 - 1 / col.ndv) * notNull;
    case '>':
    case '>=': {
      // A single-valued column is the one place strict and non-strict genuinely differ:
      // for a column that is always 5, `> 5` keeps nothing while `>= 5` keeps everything.
      // Treating them alike here reported "keeps all rows" for a predicate that keeps none.
      if (span <= 0) {
        const keeps = effectiveOp === '>=' ? value <= col.min : value < col.min;
        return keeps ? notNull : 0;
      }
      // SQL comparisons drop NULLs, so scale by the non-null fraction. Forgetting this
      // is why the 2% NULL `speed` column in this repo's source made `speed > 0` look
      // like it kept everything.
      return clamp01((col.max - value) / span) * notNull;
    }
    case '<':
    case '<=': {
      if (span <= 0) {
        const keeps = effectiveOp === '<=' ? value >= col.max : value > col.max;
        return keeps ? notNull : 0;
      }
      return clamp01((value - col.min) / span) * notNull;
    }
    default:
      return DEFAULT_SELECTIVITY;
  }
}

/** Resolve an expression to a column's stats, if it is a bare column reference. */
function asColumn(e: Expr, stats: SourceStats): ColumnStats | undefined {
  return e.kind === 'col' ? stats.columns.get(e.name) : undefined;
}

/** Resolve an expression to a number, if it is a literal or a bound parameter. */
function asConstant(e: Expr, params: Record<string, number>): number | undefined {
  if (e.kind === 'num') return e.value;
  if (e.kind === 'param') {
    const v = params[e.name];
    return Number.isFinite(v) ? v : undefined;
  }
  if (e.kind === 'unary' && e.op === '-') {
    const inner = asConstant(e.operand, params);
    return inner === undefined ? undefined : -inner;
  }
  return undefined;
}

function flip(op: string): string {
  return { '<': '>', '<=': '>=', '>': '<', '>=': '<=' }[op] ?? op;
}

/**
 * Bytes an attribute of this width occupies for `rows` rows, as f32 on the GPU.
 * Everything reaching a buffer is f32, so the source type does not enter here.
 */
export function attributeBytes(rows: number, width: number): number {
  return rows * width * 4;
}

/** Columns a set of expressions reads, for projection-pushdown cost estimates. */
export function referencedColumns(exprs: Expr[]): Set<string> {
  const out = new Set<string>();
  for (const e of exprs) for (const c of columnsOf(e)) out.add(c);
  return out;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_SELECTIVITY;
}

function num(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
