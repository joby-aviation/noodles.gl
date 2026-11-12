import { describe, it, expect } from 'vitest';
import {
  buildRegistry, defineFunction, inlineFunctions, parseFunctionDeclaration,
  type FunctionDef,
} from './functions.js';
import { parseExpr, columnsOf, paramsOf, enginesFor, widthOf } from './expr.js';
import { opCount } from './analyze.js';
import { toJs } from './backends/js.js';
import { parseWrangle } from './wrangle.js';
import { plan } from './planner.js';
import { SCHEMA, STATS } from './fixtures.js';
import type { Graph } from './types.js';

/**
 * User functions are resolved by inlining, so the assertions that matter are about what the
 * rest of the system sees *afterwards*: an ordinary expression tree, with the same engines,
 * the same width, the same dependency set and an op count that includes the duplicated work.
 * If those hold, nothing downstream needs to know functions exist — which is the entire claim.
 */

const reg = (src: Record<string, { params: string[]; body: string }>) => buildRegistry(src);

/**
 * Evaluate an expression through the JS backend, the one executable in Node.
 *
 * The registry is passed to `parseExpr` as well as to `inlineFunctions`, because the parser
 * validates call names and arity eagerly — a user function has to be declared to it.
 */
function evaluate(src: string, cols: Record<string, number>, params: Record<string, number> = {},
  registry = reg({})): number {
  const tree = inlineFunctions(parseExpr(src, { functions: registry }), registry);
  const emitted = toJs(tree, (name) => ({ width: 1, component: () => `c.${name}` }));
  const fn = new Function('c', 'p', `return ${emitted.components[0]};`) as
    (c: Record<string, number>, p: Record<string, number>) => number;
  return fn(cols, params);
}

describe('inlining', () => {
  const ease = reg({ ease: { params: ['t'], body: 't * t * (3.0 - 2.0 * t)' } });

  it('substitutes the argument for the parameter', () => {
    expect(evaluate('ease(0.5)', {}, {}, ease)).toBeCloseTo(0.5, 6);
    expect(evaluate('ease(x)', { x: 0.25 }, {}, ease)).toBeCloseTo(0.15625, 6);
  });

  it('leaves the tree free of any call to the function', () => {
    const tree = inlineFunctions(parseExpr('ease(x)', { functions: ease }), ease);
    const calls: string[] = [];
    const walk = (e: ReturnType<typeof parseExpr>): void => {
      if (e.kind === 'call') { calls.push(e.fn); e.args.forEach(walk); return; }
      if (e.kind === 'binary') { walk(e.left); walk(e.right); return; }
      if (e.kind === 'unary') { walk(e.operand); return; }
    };
    walk(tree);
    expect(calls).not.toContain('ease');
  });

  it('reports the true dependency set after inlining', () => {
    // `columnsOf` on the inlined tree is what the planner uses for projection pushdown, so a
    // function reading an attribute must show up as a real dependency.
    const density = reg({ density: { params: [], body: 'pop / area' } });
    expect(columnsOf(inlineFunctions(parseExpr('density()', { functions: density }), density)).sort())
      .toEqual(['area', 'pop']);
  });

  it('preserves parameter references in the body', () => {
    const scaled = reg({ scaled: { params: ['x'], body: 'x * {{k}}' } });
    const tree = inlineFunctions(parseExpr('scaled(pop)', { functions: scaled }), scaled);
    expect(paramsOf(tree)).toEqual(['k']);
    expect(evaluate('scaled(pop)', { pop: 4 }, { k: 3 }, scaled)).toBe(12);
  });

  it('resolves nested calls bottom-up', () => {
    const nested = reg({
      double: { params: ['x'], body: 'x * 2.0' },
      quad: { params: ['x'], body: 'double(double(x))' },
    });
    expect(evaluate('quad(3)', {}, {}, nested)).toBe(12);
  });

  it('keeps a function usable on every engine its body supports', () => {
    const portable = reg({ norm: { params: ['x', 'lo', 'hi'], body: 'fit(x, lo, hi, 0.0, 1.0)' } });
    const engines = enginesFor(inlineFunctions(parseExpr('norm(pop, 0, 100)', { functions: portable }), portable));
    expect(engines.has('sql')).toBe(true);
    expect(engines.has('gpu')).toBe(true);
  });

  it('inherits infeasibility from the body, not from being a function', () => {
    // `ramp` has no SQL form, so anything calling it loses SQL — the same as writing it inline.
    const ramped = reg({ shade: { params: ['t'], body: 'ramp(t)' } });
    const engines = enginesFor(inlineFunctions(parseExpr('shade(0.5)', { functions: ramped }), ramped));
    expect(engines.has('sql')).toBe(false);
    expect(engines.has('gpu')).toBe(true);
  });

  it('carries the body’s width through', () => {
    const vec = reg({ pos: { params: ['a', 'b'], body: '[a, b, 0.0]' } });
    const tree = inlineFunctions(parseExpr('pos(lng, lat)', { functions: vec }), vec);
    expect(widthOf(tree, () => 1)).toBe(3);
  });

  it('prices duplicated arguments honestly', () => {
    // `sq(sqrt(pop))` really does compute the sqrt twice on the GPU. The op count has to say
    // so, or the optimizer under-prices a function that looks cheap at the call site.
    const sq = reg({ sq: { params: ['x'], body: 'x * x' } });
    const once = opCount(parseExpr('sqrt(pop)'), 1);
    const twice = opCount(inlineFunctions(parseExpr('sq(sqrt(pop))', { functions: sq }), sq), 1);
    expect(twice).toBeGreaterThan(2 * once - 1);
  });

  it('is a no-op when no functions are declared', () => {
    const tree = parseExpr('sqrt(pop) * 2');
    expect(inlineFunctions(tree, reg({}))).toBe(tree);
  });

  it('still rejects a genuinely unknown call at parse time', () => {
    // Declaring user functions to the parser rather than relaxing its check is what keeps this
    // error where the typo is, instead of deferring it to an engine-capability failure.
    expect(() => parseExpr('nosuchfn(pop)')).toThrow(/Unknown function "nosuchfn"/);
    expect(() => parseExpr('nosuchfn(pop)', { functions: reg({ other: { params: [], body: '1' } }) }))
      .toThrow(/Unknown function "nosuchfn"/);
  });

  it('checks arity at parse time for a declared function', () => {
    const one = reg({ half: { params: ['x'], body: 'x * 0.5' } });
    expect(() => parseExpr('half(1, 2)', { functions: one })).toThrow(/half\(\) takes 1 args, got 2/);
  });
});

