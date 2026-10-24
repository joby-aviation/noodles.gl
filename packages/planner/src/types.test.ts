import { describe, it, expect } from 'vitest';
import { desugar, buildRampLut, statExpr, statParamName, RAMP_STOPS, type Graph, type RampName } from './types.js';
import { parseExpr, columnsOf, paramsOf, simplifyExpr } from './expr.js';
import { inlineFunctions } from './functions.js';
import { toJs } from './backends/js.js';

/**
 * Desugaring is where `scale`, `colorscale`, `project` and `wrangle` become plain attribute
 * nodes. It is the reason those do not need to be operators — and the reason a bug here looks
 * like a rendering problem rather than a compiler problem, so the emitted expressions are
 * checked numerically against independent references, not just by shape.
 */

const source = { id: 'src', type: 'source', dataset: { ref: 't' } } as const;
const render = (input: string) => ({ id: 'out', type: 'render', input, mode: 'points' } as const);
const g = (nodes: Graph['nodes']): Graph => ({ params: {}, nodes });

/** Evaluate a desugared attribute node's expression for one row. */
function evalNode(
  nodes: Graph['nodes'],
  nodeId: string,
  cols: Record<string, number>,
  params: Record<string, number> = {},
): number[] {
  const out = desugar(g(nodes));
  const node = out.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'attribute') throw new Error(`no attribute node ${nodeId}`);
  // Resolved as `analyze` resolves it: sugar may call the geo prelude (`project` does).
  const parsed = typeof node.expr === 'string' ? parseExpr(node.expr, { functions: out.functions }) : node.expr;
  const expr = simplifyExpr(inlineFunctions(parsed, out.functions));
  const emitted = toJs(expr, (name) => ({ width: 1, component: () => `c.${name}` }));
  const rampAt = (t: number, ch: number) => Math.min(Math.max(t, 0), 1) * (ch + 1);
  const fn = new Function('c', 'p', 'rampAt', `return [${emitted.components.join(',')}];`) as (
    c: Record<string, number>, p: Record<string, number>, r: typeof rampAt,
  ) => number[];
  return fn(cols, params, rampAt);
}

