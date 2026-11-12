import { describe, it, expect } from 'vitest';
import { Table, tableFromArrays, vectorFromArray, Float32 } from 'apache-arrow';
import { readColumn, readVectorColumns, ringStarts } from './arrow.js';
import { materialize } from './cpu-stage.js';

/**
 * Tier detection is the part of the upload path with a right answer, so it is the part
 * worth testing. The regression that motivated most of these: Arrow JS returns a
 * zero-length `nullBitmap` rather than undefined for a column with no nulls, and naively
 * bit-testing that marks every row null.
 */

describe('readColumn tier detection', () => {
  it('single-chunk Float32 with no nulls is zero-copy', () => {
    const table = tableFromArrays({ a: new Float32Array([1, 2, 3, 4]) });
    const up = readColumn(table, 'a');
    expect(up.tier).toBe('arrow');
    expect(up.convertMs).toBe(0);
    expect(up.nullCount).toBe(0);
    expect([...up.data!]).toEqual([1, 2, 3, 4]);
    // The returned view must alias the column's own memory, not a copy of it.
    const source = table.getChild('a')!.data[0].values as Float32Array;
    expect(up.data!.buffer).toBe(source.buffer);
  });

  it('Float64 is narrowed on the cpu', () => {
    const table = tableFromArrays({ b: new Float64Array([1.5, 2.5, 3.5]) });
    const up = readColumn(table, 'b');
    expect(up.tier).toBe('cast');
    expect([...up.data!]).toEqual([1.5, 2.5, 3.5]);
  });

  it('integers are narrowed on the cpu', () => {
    const table = tableFromArrays({ i: new Int32Array([10, 20, 30]) });
    const up = readColumn(table, 'i');
    expect(up.tier).toBe('cast');
    expect([...up.data!]).toEqual([10, 20, 30]);
  });

  it('a column with no nulls is not misread as all-null', () => {
    // The exact regression: an empty nullBitmap must not be treated as "all null".
    const table = tableFromArrays({ b: new Float64Array([7, 8, 9]) });
    const chunk = table.getChild('b')!.data[0];
    expect(chunk.nullCount).toBe(0);
    const up = readColumn(table, 'b');
    expect(up.nullCount).toBe(0);
    expect([...up.data!].every(Number.isFinite)).toBe(true);
  });

  it('nulls become NaN and are counted', () => {
    const table = new Table({ s: vectorFromArray([1, null, 3, null], new Float32()) });
    const up = readColumn(table, 's');
    expect(up.tier).toBe('cast');
    expect(up.nullCount).toBe(2);
    const data = [...up.data!];
    expect(data[0]).toBe(1);
    expect(Number.isNaN(data[1])).toBe(true);
    expect(data[2]).toBe(3);
    expect(Number.isNaN(data[3])).toBe(true);
  });

  it('multi-chunk Float32 with no nulls takes the chunked path, not a cpu pass', () => {
    const t1 = tableFromArrays({ a: new Float32Array([1, 2]) });
    const t2 = tableFromArrays({ a: new Float32Array([3, 4, 5]) });
    const table = new Table([...t1.batches, ...t2.batches]);
    expect(table.numRows).toBe(5);

    const up = readColumn(table, 'a');
    expect(up.tier).toBe('chunked');
    expect(up.chunkCount).toBe(2);
    expect(up.convertMs).toBe(0);
    expect(up.data).toBeUndefined();
    expect(up.chunks!.map((c) => [...c])).toEqual([[1, 2], [3, 4, 5]]);
    // Concatenation is the GPU's job, but materializing must produce the right order.
    expect([...materialize(up)]).toEqual([1, 2, 3, 4, 5]);
  });

  it('reports the arrow type and row count', () => {
    const table = tableFromArrays({ a: new Float32Array([1, 2, 3]) });
    const up = readColumn(table, 'a');
    expect(up.arrowType).toBe('Float32');
    expect(up.rows).toBe(3);
  });

  it('names the available columns when one is missing', () => {
    const table = tableFromArrays({ a: new Float32Array([1]) });
    expect(() => readColumn(table, 'nope')).toThrow(/Have: a/);
  });
});

