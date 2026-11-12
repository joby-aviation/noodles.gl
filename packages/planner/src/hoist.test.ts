import { describe, it, expect } from 'vitest';
import { type Expr, parseExpr, simplifyExpr, walk } from './expr.js';
import { inlineFunctions } from './functions.js';
import { HOIST_PREFIX, type DerivedParam, hoistParams, derivedValues, withDerived, sourceParams, paramLabel } from './hoist.js';
import { analyze, PlanError } from './analyze.js';
import { plan } from './planner.js';
import { targetCaps } from './target.js';
import { evaluateStage } from './cpu-stage.js';
import { GEO_PRELUDE } from './geo.js';
import type { Graph } from './types.js';
import { SCHEMA, STATS, sourceUploads } from './fixtures.js';

const NUMERIC = new Set(['a', 'b', 'lat0', 'lng0', 'm']);
const numeric = (name: string) => NUMERIC.has(name);

function hoist(src: string): { tree: Expr; derived: DerivedParam[] } {
  const into = new Map<string, DerivedParam>();
  const parsed = simplifyExpr(inlineFunctions(parseExpr(src, { functions: GEO_PRELUDE }), GEO_PRELUDE));
  const tree = hoistParams(parsed, numeric, into);
  return { tree, derived: [...into.values()] };
}
/** The tree with each derived parameter spelled `$0`, `$1`… in order of appearance. */
function shape(src: string): string {
  const { tree, derived } = hoist(src);
  const names = derived.map((d) => d.name);
  const show = (e: Expr): string => {
    switch (e.kind) {
      case 'num': return String(e.value);
      case 'col': return e.name;
      case 'str': return `'${e.value}'`;
      case 'param': return names.includes(e.name) ? `$${names.indexOf(e.name)}` : `{{${e.name}}}`;
      case 'unary': return `${e.op}${show(e.operand)}`;
      case 'binary': return `(${show(e.left)} ${e.op} ${show(e.right)})`;
      case 'call': return `${e.fn}(${e.args.map(show).join(', ')})`;
      case 'vec': return `[${e.components.map(show).join(', ')}]`;
      case 'swizzle': return `${show(e.target)}.${e.channels}`;
      case 'cond': return `(${show(e.test)} ? ${show(e.then)} : ${show(e.else)})`;
    }
  };
  return show(tree);
}