describe('scale', () => {
  const scaleNodes = (kind?: 'linear' | 'log' | 'sqrt', clamp?: boolean): Graph['nodes'] => [
    source,
    { id: 's', type: 'scale', input: 'src', name: 'pscale', expr: 'v', kind, clamp, domain: ['0', '100'], range: ['1', '11'] },
    render('s'),
  ];

  it('becomes an attribute node with the requested name', () => {
    const out = desugar(g(scaleNodes()));
    const node = out.nodes.find((n) => n.id === 's');
    expect(node).toMatchObject({ type: 'attribute', name: 'pscale' });
    expect(out.notes.join(' ')).toMatch(/scale desugared/);
  });

  it('maps the domain onto the range linearly', () => {
    expect(evalNode(scaleNodes('linear'), 's', { v: 0 })[0]).toBeCloseTo(1, 6);
    expect(evalNode(scaleNodes('linear'), 's', { v: 50 })[0]).toBeCloseTo(6, 6);
    expect(evalNode(scaleNodes('linear'), 's', { v: 100 })[0]).toBeCloseTo(11, 6);
  });

  it('clamps to the range by default', () => {
    expect(evalNode(scaleNodes('linear'), 's', { v: -500 })[0]).toBeCloseTo(1, 6);
    expect(evalNode(scaleNodes('linear'), 's', { v: 500 })[0]).toBeCloseTo(11, 6);
  });

  it('does not clamp when told not to', () => {
    expect(evalNode(scaleNodes('linear', false), 's', { v: 200 })[0]).toBeGreaterThan(11);
  });

  it('clamps correctly even with a descending range', () => {
    const nodes: Graph['nodes'] = [
      source,
      { id: 's', type: 'scale', input: 'src', name: 'pscale', expr: 'v', domain: ['0', '10'], range: ['9', '1'] },
      render('s'),
    ];
    expect(evalNode(nodes, 's', { v: 0 })[0]).toBeCloseTo(9, 6);
    expect(evalNode(nodes, 's', { v: 10 })[0]).toBeCloseTo(1, 6);
    // Out of domain must still land inside [1, 9], not outside it.
    const low = evalNode(nodes, 's', { v: -100 })[0];
    expect(low).toBeLessThanOrEqual(9);
    expect(low).toBeGreaterThanOrEqual(1);
  });

  it('warps by log, matching a reference', () => {
    const nodes: Graph['nodes'] = [
      source,
      { id: 's', type: 'scale', input: 'src', name: 'pscale', expr: 'v', kind: 'log', domain: ['1', '1000'], range: ['0', '3'] },
      render('s'),
    ];
    for (const v of [1, 10, 100, 1000]) {
      const expected = (Math.log(v) - Math.log(1)) / (Math.log(1000) - Math.log(1)) * 3;
      expect(evalNode(nodes, 's', { v })[0]).toBeCloseTo(expected, 4);
    }
  });

  it('guards log against zero and negative input', () => {
    const nodes: Graph['nodes'] = [
      source,
      { id: 's', type: 'scale', input: 'src', name: 'pscale', expr: 'v', kind: 'log', domain: ['1', '1000'], range: ['0', '3'] },
      render('s'),
    ];
    // ln(0) is -Infinity; the emitted expression must floor it so the result stays finite.
    expect(Number.isFinite(evalNode(nodes, 's', { v: 0 })[0])).toBe(true);
    expect(Number.isFinite(evalNode(nodes, 's', { v: -5 })[0])).toBe(true);
  });

  it('warps by sqrt and guards negatives', () => {
    const nodes: Graph['nodes'] = [
      source,
      { id: 's', type: 'scale', input: 'src', name: 'pscale', expr: 'v', kind: 'sqrt', domain: ['0', '100'], range: ['0', '10'] },
      render('s'),
    ];
    expect(evalNode(nodes, 's', { v: 25 })[0]).toBeCloseTo(5, 5);
    expect(Number.isFinite(evalNode(nodes, 's', { v: -1 })[0])).toBe(true);
  });

  it('reads an auto domain from the named stats node', () => {
    const nodes: Graph['nodes'] = [
      source,
      { id: 'st', type: 'stats', input: 'src', column: 'v', ops: ['min', 'max'] },
      { id: 's', type: 'scale', input: 'src', name: 'pscale', expr: 'v', domain: 'auto', statsFrom: 'st', range: ['0', '1'] },
      render('s'),
    ];
    const node = desugar(g(nodes)).nodes.find((n) => n.id === 's')!;
    if (node.type !== 'attribute') throw new Error('scale should desugar to an attribute');
    const expr = typeof node.expr === 'string' ? parseExpr(node.expr) : node.expr;
    expect(paramsOf(expr)).toEqual(expect.arrayContaining([statParamName('st', 'min'), statParamName('st', 'max')]));
    // And it evaluates against those parameters.
    expect(evalNode(nodes, 's', { v: 5 }, { st_min: 0, st_max: 10 })[0]).toBeCloseTo(0.5, 6);
  });

  it('rejects an auto domain with no statsFrom', () => {
    expect(() => desugar(g([
      source,
      { id: 's', type: 'scale', input: 'src', name: 'pscale', expr: 'v', domain: 'auto', range: ['0', '1'] },
      render('s'),
    ]))).toThrow(/requires 'statsFrom'/);
  });
});

