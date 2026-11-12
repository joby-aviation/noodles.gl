/**
 * Arrow column -> GPU buffer, with the honest cost recorded.
 *
 * The measured finding that shaped this file: **DuckDB-Wasm never returns one
 * contiguous chunk.** A 300k-row result arrives as ~147 record batches of 2048 rows.
 * So the appealing story — "the Arrow column IS the attribute buffer, byte for byte" —
 * is false for DuckDB output in practice, and any design that assumes a single
 * `Float32Array` per column will silently fall back to a full CPU pass.
 *
 * That does not mean a JS loop is unavoidable. It means the concatenation belongs to
 * the GPU copy engine rather than to JS:
 *
 *   'arrow'   single chunk, Float32, no nulls -> one writeBuffer over the column's own
 *             memory. Rare from DuckDB; common if you hand-build the table.
 *   'chunked' many chunks, Float32, no nulls  -> one writeBuffer per chunk at the right
 *             byte offset. N GPU copies, zero JS element loops. This is the realistic
 *             fast path.
 *   'cast'    Float64 / integer / nullable    -> one JS pass into a fresh Float32Array.
 *             Unavoidable: WGSL has no f64, and Arrow's validity bitmap has to be
 *             consumed somewhere. Nulls become NaN and the shaders discard them.
 */

import type { Table, Vector } from 'apache-arrow';

export type Tier = 'arrow' | 'chunked' | 'cast';

export interface ColumnUpload {
  tier: Tier;
  /** Contiguous values for the 'arrow' and 'cast' tiers. */
  data?: Float32Array;
  /** Per-chunk views in row order, for the 'chunked' tier. */
  chunks?: Float32Array[];
  /**
   * The same values as `data` in the `hilo` layout (planner `packing.ts`): per row, the f32
   * high halves then the low halves. Present when a vector was read with `hiLo`, which is how
   * a DOUBLE position keeps its precision on the GPU. `data` stays the f32 view, so the CPU
   * consumers that read it are unaffected.
   */
  hiLo?: Float32Array;
  chunkCount: number;
  /** Rows that were null in Arrow and are NaN on the GPU. */
  nullCount: number;
  /** Milliseconds of CPU element-wise work. 0 for 'arrow' and 'chunked'. */
  convertMs: number;
  arrowType: string;
  rows: number;
}

export function readColumn(table: Table, name: string): ColumnUpload {
  const vector = table.getChild(name) as Vector | null;
  if (!vector) {
    throw new Error(
      `Column '${name}' not present in query result. Have: ${table.schema.fields.map((f) => f.name).join(', ')}`,
    );
  }
  const arrowType = String(vector.type);
  // A string column's `values` is its UTF-8 byte buffer, so the cast loop below would read
  // bytes as numbers and upload plausible-looking garbage with no error at all.
  if (NON_NUMERIC.test(arrowType)) {
    throw new Error(
      `Column '${name}' is ${arrowType}, which has no f32 form. Read it with readStrings or readValues.`,
    );
  }
  const chunkCount = vector.data.length;
  const rows = table.numRows;

  // Can every chunk be handed to the GPU as-is?
  const allFloat32NoNulls =
    vector.nullCount === 0 &&
    vector.data.every((d) => d.values instanceof Float32Array && d.nullCount === 0);

  if (allFloat32NoNulls && chunkCount === 1) {
    const d = vector.data[0];
    const values = d.values as Float32Array;
    return {
      tier: 'arrow',
      // A subarray is a view onto the same ArrayBuffer, not a copy.
      data: values.subarray(d.offset, d.offset + d.length),
      chunkCount,
      nullCount: 0,
      convertMs: 0,
      arrowType,
      rows,
    };
  }

  if (allFloat32NoNulls) {
    return {
      tier: 'chunked',
      chunks: vector.data.map((d) => (d.values as Float32Array).subarray(d.offset, d.offset + d.length)),
      chunkCount,
      nullCount: 0,
      convertMs: 0,
      arrowType,
      rows,
    };
  }

  // --- the genuine CPU pass ------------------------------------------------
  const started = performance.now();
  const out = new Float32Array(rows);
  let nullCount = 0;
  let cursor = 0;

  for (const chunk of vector.data) {
    const values = chunk.values as ArrayLike<number> | BigInt64Array | BigUint64Array;
    const offset = chunk.offset;
    const len = chunk.length;

    // Arrow JS hands back a zero-length Uint8Array rather than undefined when a chunk
    // has no nulls. Testing bits against that reads `undefined`, which looks like
    // "null" for every row — so gate on the null count, not the bitmap's existence.
    const bitmap = chunk.nullCount > 0 && chunk.nullBitmap && chunk.nullBitmap.length > 0
      ? chunk.nullBitmap
      : undefined;

    if (values instanceof BigInt64Array || values instanceof BigUint64Array) {
      // 64-bit integers exceed f32's exact range; the precision loss is real and
      // deliberate, not an oversight.
      for (let i = 0; i < len; i++) {
        if (bitmap && !bitSet(bitmap, offset + i)) { out[cursor + i] = NaN; nullCount++; continue; }
        out[cursor + i] = Number(values[offset + i]);
      }
    } else {
      for (let i = 0; i < len; i++) {
        if (bitmap && !bitSet(bitmap, offset + i)) { out[cursor + i] = NaN; nullCount++; continue; }
        out[cursor + i] = (values as ArrayLike<number>)[offset + i];
      }
    }
    cursor += len;
  }

  return {
    tier: 'cast',
    data: out,
    chunkCount,
    nullCount,
    convertMs: performance.now() - started,
    arrowType,
    rows,
  };
}

