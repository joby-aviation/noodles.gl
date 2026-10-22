import { describe, it, expect } from 'vitest';
import { parseExpr, enginesFor, columnsOf, paramsOf, isAggregate, simplifyExpr, widthOf } from './expr.js';
import { toSql, toSqlColumns } from './backends/sql.js';
import { toWgsl, type Resolver } from './backends/wgsl.js';

/** Test resolver: every column is a scalar named `a_<name>` unless listed wider. */
function resolver(widths: Record<string, number> = {}): Resolver {
  return (name) => ({ code: `a_${name}`, width: widths[name] ?? 1 });
}

describe('parser', () => {
  it('respects precedence', () => {
    expect(toSql(parseExpr('1 + 2 * 3')).code).toBe('(1.0 + (2.0 * 3.0))');
  });

  it('parses parameters, calls, vectors and ternaries', () => {
    const e = parseExpr('speed > {{cutoff}} ? [x, y, 0] : [0, 0, 0]');
    expect(columnsOf(e).sort()).toEqual(['speed', 'x', 'y']);
    expect(paramsOf(e)).toEqual(['cutoff']);
  });

  it('rejects unknown functions and bad arity', () => {
    expect(() => parseExpr('frobnicate(x)')).toThrow(/Unknown function/);
    expect(() => parseExpr('sqrt(x, y)')).toThrow(/takes 1 args/);
  });

  it('rejects trailing junk', () => {
    expect(() => parseExpr('x +')).toThrow();
    expect(() => parseExpr('x y')).toThrow(/Trailing/);
  });
});

describe('engine capability', () => {
  it('portable math runs on both engines', () => {
    expect([...enginesFor(parseExpr('sqrt(pop) * 2')).values()].sort()).toEqual(['gpu', 'sql']);
  });

  it('ramp() is GPU-only', () => {
    const engines = enginesFor(parseExpr('ramp(t)'));
    expect(engines.has('gpu')).toBe(true);
    expect(engines.has('sql')).toBe(false);
  });

  it('swizzles are GPU-only', () => {
    expect(enginesFor(parseExpr('P.xy')).has('sql')).toBe(false);
  });

  it('aggregates are SQL-only', () => {
    const e = parseExpr('avg(speed)');
    expect(enginesFor(e).has('gpu')).toBe(false);
    expect(isAggregate(e)).toBe(true);
  });

  it('one GPU-only leaf poisons the whole tree for SQL', () => {
    expect(enginesFor(parseExpr('sqrt(pop) + smoothstep(0, 1, t)')).has('sql')).toBe(false);
  });
});

describe('dual-backend agreement — the core claim', () => {
  // Every expression here must compile to BOTH backends. These snapshots are the
  // evidence that the same tree produces valid SQL and valid WGSL.
  const portable = [
    'sqrt(pop) * 2',
    'fit(speed, 0, 100, 0, 1)',
    'clamp(x / {{scale}}, 0, 1)',
    'speed > 10 ? 1 : 0',
    'lerp(a, b, 0.5)',
    'abs(x) % 7',
    'ln(max(pop, 1))',
    '-x + min(a, b)',
  ];

  it.each(portable)('compiles %s to both backends', (src) => {
    const e = parseExpr(src);
    expect(enginesFor(e).has('sql')).toBe(true);
    expect(enginesFor(e).has('gpu')).toBe(true);
    expect(toSql(e).code).toBeTruthy();
    expect(toWgsl(e, resolver()).code).toBeTruthy();
  });

  it('snapshots both emissions side by side', () => {
    const rows = portable.map((src) => {
      const e = parseExpr(src);
      return { src, sql: toSql(e).code, wgsl: toWgsl(e, resolver()).code };
    });
    expect(rows).toMatchSnapshot();
  });
});

