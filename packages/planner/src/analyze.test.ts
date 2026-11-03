import { describe, it, expect } from 'vitest';
import { analyze, opCount, type Schema } from './analyze.js';
import { parseExpr } from './expr.js';
import type { Graph } from './types.js';

/**
 * Analysis answers only questions with objective answers — order, feasibility, widths, op
 * counts — and makes no placement decisions. These tests pin that separation: if a placement
 * ever leaks into this phase, the cost model stops being the thing that decides.
 */

const schema: Schema = new Map([
  ['lng', 1], ['lat', 1], ['elevation', 1], ['pop', 1], ['speed', 1], ['cluster', 1],
]);

const source = { id: 'src', type: 'source', dataset: { ref: 't', estimatedRows: 1000 } } as const;
const render = (input: string) => ({ id: 'out', type: 'render', input, mode: 'points' } as const);
const attr = (id: string, input: string, name: string, expr: string) =>
  ({ id, type: 'attribute', input, name, expr } as const);

const g = (nodes: Graph['nodes'], params: Graph['params'] = {}): Graph => ({ params, nodes });
const ids = (a: ReturnType<typeof analyze>) => a.order.map((n) => n.id);

describe('topological order', () => {
  it('follows a linear chain', () => {
    const a = analyze(g([
      source, attr('a', 'src', 'P', '[lng, lat, 0]'), attr('b', 'a', 'pscale', 'pop'), render('b'),
    ]), schema);
    expect(ids(a)).toEqual(['a', 'b']);
  });

  it('orders a diamond so both branches precede the merge', () => {
    const a = analyze(g([
      source,
      attr('left', 'src', 'x1', 'pop * 2'),
      attr('right', 'src', 'x2', 'elevation * 3'),
      { id: 'merge', type: 'attribute', input: 'left', inputs: ['left', 'right'], name: 'P', expr: '[x1, x2, 0]' },
      render('merge'),
    ]), schema);
    const order = ids(a);
    expect(order.indexOf('left')).toBeLessThan(order.indexOf('merge'));
    expect(order.indexOf('right')).toBeLessThan(order.indexOf('merge'));
  });

  it('breaks ties by declaration order, so plans are reproducible', () => {
    // A different tie-break would give a different (equally legal) stage boundary and make
    // the explain pane jitter between runs.
    const nodes: Graph['nodes'] = [
      source,
      attr('first', 'src', 'x1', 'pop'),
      attr('second', 'src', 'x2', 'elevation'),
      { id: 'm', type: 'attribute', input: 'first', inputs: ['first', 'second'], name: 'P', expr: '[x1, x2, 0]' },
      render('m'),
    ];
    expect(ids(analyze(g(nodes), schema))).toEqual(['first', 'second', 'm']);
    expect(ids(analyze(g(nodes), schema))).toEqual(ids(analyze(g(nodes), schema)));
  });

  it('includes a stats node that branches off the chain', () => {
    const a = analyze(g([
      source,
      { id: 'f', type: 'filter', input: 'src', predicate: 'speed > 10' },
      { id: 'st', type: 'stats', input: 'f', column: 'pop', ops: ['min'] },
      attr('p', 'f', 'P', '[lng, lat, 0]'),
      render('p'),
    ]), schema);
    expect(a.statsNodes.map((s) => s.id)).toEqual(['st']);
    // Stats are not placeable nodes, so they stay out of the order.
    expect(ids(a)).toEqual(['f', 'p']);
  });
});