describe('rejections', () => {
  it('refuses to shadow a built-in', () => {
    expect(() => reg({ sqrt: { params: ['x'], body: 'x' } }))
      .toThrow(/built-in function and cannot be redefined/);
  });

  it('refuses a duplicate declaration, naming the first one', () => {
    const into = reg({ f: { params: ['x'], body: 'x' } });
    expect(() => buildRegistry({ f: { params: ['y'], body: 'y' } }, into))
      .toThrow(/already defined at functions\.f/);
  });

  it('reports an arity mismatch at the call site', () => {
    // The parser catches it first, which is where it belongs. The check inside `inlineFunctions`
    // below is a backstop for trees built by hand rather than parsed.
    const two = reg({ mix2: { params: ['a', 'b'], body: 'a + b' } });
    expect(() => parseExpr('mix2(1)', { functions: two })).toThrow(/mix2\(\) takes 2 args, got 1/);
  });

  it('backstops arity for a hand-built tree, naming the parameters', () => {
    const two = reg({ mix2: { params: ['a', 'b'], body: 'a + b' } });
    const call = { kind: 'call' as const, fn: 'mix2', args: [{ kind: 'num' as const, value: 1 }] };
    expect(() => inlineFunctions(call, two))
      .toThrow(/mix2\(\) takes 2 argument\(s\) \(a, b\), got 1/);
  });

  it('rejects direct recursion, showing the cycle', () => {
    // Built by hand: a self-referential body cannot be authored through `buildRegistry`,
    // because the parser would reject the name before the declaration finished.
    const registry = new Map<string, FunctionDef>();
    const stub = { params: ['x'] as const };
    const body = parseExpr('loop(x)', { functions: new Map([['loop', stub]]) });
    registry.set('loop', defineFunction('loop', ['x'], body, 'test'));
    expect(() => inlineFunctions(parseExpr('loop(1)', { functions: registry }), registry))
      .toThrow(/loop -> loop is recursive/);
  });

  it('rejects mutual recursion', () => {
    const stubs = new Map([['a', { params: ['x'] }], ['b', { params: ['x'] }]]);
    const registry = new Map<string, FunctionDef>([
      ['a', defineFunction('a', ['x'], parseExpr('b(x)', { functions: stubs }), 'test')],
      ['b', defineFunction('b', ['x'], parseExpr('a(x)', { functions: stubs }), 'test')],
    ]);
    expect(() => inlineFunctions(parseExpr('a(1)', { functions: registry }), registry)).toThrow(/a -> b -> a is recursive/);
  });

  it('rejects an invalid name or a repeated parameter', () => {
    expect(() => defineFunction('9bad', ['x'], parseExpr('x'), 't')).toThrow(/not a valid function name/);
    expect(() => defineFunction('f', ['x', 'x'], parseExpr('x'), 't')).toThrow(/declares 'x' twice/);
  });

  it('reports a parse error in the body against the declaration, not the call site', () => {
    expect(() => reg({ broken: { params: ['x'], body: 'x +' } })).toThrow(/functions\.broken/);
  });
});

