/**
 * IR -> WGSL.
 *
 * Two things this has to get right that SQL does not:
 *
 * 1. Widths. WGSL will not add `vec3<f32>` to `f32`, so mixed-width operands are
 *    splatted explicitly. Every emit carries its width so the parent can coerce.
 * 2. Bools. Comparisons produce `bool`, which cannot enter arithmetic. Where a bool
 *    reaches a numeric context it is converted with `select(0.0, 1.0, b)`.
 *
 * Naming contract with the kernel builder (graph/planner.ts):
 *   columns    -> whatever the caller's `resolve` returns. The planner hands back an
 *                 SSA local name, which is how it fuses several attribute nodes into
 *                 one kernel and lets a node overwrite an attribute it also reads.
 *   parameters -> `params.<wgslParamMember(name)>`. Prefixed, because a parameter becomes a
 *                 struct *member* and WGSL reserves a long list of plausible names — a
 *                 parameter called `type`, `filter` or `mod` would emit an illegal
 *                 declaration. Prefixing every one is cheaper than maintaining the list.
 *   ramp()     -> `sampleRamp(x)` (declared in the kernel prelude)
 */

import { type Expr, FUNCTIONS, ExprError, widthOf } from '../expr.js';

/** How a bare identifier in an expression becomes WGSL. */
export type Resolver = (name: string) => { code: string; width: number };

export interface WgslEmit {
  code: string;
  width: number;
  params: string[];
  columns: string[];
}

interface Val {
  code: string;
  width: number;
  isBool: boolean;
}

interface Ctx {
  resolve: Resolver;
  params: Set<string>;
  columns: Set<string>;
}

const COMPARISONS = ['==', '!=', '<', '<=', '>', '>='];
const LOGICAL = ['&&', '||'];

function ty(width: number): string {
  return width === 1 ? 'f32' : `vec${width}<f32>`;
}

/** Force a value into numeric form at the requested width. */
function coerce(v: Val, width: number): string {
  let code = v.code;
  if (v.isBool) {
    code = v.width === 1 ? `select(0.0, 1.0, ${code})` : `select(${ty(v.width)}(0.0), ${ty(v.width)}(1.0), ${code})`;
  }
  if (v.width === width) return code;
  if (v.width === 1) return `${ty(width)}(${code})`;
  throw new ExprError(`Cannot widen a ${ty(v.width)} to ${ty(width)}`);
}

/** Force a value into a scalar bool, for use as a condition. */
function asBool(v: Val): string {
  if (v.isBool) {
    if (v.width !== 1) throw new ExprError('Vector conditions are not supported');
    return v.code;
  }
  if (v.width !== 1) throw new ExprError('Vector conditions are not supported');
  return `(${v.code} != 0.0)`;
}