describe('readVectorColumns', () => {
  it('interleaves components in column order', () => {
    const table = tableFromArrays({
      P_0: new Float32Array([1, 4]),
      P_1: new Float32Array([2, 5]),
      P_2: new Float32Array([3, 6]),
    });
    const up = readVectorColumns(table, ['P_0', 'P_1', 'P_2']);
    expect(up.tier).toBe('cast');
    expect([...up.data!]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('interleaves across chunk boundaries', () => {
    const mk = (a: number[], b: number[]) =>
      tableFromArrays({ P_0: new Float32Array(a), P_1: new Float32Array(b) });
    const table = new Table([...mk([1, 3], [2, 4]).batches, ...mk([5], [6]).batches]);
    const up = readVectorColumns(table, ['P_0', 'P_1']);
    expect([...up.data!]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('a single name is just readColumn', () => {
    const table = tableFromArrays({ a: new Float32Array([1, 2]) });
    expect(readVectorColumns(table, ['a']).tier).toBe('arrow');
  });
});

describe('readVectorColumns with hiLo', () => {
  it('keeps a double past f32 precision as hi + lo, and the f32 view unchanged', () => {
    // 0.1234567890123 needs ~41 bits; f32 holds 24.
    const x = [0.1234567890123, -179.99999999, 1e-9 + 0.5];
    const y = [42.000000001, 0, -0.25];
    const table = tableFromArrays({ P_0: new Float64Array(x), P_1: new Float64Array(y) });
    const up = readVectorColumns(table, ['P_0', 'P_1'], { hiLo: true });
    expect(up.tier).toBe('cast');
    expect(up.hiLo).toHaveLength(3 * 2 * 2);
    for (let i = 0; i < 3; i++) {
      const [hx, hy, lx, ly] = up.hiLo!.subarray(i * 4, i * 4 + 4);
      expect(up.data![i * 2]).toBe(Math.fround(x[i]));
      expect(hx).toBe(Math.fround(x[i]));
      expect(Math.abs(hx + lx - x[i])).toBeLessThan(1e-13 * Math.max(1, Math.abs(x[i])));
      expect(Math.abs(hy + ly - y[i])).toBeLessThan(1e-13 * Math.max(1, Math.abs(y[i])));
    }
    // And the f32 view alone really does lose it, or this test proves nothing.
    expect(Math.abs(up.data![0] - x[0])).toBeGreaterThan(1e-9);
  });

  it('nulls become NaN in both halves', () => {
    const table = new Table({
      a: vectorFromArray([1.5, null, 3.5]),
      b: vectorFromArray([0.25, 0.5, null]),
    });
    const up = readVectorColumns(table, ['a', 'b'], { hiLo: true });
    expect(up.nullCount).toBe(2);
    expect(Number.isNaN(up.hiLo![4])).toBe(true);
    expect(Number.isNaN(up.hiLo![6])).toBe(true);
    expect(Number.isNaN(up.hiLo![9])).toBe(true);
    expect(up.hiLo![0]).toBe(1.5);
  });
});

describe('ringStarts', () => {
  it('starts a ring where the polygon or the ring changes', () => {
    const poly = [1, 1, 1, 1, 1, 1, 2, 2, 2];
    const ring = [0, 0, 0, 1, 1, 1, 0, 0, 0];
    expect([...ringStarts(poly, ring)]).toEqual([0, 3, 6]);
    // Polygon 2 reusing ring id 1 still starts a new run at its first row.
    expect([...ringStarts([1, 1, 2, 2], [1, 1, 1, 1])]).toEqual([0, 2]);
  });

  it('without ring ids, rings are polygons', () => {
    expect([...ringStarts([5, 5, 6], undefined)]).toEqual([0, 2]);
  });

  it('counts in kept rows, as the mask leaves them', () => {
    expect([...ringStarts([1, 1, 1, 1], [0, 0, 1, 1], [0, 2, 3])]).toEqual([0, 1]);
  });
});