describe('hoistParams: what is lifted', () => {
  it('lifts a function of parameters out of a per-row expression', () => {
    expect(shape('x * cos({{lat0}} * 0.0174)')).toBe('(x * $0)');
    expect(shape('x * ({{a}} * {{b}} + 1)')).toBe('(x * $0)');
  });

  it('lifts the maximal subtree, once', () => {
    const { tree, derived } = hoist('x + cos({{a}}) * sin({{a}})');
    expect(derived).toHaveLength(1);
    expect(derived[0].sources).toEqual(['a']);
    expect(shape('x + cos({{a}}) * sin({{a}})')).toBe('(x + $0)');
    expect(tree.kind).toBe('binary');
  });

  it('shares one parameter between identical subtrees', () => {
    const { derived } = hoist('x * cos({{a}}) + y * cos({{a}})');
    expect(derived).toHaveLength(1);
    expect(shape('x * cos({{a}}) + y * cos({{a}})')).toBe('((x * $0) + (y * $0))');
  });

  it('leaves a single operator inline, as not worth a parameter', () => {
    expect(shape('x * ({{a}} * 0.4)')).toBe('(x * ({{a}} * 0.4))');
    expect(shape('x * -{{a}}')).toBe('(x * -{{a}})');
    expect(shape('x * {{a}}')).toBe('(x * {{a}})');
  });

  it('leaves constants and undeclared or string parameters alone', () => {
    expect(shape('x * cos(1.0) * 2.0')).toBe('((x * cos(1)) * 2)');
    // A stats output is not declared: it is only known after its query runs.
    expect(shape('x * ln({{__stat_max}})')).toBe('(x * ln({{__stat_max}}))');
    expect(shape('x * ln({{code}})')).toBe('(x * ln({{code}}))');
  });

  it('does not lift a bare predicate, but lifts inside and around one', () => {
    expect(shape('{{a}} * 2.0 + 1.0 > 3.0')).toBe('($0 > 3)');
    expect(shape('x > cos({{a}})')).toBe('(x > $0)');
    // A numeric `cond` whose test compares parameters is one value.
    expect(shape('x * ({{a}} > 0.0 ? cos({{b}}) : 1.0)')).toBe('(x * $0)');
  });

  it('never lifts vectors, swizzles, ramps or aggregates, only their scalar insides', () => {
    expect(shape('[cos({{a}}), sin({{a}})]')).toBe('[$0, $1]');
    expect(shape('ramp(x * fract({{a}} * 0.5))')).toBe('ramp((x * $0))');
    expect(shape('sum(x * cos({{a}}))')).toBe('sum((x * $0))');
  });

  it('can lift a whole expression that reads no column', () => {
    expect(shape('sqrt({{a}}) * 2.0')).toBe('$0');
  });

  it('lifts the constant half of an inlined geo function', () => {
    const { tree, derived } = hoist('distance([lng, lat], [{{lng0}}, {{lat0}}])');
    // cos(radians(lat0)) is the one factor with no column in it.
    expect(derived.map((d) => d.sources)).toEqual([['lat0']]);
    let reads = 0;
    walk(tree, (n) => { if (n.kind === 'param' && n.name.startsWith(HOIST_PREFIX)) reads++; });
    expect(reads).toBe(1);
  });
});

