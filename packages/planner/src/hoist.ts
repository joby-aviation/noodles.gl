/**
 * Hoisting: a subexpression that reads parameters and no columns has the same value on every
 * row, so it is computed once per change instead of once per row, and bound as a parameter of
 * its own.
 *
 *     distance([lng, lat], [{{lng0}}, {{lat0}}])
 *       inlines to  … cos(lat * 0.0174…) * cos({{lat0}} * 0.0174…) …
 *       and hoists  … cos(lat * 0.0174…) * {{__hoist_3f…}} …
 *
 * This matters most for the geo prelude (`geo.ts`) with a keyframed centre: every inlined
 * haversine carries a trigonometric function of the centre, re-evaluated per row per frame.
 *
 * A derived parameter is evaluated in f64 by the JS backend, the CPU stage's semantics, and
 * reaches every stage as an ordinary value: a SQL bind, a uniform, a `p.` read in the loop.
 * That makes a hoisted GPU-only function (`fract({{t}})`) no longer pin its node off SQL, and
 * makes the GPU's copy f64-rounded rather than computed in f32.
 *
 * What stays true for everything outside the plan:
 *
 * - `AnalyzedNode.params` keeps the **source** names. The optimizer still charges one
 *   rebind of `lat0`, at `lat0`'s change rate, so a keyframed centre is priced as before.
 * - A derived parameter is never in `plan.params`, so no editor shows a control for it.
 * - Routes are keyed by source names (`sourceParams`). Changing `lat0` recomputes its derived
 *   values and then goes by the most expensive route any of them takes.
 * - The name is a hash of the expression, so the same subtree hoisted from two nodes, or two
 *   layers, is one parameter with one value, and a layer plan's hash does not move.
 */

import { type Expr, type BinaryOp, FUNCTIONS, paramsOf } from './expr.js';
import { toJs } from './backends/js.js';
import { hashOf } from './hash.js';

/** Declared parameters may not use it, so a derived name cannot shadow one. */
export const HOIST_PREFIX = '__hoist_';

export interface DerivedParam {
  /** `__hoist_<hash of expr>`. */
  name: string;
  /** Reads declared numeric parameters and nothing else. */
  expr: Expr;
  /** The declared parameters it reads. */
  sources: string[];
}

/** Anything that carries derived parameters: an `Analysis` or a `PhysicalPlan`. */
export interface WithDerived {
  readonly derived?: readonly DerivedParam[];
}

const BOOLEAN_OPS = new Set<BinaryOp>(['==', '!=', '<', '<=', '>', '>=', '&&', '||']);

/**
 * Replace every maximal param-only subtree of `e` with a derived parameter, recorded in `into`.
 *
 * Eligible subtrees:
 * - read at least one parameter, each accepted by `isNumericParam`: declared, with a number
 *   value. A stats parameter is not declared, and is only known after a query runs.
 * - read no column. A string, vector literal or swizzle disqualifies too: a derived value is
 *   one f64.
 * - call no aggregate and no `ramp`, which read rows and a LUT.
 * - are not boolean-valued at the top. A comparison can be hoisted inside a `cond`, but a
 *   bare predicate stays where WGSL's `bool` typing expects it.
 * - are worth it: at least one function call or two operators. `{{size}} * 0.4` trades one
 *   multiply for a less readable plan, so it stays inline.
 */
