/**
 * User-defined functions, resolved by inlining.
 *
 * A graph can declare its own functions and call them from any expression:
 *
 *     "functions": { "ease": { "params": ["t"], "body": "t * t * (3.0 - 2.0 * t)" } }
 *     "@Cd": "ramp(ease(t))"
 *
 * or, inside a wrangle body, `fn ease(t) = t * t * (3.0 - 2.0 * t);`.
 *
 * **They are inlined, not compiled.** A call is replaced by the function's body with the
 * arguments substituted, and everything downstream — the three backends, `enginesFor`,
 * `widthOf`, `opCount`, fusion, placement — sees an ordinary expression tree and needs no
 * knowledge that functions exist. That is the whole reason to do it this way: a real call
 * mechanism would have to be implemented three times (SQL has no user functions we can
 * define per-query, WGSL has real functions, JS has closures) and would have to answer
 * "which engines can run this function" separately from "which engines can run its body".
 * Inlining makes both questions the same question.
 *
 * The cost of inlining is duplication: `sq(expensive())` evaluates `expensive()` twice.
 * That is faithful rather than surprising — the GPU really does compute it twice — and it
 * shows up honestly in `opCount`, so the optimizer prices the duplicated work. But it means
 * a function is not a way to *save* work, only a way to name it.
 */

import { type Expr, type ParseScope, parseExpr, FUNCTIONS, ExprError } from './expr.js';

export interface FunctionDef {
  name: string;
  /** Parameter names. Inside `body` they appear as column references. */
  params: string[];
  /** Absent for a macro. */
  body?: Expr;
  /**
   * A macro: builds the body from the (already inlined) argument trees, for a function whose
   * shape depends on an argument's *value* and so cannot be one template. The geo prelude's
   * constant geometries are the case: a polygon literal of n edges expands to n crossing tests.
   * The result is inlined again, so it may call other functions in the registry. Only the
   * prelude defines these; a graph cannot.
   */
  expand?: (args: readonly Expr[]) => Expr;
  /** Where it was declared, for error messages: a graph key or a wrangle line. */
  source: string;
}

export type FunctionRegistry = ReadonlyMap<string, FunctionDef>;

/** A function written as a template, which is every function a graph or wrangle declares. */
export type TemplateFunctionDef = FunctionDef & { body: Expr };

/** Authored form, as it appears in graph JSON. */
export interface FunctionSpec {
  params: string[];
  body: string;
}

export class FunctionError extends Error {}

/**
 * The `source` prefix of the geo prelude's definitions (`geo.ts`). It lives here rather than
 * there because `geo.ts` builds its registry with this module, so the import only runs one way.
 */
export const GEO_SOURCE_PREFIX = 'geo.';

/** Guard against a cycle that the call-stack check somehow misses. */
const MAX_INLINE_DEPTH = 64;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function defineFunction(
  name: string,
  params: readonly string[],
  body: Expr,
  source: string,
): TemplateFunctionDef {
  if (!NAME.test(name)) {
    throw new FunctionError(`${source}: '${name}' is not a valid function name`);
  }
  if (FUNCTIONS[name]) {
    // Shadowing `sqrt` would mean the same call site means different things in two graphs,
    // and the error it eventually causes would point at the call, not the declaration.
    throw new FunctionError(
      `${source}: '${name}' is a built-in function and cannot be redefined`,
    );
  }
  const seen = new Set<string>();
  for (const p of params) {
    if (!NAME.test(p)) {
      throw new FunctionError(`${source}: '${p}' is not a valid parameter name in ${name}()`);
    }
    if (seen.has(p)) {
      throw new FunctionError(`${source}: ${name}() declares '${p}' twice`);
    }
    seen.add(p);
  }
  return { name, params: [...params], body, source };
}

/** Build a registry from the authored `functions` map. */
export function buildRegistry(
  specs: Record<string, FunctionSpec> | undefined,
  into: Map<string, FunctionDef> = new Map(),
  /** Where the specs came from, for error messages: a graph's `functions`, or the geo prelude. */
  sourcePrefix = 'functions.',
): Map<string, FunctionDef> {
  for (const [name, spec] of Object.entries(specs ?? {})) {
    const source = `${sourcePrefix}${name}`;
    let body: Expr;
    try {
      // Declarations parse in the scope built so far, so a function may call one declared
      // before it. Order in the JSON therefore matters, which is the price of not doing a
      // two-pass resolve for a feature whose bodies are one line long.
      body = parseExpr(spec.body, { functions: into });
    } catch (err) {
      throw new FunctionError(`${source}: ${(err as Error).message}`);
    }
    addFunction(into, defineFunction(name, spec.params, body, source));
  }
  return into;
}

export function addFunction(into: Map<string, FunctionDef>, def: FunctionDef): void {
  const existing = into.get(def.name);
  if (existing?.source.startsWith(GEO_SOURCE_PREFIX)) {
    // Same reasoning as for `FUNCTIONS`: a graph that redefines `distance` would make the
    // name mean different things in different graphs. Named separately because "already
    // defined at geo.distance" reads like the user's own mistake.
    throw new FunctionError(
      `${def.source}: '${def.name}' is a built-in geo function (geo.ts) and cannot be redefined`,
    );
  }
  if (existing) {
    throw new FunctionError(
      `${def.source}: '${def.name}' is already defined at ${existing.source}`,
    );
  }
  into.set(def.name, def);
}