/**
 * Interleave several scalar columns into one packed attribute (`P_0,P_1,P_2` -> `P`).
 *
 * This is the price of doing vector math in SQL: SQL columns are scalars, so a vec3
 * always arrives as separate buffers and must be interleaved on the CPU — and there is
 * no chunked shortcut, because the destination stride is not the source stride. A
 * kernel that produces the same vec3 writes it packed in the first place. Worth knowing
 * before deciding to push position math into SQL.
 */
export function readVectorColumns(
  table: Table,
  names: string[],
  options: { hiLo?: boolean } = {},
): ColumnUpload {
  if (options.hiLo) return readVectorHiLo(table, names);
  if (names.length === 1) return readColumn(table, names[0]);
  const started = performance.now();
  const parts = names.map((n) => readColumn(table, n));
  const rows = table.numRows;
  const width = names.length;
  const out = new Float32Array(rows * width);

  for (let c = 0; c < width; c++) {
    const part = parts[c];
    if (part.data) {
      const src = part.data;
      for (let i = 0; i < rows; i++) out[i * width + c] = src[i];
    } else {
      let row = 0;
      for (const chunk of part.chunks!) {
        for (let i = 0; i < chunk.length; i++) out[(row + i) * width + c] = chunk[i];
        row += chunk.length;
      }
    }
  }

  return {
    tier: 'cast',
    data: out,
    chunkCount: Math.max(...parts.map((p) => p.chunkCount)),
    nullCount: parts.reduce((s, p) => s + p.nullCount, 0),
    convertMs: performance.now() - started,
    arrowType: `interleaved(${parts.map((p) => p.arrowType).join(', ')})`,
    rows,
  };
}

/**
 * `readVectorColumns` with the high/low split, in the same single pass over each column.
 *
 * Reads the native values rather than going through `readColumn`, which would narrow to f32
 * first and throw the low half away before it could be kept.
 */
