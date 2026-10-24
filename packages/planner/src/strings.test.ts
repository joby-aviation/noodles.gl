import { describe, it, expect } from 'vitest';
import { Table, tableFromArrays, vectorFromArray, Utf8, makeTable } from 'apache-arrow';
import { parseExpr, enginesFor, ExprError } from './expr.js';
import { toSql, SqlParams } from './backends/sql.js';
import { toWgsl } from './backends/wgsl.js';
import { plan, type Schema } from './planner.js';
import { readColumn, readStrings, readValues, runStarts } from './arrow.js';
import type { ColumnTypes } from './analyze.js';
import type { Graph } from './types.js';

describe('string literals', () => {
  it("parse with SQL quoting, where '' escapes a quote", () => {
    expect(parseExpr("'JFK'")).toEqual({ kind: 'str', value: 'JFK' });
    expect(parseExpr("'O''Hare'")).toEqual({ kind: 'str', value: "O'Hare" });
    expect(() => parseExpr("'open")).toThrow(ExprError);
  });

  it('are SQL-only', () => {
    expect([...enginesFor(parseExpr("code == 'JFK'"))]).toEqual(['sql']);
    const e = parseExpr("code == 'O''Hare'");
    expect(toSql(e, new SqlParams()).code).toBe(`("code" = 'O''Hare')`);
    expect(() => toWgsl(e, () => ({ code: 'x', width: 1 }))).toThrow(/SQL-only/);
  });
});

describe('vectors below the top level', () => {
  it('have no SQL form: SQL splits a vector only at the top', () => {
    expect([...enginesFor(parseExpr('[a, b, 0.0]'))].sort()).toEqual(['gpu', 'sql']);
    expect([...enginesFor(parseExpr('v > 0.5 ? [1.0, 0.0, 0.0] : [0.0, 0.0, 1.0]'))]).toEqual(['gpu']);
    expect([...enginesFor(parseExpr('[a, b, 0.0] * 2.0'))]).toEqual(['gpu']);
  });
});

describe('string columns through the planner', () => {
  const schema: Schema = new Map([['lng', 1], ['lat', 1], ['trip', 1]]);
  const types: ColumnTypes = new Map([['lng', 'num'], ['lat', 'num'], ['trip', 'num'], ['code', 'str'], ['name', 'str']]);
  const labels: Graph = {
    params: { airport: { value: 'JFK' } },
    nodes: [
      { id: 'src', type: 'source', dataset: { ref: 't' } },
      { id: 'f', type: 'filter', input: 'src', predicate: 'code != {{airport}}' },
      { id: 'p', type: 'project', input: 'f', mode: 'identity', x: 'lng', y: 'lat' },
      { id: 'txt', type: 'layer', kind: 'text', input: 'p', channels: { text: 'name' } },
    ],
    output: 'txt',
  };

  it('pins a filter reading a string column to SQL, even under gpu-first', () => {
    const p = plan(labels, schema, { policy: 'gpu-first', columnTypes: types });
    expect(p.assignments.find((a) => a.nodeId === 'f')!.engine).toBe('sql');
    expect(p.sqlParams).toEqual(['airport']);
  });

  it('selects a string column uncast and tags its declaration', () => {
    const p = plan(labels, schema, { policy: 'auto', columnTypes: types });
    expect(p.sql).toContain('"name" AS "name"');
    expect(p.sql).not.toContain('CAST("name"');
    expect(p.attributes.find((a) => a.name === 'name')?.type).toBe('str');
  });

  it('rejects a number channel reading a string, and a string channel reading a number', () => {
    const wrong = structuredClone(labels);
    (wrong.nodes[3] as { channels: Record<string, string> }).channels = { text: 'lng' };
    expect(() => plan(wrong, schema, { columnTypes: types })).toThrow(/takes a string/);
    const sized = structuredClone(labels);
    (sized.nodes[3] as { channels: Record<string, string> }).channels = { text: 'name', size: 'code' };
    expect(() => plan(sized, schema, { columnTypes: types })).toThrow(/takes a number/);
  });

  it('carries a string-valued attribute through SQL uncast', () => {
    const g: Graph = {
      nodes: [
        { id: 'src', type: 'source', dataset: { ref: 't' } },
        { id: 'l', type: 'attribute', input: 'src', name: 'label', expr: "lng > 0.0 ? name : 'west'" },
        { id: 'p', type: 'project', input: 'l', mode: 'identity', x: 'lng', y: 'lat' },
        { id: 'txt', type: 'layer', kind: 'text', input: 'p', channels: { text: 'label' } },
      ],
      output: 'txt',
    };
    const p = plan(g, schema, { policy: 'gpu-first', columnTypes: types });
    expect(p.assignments.find((a) => a.nodeId === 'l')!.engine).toBe('sql');
    expect(p.sql).toMatch(/\(CASE WHEN .* THEN "name" ELSE 'west' END\) AS "label"/);
    expect(p.attributes.find((a) => a.name === 'label')?.type).toBe('str');
  });

  it('selects a path id in its native type, never narrowed to f32', () => {
    const g: Graph = {
      nodes: [
        { id: 'src', type: 'source', dataset: { ref: 't' } },
        { id: 'p', type: 'project', input: 'src', mode: 'identity', x: 'lng', y: 'lat' },
        { id: 'path', type: 'layer', kind: 'path', input: 'p', pathId: 'trip' },
      ],
      output: 'path',
    };
    const p = plan(g, schema, { policy: 'auto', columnTypes: types });
    expect(p.sql).toContain('"trip" AS "trip"');
    expect(p.attributes.find((a) => a.name === 'trip')?.type).toBe('raw');
  });
});

describe('arrow readers for non-f32 columns', () => {
  const table = makeTable({ n: new Float32Array([1, 2]) });
  const strings = new Table({ s: vectorFromArray(['a', 'bb'], new Utf8()) });

  it('refuses to cast a string column to f32', () => {
    expect(() => readColumn(strings, 's')).toThrow(/no f32 form/);
    expect(readColumn(table, 'n').tier).toBe('arrow');
  });

  it('reads strings and native values', () => {
    expect(readStrings(strings, 's')).toEqual(['a', 'bb']);
    const big = tableFromArrays({ id: new BigInt64Array([16777217n, 16777216n]) });
    // As f32 these two ids are equal, which is exactly the bug readValues avoids.
    expect(Math.fround(16777217)).toBe(Math.fround(16777216));
    expect(runStarts(readValues(big, 'id'))).toEqual(Uint32Array.from([0, 1]));
  });
});

describe('runStarts', () => {
  it('starts a path at every change of id', () => {
    expect([...runStarts([7, 7, 7, 2, 2, 9])]).toEqual([0, 3, 5]);
    expect([...runStarts([])]).toEqual([]);
    expect([...runStarts(['a', 'a', 'b'])]).toEqual([0, 2]);
  });

  it('numbers kept rows, so a dropped vertex does not leave a hole', () => {
    // Rows 1 and 3 were masked out; indices are into the four kept rows.
    expect([...runStarts([1, 1, 1, 2, 2, 2], [0, 2, 4, 5])]).toEqual([0, 2]);
  });
});