/**
 * Replace every call to a user-defined function with its body.
 *
 * Arguments are inlined before substitution, so nested calls resolve bottom-up. Unknown
 * names are left alone: they are either built-ins or genuine errors, and `enginesFor` and
 * the backends already produce a good message for the latter.
 */
export function inlineFunctions(e: Expr, registry: FunctionRegistry): Expr {
  if (registry.size === 0) return e;
  return inline(e, registry, [], 0);
}

function inline(e: Expr, reg: FunctionRegistry, stack: string[], depth: number): Expr {
  if (depth > MAX_INLINE_DEPTH) {
    throw new FunctionError(
      `Function inlining exceeded ${MAX_INLINE_DEPTH} levels (${stack.join(' -> ')})`,
    );
  }
  switch (e.kind) {
    case 'num':
    case 'str':
    case 'col':
    case 'param':
      return e;
    case 'unary':
      return { ...e, operand: inline(e.operand, reg, stack, depth) };
    case 'binary':
      return {
        ...e,
        left: inline(e.left, reg, stack, depth),
        right: inline(e.right, reg, stack, depth),
      };
    case 'vec':
      return { ...e, components: e.components.map((c) => inline(c, reg, stack, depth)) };
    case 'swizzle':
      return { ...e, target: inline(e.target, reg, stack, depth) };
    case 'cond':
      return {
        ...e,
        test: inline(e.test, reg, stack, depth),
        then: inline(e.then, reg, stack, depth),
        else: inline(e.else, reg, stack, depth),
      };
    case 'call': {
      const args = e.args.map((a) => inline(a, reg, stack, depth));
      const def = reg.get(e.fn);
      if (!def) return { ...e, args };

      if (stack.includes(def.name)) {
        // Inlining cannot express recursion at all, so this is a hard error rather than a
        // depth limit. Named explicitly because the cycle is the useful part of the message.
        throw new FunctionError(
          `${def.source}: ${[...stack, def.name].join(' -> ')} is recursive; ` +
          'user functions are inlined and cannot recurse',
        );
      }
      if (args.length !== def.params.length) {
        throw new FunctionError(
          `${def.name}() takes ${def.params.length} argument(s) ` +
          `(${def.params.join(', ')}), got ${args.length}`,
        );
      }

      if (def.expand) {
        let expanded: Expr;
        try {
          expanded = def.expand(args);
        } catch (err) {
          if (err instanceof FunctionError) throw err;
          throw new FunctionError(`${def.name}(): ${(err as Error).message}`);
        }
        return inline(expanded, reg, [...stack, def.name], depth + 1);
      }

      const bound = new Map(def.params.map((p, i) => [p, args[i]] as const));
      // The body may itself call other user functions, so inline it under this call.
      const body = inline(def.body!, reg, [...stack, def.name], depth + 1);
      return substitute(body, bound);
    }
  }
}

/**
 * Replace parameter references in a function body with the argument subtrees.
 *
 * A `col` node whose name is not a parameter is left alone, so a function may read an
 * attribute directly (`fn density() = pop / area`). That makes functions less hygienic than
 * a closed abstraction — the call site cannot see which attributes a function needs — but it
 * matches how a VEX wrangle behaves, and `columnsOf` on the inlined result still reports the
 * true dependency set, so the planner is never misled. `param` nodes are likewise untouched,
 * which is what lets `fn f(x) = x * {{k}}` work.
 */
function substitute(e: Expr, bound: ReadonlyMap<string, Expr>): Expr {
  switch (e.kind) {
    case 'col':
      return bound.get(e.name) ?? e;
    case 'num':
    case 'str':
    case 'param':
      return e;
    case 'unary':
      return { ...e, operand: substitute(e.operand, bound) };
    case 'binary':
      return { ...e, left: substitute(e.left, bound), right: substitute(e.right, bound) };
    case 'call':
      return { ...e, args: e.args.map((a) => substitute(a, bound)) };
    case 'vec':
      return { ...e, components: e.components.map((c) => substitute(c, bound)) };
    case 'swizzle':
      return { ...e, target: substitute(e.target, bound) };
    case 'cond':
      return {
        ...e,
        test: substitute(e.test, bound),
        then: substitute(e.then, bound),
        else: substitute(e.else, bound),
      };
  }
}

/**
 * Parse `fn name(a, b) = expr` from a wrangle statement, or return undefined if the text is
 * not a function declaration. Kept here rather than in `wrangle.ts` so the grammar and the
 * registry that consumes it stay together.
 */
const FN_DECL = /^\s*fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*=\s*(.+)$/s;

export function parseFunctionDeclaration(
  text: string,
  source: string,
  scope?: ParseScope,
): TemplateFunctionDef | undefined {
  const m = FN_DECL.exec(text);
  if (!m) return undefined;
  const [, name, paramList, bodySrc] = m;
  const params = paramList.trim() === ''
    ? []
    : paramList.split(',').map((p) => p.trim());
  let body: Expr;
  try {
    body = parseExpr(bodySrc, scope);
  } catch (err) {
    if (err instanceof ExprError) throw new FunctionError(`${source}: ${err.message}`);
    throw err;
  }
  return defineFunction(name, params, body, source);
}