describe('fn declarations in a wrangle body', () => {
  it('parses and hoists a declaration', () => {
    const statements = parseWrangle(`
      fn ease(t) = t * t * (3.0 - 2.0 * t);
      @Cd = ramp(ease(0.5));
    `);
    expect(statements.map((s) => s.kind)).toEqual(['function', 'attribute']);
    expect(statements[0].fn?.params).toEqual(['t']);
  });

  it('accepts a zero-argument declaration', () => {
    const [decl] = parseWrangle('fn half() = 0.5; @pscale = half();');
    expect(decl.fn?.params).toEqual([]);
  });

  it('produces no node of its own', () => {
    // A declaration is not a statement that computes anything, so nothing should be placed.
    const statements = parseWrangle('fn f(x) = x; @P = [f(lng), lat, 0.0];');
    expect(statements.filter((s) => s.kind !== 'function')).toHaveLength(1);
  });

  it('still requires at least one attribute assignment', () => {
    expect(() => parseWrangle('fn f(x) = x;')).toThrow(/assigns no attributes/);
  });

  it('reports a bad declaration with its line number', () => {
    expect(() => parseWrangle('@P = [lng, lat, 0.0];\nfn bad(x) = ;'))
      .toThrow(/Line 2/);
  });

  it('is distinguished from an assignment beginning with the letters "fn"', () => {
    // `fnord` is a perfectly good attribute name and must not be read as a declaration.
    const [s] = parseWrangle('@fnord = pop;');
    expect(s.kind).toBe('attribute');
    expect(s.name).toBe('fnord');
    expect(parseFunctionDeclaration('@fnord = pop', 'x')).toBeUndefined();
  });
});

describe('a graph using functions plans normally', () => {
  function graph(): Graph {
    return {
      functions: {
        ease: { params: ['t'], body: 't * t * (3.0 - 2.0 * t)' },
        mercatorY: { params: ['lat'], body: 'ln(tan(0.7853981634 + lat * 0.008726646259971648)) / 6.283185307' },
      },
      params: { k: { value: 2, kind: 'value', changeRate: 8 } },
      nodes: [
        { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1_000_000 } },
        {
          id: 'wr', type: 'wrangle', input: 'src', ramp: 'viridis', body: `
            fn norm(x) = clamp(fit(x, 0.0, 900.0, 0.0, 1.0), 0.0, 1.0);
            @P      = [lng / 360.0, mercatorY(lat), 0.0];
            var t   = ease(norm(elevation));
            @Cd     = ramp(t);
            @pscale = t * {{k}};
          `,
        },
        { id: 'out', type: 'render', input: 'wr', mode: 'points' },
      ],
    };
  }

  const physical = plan(graph(), SCHEMA, {
    policy: 'cost', stats: STATS, params: { k: 2 },
  });

  it('produces a plan with the expected attributes', () => {
    const names = physical.attributes.map((a) => a.name);
    expect(names).toContain('P');
    expect(names).toContain('Cd');
    expect(names).toContain('pscale');
  });

  it('emits no trace of the function names in the generated code', () => {
    const code = [physical.sql, ...physical.kernels.map((k) => k.code)].join('\n');
    for (const name of ['ease', 'norm', 'mercatorY']) {
      expect(code, `${name} should have been inlined away`).not.toContain(name);
    }
  });

  it('still fuses into a single kernel', () => {
    // Functions must not become a fusion barrier: after inlining there is nothing to barrier.
    expect(physical.kernels).toHaveLength(1);
  });

  it('routes the parameter used inside a function body as a uniform', () => {
    expect(physical.uniformParams).toContain('k');
  });

  it('records the declaration in the notes', () => {
    expect(physical.notes.join('\n')).toMatch(/declared norm\(x\)/);
  });
});
