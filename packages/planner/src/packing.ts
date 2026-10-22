/**
 * GPU storage formats other than f32 per component, and the rules for when each applies.
 *
 * Two ideas from CesiumJS's buffer primitives (FINDINGS §15):
 *
 * `rgba8`: the color channel packed into one u32 per row. A `vec3` color is otherwise 12
 * bytes a row for a value the screen shows at 8 bits a channel; 5M rows of `Cd` drop from
 * 60 MB to 20 MB. Four bytes a row is also what deck's WebGPU path can bind (`unorm8x4`); a
 * 3-component color makes it derive `unorm8x3`, which is not a WebGPU vertex format.
 *
 * `hilo`: the position channel as two f32s per component, high and low, laid out per row as
 * `[hi.xyz, lo.xyz]`. `hi + lo` carries about 48 bits of mantissa, so a position DuckDB
 * computed as DOUBLE survives the trip to the GPU, and the points shader subtracts the camera
 * target from each half before projecting (relative to eye). This is Cesium's
 * `EncodedCartesian3`, and it is byte for byte deck's fp64 attribute layout on WebGPU (a
 * 24-byte stride), so deck binds a `hilo` buffer as `getPosition` without a conversion.
 *
 * The rules are stated once here so the optimizer's byte estimate and the emitter cannot
 * disagree about them.
 */

import type { Analysis } from './analyze.js';
import type { TargetCaps } from './target.js';

export type AttributeFormat = 'rgba8' | 'hilo';

/**
 * The attribute that packs as RGBA8 when the GPU stage writes it, or undefined.
 *
 * Only a color the kernel *writes* is packed. A color that arrives from SQL or the CPU stage
 * would need a JS pass to pack, which is the cost this exists to avoid. The caller
 * still has to check that nothing upstream of the kernel produced the same name; that part
 * depends on the stage assignment.
 */
export function packedColorName(analysis: Pick<Analysis, 'channels' | 'widths' | 'sourceSchema' | 'aggregateNames'>): string | undefined {
  const { channels } = analysis;
  // Only the points renderer reads the channel from a buffer. A heatmap has no color buffer.
  if (channels.mode !== 'points') return undefined;
  const name = channels.color;
  const width = analysis.widths.get(name);
  if (width !== 3 && width !== 4) return undefined;
  // A source column or aggregate of the same name is selected and uploaded as f32.
  if (analysis.sourceSchema.has(name) || analysis.aggregateNames.includes(name)) return undefined;
  return name;
}

/**
 * The storage format of the position channel when `stage` is the first to produce it.
 *
 * - SQL: `hilo`, always. DuckDB computes the vector in DOUBLE and the CPU already interleaves
 *   SQL vectors, so splitting each component into high and low halves rides along on a pass
 *   that exists anyway. This is the path that gains precision.
 * - CPU or GPU: f32, unless the target's renderer reads positions as hi/lo pairs
 *   (`fp64Positions`). Then the low half is written as zero: no precision is gained, but the
 *   buffer has the layout deck's WebGPU path requires.
 *
 * A layer output is excluded: its consumers evaluate on the CPU and read f32 columns.
 */
export function positionFormat(
  analysis: Pick<Analysis, 'channels' | 'widths' | 'layer'>,
  caps: Pick<TargetCaps, 'fp64Positions'>,
  stage: 'sql' | 'cpu' | 'gpu',
): AttributeFormat | undefined {
  if (analysis.channels.mode !== 'points' || analysis.layer) return undefined;
  if ((analysis.widths.get(analysis.channels.position) ?? 1) < 2) return undefined;
  if (stage === 'sql') return 'hilo';
  return caps.fp64Positions ? 'hilo' : undefined;
}

/** GPU bytes one row of an attribute occupies. */
export function rowBytes(attr: { width: number; format?: AttributeFormat }): number {
  if (attr.format === 'rgba8') return 4;
  if (attr.format === 'hilo') return attr.width * 8;
  return attr.width * 4;
}

/**
 * Split doubles into the `hilo` layout: per row, `width` high halves then `width` low halves.
 * `hi` is the value rounded to f32 (exactly what an f32 attribute would hold), `lo` is the
 * remainder rounded to f32. `hi + lo` recovers the double to about 1e-14 relative.
 */
export function splitHiLo(values: ArrayLike<number>, width: number, rows: number): Float32Array {
  const out = new Float32Array(rows * width * 2);
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < width; c++) {
      const v = values[i * width + c];
      const hi = Math.fround(v);
      out[i * width * 2 + c] = hi;
      out[i * width * 2 + width + c] = v - hi;
    }
  }
  return out;
}

/** `hilo` storage back to doubles, `hi + lo` per component. */
export function joinHiLo(stored: Float32Array, width: number, rows: number): Float64Array {
  const out = new Float64Array(rows * width);
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < width; c++) out[i * width + c] = stored[i * width * 2 + c] + stored[i * width * 2 + width + c];
  }
  return out;
}

/**
 * Packed RGBA8 back to f32 components, for readback and tests. Byte 0 is red, matching WGSL's
 * `pack4x8unorm` and a little-endian `unorm8x4` vertex fetch.
 */
export function unpackRgba8(packed: Uint32Array, width: number, rows = packed.length): Float32Array {
  const out = new Float32Array(rows * width);
  for (let i = 0; i < rows; i++) {
    const v = packed[i];
    for (let c = 0; c < width; c++) out[i * width + c] = ((v >>> (c * 8)) & 0xff) / 255;
  }
  return out;
}
