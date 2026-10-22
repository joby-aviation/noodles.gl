/**
 * The wrangle node: a VEX-style multi-statement body, which is what makes the pipeline
 * programmable rather than a fixed catalogue of operator types.
 *
 *     @P      = [mercator_x(lng), mercator_y(lat), elevation * {{exag}}];
 *     var t   = fit(ln(pop), {{lo}}, {{hi}}, 0, 1);
 *     @Cd     = ramp(t);
 *     @pscale = sqrt(pop) * {{k}};
 *
 * `@name` writes a point attribute; `var name` is a local, visible to later statements in
 * the same wrangle but not outside it. Every right-hand side goes through the existing
 * `parseExpr`, so a wrangle gets all three backends and the planner's capability analysis
 * for free.
 *
 * Deliberately *not* a general language: no control flow and no loops. Each statement must be
 * a pure expression so it stays placeable on any of the three engines. Adding an `if` would
 * mean either divergence in the kernel or an escape to CPU-only, and the point of the IR is
 * that placement stays open.
 *
 * The one exception is `fn name(a, b) = expr;`, which declares a user function. It is not a
 * call mechanism — the declaration is hoisted and every call is inlined (see
 * `functions.ts`), so a function names an expression without changing what any engine has to
 * support.
 */

import { parseExpr, type Expr } from './expr.js';
import { type FunctionDef, parseFunctionDeclaration } from './functions.js';
import { GEO_PRELUDE } from './geo.js';

export interface WrangleStatement {
  /** Attribute, local or function name as written, without the `@`. */
  name: string;
  /**
   * `attribute` is externally visible; `local` is scoped to this wrangle; `function` is a
   * declaration that produces no value and is hoisted into the graph's function registry.
   */
  kind: 'attribute' | 'local' | 'function';
  expr: Expr;
  /** Set for `kind: 'function'`: the declaration, ready to register. */
  fn?: FunctionDef;
  /** 1-based line in the body, for error messages. */
  line: number;
}

export class WrangleError extends Error {}

// `s` (dotAll) matters: newlines are not statement separators, so a long expression is
// allowed to wrap and `.` has to match across lines.
const STATEMENT = /^\s*(?:(var)\s+([A-Za-z_][A-Za-z0-9_]*)|@([A-Za-z_][A-Za-z0-9_]*))\s*=\s*(.+)$/s;

/**
 * Parse a wrangle body into statements.
 *
 * Statements are separated by `;`. Newlines are not separators, so a long expression may
 * wrap. `//` starts a comment that runs to end of line.
 */
export function parseWrangle(
  body: string,
  /**
   * Functions already visible to this body — the graph-level ones. Declarations found here are
   * added to a private copy, so a later statement can call an earlier declaration without this
   * function mutating its caller's registry; hoisting into the real one is `desugar`'s job.
   * Omitted, the scope is the geo prelude, so a body checked on its own (the inspector's live
   * preview) accepts what the same body inside a graph would.
   */
  functions?: ReadonlyMap<string, FunctionDef>,
): WrangleStatement[] {
  const stripped = stripComments(body);
  const out: WrangleStatement[] = [];
  const scope = new Map<string, FunctionDef>(functions ?? GEO_PRELUDE);

  let line = 1;
  let buffer = '';
  const flush = (atLine: number) => {
    const text = buffer.trim();
    buffer = '';
    if (text === '') return;

    // `fn` declarations are checked first: they are not assignments and would otherwise be
    // reported as a malformed one.
    const fn = parseFunctionDeclaration(text, `Line ${atLine}`, { functions: scope });
    if (fn) {
      scope.set(fn.name, fn);
      out.push({ name: fn.name, kind: 'function', expr: fn.body, fn, line: atLine });
      return;
    }

    const m = STATEMENT.exec(text);
    if (!m) {
      throw new WrangleError(
        `Line ${atLine}: expected '@name = expr' or 'var name = expr', got ${JSON.stringify(truncate(text))}`,
      );
    }
    const [, varKeyword, localName, attrName, rhs] = m;
    const name = varKeyword ? localName : attrName;
    let expr: Expr;
    try {
      expr = parseExpr(rhs, { functions: scope });
    } catch (err) {
      throw new WrangleError(`Line ${atLine}: ${(err as Error).message}`);
    }
    out.push({ name, kind: varKeyword ? 'local' : 'attribute', expr, line: atLine });
  };

  let statementLine = 1;
  for (const ch of stripped) {
    if (ch === ';') {
      flush(statementLine);
      statementLine = line;
      continue;
    }
    if (ch === '\n') {
      line++;
      // A statement that has not started yet should report the line it does start on.
      if (buffer.trim() === '') statementLine = line;
    }
    buffer += ch;
  }
  // A trailing statement without a terminating semicolon is accepted.
  flush(statementLine);

  if (out.length === 0) throw new WrangleError('Wrangle body has no statements');
  if (!out.some((s) => s.kind === 'attribute')) {
    throw new WrangleError(
      'Wrangle body assigns no attributes; every statement is a local or a function',
    );
  }
  return out;
}