function readVectorHiLo(table: Table, names: string[]): ColumnUpload {
  const started = performance.now();
  const rows = table.numRows;
  const width = names.length;
  const data = new Float32Array(rows * width);
  const hiLo = new Float32Array(rows * width * 2);
  let nullCount = 0;
  let chunkCount = 0;
  const types: string[] = [];

  for (let c = 0; c < width; c++) {
    const vector = table.getChild(names[c]) as Vector | null;
    if (!vector) throw new Error(`Column '${names[c]}' not present in query result`);
    types.push(String(vector.type));
    if (NON_NUMERIC.test(String(vector.type))) {
      throw new Error(`Column '${names[c]}' is ${String(vector.type)}, which has no numeric form`);
    }
    chunkCount = Math.max(chunkCount, vector.data.length);
    let row = 0;
    for (const chunk of vector.data) {
      const values = chunk.values as ArrayLike<number> | BigInt64Array | BigUint64Array;
      const big = values instanceof BigInt64Array || values instanceof BigUint64Array;
      // Gate on the null count, not the bitmap's existence; see `readColumn`.
      const bitmap = chunk.nullCount > 0 && chunk.nullBitmap && chunk.nullBitmap.length > 0
        ? chunk.nullBitmap
        : undefined;
      for (let i = 0; i < chunk.length; i++, row++) {
        let v: number;
        if (bitmap && !bitSet(bitmap, chunk.offset + i)) { v = NaN; nullCount++; }
        else v = big ? Number((values as BigInt64Array)[chunk.offset + i]) : (values as ArrayLike<number>)[chunk.offset + i];
        const hi = Math.fround(v);
        data[row * width + c] = hi;
        hiLo[row * width * 2 + c] = hi;
        hiLo[row * width * 2 + width + c] = v - hi;
      }
    }
  }

  return {
    tier: 'cast',
    data,
    hiLo,
    chunkCount,
    nullCount,
    convertMs: performance.now() - started,
    arrowType: `hilo(${types.join(', ')})`,
    rows,
  };
}

const NON_NUMERIC = /Utf8|Binary|List|Struct|Map|Union/i;

/** A string column as JS strings, nulls as ''. For text channels and labels. */
export function readStrings(table: Table, name: string): string[] {
  const vector = table.getChild(name) as Vector | null;
  if (!vector) throw new Error(`Column '${name}' not present in query result`);
  const out = new Array<string>(vector.length);
  let i = 0;
  // Iterating the vector walks every record batch; there are many (see the file header).
  for (const v of vector) out[i++] = v == null ? '' : String(v);
  return out;
}

/**
 * A column's values in their native JS type — number, bigint or string — without narrowing.
 * What a path id is read with, because an f32 id merges distinct paths above 2^24.
 */
export function readValues(table: Table, name: string): unknown[] {
  const vector = table.getChild(name) as Vector | null;
  if (!vector) throw new Error(`Column '${name}' not present in query result`);
  const out = new Array<unknown>(vector.length);
  let i = 0;
  for (const v of vector) out[i++] = v;
  return out;
}

/**
 * Start index of every run of equal ids: deck's `startIndices` for path and trips layers.
 *
 * `keep` restricts to the rows that survived a discard mask, in which case indices are into
 * the kept rows, so a dropped vertex re-segments its path rather than leaving a hole in the
 * numbering. Rows must already be ordered by id — the planner emits `ORDER BY pathId` for
 * vertex layers — or one path will come back as several.
 */
export function runStarts(ids: ArrayLike<unknown>, keep?: ArrayLike<number>): Uint32Array {
  const n = keep ? keep.length : ids.length;
  const starts: number[] = [];
  let prev: unknown = Symbol('none');
  for (let j = 0; j < n; j++) {
    const id = ids[keep ? keep[j] : j];
    if (id !== prev) {
      starts.push(j);
      prev = id;
    }
  }
  return Uint32Array.from(starts);
}

/**
 * Ring starts for polygon layers: a new run wherever the polygon id or the ring id changes,
 * over the rows that `keep` retains. Without ring ids every polygon is one ring and this is
 * `runStarts(pathIds)`.
 */
export function ringStarts(
  pathIds: ArrayLike<unknown>,
  ringIds: ArrayLike<unknown> | undefined,
  keep?: ArrayLike<number>,
): Uint32Array {
  if (!ringIds) return runStarts(pathIds, keep);
  const n = keep ? keep.length : pathIds.length;
  const starts: number[] = [];
  let prevPath: unknown = Symbol('none');
  let prevRing: unknown = Symbol('none');
  for (let j = 0; j < n; j++) {
    const i = keep ? keep[j] : j;
    if (pathIds[i] !== prevPath || ringIds[i] !== prevRing) {
      starts.push(j);
      prevPath = pathIds[i];
      prevRing = ringIds[i];
    }
  }
  return Uint32Array.from(starts);
}

function bitSet(bitmap: Uint8Array, index: number): boolean {
  return (bitmap[index >> 3] & (1 << (index & 7))) !== 0;
}