describe('dead code', () => {
  it('drops a branch the output does not depend on', () => {
    const a = analyze(g([
      source,
      attr('used', 'src', 'P', '[lng, lat, 0]'),
      attr('dead', 'src', 'unused', 'sqrt(pop)'),
      render('used'),
    ]), schema);
    expect(ids(a)).toEqual(['used']);
    expect(a.notes.join(' ')).toMatch(/dead-code elimination.*dead/);
  });

  it('drops a whole unreachable chain, not just its tail', () => {
    const a = analyze(g([
      source,
      attr('used', 'src', 'P', '[lng, lat, 0]'),
      attr('d1', 'src', 'q', 'pop'),
      attr('d2', 'd1', 'r', 'q * 2'),
      render('used'),
    ]), schema);
    expect(ids(a)).toEqual(['used']);
  });

  it('keeps a stats node whose input survives', () => {
    const a = analyze(g([
      source,
      attr('used', 'src', 'P', '[lng, lat, 0]'),
      { id: 'st', type: 'stats', input: 'used', column: 'pop', ops: ['max'] },
      render('used'),
    ]), schema);
    expect(a.statsNodes).toHaveLength(1);
  });
});

describe('errors are actionable', () => {
  it('detects a cycle instead of hanging', () => {
    expect(() => analyze(g([
      source, attr('a', 'b', 'P', '[lng, lat, 0]'), attr('b', 'a', 'q', 'pop'), render('a'),
    ]), schema)).toThrow(/Cycle/);
  });

  it('names an unknown input id', () => {
    expect(() => analyze(g([
      source, attr('a', 'nope', 'P', '[lng, lat, 0]'), render('a'),
    ]), schema)).toThrow(/Unknown node id 'nope'/);
  });

  it('lists the available attributes when one is misspelled', () => {
    expect(() => analyze(g([
      source, attr('a', 'src', 'P', '[lngg, lat, 0]'), render('a'),
    ]), schema)).toThrow(/unknown attribute 'lngg'.*Available/s);
  });

  it('rejects a graph with no source or no render node', () => {
    expect(() => analyze(g([attr('a', 'src', 'P', 'pop'), render('a')]), schema)).toThrow();
    expect(() => analyze(g([source]), schema)).toThrow(/no render node/);
  });

  it('rejects an aggregate expression in an attribute node', () => {
    expect(() => analyze(g([
      source, attr('a', 'src', 'P', '[avg(pop), 0, 0]'), render('a'),
    ]), schema)).toThrow(/cannot aggregate/);
  });

  it('rejects a non-aggregate expression in an aggregate node', () => {
    expect(() => analyze(g([
      source,
      { id: 'ag', type: 'aggregate', input: 'src', groupBy: ['cluster'], aggs: [{ name: 'n', expr: 'pop' }] },
      attr('p', 'ag', 'P', '[cluster, n, 0]'),
      render('p'),
    ]), schema)).toThrow(/is not an aggregate expression/);
  });

  it('rejects two aggregates', () => {
    const agg = (id: string, input: string, name: string): Graph['nodes'][number] =>
      ({ id, type: 'aggregate', input, groupBy: ['cluster'], aggs: [{ name, expr: 'count()' }] });
    expect(() => analyze(g([
      source, agg('a1', 'src', 'n1'), agg('a2', 'a1', 'n2'),
      attr('p', 'a2', 'P', '[cluster, n2, 0]'), render('p'),
    ]), schema)).toThrow(/only one aggregate/);
  });

  it('names the node when an expression fails to parse', () => {
    expect(() => analyze(g([
      source, attr('bad', 'src', 'P', 'sqrt('), render('bad'),
    ]), schema)).toThrow(/Node bad/);
  });

  it('rejects an unknown groupBy column and an unknown stats column', () => {
    expect(() => analyze(g([
      source,
      { id: 'ag', type: 'aggregate', input: 'src', groupBy: ['nope'], aggs: [{ name: 'n', expr: 'count()' }] },
      attr('p', 'ag', 'P', '[n, 0, 0]'), render('p'),
    ]), schema)).toThrow(/unknown groupBy column 'nope'/);

    expect(() => analyze(g([
      source,
      { id: 'st', type: 'stats', input: 'src', column: 'nope', ops: ['min'] },
      attr('p', 'src', 'P', '[lng, lat, 0]'), render('p'),
    ]), schema)).toThrow(/unknown column 'nope'/);
  });
});