describe('colorscale', () => {
  it('defaults to writing Cd and calls ramp()', () => {
    const out = desugar(g([
      source,
      { id: 'c', type: 'colorscale', input: 'src', expr: 'v', ramp: 'magma', domain: ['0', '1'] },
      render('c'),
    ]));
    const node = out.nodes.find((n) => n.id === 'c')!;
    expect(node).toMatchObject({ type: 'attribute', name: 'Cd' });
    expect(out.ramp).toBe('magma');
  });

  it('honours an explicit name', () => {
    const out = desugar(g([
      source,
      { id: 'c', type: 'colorscale', input: 'src', name: 'Highlight', expr: 'v', ramp: 'turbo', domain: ['0', '1'] },
      render('c'),
    ]));
    expect(out.nodes.find((n) => n.id === 'c')).toMatchObject({ name: 'Highlight' });
  });

  it('normalizes the domain to 0..1 and clamps outside it', () => {
    const nodes: Graph['nodes'] = [
      source,
      { id: 'c', type: 'colorscale', input: 'src', expr: 'v', ramp: 'viridis', domain: ['10', '20'] },
      render('c'),
    ];
    // The stub rampAt returns t*(channel+1), so channel 0 reveals t directly.
    expect(evalNode(nodes, 'c', { v: 15 })[0]).toBeCloseTo(0.5, 6);
    expect(evalNode(nodes, 'c', { v: -100 })[0]).toBeCloseTo(0, 6);
    expect(evalNode(nodes, 'c', { v: 999 })[0]).toBeCloseTo(1, 6);
  });

  it('rejects two different ramps, which would need two LUTs', () => {
    expect(() => desugar(g([
      source,
      { id: 'c1', type: 'colorscale', input: 'src', name: 'Cd', expr: 'v', ramp: 'viridis', domain: ['0', '1'] },
      { id: 'c2', type: 'colorscale', input: 'c1', name: 'Cd2', expr: 'v', ramp: 'magma', domain: ['0', '1'] },
      render('c2'),
    ]))).toThrow(/different ramps/);
  });

  it('accepts the same ramp used twice', () => {
    expect(() => desugar(g([
      source,
      { id: 'c1', type: 'colorscale', input: 'src', name: 'Cd', expr: 'v', ramp: 'viridis', domain: ['0', '1'] },
      { id: 'c2', type: 'colorscale', input: 'c1', name: 'Cd2', expr: 'v', ramp: 'viridis', domain: ['0', '1'] },
      render('c2'),
    ]))).not.toThrow();
  });
});

describe('project', () => {
  const mercatorX = (lng: number) => lng / 360;
  const mercatorY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);

  const projNodes = (mode: 'mercator' | 'identity', worldScale?: string): Graph['nodes'] => [
    source,
    { id: 'p', type: 'project', input: 'src', mode, x: 'lng', y: 'lat', z: 'elev', worldScale },
    render('p'),
  ];

  it('always writes a vec3 named P', () => {
    const node = desugar(g(projNodes('identity'))).nodes.find((n) => n.id === 'p')!;
    expect(node).toMatchObject({ type: 'attribute', name: 'P' });
    expect(evalNode(projNodes('identity'), 'p', { lng: 1, lat: 2, elev: 3 })).toHaveLength(3);
  });

  it('identity mode passes coordinates through', () => {
    expect(evalNode(projNodes('identity'), 'p', { lng: 1, lat: 2, elev: 3 }))
      .toEqual([1, 2, 3]);
  });

  it('mercator matches an independent reference across the usable latitude band', () => {
    for (const [lng, lat] of [[0, 0], [45, 30], [-170, -60], [179, 80], [-179, -80]]) {
      const [x, y] = evalNode(projNodes('mercator'), 'p', { lng, lat, elev: 0 });
      expect(x).toBeCloseTo(mercatorX(lng), 6);
      expect(y).toBeCloseTo(mercatorY(lat), 5);
    }
  });

  it('normalizes the world to roughly one unit across', () => {
    // The orbit camera's default framing depends on this.
    const [xMin] = evalNode(projNodes('mercator'), 'p', { lng: -180, lat: 0, elev: 0 });
    const [xMax] = evalNode(projNodes('mercator'), 'p', { lng: 180, lat: 0, elev: 0 });
    expect(xMax - xMin).toBeCloseTo(1, 6);
  });

  it('applies worldScale to every component', () => {
    const scaled = evalNode(projNodes('identity', '10'), 'p', { lng: 1, lat: 2, elev: 3 });
    expect(scaled).toEqual([10, 20, 30]);
  });

  it('defaults z to zero when omitted', () => {
    const nodes: Graph['nodes'] = [
      source,
      { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat' },
      render('p'),
    ];
    expect(evalNode(nodes, 'p', { lng: 1, lat: 2 })[2]).toBe(0);
  });
});

