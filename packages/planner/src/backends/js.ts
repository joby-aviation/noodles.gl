/**
 * IR -> JavaScript. The third backend.
 *
 * Two reasons this exists rather than being an afterthought:
 *
 * 1. It is what makes the deck.gl comparison fair. deck.gl cannot consume a WGSL
 *    kernel's output without a GPU readback, so the honest deck path is its own
 *    documented fast path: precomputed binary attributes. Producing those needs a CPU
 *    evaluator for the same graph — which is exactly a third backend.
 * 2. It tests the claim that the IR is backend-agnostic. Two backends can agree by
 *    coincidence; three that agree is evidence the IR is the right abstraction.
 *
 * Emission is component-wise: a vec3 expression compiles to three scalar JS
 * expressions, so evaluating a row allocates nothing. Vector temporaries would mean an
 * array per row per node, which would make the CPU path look worse than it is.
 */

import { type Expr, FUNCTIONS, ExprError, widthOf } from '../expr.js';

/** How a bare identifier becomes JS, per component. */
export type JsResolver = (name: string) => { width: number; component: (c: number) => string };

export interface JsEmit {
  /** One scalar JS expression per component. */
  components: string[];
  width: number;
  params: string[];
  columns: string[];
}

interface Ctx {
  resolve: JsResolver;
  params: Set<string>;
  columns: Set<string>;
}

const COMPARISONS = ['==', '!=', '<', '<=', '>', '>='];
const LOGICAL = ['&&', '||'];

/** JS spellings for the portable function set. */
const JS_FN: Record<string, (args: string[][], width: number, c: number) => string> = {
  sqrt: (a, _w, c) => `Math.sqrt(${a[0][c]})`,
  abs: (a, _w, c) => `Math.abs(${a[0][c]})`,
  floor: (a, _w, c) => `Math.floor(${a[0][c]})`,
  ceil: (a, _w, c) => `Math.ceil(${a[0][c]})`,
  round: (a, _w, c) => `Math.round(${a[0][c]})`,
  sign: (a, _w, c) => `Math.sign(${a[0][c]})`,
  exp: (a, _w, c) => `Math.exp(${a[0][c]})`,
  sin: (a, _w, c) => `Math.sin(${a[0][c]})`,
  cos: (a, _w, c) => `Math.cos(${a[0][c]})`,
  tan: (a, _w, c) => `Math.tan(${a[0][c]})`,
  asin: (a, _w, c) => `Math.asin(${a[0][c]})`,
  atan: (a, _w, c) => `Math.atan(${a[0][c]})`,
  atan2: (a, _w, c) => `Math.atan2(${a[0][c]}, ${a[1][c]})`,
  pow: (a, _w, c) => `Math.pow(${a[0][c]}, ${a[1][c]})`,
  min: (a, _w, c) => `Math.min(${a[0][c]}, ${a[1][c]})`,
  max: (a, _w, c) => `Math.max(${a[0][c]}, ${a[1][c]})`,
  ln: (a, _w, c) => `Math.log(${a[0][c]})`,
  log10: (a, _w, c) => `Math.log10(${a[0][c]})`,
  log2: (a, _w, c) => `Math.log2(${a[0][c]})`,
  clamp: (a, _w, c) => `Math.min(Math.max(${a[0][c]}, ${a[1][c]}), ${a[2][c]})`,
  fit: (a, _w, c) =>
    `(${a[3][c]} + (${a[4][c]} - ${a[3][c]}) * ((${a[0][c]}) - (${a[1][c]})) / ((${a[2][c]}) - (${a[1][c]})))`,
  lerp: (a, _w, c) => `((${a[0][c]}) + ((${a[1][c]}) - (${a[0][c]})) * (${a[2][c]}))`,
  fract: (a, _w, c) => `((${a[0][c]}) - Math.floor(${a[0][c]}))`,
  smoothstep: (a, _w, c) => {
    const t = `Math.min(Math.max(((${a[2][c]}) - (${a[0][c]})) / ((${a[1][c]}) - (${a[0][c]})), 0), 1)`;
    return `(function(t){return t*t*(3-2*t);})(${t})`;
  },
  length: (a) => `Math.hypot(${a[0].join(', ')})`,
  dot: (a) => `(${a[0].map((x, i) => `(${x}) * (${a[1][i]})`).join(' + ')})`,
  normalize: (a, _w, c) => `((${a[0][c]}) / (Math.hypot(${a[0].join(', ')}) || 1))`,
  cross: (a, _w, c) => {
    const [x, y] = a;
    const i = (c + 1) % 3;
    const j = (c + 2) % 3;
    return `((${x[i]}) * (${y[j]}) - (${x[j]}) * (${y[i]}))`;
  },
  // Matches the WGSL sampleRamp: the LUT is provided by the caller as `rampAt(t, c)`.
  ramp: (a, _w, c) => `rampAt(${a[0][0]}, ${c})`,
};