describe('schema evolution', () => {
  it('adds each attribute as it is created, with its width', () => {
    const a = analyze(g([
      source, attr('p', 'src', 'P', '[lng, lat, 0]'), attr('s', 'p', 'pscale', 'length(P)'), render('s'),
    ]), schema);
    expect(a.widths.get('P')).toBe(3);
    expect(a.widths.get('pscale')).toBe(1);
  });

  it('an aggregate reshapes the namespace to keys plus aggregates', () => {
    const a = analyze(g([
      source,
      { id: 'ag', type: 'aggregate', input: 'src', groupBy: ['cluster'], aggs: [{ name: 'n', expr: 'count()' }, { name: 'mp', expr: 'avg(pop)' }] },
      attr('p', 'ag', 'P', '[cluster, n, mp]'),
      render('p'),
    ]), schema);
    expect(a.groupBy).toEqual(['cluster']);
    expect(a.aggregateNames).toEqual(['n', 'mp']);
    expect(a.widths.has('lng')).toBe(false);
    expect(a.widths.get('n')).toBe(1);
  });

  it('rejects a column the aggregate dropped', () => {
    expect(() => analyze(g([
      source,
      { id: 'ag', type: 'aggregate', input: 'src', groupBy: ['cluster'], aggs: [{ name: 'n', expr: 'count()' }] },
      attr('p', 'ag', 'P', '[lng, lat, 0]'),
      render('p'),
    ]), schema)).toThrow(/unknown attribute 'lng'/);
  });

  it('lets an attribute overwrite one it also reads', () => {
    const a = analyze(g([
      source, attr('p', 'src', 'P', '[lng, lat, 0]'), attr('q', 'p', 'P', 'P * 2'), render('q'),
    ]), schema);
    expect(a.widths.get('P')).toBe(3);
  });
});

describe('feasible stages', () => {
  const feasibleOf = (nodes: Graph['nodes'], id: string) =>
    [...analyze(g(nodes), schema).order.find((n) => n.id === id)!.feasible].sort();

  it('portable math can run anywhere', () => {
    expect(feasibleOf([source, attr('a', 'src', 'x', 'sqrt(pop)'), render('a')], 'a'))
      .toEqual(['cpu', 'gpu', 'sql']);
  });

  it('ramp() and swizzles cannot run in SQL', () => {
    expect(feasibleOf([
      source, attr('t', 'src', 'tt', 'pop / 1000.0'), attr('a', 't', 'Cd', 'ramp(tt)'), render('a'),
    ], 'a')).toEqual(['cpu', 'gpu']);

    expect(feasibleOf([
      source, attr('p', 'src', 'P', '[lng, lat, 0]'), attr('a', 'p', 'x', 'P.x'), render('a'),
    ], 'a')).toEqual(['cpu', 'gpu']);
  });

  it('an aggregate is SQL-only', () => {
    expect(feasibleOf([
      source,
      { id: 'ag', type: 'aggregate', input: 'src', groupBy: ['cluster'], aggs: [{ name: 'n', expr: 'count()' }] },
      attr('p', 'ag', 'P', '[cluster, n, 0]'), render('p'),
    ], 'ag')).toEqual(['sql']);
  });

  it('bin2d is GPU-only', () => {
    expect(feasibleOf([
      source, attr('p', 'src', 'P', '[lng, lat, 0]'),
      { id: 'b', type: 'bin2d', input: 'p', resolution: 128, ramp: 'magma' },
      { id: 'out', type: 'render', input: 'b', mode: 'heatmap' },
    ], 'b')).toEqual(['gpu']);
  });

  it('CPU feasibility always matches GPU feasibility', () => {
    // The JS backend implements every function the WGSL backend does; stating it as an
    // invariant means a divergence fails here rather than at runtime on a WebGL2 target.
    const a = analyze(g([
      source,
      attr('p', 'src', 'P', '[lng, lat, 0]'),
      attr('t', 'p', 'tt', 'pop / 1000.0'),
      attr('c', 't', 'Cd', 'ramp(tt)'),
      { id: 'f', type: 'filter', input: 'c', predicate: 'speed > 1' },
      render('f'),
    ]), schema);
    for (const node of a.order) {
      expect(node.feasible.has('cpu'), node.id).toBe(node.feasible.has('gpu'));
    }
  });
});