export function hoistParams(
  e: Expr,
  isNumericParam: (name: string) => boolean,
  into: Map<string, DerivedParam>,
): Expr {
  const pure = new Map<Expr, boolean>();
  const isPure = (n: Expr): boolean => {
    const known = pure.get(n);
    if (known !== undefined) return known;
    let ok: boolean;
    switch (n.kind) {
      case 'num': ok = true; break;
      case 'param': ok = isNumericParam(n.name); break;
      case 'unary': ok = isPure(n.operand); break;
      case 'binary': ok = isPure(n.left) && isPure(n.right); break;
      case 'cond': ok = isPure(n.test) && isPure(n.then) && isPure(n.else); break;
      case 'call': {
        const spec = FUNCTIONS[n.fn];
        ok = !!spec && !spec.aggregate && n.fn !== 'ramp' && n.args.every(isPure);
        break;
      }
      default: ok = false; // col, str, vec, swizzle
    }
    pure.set(n, ok);
    return ok;
  };

  const worth = (n: Expr): boolean => {
    let calls = 0;
    let ops = 0;
    let params = 0;
    const count = (m: Expr): void => {
      switch (m.kind) {
        case 'param': params++; break;
        case 'unary': ops++; count(m.operand); break;
        case 'binary': ops++; count(m.left); count(m.right); break;
        case 'cond': ops++; count(m.test); count(m.then); count(m.else); break;
        case 'call': calls++; m.args.forEach(count); break;
        default: break;
      }
    };
    count(n);
    return params > 0 && (calls > 0 || ops >= 2);
  };

  const booleanValued = (n: Expr): boolean =>
    (n.kind === 'binary' && BOOLEAN_OPS.has(n.op)) || (n.kind === 'unary' && n.op === '!');

  const visit = (n: Expr): Expr => {
    if (n.kind !== 'num' && n.kind !== 'param' && isPure(n) && !booleanValued(n) && worth(n)) {
      const name = `${HOIST_PREFIX}${hashOf(n)}`;
      if (!into.has(name)) into.set(name, { name, expr: n, sources: paramsOf(n) });
      return { kind: 'param', name };
    }
    switch (n.kind) {
      case 'unary': return { ...n, operand: visit(n.operand) };
      case 'binary': return { ...n, left: visit(n.left), right: visit(n.right) };
      case 'call': return { ...n, args: n.args.map(visit) };
      case 'vec': return { ...n, components: n.components.map(visit) };
      case 'swizzle': return { ...n, target: visit(n.target) };
      case 'cond': return { ...n, test: visit(n.test), then: visit(n.then), else: visit(n.else) };
      default: return n;
    }
  };
  return visit(e);
}

const compiled = new WeakMap<DerivedParam, (p: Readonly<Record<string, number | string>>) => number>();

function evaluator(d: DerivedParam): (p: Readonly<Record<string, number | string>>) => number {
  let fn = compiled.get(d);
  if (!fn) {
    const emitted = toJs(d.expr, (name) => {
      throw new Error(`Derived parameter ${d.name} reads column '${name}'`);
    });
    const body = new Function('p', `return ${emitted.components[0]};`) as (p: unknown) => unknown;
    fn = (p) => Number(body(p));
    compiled.set(d, fn);
  }
  return fn;
}

/**
 * The derived parameters' values under `values`. One whose source has no value is left out,
 * so a missing parameter stays missing, and fails or defaults exactly where it did before.
 */
export function derivedValues(
  plan: WithDerived,
  values: Readonly<Record<string, number | string>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of plan.derived ?? []) {
    if (d.sources.some((s) => values[s] === undefined)) continue;
    out[d.name] = evaluator(d)(values);
  }
  return out;
}

/** `values` plus the plan's derived parameters: what every bind, uniform and loop reads. */
export function withDerived<V extends number | string>(
  plan: WithDerived,
  values: Readonly<Record<string, V>>,
): Record<string, V | number> {
  return { ...values, ...derivedValues(plan, values) };
}

/**
 * Parameter names with each derived one replaced by its sources: what a route, a control or
 * a change rate is keyed by. Order-preserving and de-duplicated.
 */
export function sourceParams(plan: WithDerived, names: Iterable<string>): string[] {
  const byName = new Map((plan.derived ?? []).map((d) => [d.name, d.sources]));
  const out = new Set<string>();
  for (const n of names) for (const s of byName.get(n) ?? [n]) out.add(s);
  return [...out];
}

/** A param-only tree in the expression language, `cos(({{lat0}} * 0.0174…))`. */
function format(e: Expr): string {
  switch (e.kind) {
    case 'num': return String(e.value);
    case 'param': return `{{${e.name}}}`;
    case 'unary': return `${e.op}${format(e.operand)}`;
    case 'binary': return `(${format(e.left)} ${e.op} ${format(e.right)})`;
    case 'call': return `${e.fn}(${e.args.map(format).join(', ')})`;
    case 'cond': return `(${format(e.test)} ? ${format(e.then)} : ${format(e.else)})`;
    default: return '?'; // not hoistable
  }
}

/**
 * How a bind or uniform is shown to a person: a declared name as itself, a derived one as
 * the expression it stands for, since its hash says nothing.
 */
export function paramLabel(plan: WithDerived, name: string): string {
  const d = plan.derived?.find((x) => x.name === name);
  return d ? format(d.expr) : name;
}
