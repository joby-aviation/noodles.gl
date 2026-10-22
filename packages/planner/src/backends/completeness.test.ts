import { describe, it, expect } from 'vitest';
import { FUNCTIONS, parseExpr, enginesFor, widthOf, type FnSpec } from '../expr.js';
import { toSql } from './sql.js';
import { toWgsl, wgslParamMember } from './wgsl.js';
import { toJs } from './js.js';

/**
 * Completeness, driven off the op table rather than a hand-maintained list.
 *
 * The failure this prevents: someone adds a function to `FUNCTIONS` with a `wgsl` spelling,
 * forgets the JS implementation, and the CPU stage throws at runtime — on a WebGL2 target,
 * in production, months later. Enumerating the table means the test fails the moment the
 * table and the backends disagree.
 */

const ENTRIES = Object.entries(FUNCTIONS) as [string, FnSpec][];

/** A call to `name` with the right arity, using distinct scalar columns as arguments. */
function callOf(name: string, spec: FnSpec): string {
  const [lo] = spec.arity;
  const args = Array.from({ length: lo }, (_, i) => `a${i}`);
  return `${name}(${args.join(', ')})`;
}

const scalarResolver = (n: string) => ({ code: `v_${n}`, width: 1 });
const jsResolver = () => ({ width: 1, component: () => 'x' });

describe('the op table is internally consistent', () => {
  it('is not empty and every entry has a usable arity', () => {
    expect(ENTRIES.length).toBeGreaterThan(20);
    for (const [name, spec] of ENTRIES) {
      const [lo, hi] = spec.arity;
      expect(lo, name).toBeGreaterThanOrEqual(0);
      expect(hi, name).toBeGreaterThanOrEqual(lo);
    }
  });

  it('every function is reachable by at least one backend', () => {
    // A function with neither an sql nor a wgsl spelling can never run anywhere.
    const orphans = ENTRIES.filter(([, s]) => !s.sql && !s.wgsl).map(([n]) => n);
    expect(orphans).toEqual([]);
  });

  it('aggregates are SQL-only, and only aggregates are', () => {
    for (const [name, spec] of ENTRIES) {
      if (spec.aggregate) {
        expect(spec.sql, `${name} is an aggregate and needs SQL`).toBeTruthy();
        expect(spec.wgsl, `${name} is an aggregate and must not claim GPU`).toBeNull();
      }
    }
  });

  it('declares a width rule for every function', () => {
    for (const [name, spec] of ENTRIES) {
      const ok = spec.width === 'broadcast' || (typeof spec.width === 'number' && spec.width >= 1);
      expect(ok, `${name} has width ${String(spec.width)}`).toBe(true);
    }
  });
});

describe('each function compiles on exactly the backends it claims', () => {
  it.each(ENTRIES.map(([name, spec]) => [name, spec] as const))(
    '%s',
    (name, spec) => {
      const src = callOf(name, spec);
      const expr = parseExpr(src);
      const engines = enginesFor(expr);

      // Declared availability must match what enginesFor reports.
      expect(engines.has('sql'), `${name} sql availability`).toBe(Boolean(spec.sql));
      expect(engines.has('gpu'), `${name} gpu availability`).toBe(Boolean(spec.wgsl));

      if (spec.sql) {
        const emitted = toSql(expr);
        expect(emitted.code, `${name} -> sql`).toBeTruthy();
        expect(balancedParens(emitted.code), `${name} sql parens`).toBe(true);
      } else {
        expect(() => toSql(expr), `${name} must refuse sql`).toThrow();
      }

      if (spec.wgsl) {
        const emitted = toWgsl(expr, scalarResolver);
        expect(emitted.code, `${name} -> wgsl`).toBeTruthy();
        expect(balancedParens(emitted.code), `${name} wgsl parens`).toBe(true);
        // The CPU backend must keep pace with the GPU one; they share a feasibility rule.
        const js = toJs(expr, jsResolver);
        expect(js.components.length, `${name} -> js`).toBeGreaterThan(0);
      } else {
        expect(() => toWgsl(expr, scalarResolver), `${name} must refuse wgsl`).toThrow();
        expect(() => toJs(expr, jsResolver), `${name} must refuse js`).toThrow();
      }
    },
  );
});

describe('width inference matches the declared rule', () => {
  const env = (n: string) => (n === 'vec3' ? 3 : n === 'vec2' ? 2 : 1);

  it.each(ENTRIES.filter(([, s]) => typeof s.width === 'number').map(([n, s]) => [n, s] as const))(
    '%s pins its result width',
    (name, spec) => {
      const src = callOf(name, spec);
      // Reducing functions take vectors; feed vec3 where the arity allows.
      const vecSrc = src.replace(/a\d+/g, 'vec3');
      const expr = parseExpr(vecSrc);
      expect(widthOf(expr, env)).toBe(spec.width);
    },
  );

  it('broadcast functions take their width from the widest argument', () => {
    const broadcast = ENTRIES.filter(([, s]) => s.width === 'broadcast' && !s.aggregate);
    expect(broadcast.length).toBeGreaterThan(5);
    for (const [name, spec] of broadcast) {
      if (!spec.wgsl) continue;
      const src = callOf(name, spec).replace(/a0/, 'vec3');
      expect(widthOf(parseExpr(src), env), name).toBe(3);
    }
  });
});

describe('generated WGSL avoids reserved words', () => {
  /**
   * A subset of the WGSL reserved-word list that a data column or parameter could plausibly
   * be called. `meta` is in here because it already bit this project once: the row-count
   * uniform was named `meta` and every kernel failed to compile.
   */
  const RESERVED = [
    'meta', 'filter', 'from', 'get', 'set', 'type', 'mod', 'match', 'where', 'with',
    'target', 'shared', 'precise', 'sample', 'enum', 'class', 'new', 'delete', 'union',
    'export', 'import', 'module', 'private', 'public', 'static', 'typedef', 'virtual',
  ];

  it('the reserved list itself is non-trivial', () => {
    expect(RESERVED.length).toBeGreaterThan(10);
  });

  it.each(RESERVED)('a column named "%s" does not emit a bare reserved identifier', (word) => {
    // Columns are safe because the resolver renames them; this asserts that stays true.
    const emitted = toWgsl(parseExpr(`${word} * 2`), (n) => ({ code: `b_${n}[i]`, width: 1 }));
    expect(declaresIdentifier(emitted.code, word)).toBe(false);
  });

  it.each(RESERVED)('a parameter named "%s" is prefixed, not emitted bare', (word) => {
    // A parameter becomes a uniform struct *member*, and WGSL reserved words are not legal
    // identifiers there — `struct Params { type: f32 }` does not compile. Every parameter is
    // prefixed so the reserved list never has to be maintained.
    const emitted = toWgsl(parseExpr(`x * {{${word}}}`), (n) => ({ code: `b_${n}[i]`, width: 1 }));
    expect(emitted.params).toEqual([word]);
    expect(emitted.code).toContain(`params.${wgslParamMember(word)}`);
    expect(emitted.code).not.toMatch(new RegExp(`params\\.${word}(?![\\w])`));
  });

  it('the member prefix also sanitizes characters WGSL rejects', () => {
    expect(wgslParamMember('a-b')).toBe('p_a_b');
    expect(wgslParamMember('type')).toBe('p_type');
  });
});

function balancedParens(code: string): boolean {
  let depth = 0;
  for (const ch of code) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Does the code use `word` as a standalone identifier (not as `.word` or `x_word`)? */
function declaresIdentifier(code: string, word: string): boolean {
  return new RegExp(`(^|[^.\\w])${word}(?![\\w])`).test(code);
}