describe('opCount', () => {
  it('grows with tree size', () => {
    expect(opCount(parseExpr('a + b'), 1)).toBeLessThan(opCount(parseExpr('a + b * c - d'), 1));
  });

  it('scales with result width, because elementwise work repeats per component', () => {
    const e = parseExpr('a + b');
    expect(opCount(e, 3)).toBe(3 * opCount(e, 1));
  });

  it('is at least 1 even for a bare reference', () => {
    expect(opCount(parseExpr('a'), 1)).toBeGreaterThanOrEqual(1);
    expect(opCount(parseExpr('1'), 1)).toBeGreaterThanOrEqual(1);
  });

  it('counts a call as work', () => {
    expect(opCount(parseExpr('sqrt(a)'), 1)).toBeGreaterThan(opCount(parseExpr('a'), 1));
  });

  it('is recorded on every analyzed node', () => {
    const a = analyze(g([
      source, attr('p', 'src', 'P', '[lng, lat, elevation * 2]'), render('p'),
    ]), schema);
    expect(a.order[0].ops).toBeGreaterThan(0);
  });
});

describe('analysis makes no placement decisions', () => {
  it('produces the same analysis regardless of any policy or cost input', () => {
    // `analyze` takes neither, which is the structural guarantee. This asserts the result is
    // a pure function of graph and schema.
    const nodes: Graph['nodes'] = [
      source,
      { id: 'f', type: 'filter', input: 'src', predicate: 'speed > 10' },
      attr('p', 'f', 'P', '[lng, lat, 0]'),
      render('p'),
    ];
    const a = analyze(g(nodes), schema);
    const b = analyze(g(nodes), schema);
    expect(ids(a)).toEqual(ids(b));
    expect(a.order.map((n) => [...n.feasible].sort())).toEqual(b.order.map((n) => [...n.feasible].sort()));
    expect(a.order.map((n) => n.ops)).toEqual(b.order.map((n) => n.ops));
  });

  it('records no stage on any node', () => {
    const a = analyze(g([source, attr('p', 'src', 'P', '[lng, lat, 0]'), render('p')]), schema);
    for (const node of a.order) {
      expect(node).not.toHaveProperty('stage');
    }
  });
});

describe('sugar is already expanded', () => {
  it('a wrangle arrives as one attribute node per statement', () => {
    const a = analyze(g([
      source,
      { id: 'w', type: 'wrangle', input: 'src', body: '@P = [lng, lat, 0]; var t = pop; @pscale = t;' },
      render('w'),
    ]), schema);
    expect(a.order).toHaveLength(3);
    expect(a.order.every((n) => n.kind === 'attribute')).toBe(true);
  });

  it('a scale and colorscale arrive as attribute nodes', () => {
    const a = analyze(g([
      source,
      { id: 's', type: 'scale', input: 'src', name: 'pscale', expr: 'pop', domain: ['0', '1'], range: ['1', '9'] },
      { id: 'p', type: 'project', input: 's', mode: 'identity', x: 'lng', y: 'lat' },
      render('p'),
    ]), schema);
    expect(a.order.map((n) => n.kind)).toEqual(['attribute', 'attribute']);
  });

  it('marks a wrangle local as internal', () => {
    const a = analyze(g([
      source,
      { id: 'w', type: 'wrangle', input: 'src', body: 'var t = pop; @P = [lng, lat, t];' },
      render('w'),
    ]), schema);
    const local = a.order.find((n) => n.internal);
    expect(local).toBeDefined();
    expect(local!.name).toMatch(/^__/);
  });
});