describe('derived values', () => {
  const { derived } = hoist('x * cos({{a}}) + y * ({{a}} * {{b}} + 1.0)');
  const p = { derived };

  it('evaluates in f64', () => {
    const v = derivedValues(p, { a: 0.3, b: 2 });
    expect(Object.values(v).sort()).toEqual([Math.cos(0.3), 0.3 * 2 + 1].sort());
  });

  it('leaves out a value whose source is missing, rather than inventing one', () => {
    const v = derivedValues(p, { a: 0.3 });
    expect(Object.keys(v)).toHaveLength(1);
    expect(withDerived(p, { a: 0.3 }).a).toBe(0.3);
  });

  it('passes non-finite results through, as the unhoisted expression would produce them', () => {
    const { derived: d } = hoist('x * (1.0 / {{a}} + {{b}})');
    expect(Object.values(derivedValues({ derived: d }, { a: 0, b: 1 }))).toEqual([Infinity]);
  });

  it('maps derived names back to their sources', () => {
    expect(sourceParams(p, [...derived.map((d) => d.name), 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(sourceParams({}, ['a'])).toEqual(['a']);
  });
});

const SRC = { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1_000_000 } } as const;
function centred(extra: Graph['nodes'] = []): Graph {
  return {
    params: { lng0: { value: -73.9, changeRate: 60 }, lat0: { value: 40.7, changeRate: 60 } },
    nodes: [
      SRC,
      { id: 'd', type: 'attribute', input: 'src', name: 'pscale', expr: 'distance([lng, lat], [{{lng0}}, {{lat0}}])' },
      ...extra,
      { id: 'pos', type: 'attribute', input: extra.length ? extra[extra.length - 1].id : 'd', name: 'P', expr: '[lng, lat, 0.0]' },
      { id: 'out', type: 'render', input: 'pos', mode: 'points' },
    ],
  };
}

describe('analyze and plan', () => {
  it('keeps source names on the node, so a rebind is charged to lat0', () => {
    const a = analyze(centred(), SCHEMA);
    const d = a.order.find((n) => n.id === 'd')!;
    expect(d.params.sort()).toEqual(['lat0', 'lng0']);
    expect(a.derived).toHaveLength(1);
    // …and the per-row price no longer includes the hoisted factor.
    const off = analyze(centred(), SCHEMA, undefined, undefined, { hoist: false });
    expect(off.derived).toEqual([]);
    expect(d.ops).toBeLessThan(off.order.find((n) => n.id === 'd')!.ops);
  });

  it('rejects a declared parameter with the reserved prefix', () => {
    const g = centred();
    g.params![`${HOIST_PREFIX}x`] = { value: 1 };
    expect(() => analyze(g, SCHEMA)).toThrow(PlanError);
  });

  it('binds a derived parameter wherever its reader was placed, and never offers a control', () => {
    const name = analyze(centred(), SCHEMA).derived[0].name;
    const sql = plan(centred(), SCHEMA, { policy: 'sql-first' });
    expect(sql.sqlParams).toContain(name);
    const gpu = plan(centred(), SCHEMA, { policy: 'gpu-first' });
    expect(gpu.uniformParams).toContain(name);
    for (const p of [sql, gpu]) {
      expect(p.params[name]).toBeUndefined();
      expect(p.derived.map((d) => d.name)).toEqual([name]);
    }
  });

  it('computes the same numbers on the CPU stage as the unhoisted expression', () => {
    const rows = 512;
    const caps = targetCaps('deck-webgl2', undefined);
    // The rule-based policy on a target with no compute puts row math on the CPU stage.
    const hoisted = plan(centred(), SCHEMA, { caps, policy: 'auto' });
    const literal = plan({
      params: {},
      nodes: centred().nodes.map((n) => (n.id === 'd'
        ? { ...n, expr: 'distance([lng, lat], [-73.9, 40.7])' } as Graph['nodes'][number]
        : n)),
    }, SCHEMA, { caps, policy: 'auto' });
    expect(hoisted.cpuStage.some((s) => s.name === 'pscale')).toBe(true);
    expect(hoisted.derived).toHaveLength(1);
    const uploads = sourceUploads(rows);
    const a = evaluateStage(hoisted.cpuStage, hoisted, uploads, { lng0: -73.9, lat0: 40.7 }, rows);
    const b = evaluateStage(literal.cpuStage, literal, uploads, {}, rows);
    const got = a.values.get('pscale')!.data;
    const want = b.values.get('pscale')!.data;
    // Both f64 loops stored to f32: cos(40.7°) computed once or per row is the same double.
    expect([...got]).toEqual([...want]);
    expect(a.code).toContain(`p.${hoisted.derived[0].name}`);
  });

  it('estimates a hoisted threshold instead of defaulting', () => {
    const g = (predicate: string): Graph => ({
      params: { a: { value: 20 } },
      nodes: [
        SRC,
        { id: 'f', type: 'filter', input: 'src', predicate },
        { id: 'pos', type: 'attribute', input: 'f', name: 'P', expr: '[lng, lat, 0.0]' },
        { id: 'out', type: 'render', input: 'pos', mode: 'points' },
      ],
    });
    const hoisted = plan(g('speed > {{a}} * 2.0 + 1.0'), SCHEMA, { stats: STATS, params: { a: 20 } });
    const bound = plan(g('speed > {{a}}'), SCHEMA, { stats: STATS, params: { a: 41 } });
    const [h] = hoisted.explain.estimatedSelectivity;
    const [b] = bound.explain.estimatedSelectivity;
    expect(h.selectivity).toBeCloseTo(b.selectivity, 9);
    // …which is not the fallback the unhoisted `{{a}} * 2.0 + 1.0` got.
    expect(h.selectivity).not.toBeCloseTo(1 / 3, 3);
  });
});

describe('paramLabel', () => {
  it('shows a derived parameter as its expression, and a declared one as its name', () => {
    const { derived } = hoist('x * cos({{a}} * 2.0)');
    expect(paramLabel({ derived }, derived[0].name)).toBe('cos(({{a}} * 2))');
    expect(paramLabel({ derived }, 'a')).toBe('a');
  });
});