/**
 * Rewrite locals to graph-unique attribute names.
 *
 * The planner has one flat attribute namespace, so two wrangles that both declare
 * `var t` would collide. Prefixing with the node id keeps them distinct, and the `__`
 * marks them as internal so the inspector can hide them.
 */
export function localName(nodeId: string, name: string): string {
  return `__${sanitize(nodeId)}_${name}`;
}

/**
 * Expand statements into `(name, expr)` pairs with locals renamed.
 *
 * Renaming happens on both sides: the definition and every later reference. Only
 * references to names actually declared local in *this* wrangle are rewritten, so an
 * attribute produced upstream that happens to share a name is left alone.
 */
export function expandWrangle(
  nodeId: string,
  statements: WrangleStatement[],
): { name: string; expr: Expr; internal: boolean; line: number }[] {
  const locals = new Set<string>();
  // Declarations are hoisted by `desugar` and produce no node.
  return statements.filter((s) => s.kind !== 'function').map((s) => {
    // Rewrite references before adding this statement's own name, so `var t = t + 1`
    // reads the upstream `t` rather than itself.
    const expr = renameColumns(s.expr, (n) => (locals.has(n) ? localName(nodeId, n) : n));
    if (s.kind === 'local') locals.add(s.name);
    return {
      name: s.kind === 'local' ? localName(nodeId, s.name) : s.name,
      expr,
      internal: s.kind === 'local',
      line: s.line,
    };
  });
}

/** Structural rename of column references in an expression tree. */
export function renameColumns(e: Expr, rename: (name: string) => string): Expr {
  switch (e.kind) {
    case 'col': {
      const next = rename(e.name);
      return next === e.name ? e : { kind: 'col', name: next };
    }
    case 'num':
    case 'str':
    case 'param':
      return e;
    case 'unary':
      return { ...e, operand: renameColumns(e.operand, rename) };
    case 'binary':
      return { ...e, left: renameColumns(e.left, rename), right: renameColumns(e.right, rename) };
    case 'call':
      return { ...e, args: e.args.map((a) => renameColumns(a, rename)) };
    case 'vec':
      return { ...e, components: e.components.map((c) => renameColumns(c, rename)) };
    case 'swizzle':
      return { ...e, target: renameColumns(e.target, rename) };
    case 'cond':
      return {
        ...e,
        test: renameColumns(e.test, rename),
        then: renameColumns(e.then, rename),
        else: renameColumns(e.else, rename),
      };
  }
}

// ---------------------------------------------------------------------------

/** Remove `//` comments while preserving newlines so line numbers stay correct. */
function stripComments(body: string): string {
  return body
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_');
}

function truncate(s: string, max = 60): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
