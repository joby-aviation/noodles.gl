/**
 * IR -> DuckDB SQL.
 *
 * Value parameters become **numbered** placeholders (`$1`, `$2`, ...) so the whole stage can
 * be a prepared statement: changing a slider rebinds and re-executes without DuckDB
 * re-planning the query.
 *
 * Numbered rather than positional `?` for a specific reason. Several op templates repeat an
 * argument — `fit` uses its domain-low and range-low twice, `lerp` uses its first argument
 * twice — and each repetition duplicates whatever text that argument produced. With `?` a
 * repeated parameter emitted two placeholders but contributed one bind, so a graph using
 * `fit` with a parameterized domain generated 7 placeholders for 6 binds and DuckDB rejected
 * the statement. Numbering makes repetition free: `$3` can appear five times and still means
 * bind three.
 *
 * A consequence: all emissions that end up in **one statement** must share a `SqlParams`, or
 * their numbering collides. The planner creates one per statement and passes it in.
 *
 * SQL columns are scalars, so a vector-valued expression can only appear at the top
 * level, where it is split into one column per component (`P_0`, `P_1`, `P_2`).
 * `enginesFor()` in expr.ts already refuses swizzles for SQL, so nested vector math
 * never reaches here.
 */

import { type Expr, FUNCTIONS, SQL_BINARY, ExprError } from '../expr.js';

export interface SqlEmit {
  /** SQL expression text. */
  code: string;
  /** Distinct parameter names, in bind order: index 0 is `$1`. */
  params: string[];
}

/**
 * Placeholder numbering for one SQL statement.
 *
 * Share a single instance across every expression that lands in the same statement — the
 * SELECT list and the WHERE clause of one query — and use a fresh one per statement.
 */
export class SqlParams {
  private index = new Map<string, number>();
  /** Parameter names in bind order; `order[0]` binds `$1`. */
  readonly order: string[] = [];

  /** The placeholder text for a parameter, assigning it a number on first sight. */
  placeholder(name: string): string {
    let at = this.index.get(name);
    if (at === undefined) {
      this.order.push(name);
      at = this.order.length;
      this.index.set(name, at);
    }
    return `$${at}`;
  }
}

interface Ctx {
  params: SqlParams;
}

/**
 * An emitted fragment plus whether it is a SQL BOOLEAN.
 *
 * Tracking this matters because SQL, unlike WGSL and JS, has no implicit boolean-to-number
 * conversion: DuckDB rejects `(a > b) * 2` with a binder error. The WGSL backend already
 * carried an `isBool` flag for the same reason; the SQL backend did not, so a comparison used
 * in arithmetic produced a query that failed to bind.
 */
interface Val {
  code: string;
  isBool: boolean;
}

const COMPARISONS = ['==', '!=', '<', '<=', '>', '>='];
const LOGICAL = ['&&', '||'];

/** Force a fragment into numeric form. */
function asNumber(v: Val): string {
  return v.isBool ? `(CASE WHEN ${v.code} THEN 1.0 ELSE 0.0 END)` : v.code;
}

/** Force a fragment into boolean form, for a WHERE clause or a CASE condition. */
function asBool(v: Val): string {
  return v.isBool ? v.code : `(${v.code} <> 0)`;
}

