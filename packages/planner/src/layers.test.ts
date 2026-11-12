import { describe, it, expect } from 'vitest';
import { plan, PlanError, type Schema } from './planner.js';
import { analyze, externalAttributes } from './analyze.js';
import { targetCaps } from './target.js';
import { resolveProps, propParam } from './layers.js';
import type { Graph } from './types.js';

const schema: Schema = new Map([
  ['lng', 1], ['lat', 1], ['lng2', 1], ['lat2', 1], ['mag', 1], ['depth', 1], ['trip', 1], ['t', 1],
]);
const source = { id: 'src', type: 'source', dataset: { ref: 'test', estimatedRows: 1000 } } as const;
const webgl2 = { caps: targetCaps('deck-webgl2', undefined) };

describe('regressions found while generalizing the output node', () => {
  it('groups by a computed attribute by computing it in a subquery first', () => {
    // Before the fix the SQL-stage cell key was never emitted, so GROUP BY named a column
    // that did not exist and DuckDB rejected the query.
    const g: Graph = {
      params: { cell: { value: 0.01 } },
      nodes: [
        source,
        { id: 'ix', type: 'attribute', input: 'src', name: 'ix', expr: 'floor(lng / {{cell}})' },
        { id: 'iy', type: 'attribute', input: 'ix', name: 'iy', expr: 'floor(lat / {{cell}})' },
        { id: 'agg', type: 'aggregate', input: 'iy', groupBy: ['ix', 'iy'], aggs: [{ name: 'n', expr: 'count()' }] },
        { id: 'p', type: 'attribute', input: 'agg', name: 'P', expr: '[ix * {{cell}}, iy * {{cell}}, 0.0]' },
        { id: 'out', type: 'render', input: 'p', mode: 'points' },
      ],
    };
    const p = plan(g, schema, 'sql-first');
    expect(p.sql).toMatch(/FROM \(SELECT \*, .*AS "ix".*AS "iy" FROM "src"\) AS "pre".* GROUP BY "ix", "iy"/);
    // One parameter, one placeholder, however many times it appears.
    expect(p.sqlParams).toEqual(['cell']);
  });

  it('excludes a source column the pre-aggregate attribute overwrites', () => {
    const g: Graph = {
      nodes: [
        source,
        { id: 'r', type: 'attribute', input: 'src', name: 'mag', expr: 'round(mag)' },
        { id: 'agg', type: 'aggregate', input: 'r', groupBy: ['mag'], aggs: [{ name: 'n', expr: 'count()' }] },
        { id: 'p', type: 'attribute', input: 'agg', name: 'P', expr: '[mag, n, 0.0]' },
        { id: 'out', type: 'render', input: 'p', mode: 'points' },
      ],
    };
    expect(plan(g, schema, 'sql-first').sql).toContain('SELECT * EXCLUDE ("mag"), ');
  });

  it('selects a source column bound straight to a channel', () => {
    const g: Graph = {
      nodes: [
        source,
        { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat' },
        { id: 'out', type: 'render', input: 'p', mode: 'points', size: 'mag' },
      ],
    };
    const p = plan(g, schema, 'auto');
    expect(p.sql).toContain('AS "mag"');
    expect(p.attributes.some((a) => a.name === 'mag')).toBe(true);
  });
});

describe('layer outputs', () => {
  const arcs: Graph = {
    params: { minMag: { value: 2 }, time: { value: 0, changeRate: 60 } },
    nodes: [
      source,
      { id: 'f', type: 'filter', input: 'src', predicate: 'mag > {{minMag}}' },
      { id: 'a', type: 'attribute', input: 'f', name: 'from', expr: '[lng, lat, 0.0]' },
      { id: 'b', type: 'attribute', input: 'a', name: 'to', expr: '[lng2, lat2, 0.0]' },
      {
        id: 'arcs', type: 'layer', kind: 'arc', input: 'b',
        channels: { sourcePosition: 'from', targetPosition: 'to', width: 'mag' },
        props: { opacity: 0.5, greatCircle: true, currentTime: '{{time}}' },
      },
    ],
    output: 'arcs',
  };

  it('resolves every channel once and publishes the bindings on the plan', () => {
    const p = plan(arcs, schema, { policy: 'auto', ...webgl2 });
    expect(p.layer?.kind).toBe('arc');
    expect(p.layer?.bindings.map((b) => [b.channel, b.attribute])).toEqual([
      ['sourcePosition', 'from'], ['targetPosition', 'to'], ['width', 'mag'],
    ]);
    // Every binding reaches an attribute the runtime can read.
    for (const b of p.layer!.bindings) expect(p.attributes.some((a) => a.name === b.attribute)).toBe(true);
  });

  it('treats a prop parameter as nothing the plan has to bind', () => {
    const p = plan(arcs, schema, { policy: 'auto', ...webgl2 });
    expect(p.layer?.propParams).toEqual(['time']);
    expect(p.sqlParams).not.toContain('time');
    expect(p.uniformParams).not.toContain('time');
  });

  it('counts layer bindings as external, so a kernel keeps their buffers', () => {
    const a = analyze(arcs, schema);
    const ext = externalAttributes(a);
    expect(ext.has('from')).toBe(true);
    expect(ext.has('to')).toBe(true);
    const p = plan(arcs, schema, 'gpu-first');
    expect(p.kernels[0].writes).toEqual(expect.arrayContaining(['from', 'to']));
  });

  it('falls back to convention attributes for channels the layer leaves unbound', () => {
    const g: Graph = {
      nodes: [
        source,
        { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat' },
        { id: 'dots', type: 'layer', kind: 'scatter', input: 'p' },
      ],
      output: 'dots',
    };
    const p = plan(g, schema, 'auto');
    expect(p.layer?.bindings.map((b) => b.channel)).toEqual(['position']);
    expect(p.layer?.bindings[0].attribute).toBe('P');
  });

  it('orders vertex layers by path id first, on the outermost statement', () => {
    const g: Graph = {
      nodes: [
        source,
        { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat' },
        { id: 'trips', type: 'layer', kind: 'trips', input: 'p', pathId: 'trip', orderBy: ['t'], channels: { timestamp: 't' } },
      ],
      output: 'trips',
    };
    const p = plan(g, schema, 'auto');
    expect(p.sql.endsWith(' ORDER BY "trip", "t"')).toBe(true);
    expect(p.attributes.map((a) => a.name)).toEqual(expect.arrayContaining(['trip', 't']));
  });

  it('rejects a vertex layer without a path id, an unknown channel, and a missing required one', () => {
    const base = [source, { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat' }] as Graph['nodes'];
    const bad = (layer: Graph['nodes'][number]) => () => plan({ nodes: [...base, layer], output: layer.id }, schema);
    expect(bad({ id: 'l', type: 'layer', kind: 'path', input: 'p' })).toThrow(/needs 'pathId'/);
    expect(bad({ id: 'l', type: 'layer', kind: 'scatter', input: 'p', channels: { nope: 'mag' } })).toThrow(/no channel 'nope'/);
    expect(bad({ id: 'l', type: 'layer', kind: 'arc', input: 'p', channels: { sourcePosition: 'P' } })).toThrow(/needs a 'targetPosition'/);
    expect(bad({ id: 'l', type: 'layer', kind: 'scatter', input: 'p', channels: { position: 'ghost' } })).toThrow(PlanError);
  });

  it('cannot sort by an attribute only a later stage computes', () => {
    const g: Graph = {
      nodes: [
        source,
        { id: 'c', type: 'colorscale', input: 'src', expr: 'mag', ramp: 'viridis', domain: ['0', '9'] },
        { id: 'p', type: 'project', input: 'c', mode: 'identity', x: 'lng', y: 'lat' },
        { id: 'l', type: 'layer', kind: 'scatter', input: 'p', orderBy: ['Cd'] },
      ],
      output: 'l',
    };
    expect(() => plan(g, schema, 'auto')).toThrow(/cannot order by 'Cd'/);
  });
});

describe('props', () => {
  it('reads a parameter only from an exact {{name}} reference', () => {
    expect(propParam('{{time}}')).toBe('time');
    expect(propParam('{{ time }}')).toBe('time');
    expect(propParam('time')).toBeUndefined();
    expect(propParam('{{a}} + 1')).toBeUndefined();
    expect(resolveProps({ t: '{{time}}', o: 0.5, units: 'pixels' }, { time: 12 })).toEqual({ t: 12, o: 0.5, units: 'pixels' });
  });
});