function emit(e: Expr, ctx: Ctx): Val {
  switch (e.kind) {
    case 'num':
      return { code: formatNumber(e.value), width: 1, isBool: false };

    case 'str':
      throw new Error(`String literal '${e.value}' has no WGSL form; strings are SQL-only`);

    case 'col': {
      ctx.columns.add(e.name);
      const r = ctx.resolve(e.name);
      return { code: r.code, width: r.width, isBool: false };
    }

    case 'param':
      ctx.params.add(e.name);
      return { code: `params.${wgslParamMember(e.name)}`, width: 1, isBool: false };

    case 'unary': {
      const v = emit(e.operand, ctx);
      if (e.op === '!') return { code: `(!${asBool(v)})`, width: 1, isBool: true };
      return { code: `(-${coerce(v, v.width)})`, width: v.width, isBool: false };
    }

    case 'binary': {
      const l = emit(e.left, ctx);
      const r = emit(e.right, ctx);

      if (LOGICAL.includes(e.op)) {
        return { code: `(${asBool(l)} ${e.op} ${asBool(r)})`, width: 1, isBool: true };
      }
      if (COMPARISONS.includes(e.op)) {
        if (l.width !== 1 || r.width !== 1) {
          throw new ExprError(`Comparison '${e.op}' requires scalar operands`);
        }
        return { code: `(${coerce(l, 1)} ${e.op} ${coerce(r, 1)})`, width: 1, isBool: true };
      }
      // Arithmetic. WGSL has no '%' for floats; use the builtin remainder.
      const w = Math.max(l.width, r.width);
      const lc = coerce(l, w);
      const rc = coerce(r, w);
      if (e.op === '%') return { code: `(${lc} - ${rc} * floor(${lc} / ${rc}))`, width: w, isBool: false };
      return { code: `(${lc} ${e.op} ${rc})`, width: w, isBool: false };
    }

    case 'cond': {
      const test = emit(e.test, ctx);
      const t = emit(e.then, ctx);
      const f = emit(e.else, ctx);
      const w = Math.max(t.width, f.width);
      // WGSL's select() takes (false-value, true-value, condition).
      return { code: `select(${coerce(f, w)}, ${coerce(t, w)}, ${asBool(test)})`, width: w, isBool: false };
    }

    case 'vec': {
      const parts = e.components.map((c) => coerce(emit(c, ctx), 1));
      return { code: `${ty(parts.length)}(${parts.join(', ')})`, width: parts.length, isBool: false };
    }

    case 'swizzle': {
      const target = emit(e.target, ctx);
      if (target.width === 1) throw new ExprError('Cannot swizzle a scalar');
      const maxIndex = Math.max(...[...e.channels].map((c) => 'xyzw'.indexOf(c === 'r' ? 'x' : c === 'g' ? 'y' : c === 'b' ? 'z' : c === 'a' ? 'w' : c)));
      if (maxIndex >= target.width) {
        throw new ExprError(`Swizzle .${e.channels} exceeds ${ty(target.width)}`);
      }
      // WGSL accepts both xyzw and rgba sets; pass through unchanged.
      return { code: `(${coerce(target, target.width)}).${e.channels}`, width: e.channels.length, isBool: false };
    }

    case 'call': {
      const spec = FUNCTIONS[e.fn];
      if (!spec.wgsl) {
        throw new ExprError(`${e.fn}() has no GPU equivalent; this node must run in SQL`);
      }
      const width = widthOf(e, (n) => ctx.resolve(n).width);
      // Elementwise builtins want all arguments at the result width; the reducing ones
      // (dot, length, cross) want their arguments at their own natural width instead.
      const reducing = spec.width !== 'broadcast';
      const args = e.args.map((a) => {
        const v = emit(a, ctx);
        return reducing ? coerce(v, v.width) : coerce(v, Math.max(width, v.width));
      });
      const code =
        typeof spec.wgsl === 'function' ? spec.wgsl(args) : `${spec.wgsl}(${args.join(', ')})`;
      return { code, width, isBool: false };
    }
  }
}

export function toWgsl(e: Expr, resolve: Resolver): WgslEmit {
  const ctx: Ctx = { resolve, params: new Set(), columns: new Set() };
  const v = emit(e, ctx);
  const width = v.width;
  return {
    code: coerce(v, width),
    width,
    params: [...ctx.params],
    columns: [...ctx.columns],
  };
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) throw new ExprError(`Cannot emit non-finite literal ${v} to WGSL`);
  // WGSL infers AbstractInt for `2`, which then fails to mix with f32 in some
  // positions. Always emit a float literal.
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

export { ty as wgslType };

/**
 * Uniform struct member name for a parameter.
 *
 * Prefixed so a parameter named after a WGSL reserved word (`type`, `filter`, `from`, `mod`,
 * `meta`, ...) cannot produce an illegal struct declaration. The prefix also guarantees the
 * name is a valid identifier even if the parameter contains characters WGSL rejects.
 */
export function wgslParamMember(name: string): string {
  return `p_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
}
