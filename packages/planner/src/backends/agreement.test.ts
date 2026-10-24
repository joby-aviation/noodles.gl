import { describe, it, expect } from 'vitest';
import { parseExpr, enginesFor } from '../expr.js';
import { toSql } from './sql.js';
import { toWgsl, type Resolver } from './wgsl.js';
import { toJs, type JsResolver } from './js.js';

/**
 * The thesis test. Two backends can agree by coincidence; three that agree is evidence
 * the IR is the right abstraction.
 *
 * SQL cannot be executed here without DuckDB, so it is checked structurally (it
 * compiles, and its parameter order is right). WGSL likewise (it compiles, with the
 * right widths). The JS backend is *executed*, so numeric semantics — operator
 * precedence, integer division, float modulo, ternary branch order — are checked
 * against hand-computed values rather than asserted.
 */

const widths: Record<string, number> = { P: 3, uv: 2 };

const wgslResolver: Resolver = (name) => ({ code: `a_${name}`, width: widths[name] ?? 1 });

/** Columns are read from a `cols` object the generated function receives. */
function jsResolver(): JsResolver {
  return (name) => ({
    width: widths[name] ?? 1,
    component: (c) => `cols[${JSON.stringify(name)}][${c}]`,
  });
}

/** Compile via the JS backend and evaluate for one row. */
function evalJs(src: string, cols: Record<string, number[]>, params: Record<string, number> = {}): number[] {
  const emitted = toJs(parseExpr(src), jsResolver());
  const body = `return [${emitted.components.join(', ')}];`;
  const rampAt = (t: number, c: number) => Math.min(Math.max(t, 0), 1) * (c + 1);
  const fn = new Function('cols', 'p', 'rampAt', body) as (
    cols: Record<string, number[]>, p: Record<string, number>, rampAt: (t: number, c: number) => number,
  ) => number[];
  return fn(cols, params, rampAt);
}

describe('three backends compile the same tree', () => {
  const portable = [
    'sqrt(pop) * 2',
    'fit(speed, 0, 100, 0, 1)',
    'clamp(x / {{scale}}, 0, 1)',
    'speed > 10 ? 1 : 0',
    'lerp(a, b, 0.5)',
    'abs(x) % 7',
    'ln(max(pop, 1))',
    '-x + min(a, b)',
    '(speed > 10) * 2',
  ];

  it.each(portable)('%s compiles to sql, wgsl and js', (src) => {
    const e = parseExpr(src);
    expect(enginesFor(e).has('sql'), 'sql-capable').toBe(true);
    expect(enginesFor(e).has('gpu'), 'gpu-capable').toBe(true);
    expect(toSql(e).code).toBeTruthy();
    expect(toWgsl(e, wgslResolver).code).toBeTruthy();
    expect(toJs(e, jsResolver()).components.length).toBeGreaterThan(0);
  });

  it('gpu-only constructs compile to wgsl and js but not sql', () => {
    for (const src of ['ramp(t)', 'P.xy', 'length(P)', 'smoothstep(0, 1, t)']) {
      const e = parseExpr(src);
      expect(enginesFor(e).has('sql'), src).toBe(false);
      expect(() => toWgsl(e, wgslResolver)).not.toThrow();
      expect(() => toJs(e, jsResolver())).not.toThrow();
    }
  });

  it('aggregates compile to sql only', () => {
    const e = parseExpr('avg(speed)');
    expect(toSql(e).code).toBe('avg("speed")');
    expect(() => toWgsl(e, wgslResolver)).toThrow(/no GPU equivalent/);
    expect(() => toJs(e, jsResolver())).toThrow(/aggregate/);
  });
});

describe('js backend numeric semantics', () => {
  const cols = { x: [7], a: [2], b: [10], pop: [100], speed: [42], t: [0.5], P: [1, 2, 3], uv: [4, 5] };

  it.each([
    ['1 + 2 * 3', [7]],
    ['(1 + 2) * 3', [9]],
    // Integer division must not truncate, matching the SQL backend's float literals.
    ['1 / 2', [0.5]],
    ['sqrt(pop) * 2', [20]],
    ['fit(speed, 0, 100, 0, 1)', [0.42]],
    ['lerp(a, b, 0.5)', [6]],
    ['abs(x) % 3', [1]],
    // Negative modulo: floor-based, matching the WGSL polyfill, not JS's % operator.
    ['-x % 3', [2]],
    ['ln(max(pop, 1))', [Math.log(100)]],
    ['-x + min(a, b)', [-5]],
    ['speed > 10 ? 1 : 0', [1]],
    ['speed < 10 ? 1 : 0', [0]],
    ['(speed > 10) * 2', [2]],
    ['clamp(x, 0, 5)', [5]],
    ['[a, b, x]', [2, 10, 7]],
    ['P.xy', [1, 2]],
    ['P * 2', [2, 4, 6]],
    ['P + 1', [2, 3, 4]],
    ['length(P)', [Math.hypot(1, 2, 3)]],
    ['dot(P, P)', [14]],
    ['uv.yx', [5, 4]],
  ])('%s -> %j', (src, want) => {
    const got = evalJs(src, cols);
    expect(got).toHaveLength(want.length);
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 10));
  });

  it('binds parameters', () => {
    expect(evalJs('x / {{scale}}', cols, { scale: 2 })).toEqual([3.5]);
  });

  it('short-circuits logical operators to booleans, not numbers', () => {
    expect(evalJs('(a > 1) && (b > 100) ? 1 : 0', cols)).toEqual([0]);
    expect(evalJs('(a > 1) || (b > 100) ? 1 : 0', cols)).toEqual([1]);
  });
});

describe('wgsl and js agree on width', () => {
  it.each([
    ['[a, b, x]', 3],
    ['P.xy', 2],
    ['P * 2', 3],
    ['length(P)', 1],
    ['ramp(t)', 3],
    ['cross(P, P)', 3],
  ])('%s -> %i components in both', (src, want) => {
    const e = parseExpr(src);
    expect(toWgsl(e, wgslResolver).width).toBe(want);
    expect(toJs(e, jsResolver()).width).toBe(want);
  });
});
