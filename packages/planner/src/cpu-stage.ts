/**
 * Evaluate the plan's GPU stage on the CPU, producing packed binary attributes.
 *
 * This is what deck.gl needs, and it is the cost the comparison is really measuring.
 * deck.gl cannot read a WGSL kernel's output without a GPU readback, so to render the
 * same graph it needs the derived attributes materialized in JS. Everything below —
 * the contiguous source arrays, the per-row loop, the Uint8 color packing — is work
 * the WebGPU path does not do at all.
 *
 * The loop is generated once with `new Function` rather than interpreted per row, so
 * the CPU path is as fast as a hand-written accessor. Anything slower would flatter
 * the WebGPU side unfairly.
 */

import type { PhysicalPlan, StageNode } from './planner.js';
import { toJs } from './backends/js.js';
import { widthOf } from './expr.js';
import { buildRampLut } from './types.js';
import type { ColumnUpload } from './arrow.js';
import { withDerived } from './hoist.js';

export interface CpuAttributes {
  rows: number;
  /** name -> { data (packed), width }. */
  values: Map<string, { data: Float32Array; width: number }>;
  /** Milliseconds to make the source columns contiguous. */
  materializeMs: number;
  /** Milliseconds in the generated per-row loop. */
  evalMs: number;
  /** The generated JS, for the inspector. */
  code: string;
}

/** Concatenate a chunked upload into one contiguous array. Free if already contiguous. */
export function materialize(upload: ColumnUpload): Float32Array {
  if (upload.data) return upload.data;
  const out = new Float32Array(upload.rows);
  let cursor = 0;
  for (const chunk of upload.chunks!) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/**
 * Evaluate one stage of a plan with the generated JS backend.
 *
 * Used two ways. The runtime calls it for `plan.cpuStage`, which the optimizer populates
 * when the CPU is the cheapest place for a node or the only legal one (a WebGL2 target has
 * no compute shaders). The deck.gl comparison calls it for `cpuStage` *plus* `gpuStage`,
 * because deck cannot read a buffer a kernel wrote without a readback — which is precisely
 * the cost that comparison exists to measure.
 */
export function evaluateStage(
  stage: StageNode[],
  plan: PhysicalPlan,
  sources: Map<string, ColumnUpload>,
  params: Record<string, number>,
  rows: number,
): CpuAttributes {
  const tMat = performance.now();
  const contiguous = new Map<string, Float32Array>();
  for (const [name, upload] of sources) contiguous.set(name, materialize(upload));
  const materializeMs = performance.now() - tMat;

  // Widths: source columns are scalars; derived attributes get theirs from the IR.
  const widths = new Map<string, number>();
  for (const decl of plan.attributes) if (decl.provenance === 'arrow') widths.set(decl.name, decl.width);

  const outputs = new Map<string, { data: Float32Array; width: number }>();
  const lines: string[] = [];
  const usedSources = new Set<string>();
  let usesRamp = false;

  for (const node of stage) {
    if (!node.expr) {
      // `raw` declares `engine: 'sql' | 'gpu'`, so the optimizer can never place one here.
      throw new Error(`CPU stage node '${node.nodeId}' has no expression; raw nodes cannot run on the CPU`);
    }
    const width = widthOf(node.expr, (n) => widths.get(n) ?? 1);
    const emitted = toJs(node.expr, (name) => {
      const w = widths.get(name) ?? 1;
      if (outputs.has(name)) {
        // Read the value written earlier this row, matching the kernel's SSA rebinding.
        return { width: w, component: (c) => `o_${safe(name)}[i * ${w} + ${c}]` };
      }
      usedSources.add(name);
      return { width: w, component: () => `s_${safe(name)}[i]` };
    });
    if (emitted.components.some((c) => c.includes('rampAt('))) usesRamp = true;

    const data = new Float32Array(rows * width);
    outputs.set(node.name, { data, width });
    widths.set(node.name, width);

    lines.push(`  // ${node.nodeId}: ${node.name}`);
    emitted.components.forEach((code, c) => {
      lines.push(`  o_${safe(node.name)}[i * ${width} + ${c}] = ${code};`);
    });
  }

  const sourceDecls = [...usedSources].map((n) => `const s_${safe(n)} = src.get(${JSON.stringify(n)});`);
  const outDecls = [...outputs.keys()].map((n) => `const o_${safe(n)} = out.get(${JSON.stringify(n)}).data;`);
  const rampDecl = usesRamp
    ? `const lut = ramp;
  const lutN = lut.length / 4 - 1;
  const rampAt = (t, c) => {
    const x = Math.min(Math.max(t, 0), 1) * lutN;
    const i0 = Math.floor(x), i1 = Math.min(i0 + 1, lutN), f = x - i0;
    return lut[i0 * 4 + c] + (lut[i1 * 4 + c] - lut[i0 * 4 + c]) * f;
  };`
    : '';

  const code = `${sourceDecls.join('\n')}
${outDecls.join('\n')}
${rampDecl}
for (let i = 0; i < rows; i++) {
${lines.join('\n')}
}`;

  const fn = new Function('src', 'out', 'p', 'rows', 'ramp', code) as (
    src: Map<string, Float32Array>,
    out: Map<string, { data: Float32Array; width: number }>,
    p: Record<string, number>,
    rows: number,
    ramp: Float32Array | undefined,
  ) => void;

  const lut = plan.ramp ? buildRampLut(plan.ramp) : undefined;
  // Here rather than in every caller: the loop reads hoisted subexpressions as `p.__hoist_…`.
  const bound = withDerived(plan, params);
  const tEval = performance.now();
  fn(contiguous, outputs, bound, rows, lut);
  const evalMs = performance.now() - tEval;

  // Carry the arrow-sourced attributes through so callers can bind them too.
  for (const decl of plan.attributes) {
    if (decl.provenance === 'arrow' && !outputs.has(decl.name)) {
      const data = contiguous.get(decl.name);
      if (data) outputs.set(decl.name, { data, width: decl.width });
    }
  }

  return { rows, values: outputs, materializeMs, evalMs, code };
}

/** Pack a float color attribute (0..1 per channel) into deck.gl's Uint8 RGBA. */
export function toUint8Color(src: Float32Array, width: number, rows: number, alpha = 255): Uint8Array {
  const out = new Uint8Array(rows * 4);
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < 3; c++) {
      const v = width > c ? src[i * width + c] : 0;
      out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    out[i * 4 + 3] = alpha;
  }
  return out;
}

function safe(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}