describe('sql backend', () => {
  it('numbers params and reuses the number for a repeated name', () => {
    // Numbered rather than positional, so an op template that repeats an argument (fit, lerp)
    // cannot emit more placeholders than there are binds.
    const { code, params } = toSql(parseExpr('x * {{a}} + {{b}} - {{a}}'));
    expect(params).toEqual(['a', 'b']);
    expect(code).toContain('$1');
    expect(code).toContain('$2');
    expect(code.match(/\$1/g)).toHaveLength(2);
    expect(code.match(/\$3/g)).toBeNull();
  });

  it('keeps placeholder count equal to bind count even when a template repeats', () => {
    // `fit` uses its domain-low and range-low twice. With `?` this produced 5 placeholders
    // for 3 binds and DuckDB rejected the statement.
    const { code, params } = toSql(parseExpr('fit(x, {{lo}}, {{hi}}, 0, {{out}})'));
    const distinct = new Set(code.match(/\$\d+/g) ?? []);
    expect(params).toEqual(['lo', 'hi', 'out']);
    expect(distinct.size).toBe(params.length);
  });

  it('forces float literals so integer division does not truncate', () => {
    expect(toSql(parseExpr('1 / 2')).code).toBe('(1.0 / 2.0)');
  });

  it('splits a top-level vector into one column per component, cast to FLOAT', () => {
    // The cast is load-bearing: without it DuckDB returns `0.0` as DECIMAL, which Arrow
    // reports as an unscaled integer and the upload path cannot read.
    const { items } = toSqlColumns(parseExpr('[lng, lat, 0]'), 'P');
    expect(items).toHaveLength(3);
    expect(items[2]).toBe('CAST(0.0 AS FLOAT) AS "P_2"');
    expect(items[0]).toContain('AS "P_0"');
  });

  it('refuses nested vectors and swizzles rather than emitting wrong SQL', () => {
    expect(() => toSql(parseExpr('[x, y] * 2'))).toThrow(/cannot be nested/);
    expect(() => toSql(parseExpr('P.x'))).toThrow(/no SQL equivalent/);
  });

  it('maps logical and comparison operators to SQL spelling', () => {
    expect(toSql(parseExpr('a == 1 && b != 2')).code).toBe('((a_placeholder))'.replace('(a_placeholder)', '("a" = 1.0) AND ("b" <> 2.0)'));
  });
});

describe('wgsl backend', () => {
  it('splats scalars when widths differ', () => {
    const out = toWgsl(parseExpr('P + 1'), resolver({ P: 3 }));
    expect(out.width).toBe(3);
    expect(out.code).toContain('vec3<f32>(1.0)');
  });

  it('converts bools to floats when they enter arithmetic', () => {
    const out = toWgsl(parseExpr('(speed > 10) * 2'), resolver());
    expect(out.code).toContain('select(0.0, 1.0,');
  });

  it('emits select() for ternaries with the WGSL argument order', () => {
    const out = toWgsl(parseExpr('t > 0 ? 1 : 2'), resolver());
    // select(falseValue, trueValue, cond)
    expect(out.code).toBe('select(2.0, 1.0, (a_t > 0.0))');
  });

  it('implements float modulo, which WGSL lacks', () => {
    expect(toWgsl(parseExpr('x % 3'), resolver()).code).toContain('floor(');
  });

  it('reports width for reducing functions', () => {
    expect(toWgsl(parseExpr('length(P)'), resolver({ P: 3 })).width).toBe(1);
    expect(toWgsl(parseExpr('ramp(t)'), resolver()).width).toBe(3);
  });

  it('rejects swizzles that exceed the source width', () => {
    expect(() => toWgsl(parseExpr('uv.z'), resolver({ uv: 2 }))).toThrow(/exceeds/);
  });

  it('collects params and columns for binding', () => {
    const out = toWgsl(parseExpr('fit(speed, 0, {{hi}}, 0, {{out}})'), resolver());
    expect(out.params.sort()).toEqual(['hi', 'out']);
    expect(out.columns).toEqual(['speed']);
  });
});

describe('width inference', () => {
  const env = (n: string) => ({ P: 3, uv: 2 } as Record<string, number>)[n] ?? 1;
  it.each([
    ['[x, y, z]', 3],
    ['P.xy', 2],
    ['P * 2', 3],
    ['length(P)', 1],
    ['dot(P, P)', 1],
    ['x > 1 ? P : P', 3],
  ])('%s -> %i components', (src, want) => {
    expect(widthOf(parseExpr(src), env)).toBe(want);
  });
});

describe('simplifyExpr', () => {
  const simp = (src: string) => simplifyExpr(parseExpr(src));

  it.each([
    ['[a, b].y', 'b'],
    ['[a, b, c].zx', '[c, a]'],
    ['[a, b, c].rgb', '[a, b, c]'],
    ['[a, b, c].zy.x', 'c'],
    ['sin([a + 1, b].x) * 2', 'sin(a + 1) * 2'],
    ['x > 0 ? [a, b].y : 0', 'x > 0 ? b : 0'],
  ])('%s -> %s', (src, want) => {
    expect(simp(src)).toEqual(parseExpr(want));
  });

  it('leaves swizzles it cannot resolve alone', () => {
    // A vector column, and a channel past the literal's width: the second must still reach
    // `widthOf`'s error rather than silently becoming something.
    expect(simp('P.x')).toEqual(parseExpr('P.x'));
    expect(simp('[a, b].z')).toEqual(parseExpr('[a, b].z'));
  });

  it('is what makes a point built from scalars SQL-feasible', () => {
    expect(enginesFor(parseExpr('[lng, lat].x * 2')).has('sql')).toBe(false);
    expect(enginesFor(simp('[lng, lat].x * 2')).has('sql')).toBe(true);
  });
});