describe('wrangle expansion', () => {
  it('rewrites consumers to the last statement, so the graph stays connected', () => {
    // The wrangle's own id disappears; anything pointing at it must be redirected or the
    // graph breaks with "Unknown node id".
    const out = desugar(g([
      source,
      { id: 'w', type: 'wrangle', input: 'src', body: '@P = [lng, lat, 0]; @pscale = pop;' },
      render('w'),
    ]));
    const renderNode = out.nodes.find((n) => n.id === 'out')!;
    expect(out.nodes.some((n) => n.id === 'w')).toBe(false);
    expect((renderNode as { input: string }).input).toBe('w#pscale');
  });

  it('chains statements so order within the body is preserved', () => {
    const out = desugar(g([
      source,
      { id: 'w', type: 'wrangle', input: 'src', body: '@a = 1; @b = 2; @P = [a, b, 0];' },
      render('w'),
    ]));
    const chain = out.nodes.filter((n) => n.id.startsWith('w#')) as { id: string; input: string }[];
    expect(chain.map((n) => n.id)).toEqual(['w#a', 'w#b', 'w#P']);
    expect(chain[0].input).toBe('src');
    expect(chain[1].input).toBe('w#a');
    expect(chain[2].input).toBe('w#b');
  });

  it('registers the ramp when the body calls ramp()', () => {
    expect(desugar(g([
      source,
      { id: 'w', type: 'wrangle', input: 'src', body: 'var t = v; @Cd = ramp(t);', ramp: 'turbo' },
      render('w'),
    ])).ramp).toBe('turbo');
  });

  it('does not register a ramp when the body never calls one', () => {
    expect(desugar(g([
      source,
      { id: 'w', type: 'wrangle', input: 'src', body: '@P = [lng, lat, 0];' },
      render('w'),
    ])).ramp).toBeUndefined();
  });
});

describe('stats expressions', () => {
  it.each([
    ['min', 'minAgg'], ['max', 'maxAgg'], ['mean', 'avg'],
    ['median', 'median'], ['stddev', 'stddev'],
  ] as const)('%s maps to %s', (op, fn) => {
    expect(statExpr(op, 'pop')).toContain(fn);
    expect(columnsOf(parseExpr(statExpr(op, 'pop')))).toEqual(['pop']);
  });

  it('percentiles use quantile_cont with the right fraction', () => {
    expect(statExpr('p01', 'pop')).toContain('0.01');
    expect(statExpr('p99', 'pop')).toContain('0.99');
  });

  it('every op parses as an aggregate expression', () => {
    for (const op of ['min', 'max', 'mean', 'median', 'p01', 'p99', 'stddev'] as const) {
      expect(() => parseExpr(statExpr(op, 'pop')), op).not.toThrow();
    }
  });

  it('publishes a stable parameter name per node and op', () => {
    expect(statParamName('popStats', 'min')).toBe('popStats_min');
    expect(statParamName('a', 'p99')).toBe('a_p99');
  });
});

describe('buildRampLut', () => {
  const RAMPS = Object.keys(RAMP_STOPS) as RampName[];

  it('covers every declared ramp', () => {
    expect(RAMPS.length).toBe(4);
    expect(RAMPS).toEqual(expect.arrayContaining(['viridis', 'magma', 'turbo', 'cividis']));
  });

  it.each(RAMPS)('%s produces a full RGBA table in range', (ramp) => {
    const lut = buildRampLut(ramp);
    expect(lut.length).toBe(256 * 4);
    for (let i = 0; i < lut.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        expect(lut[i + c]).toBeGreaterThanOrEqual(0);
        expect(lut[i + c]).toBeLessThanOrEqual(1);
      }
      expect(lut[i + 3]).toBe(1);
    }
  });

  it.each(RAMPS)('%s begins and ends on its declared stops', (ramp) => {
    const lut = buildRampLut(ramp);
    const stops = RAMP_STOPS[ramp];
    for (let c = 0; c < 3; c++) {
      expect(lut[c]).toBeCloseTo(stops[0][c], 5);
      expect(lut[255 * 4 + c]).toBeCloseTo(stops.at(-1)![c], 5);
    }
  });

  it.each(RAMPS)('%s interpolates without discontinuities', (ramp) => {
    // A jump between samples means the stop indexing is off by one somewhere.
    const lut = buildRampLut(ramp);
    for (let i = 4; i < lut.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(lut[i + c] - lut[i - 4 + c])).toBeLessThan(0.1);
      }
    }
  });

  it('honours a custom size and stays consistent at the ends', () => {
    const small = buildRampLut('viridis', 8);
    expect(small.length).toBe(8 * 4);
    const full = buildRampLut('viridis', 256);
    expect(small[0]).toBeCloseTo(full[0], 5);
    expect(small[7 * 4]).toBeCloseTo(full[255 * 4], 5);
  });
});
