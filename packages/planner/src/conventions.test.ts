import { describe, it, expect } from 'vitest';
import {
  attributeConventions, isInternal, HOUDINI_CONVENTIONS, type AttributeConventions,
} from './conventions.js';
import { analyze } from './analyze.js';
import { plan } from './planner.js';
import { desugar, type Graph } from './types.js';
import { SCHEMA, STATS } from './fixtures.js';

/**
 * The attribute vocabulary is configuration, not a constant.
 *
 * `P`/`Cd`/`pscale` are a default. What makes this a library rather than a renderer with a
 * planner attached is that a consumer can declare its own names and have them appear
 * everywhere — in the desugared graph, in the generated SQL, in the kernel, and in the
 * resolved render channels — without a single call site defaulting behind its back.
 */

/** A deliberately different vocabulary, including a differently-spelled internal prefix. */
const GL: Partial<AttributeConventions> = {
  position: 'aPosition',
  color: 'aColor',
  size: 'aRadius',
  opacity: 'aOpacity',
  mask: '$keep',
  internalPrefix: '$',
};

/**
 * A graph that names no channel explicitly, so every name comes from the conventions. A graph
 * that spells out `position: 'P'` is overriding them, which is legal and separately tested.
 */
function unnamedGraph(): Graph {
  return {
    params: {
      cut: { value: 60, kind: 'value', changeRate: 0.2 },
      k: { value: 1.6, kind: 'value', changeRate: 8 },
    },
    nodes: [
      { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1_000_000 } },
      { id: 'fast', type: 'filter', input: 'src', predicate: 'speed > {{cut}}' },
      { id: 'proj', type: 'project', input: 'fast', mode: 'mercator', x: 'lng', y: 'lat' },
      {
        id: 'color', type: 'colorscale', input: 'proj', expr: 'elevation',
        ramp: 'viridis', domain: ['0', '900'],
      },
      { id: 'out', type: 'render', input: 'color', mode: 'points' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('attributeConventions', () => {
  it('defaults to the Houdini vocabulary', () => {
    expect(attributeConventions()).toEqual(HOUDINI_CONVENTIONS);
  });

  it('merges a partial override without dropping the rest', () => {
    const c = attributeConventions({ color: 'tint' });
    expect(c.color).toBe('tint');
    expect(c.position).toBe('P');
    expect(c.mask).toBe('__mask');
  });

  it('rejects a render channel that starts with the internal prefix', () => {
    // This is the expensive mistake: an internal attribute is never given a buffer, so the
    // symptom is a render pass binding an attribute that does not exist — reported by WebGPU
    // at submit time, nowhere near the graph that named it.
    expect(() => attributeConventions({ color: '__tint' }))
      .toThrow(/starts with the internal prefix/);
  });

  it('rejects a mask that is not internal', () => {
    // A visible mask would be uploaded and reported as a real attribute.
    expect(() => attributeConventions({ mask: 'keep' }))
      .toThrow(/must start with the internal prefix/);
  });

  it('rejects two channels sharing a name', () => {
    expect(() => attributeConventions({ size: 'P' })).toThrow(/both 'P'/);
  });

  it('rejects an empty channel name or prefix', () => {
    expect(() => attributeConventions({ position: '' })).toThrow(/non-empty/);
    expect(() => attributeConventions({ internalPrefix: '' })).toThrow(/non-empty/);
  });

  it('accepts a wholly different vocabulary', () => {
    const c = attributeConventions(GL);
    expect(c.position).toBe('aPosition');
    expect(c.internalPrefix).toBe('$');
  });

  it('does not mutate the frozen default', () => {
    attributeConventions({ position: 'other' });
    expect(HOUDINI_CONVENTIONS.position).toBe('P');
  });
});

describe('isInternal', () => {
  it('follows the declared prefix, not a hardcoded one', () => {
    const gl = attributeConventions(GL);
    expect(isInternal('$tmp', gl)).toBe(true);
    expect(isInternal('__tmp', gl)).toBe(false);
    expect(isInternal('__tmp', HOUDINI_CONVENTIONS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Threading through the pipeline
// ---------------------------------------------------------------------------

describe('desugar honours the vocabulary', () => {
  it('names the project output and the colorscale output from the conventions', () => {
    const { nodes } = desugar(unnamedGraph(), attributeConventions(GL));
    const written = nodes
      .filter((n) => n.type === 'attribute')
      .map((n) => (n as { name: string }).name);
    expect(written).toContain('aPosition');
    expect(written).toContain('aColor');
    expect(written).not.toContain('P');
    expect(written).not.toContain('Cd');
  });

  it('defaults to Houdini when given no conventions', () => {
    const { nodes } = desugar(unnamedGraph());
    const written = nodes
      .filter((n) => n.type === 'attribute')
      .map((n) => (n as { name: string }).name);
    expect(written).toContain('P');
    expect(written).toContain('Cd');
  });
});

describe('analyze resolves every channel once', () => {
  it('reports resolved names, never undefined', () => {
    const a = analyze(unnamedGraph(), SCHEMA);
    expect(a.channels).toMatchObject({
      mode: 'points', position: 'P', color: 'Cd', size: 'pscale', opacity: 'Alpha',
    });
  });

  it('applies a custom vocabulary to the channels', () => {
    const a = analyze(unnamedGraph(), SCHEMA, GL);
    expect(a.channels).toMatchObject({
      position: 'aPosition', color: 'aColor', size: 'aRadius', opacity: 'aOpacity',
    });
    expect(a.conventions.mask).toBe('$keep');
  });

  it('lets an explicit render-node channel override the convention', () => {
    // The graph is more specific than the vocabulary, so it wins.
    const g = unnamedGraph();
    (g.nodes.find((n) => n.id === 'out') as { color: string }).color = 'explicit';
    const a = analyze(g, SCHEMA, GL);
    expect(a.channels.color).toBe('explicit');
    expect(a.channels.position).toBe('aPosition');
  });

  it('marks internals by the declared prefix', () => {
    const g = unnamedGraph();
    g.nodes.splice(3, 0, {
      id: 'tmp', type: 'attribute', input: 'proj', name: '$scratch', expr: 'elevation * 2',
    });
    (g.nodes.find((n) => n.id === 'color') as { input: string }).input = 'tmp';
    const a = analyze(g, SCHEMA, GL);
    expect(a.order.find((n) => n.name === '$scratch')?.internal).toBe(true);
  });
});

describe('a plan carries the custom names all the way through', () => {
  const physical = plan(unnamedGraph(), SCHEMA, {
    policy: 'cost', stats: STATS, params: { cut: 60, k: 1.6 }, conventions: GL,
  });

  it('resolves the plan-level channels', () => {
    expect(physical.channels.position).toBe('aPosition');
    expect(physical.conventions.internalPrefix).toBe('$');
  });

  it('declares attributes under the custom names and none under the defaults', () => {
    const names = physical.attributes.map((a) => a.name);
    expect(names).toContain('aPosition');
    expect(names).not.toContain('P');
    expect(names).not.toContain('Cd');
  });

  it('generates a kernel that writes the custom names', () => {
    const writes = physical.kernels.flatMap((k) => k.writes);
    // The colorscale is the ramp node, so it is GPU-placed and writes the colour attribute.
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w.startsWith('a') || w.startsWith('$')).toBe(true);
  });

  it('uses the custom mask name when a filter stays out of SQL', () => {
    // gpu-first forces the filter to be a discard mask rather than a WHERE clause, which is
    // the only path that materializes the mask attribute.
    const masked = plan(unnamedGraph(), SCHEMA, {
      policy: 'gpu-first', stats: STATS, params: { cut: 60, k: 1.6 }, conventions: GL,
    });
    expect(masked.maskAttribute).toBe('$keep');
    expect(masked.gpuStage.some((s) => s.name === '$keep')).toBe(true);
  });

  it('never mentions the default names anywhere in the generated code', () => {
    const code = [physical.sql, ...physical.kernels.map((k) => k.code)].join('\n');
    // Word-boundary matches, so `Cd` inside a longer identifier does not count.
    for (const name of ['P', 'Cd', 'pscale', 'Alpha', '__mask']) {
      expect(new RegExp(`\\b${name.replace('$', '\\$')}\\b`).test(code), name).toBe(false);
    }
  });

  it('plans identically under the default vocabulary, modulo names', () => {
    // Renaming attributes must not change *placement* — it is a spelling change, not a cost
    // change. If it did, the vocabulary would be leaking into the optimizer.
    const houdini = plan(unnamedGraph(), SCHEMA, {
      policy: 'cost', stats: STATS, params: { cut: 60, k: 1.6 },
    });
    expect(physical.explain.chosen).toEqual(houdini.explain.chosen);
    expect(physical.kernels.length).toBe(houdini.kernels.length);
    expect(physical.attributes.length).toBe(houdini.attributes.length);
    expect(physical.explain.estimatedRows).toBe(houdini.explain.estimatedRows);
  });
});