function emit(e: Expr, ctx: Ctx): Val {
  switch (e.kind) {
    case 'num':
      return { code: formatNumber(e.value), isBool: false };

    case 'str':
      return { code: `'${e.value.replace(/'/g, "''")}'`, isBool: false };

    case 'col':
      return { code: quoteIdent(e.name), isBool: false };

    case 'param':
      // Same name -> same number, so a template that repeats an argument is harmless.
      return { code: ctx.params.placeholder(e.name), isBool: false };

    case 'unary': {
      const operand = emit(e.operand, ctx);
      return e.op === '!'
        ? { code: `(NOT ${asBool(operand)})`, isBool: true }
        : { code: `(-${asNumber(operand)})`, isBool: false };
    }

    case 'binary': {
      const left = emit(e.left, ctx);
      const right = emit(e.right, ctx);
      const op = SQL_BINARY[e.op] ?? e.op;

      if (LOGICAL.includes(e.op)) {
        return { code: `(${asBool(left)} ${op} ${asBool(right)})`, isBool: true };
      }
      if (COMPARISONS.includes(e.op)) {
        return { code: `(${asNumber(left)} ${op} ${asNumber(right)})`, isBool: true };
      }
      if (e.op === '%') {
        // DuckDB's `%` truncates toward zero; WGSL has no float `%` at all and the other two
        // backends use floor semantics. Emitting the floor form here is what makes
        // `-2 % 3` agree at 1 across all three rather than being -2 in SQL only.
        const a = asNumber(left);
        const b = asNumber(right);
        return { code: `(${a} - ${b} * floor(${a} / ${b}))`, isBool: false };
      }
      return { code: `(${asNumber(left)} ${op} ${asNumber(right)})`, isBool: false };
    }

    case 'cond': {
      const test = emit(e.test, ctx);
      const then = emit(e.then, ctx);
      const otherwise = emit(e.else, ctx);
      return {
        code: `(CASE WHEN ${asBool(test)} THEN ${asNumber(then)} ELSE ${asNumber(otherwise)} END)`,
        isBool: false,
      };
    }

    case 'call': {
      const spec = FUNCTIONS[e.fn];
      if (!spec.sql) {
        throw new ExprError(`${e.fn}() has no SQL equivalent; this node must run on the GPU`);
      }
      const args = e.args.map((a) => asNumber(emit(a, ctx)));
      const code = typeof spec.sql === 'function' ? spec.sql(args) : `${spec.sql}(${args.join(', ')})`;
      return { code, isBool: false };
    }

    case 'vec':
      throw new ExprError(
        'Vector expressions cannot be nested in SQL. Split into per-component columns at the top level.',
      );

    case 'swizzle':
      throw new ExprError('Swizzles have no SQL equivalent; this node must run on the GPU');
  }
}

/**
 * Compile one scalar expression.
 *
 * Pass `params` when this expression shares a statement with others, so the numbering is
 * consistent across the whole query.
 */
export function toSql(e: Expr, params: SqlParams = new SqlParams()): SqlEmit {
  // Left in whatever form the tree produced: a predicate stays BOOLEAN for a WHERE clause.
  const value = emit(e, { params });
  return { code: value.code, params: params.order };
}

/**
 * Compile a possibly-vector expression into one SELECT item per component,
 * sharing a single parameter bind order across them.
 */
/**
 * Wrap a SELECT item so it arrives as an Arrow Float32 column.
 *
 * Two problems this solves at once. DuckDB infers DECIMAL for a literal like `1.0`, and Arrow
 * represents a decimal as an *unscaled* integer — the upload path reads it as garbage, so a
 * constant weight of 1.0 silently became 0. And every column reaching the GPU becomes f32
 * anyway, so narrowing here moves the work into DuckDB's vectorised executor and removes the
 * CPU cast tier entirely.
 */
export function castToFloat(code: string): string {
  return `CAST(${code} AS FLOAT)`;
}

/**
 * Wrap a SELECT item as DOUBLE. What a relation stores: a relation is read again by SQL, not
 * by a buffer, so it keeps full precision — a haversine distance or an epoch timestamp
 * narrowed to f32 there would lose metres and seconds before any consumer saw it. The
 * DECIMAL problem `castToFloat` solves applies equally, so the cast is still required.
 */
export function castToDouble(code: string): string {
  return `CAST(${code} AS DOUBLE)`;
}

export function toSqlColumns(
  e: Expr,
  baseAlias: string,
  params: SqlParams = new SqlParams(),
  cast: (code: string) => string = castToFloat,
): { items: string[]; params: string[] } {
  const ctx: Ctx = { params };
  // Coerced to numeric: a selected column feeds an f32 attribute buffer, so a BOOLEAN result
  // would arrive as an Arrow bool vector that the upload path cannot read.
  if (e.kind === 'vec') {
    const items = e.components.map(
      (c, i) => `${cast(asNumber(emit(c, ctx)))} AS ${quoteIdent(`${baseAlias}_${i}`)}`,
    );
    return { items, params: params.order };
  }
  return {
    items: [`${cast(asNumber(emit(e, ctx)))} AS ${quoteIdent(baseAlias)}`],
    params: params.order,
  };
}

// ---------------------------------------------------------------------------

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * DuckDB infers INTEGER for bare integer literals, which makes `1 / 2` return 0.
 * Force a decimal point so graph arithmetic behaves the same in both backends.
 */
function formatNumber(v: number): string {
  if (!Number.isFinite(v)) throw new ExprError(`Cannot emit non-finite literal ${v} to SQL`);
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

export { quoteIdent };