function emit(e: Expr, ctx: Ctx): string[] {
  switch (e.kind) {
    case 'num':
      return [formatNumber(e.value)];

    case 'str':
      // Unreachable through the planner, which never places a string on the CPU stage.
      throw new Error(`String literal '${e.value}' has no JS-stage form; strings are SQL-only`);

    case 'param':
      ctx.params.add(e.name);
      return [`p.${e.name}`];

    case 'col': {
      ctx.columns.add(e.name);
      const r = ctx.resolve(e.name);
      return Array.from({ length: r.width }, (_, c) => r.component(c));
    }

    case 'unary': {
      const v = emit(e.operand, ctx);
      if (e.op === '!') return [`(!(${truthy(v)}))`];
      return v.map((x) => `(-(${x}))`);
    }

    case 'binary': {
      const l = emit(e.left, ctx);
      const r = emit(e.right, ctx);
      if (LOGICAL.includes(e.op)) return [`((${truthy(l)}) ${e.op} (${truthy(r)}))`];
      if (COMPARISONS.includes(e.op)) {
        if (l.length !== 1 || r.length !== 1) {
          throw new ExprError(`Comparison '${e.op}' requires scalar operands`);
        }
        // JS '==' is loose; the IR means numeric equality.
        const op = e.op === '==' ? '===' : e.op === '!=' ? '!==' : e.op;
        return [`(${num(l[0])} ${op} ${num(r[0])})`];
      }
      const width = Math.max(l.length, r.length);
      return Array.from({ length: width }, (_, c) => {
        const a = num(l[l.length === 1 ? 0 : c]);
        const b = num(r[r.length === 1 ? 0 : c]);
        return e.op === '%' ? `((${a}) - (${b}) * Math.floor((${a}) / (${b})))` : `((${a}) ${e.op} (${b}))`;
      });
    }

    case 'cond': {
      const test = truthy(emit(e.test, ctx));
      const t = emit(e.then, ctx);
      const f = emit(e.else, ctx);
      const width = Math.max(t.length, f.length);
      return Array.from({ length: width }, (_, c) =>
        `((${test}) ? (${t[t.length === 1 ? 0 : c]}) : (${f[f.length === 1 ? 0 : c]}))`);
    }

    case 'vec':
      return e.components.map((c) => num(emit(c, ctx)[0]));

    case 'swizzle': {
      const target = emit(e.target, ctx);
      const index = (ch: string) => 'xyzw'.indexOf({ r: 'x', g: 'y', b: 'z', a: 'w' }[ch] ?? ch);
      return [...e.channels].map((ch) => {
        const i = index(ch);
        if (i < 0 || i >= target.length) throw new ExprError(`Swizzle .${e.channels} exceeds width ${target.length}`);
        return target[i];
      });
    }

    case 'call': {
      const spec = FUNCTIONS[e.fn];
      const fn = JS_FN[e.fn];
      if (!fn) {
        throw new ExprError(
          spec.aggregate
            ? `${e.fn}() is an aggregate; the CPU backend evaluates row-wise expressions only`
            : `${e.fn}() has no JS implementation`,
        );
      }
      const width = widthOf(e, (n) => ctx.resolve(n).width);
      const args = e.args.map((a) => {
        const v = emit(a, ctx);
        // Broadcast scalars up so `fn` can index every argument by component.
        return v.length === 1 && width > 1 ? Array.from({ length: width }, () => v[0]) : v;
      });
      return Array.from({ length: width }, (_, c) => fn(args, width, c));
    }
  }
}

/** Wrap a possibly-boolean expression for use as a condition. */
function truthy(v: string[]): string {
  if (v.length !== 1) throw new ExprError('Vector conditions are not supported');
  return v[0];
}

/** Coerce a boolean-valued expression into a number for arithmetic. */
function num(code: string): string {
  return `+(${code})`;
}

export function toJs(e: Expr, resolve: JsResolver): JsEmit {
  const ctx: Ctx = { resolve, params: new Set(), columns: new Set() };
  const components = emit(e, ctx);
  return { components, width: components.length, params: [...ctx.params], columns: [...ctx.columns] };
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) throw new ExprError(`Cannot emit non-finite literal ${v}`);
  return String(v);
}
