/**
 * The expression IR — the load-bearing idea of this prototype.
 *
 * One parser, one AST, two backends. `sqrt(pop) * 2` becomes either a DuckDB SELECT
 * expression or a WGSL statement from the same tree. If a construct can only be
 * expressed by one backend, that is recorded in the op table below rather than
 * special-cased in a compiler, so the planner can ask "can this node run in SQL?"
 * by walking the tree instead of pattern-matching node types.
 *
 * Grammar (loosely Houdini VEX-flavored, deliberately small):
 *   expr    := ternary
 *   ternary := or ('?' expr ':' expr)?
 *   or      := and ('||' and)*
 *   and     := cmp ('&&' cmp)*
 *   cmp     := add (('=='|'!='|'<'|'<='|'>'|'>=') add)*
 *   add     := mul (('+'|'-') mul)*
 *   mul     := unary (('*'|'/'|'%') unary)*
 *   unary   := ('-'|'!') unary | postfix
 *   postfix := primary ('.' swizzle | '[' index ']')*
 *   primary := number | string | ident | '{{' param '}}' | ident '(' args ')'
 *            | '[' expr (',' expr)* ']' | '(' expr ')'
 */

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Expr =
  | { kind: 'num'; value: number }
  /**
   * A string literal, `'JFK'`. SQL-only: neither WGSL nor the generated JS loop has a string
   * value, so a tree containing one is feasible in SQL and nowhere else. That is enough for
   * what strings are for here — comparing a code, a name or a category in a filter — and it
   * keeps the GPU and CPU stages numeric by construction.
   */
  | { kind: 'str'; value: string }
  | { kind: 'col'; name: string }
  | { kind: 'param'; name: string }
  | { kind: 'unary'; op: UnaryOp; operand: Expr }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'call'; fn: string; args: Expr[] }
  | { kind: 'vec'; components: Expr[] }
  | { kind: 'swizzle'; target: Expr; channels: string }
  | { kind: 'cond'; test: Expr; then: Expr; else: Expr };

export type UnaryOp = '-' | '!';
export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | '&&' | '||';

/** Which engines can evaluate a given construct. */
export type Engine = 'sql' | 'gpu';

// ---------------------------------------------------------------------------
// Op table — the single source of truth for cross-backend capability
// ---------------------------------------------------------------------------

export interface FnSpec {
  /** Arity range, inclusive. */
  arity: [number, number];
  /** SQL rendering. `null` means "no SQL equivalent" → forces the node onto the GPU. */
  sql: string | ((args: string[]) => string) | null;
  /** WGSL rendering. `null` means "no GPU equivalent" → forces the node into SQL. */
  wgsl: string | ((args: string[]) => string) | null;
  /**
   * Result width in components. `'broadcast'` = widest argument wins (elementwise);
   * a number pins it (e.g. `length` is always scalar).
   */
  width: 'broadcast' | number;
  /** True for SQL aggregates, which collapse rows and so can never be a GPU kernel. */
  aggregate?: boolean;
  /**
   * Per argument, how a UDF takes it: as a number, as text, or `auto` (text for a text column,
   * a number otherwise), which analysis resolves from the column's type.
   */
  argTypes?: ('number' | 'text' | 'auto')[];
}

export const FUNCTIONS: Record<string, FnSpec> = {
  // --- portable elementwise math: both backends, same semantics -------------
  sqrt:   { arity: [1, 1], sql: 'sqrt',  wgsl: 'sqrt',  width: 'broadcast' },
  abs:    { arity: [1, 1], sql: 'abs',   wgsl: 'abs',   width: 'broadcast' },
  floor:  { arity: [1, 1], sql: 'floor', wgsl: 'floor', width: 'broadcast' },
  ceil:   { arity: [1, 1], sql: 'ceil',  wgsl: 'ceil',  width: 'broadcast' },
  round:  { arity: [1, 1], sql: 'round', wgsl: 'round', width: 'broadcast' },
  sign:   { arity: [1, 1], sql: 'sign',  wgsl: 'sign',  width: 'broadcast' },
  exp:    { arity: [1, 1], sql: 'exp',   wgsl: 'exp',   width: 'broadcast' },
  sin:    { arity: [1, 1], sql: 'sin',   wgsl: 'sin',   width: 'broadcast' },
  cos:    { arity: [1, 1], sql: 'cos',   wgsl: 'cos',   width: 'broadcast' },
  tan:    { arity: [1, 1], sql: 'tan',   wgsl: 'tan',   width: 'broadcast' },
  asin:   { arity: [1, 1], sql: 'asin',  wgsl: 'asin',  width: 'broadcast' },
  atan:   { arity: [1, 1], sql: 'atan',  wgsl: 'atan',  width: 'broadcast' },
  atan2:  { arity: [2, 2], sql: 'atan2', wgsl: 'atan2', width: 'broadcast' },
  pow:    { arity: [2, 2], sql: 'pow',   wgsl: 'pow',   width: 'broadcast' },
  min:    { arity: [2, 2], sql: 'least', wgsl: 'min',   width: 'broadcast' },
  max:    { arity: [2, 2], sql: 'greatest', wgsl: 'max', width: 'broadcast' },
  // `ln` is DuckDB's natural log; WGSL spells it `log`.
  ln:     { arity: [1, 1], sql: 'ln',    wgsl: 'log',   width: 'broadcast' },
  log10:  { arity: [1, 1], sql: 'log10', wgsl: 'log10', width: 'broadcast' },
  log2:   { arity: [1, 1], sql: 'log2',  wgsl: 'log2',  width: 'broadcast' },

  // The first argument unless it is missing: SQL NULL, or NaN, which is how a null column reaches
  // the CPU stage and the GPU. GeoJSON properties are often absent on some features.
  coalesce: {
    arity: [2, 2],
    sql: 'coalesce',
    wgsl: (a) => `select(${a[0]}, ${a[1]}, ${a[0]} != ${a[0]})`,
    width: 'broadcast',
  },

  // How a UDF's `auto` argument reaches DuckDB, decided by analysis from the column's type.
  as_double: { arity: [1, 1], sql: (a) => `CAST(${a[0]} AS DOUBLE)`, wgsl: null, width: 1 },
  as_text: { arity: [1, 1], sql: (a) => `CAST(${a[0]} AS VARCHAR)`, wgsl: null, width: 1 },

  // Text read as a number, NULL when it is not one: how a numeric field typed as text is used.
  to_number: { arity: [1, 1], sql: (a) => `TRY_CAST(${a[0]} AS DOUBLE)`, wgsl: null, width: 1 },

  // A category's bucket in [0, n): a hash of the value, so one value always lands in one bucket,
  // as an ordinal color scale gives one category one color. SQL only.
  category: {
    arity: [2, 2],
    sql: (a) => `CAST(hash(${a[0]}) % CAST(${a[1]} AS UBIGINT) AS DOUBLE)`,
    wgsl: null,
    width: 1,
  },

  // A uniform random number in [0, 1) per row, drawn by DuckDB each time the query runs.
  random: { arity: [0, 0], sql: () => 'random()', wgsl: null, width: 1 },

  // Element `i` (0-based) of a list column, such as a `[lng, lat]` read from JSON. SQL only.
  item: {
    arity: [2, 2],
    sql: (a) => `list_extract(${a[0]}, CAST(${a[1]} AS INTEGER) + 1)`,
    wgsl: null,
    width: 1,
  },

  // One byte of a `#rgb` or `#rrggbb` color string, 0–255: `i` is 0, 1 or 2 for red, green,
  // blue. Strings live in SQL only, so this does too; `hex_color` (the prelude) builds an RGB
  // vector from three of them.
  hex_byte: {
    arity: [2, 2],
    sql: (a) => {
      const s = `lower(${a[0]})`;
      const c = (i: number) => `substr(${s}, ${i}, 1)`;
      const full = `(CASE WHEN length(${s}) = 4 THEN '#' || ${c(2)} || ${c(2)} || ${c(3)} || ${c(3)} || ${c(4)} || ${c(4)} ELSE ${s} END)`;
      const nibble = (k: number) =>
        `(strpos('0123456789abcdef', substr(${full}, CAST(2 + 2 * (${a[1]}) + ${k} AS INTEGER), 1)) - 1)`;
      return `(${nibble(0)} * 16 + ${nibble(1)})`;
    },
    wgsl: null,
    width: 1,
  },

  // `clamp` exists in both but DuckDB has no 3-arg clamp, so spell it out.
  clamp: {
    arity: [3, 3],
    sql: (a) => `least(greatest(${a[0]}, ${a[1]}), ${a[2]})`,
    wgsl: 'clamp',
    width: 'broadcast',
  },
  // Houdini's `fit`, the workhorse of every scale node.
  fit: {
    arity: [5, 5],
    sql: (a) =>
      `(${a[3]} + (${a[4]} - ${a[3]}) * ((${a[0]}) - (${a[1]})) / nullif((${a[2]}) - (${a[1]}), 0))`,
    wgsl: (a) =>
      `(${a[3]} + (${a[4]} - ${a[3]}) * ((${a[0]}) - (${a[1]})) / ((${a[2]}) - (${a[1]})))`,
    width: 'broadcast',
  },
  lerp: {
    arity: [3, 3],
    sql: (a) => `((${a[0]}) + ((${a[1]}) - (${a[0]})) * (${a[2]}))`,
    wgsl: 'mix',
    width: 'broadcast',
  },

  // --- GPU-only: no SQL equivalent, so these truncate the SQL stage ---------
  smoothstep: { arity: [3, 3], sql: null, wgsl: 'smoothstep', width: 'broadcast' },
  fract:      { arity: [1, 1], sql: null, wgsl: 'fract',      width: 'broadcast' },
  length:     { arity: [1, 1], sql: null, wgsl: 'length',     width: 1 },
  normalize:  { arity: [1, 1], sql: null, wgsl: 'normalize',  width: 'broadcast' },
  dot:        { arity: [2, 2], sql: null, wgsl: 'dot',        width: 1 },
  cross:      { arity: [2, 2], sql: null, wgsl: 'cross',      width: 3 },
  /** Sample the colorscale LUT. Inherently a GPU texture/buffer read. */
  ramp:       { arity: [1, 1], sql: null, wgsl: 'sampleRamp', width: 3 },

  // --- SQL-only: aggregates collapse rows, no per-invocation GPU analogue ---
  sum:      { arity: [1, 1], sql: 'sum',      wgsl: null, width: 1, aggregate: true },
  avg:      { arity: [1, 1], sql: 'avg',      wgsl: null, width: 1, aggregate: true },
  count:    { arity: [0, 1], sql: (a) => `count(${a[0] ?? '*'})`, wgsl: null, width: 1, aggregate: true },
  minAgg:   { arity: [1, 1], sql: 'min',      wgsl: null, width: 1, aggregate: true },
  maxAgg:   { arity: [1, 1], sql: 'max',      wgsl: null, width: 1, aggregate: true },
  median:   { arity: [1, 1], sql: 'median',   wgsl: null, width: 1, aggregate: true },
  quantile: { arity: [2, 2], sql: (a) => `quantile_cont(${a[0]}, ${a[1]})`, wgsl: null, width: 1, aggregate: true },
  stddev:   { arity: [1, 1], sql: 'stddev',   wgsl: null, width: 1, aggregate: true },
};

/** Operators that SQL spells differently from WGSL. */
const SQL_BINARY: Partial<Record<BinaryOp, string>> = {
  '&&': 'AND',
  '||': 'OR',
  '==': '=',
  '!=': '<>',
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'param'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

const PUNCT = ['{{', '}}', '&&', '||', '==', '!=', '<=', '>=', '(', ')', '[', ']', ',', '?', ':', '.', '+', '-', '*', '/', '%', '<', '>', '!'];

export class ExprError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }

    // SQL's quoting: single quotes, a doubled quote escapes one.
    if (ch === "'") {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= src.length) throw new ExprError(`Unterminated string at ${i} in ${JSON.stringify(src)}`);
        if (src[j] === "'") {
          if (src[j + 1] === "'") { value += "'"; j += 2; continue; }
          break;
        }
        value += src[j++];
      }
      out.push({ t: 'str', v: value });
      i = j + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'ident', v: m[0] });
      i += m[0].length;
      continue;
    }

    const punct = PUNCT.find((p) => src.startsWith(p, i));
    if (punct) {
      out.push({ t: 'op', v: punct });
      i += punct.length;
      continue;
    }

    throw new ExprError(`Unexpected character ${JSON.stringify(ch)} at ${i} in ${JSON.stringify(src)}`);
  }
  out.push({ t: 'eof' });
  return out;
}

// ---------------------------------------------------------------------------
// Parser (precedence climbing)
// ---------------------------------------------------------------------------

const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

/** Anything callable that is not in `FUNCTIONS`: a user-defined function. */
export interface ParseScope {
  readonly functions?: ReadonlyMap<string, { readonly params: readonly string[] }>;
}

/**
 * `scope.functions` lets a user-defined name parse.
 *
 * The parser validates call names and arity eagerly, which is worth keeping — a typo is
 * reported at the offending text rather than surfacing later as a mysterious engine
 * capability failure. So user functions have to be *declared to the parser* rather than the
 * check being relaxed for everyone.
 */
export function parseExpr(src: string, scope?: ParseScope): Expr {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos];
  const isOp = (v: string) => { const t = peek(); return t.t === 'op' && t.v === v; };
  const eat = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Expected ${JSON.stringify(v)} in ${JSON.stringify(src)}`);
    pos++;
  };

  function parseBinary(minPrec: number): Expr {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t.t !== 'op') break;
      const prec = BINARY_PRECEDENCE[t.v];
      if (prec === undefined || prec < minPrec) break;
      pos++;
      const right = parseBinary(prec + 1);
      left = { kind: 'binary', op: t.v as BinaryOp, left, right };
    }
    return left;
  }

  function parseTernary(): Expr {
    const test = parseBinary(1);
    if (!isOp('?')) return test;
    eat('?');
    const then = parseTernary();
    eat(':');
    const otherwise = parseTernary();
    return { kind: 'cond', test, then, else: otherwise };
  }

  function parseUnary(): Expr {
    if (isOp('-') || isOp('!')) {
      const op = (peek() as { t: 'op'; v: string }).v as UnaryOp;
      pos++;
      return { kind: 'unary', op, operand: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix(): Expr {
    let node = parsePrimary();
    while (isOp('.') || isOp('[')) {
      if (isOp('[')) {
        // `v[1]` is `v.y`: a component by position, for vectors read from a list column.
        eat('[');
        const t = peek();
        if (t.t !== 'num' || !Number.isInteger(t.v) || t.v > 3) {
          throw new ExprError(`An index must be a whole number from 0 to 3 in ${JSON.stringify(src)}`);
        }
        pos++;
        eat(']');
        node = { kind: 'swizzle', target: node, channels: 'xyzw'[t.v] };
        continue;
      }
      eat('.');
      const t = peek();
      if (t.t !== 'ident' || !/^[xyzwrgba]+$/.test(t.v) || t.v.length > 4) {
        throw new ExprError(`Bad swizzle after '.' in ${JSON.stringify(src)}`);
      }
      pos++;
      node = { kind: 'swizzle', target: node, channels: t.v };
    }
    return node;
  }

  function parsePrimary(): Expr {
    const t = peek();

    if (t.t === 'num') { pos++; return { kind: 'num', value: t.v }; }
    if (t.t === 'str') { pos++; return { kind: 'str', value: t.v }; }

    if (t.t === 'op' && t.v === '{{') {
      pos++;
      const name = peek();
      if (name.t !== 'ident') throw new ExprError(`Expected parameter name after '{{'`);
      pos++;
      eat('}}');
      return { kind: 'param', name: name.v };
    }

    if (t.t === 'op' && t.v === '(') {
      pos++;
      const inner = parseTernary();
      eat(')');
      return inner;
    }

    if (t.t === 'op' && t.v === '[') {
      pos++;
      const components: Expr[] = [];
      if (!isOp(']')) {
        for (;;) {
          components.push(parseTernary());
          if (isOp(',')) { pos++; continue; }
          break;
        }
      }
      eat(']');
      if (components.length < 2 || components.length > 4) {
        throw new ExprError(`Vector literals must have 2-4 components, got ${components.length}`);
      }
      return { kind: 'vec', components };
    }

    if (t.t === 'ident') {
      pos++;
      if (isOp('(')) {
        eat('(');
        const args: Expr[] = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(parseTernary());
            if (isOp(',')) { pos++; continue; }
            break;
          }
        }
        eat(')');
        const spec = FUNCTIONS[t.v];
        const user = spec ? undefined : scope?.functions?.get(t.v);
        if (!spec && !user) throw new ExprError(`Unknown function ${JSON.stringify(t.v)}`);
        const [lo, hi]: [number, number] = spec
          ? spec.arity
          : [user!.params.length, user!.params.length];
        if (args.length < lo || args.length > hi) {
          throw new ExprError(`${t.v}() takes ${lo === hi ? lo : `${lo}-${hi}`} args, got ${args.length}`);
        }
        return { kind: 'call', fn: t.v, args };
      }
      return { kind: 'col', name: t.v };
    }

    throw new ExprError(`Unexpected end of expression in ${JSON.stringify(src)}`);
  }

  const root = parseTernary();
  if (peek().t !== 'eof') {
    throw new ExprError(`Trailing tokens in ${JSON.stringify(src)}`);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Analysis — what the planner asks about a tree
// ---------------------------------------------------------------------------

export function walk(e: Expr, visit: (n: Expr) => void): void {
  visit(e);
  switch (e.kind) {
    case 'unary': walk(e.operand, visit); break;
    case 'binary': walk(e.left, visit); walk(e.right, visit); break;
    case 'call': e.args.forEach((a) => walk(a, visit)); break;
    case 'vec': e.components.forEach((c) => walk(c, visit)); break;
    case 'swizzle': walk(e.target, visit); break;
    case 'cond': walk(e.test, visit); walk(e.then, visit); walk(e.else, visit); break;
    default: break;
  }
}

export function columnsOf(e: Expr): string[] {
  const seen = new Set<string>();
  walk(e, (n) => { if (n.kind === 'col') seen.add(n.name); });
  return [...seen];
}

export function paramsOf(e: Expr): string[] {
  const seen = new Set<string>();
  walk(e, (n) => { if (n.kind === 'param') seen.add(n.name); });
  return [...seen];
}

const CHANNEL_INDEX: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };

/**
 * Resolve swizzles whose target is a vector literal: `[a, b].y` → `b`, `[a, b].yx` → `[b, a]`.
 *
 * This exists for inlined functions. A function taking a point is written `p.x`, so calling
 * it with `[lng, lat]` inlines as `[lng, lat].x`, and any swizzle rules out SQL (`enginesFor`).
 * Without this pass every geo function would be GPU-only even when all it touches is two
 * scalar columns. A swizzle of anything else — a vec column, a call — is left alone, as is a
 * channel past the literal's width, so the width errors still fire where they did before.
 */
export function simplifyExpr(e: Expr): Expr {
  switch (e.kind) {
    case 'num':
    case 'str':
    case 'col':
    case 'param':
      return e;
    case 'unary':
      return { ...e, operand: simplifyExpr(e.operand) };
    case 'binary':
      return { ...e, left: simplifyExpr(e.left), right: simplifyExpr(e.right) };
    case 'call':
      return { ...e, args: e.args.map(simplifyExpr) };
    case 'vec':
      return { ...e, components: e.components.map(simplifyExpr) };
    case 'cond':
      return { ...e, test: simplifyExpr(e.test), then: simplifyExpr(e.then), else: simplifyExpr(e.else) };
    case 'swizzle': {
      const target = simplifyExpr(e.target);
      // `[a, b, c].zy.x`: the inner swizzle has already become `[c, b]`, so this folds too.
      if (target.kind !== 'vec' || !SWIZZLE_OK.test(e.channels)) return { ...e, target };
      const picked = [...e.channels].map((ch) => target.components[CHANNEL_INDEX[ch]]);
      if (picked.some((c) => c === undefined)) return { ...e, target };
      return picked.length === 1 ? picked[0] : { kind: 'vec', components: picked };
    }
  }
}

/**
 * `item(v, 1)` is `v.y` when `v` is a vector column. A list column with one length in every
 * row is read as a vector, so an expression written to index it in SQL keeps working.
 *
 * `packed` names vectors known to be packed from scalar columns (`P = [P_0, P_1]`): one
 * component of such a vector, by `item` or a swizzle, is that column, so it stays in SQL.
 * `item` of anything else — a list, a computed index — is left alone.
 */
export function vectorItems(
  e: Expr,
  widthOfColumn: (name: string) => number,
  packed: (name: string) => Expr[] | undefined = () => undefined,
): Expr {
  const go = (n: Expr): Expr => {
    switch (n.kind) {
      case 'unary': return { ...n, operand: go(n.operand) };
      case 'binary': return { ...n, left: go(n.left), right: go(n.right) };
      case 'vec': return { ...n, components: n.components.map(go) };
      case 'cond': return { ...n, test: go(n.test), then: go(n.then), else: go(n.else) };
      case 'swizzle': {
        // `[P_0, P_1].y` folds to `P_1` in `simplifyExpr`.
        const comps = n.target.kind === 'col' ? packed(n.target.name) : undefined;
        return { ...n, target: comps ? { kind: 'vec', components: comps } : go(n.target) };
      }
      case 'call': {
        const [list, index] = n.args;
        if (n.fn === 'item' && list.kind === 'col' && index.kind === 'num' && Number.isInteger(index.value)) {
          const width = widthOfColumn(list.name);
          const comps = packed(list.name);
          if (comps && index.value >= 0 && index.value < comps.length) return comps[index.value];
          if (width > 1 && index.value >= 0 && index.value < Math.min(4, width)) {
            return { kind: 'swizzle', target: list, channels: 'xyzw'[index.value] };
          }
        }
        return { ...n, args: n.args.map(go) };
      }
      default: return n;
    }
  };
  return go(e);
}

/**
 * Which engines can evaluate this whole tree. This is what makes the planner's
 * engine assignment a lookup rather than a heuristic.
 */
export function enginesFor(e: Expr): Set<Engine> {
  const engines = new Set<Engine>(['sql', 'gpu']);
  walk(e, (n) => {
    if (n.kind === 'call') {
      const spec = FUNCTIONS[n.fn];
      if (!spec.sql) engines.delete('sql');
      if (!spec.wgsl) engines.delete('gpu');
    }
    // Swizzles and vector literals have no clean SQL representation: SQL columns are
    // scalars. A vec-valued expression has to be split into per-component columns,
    // which the SQL backend does at the top level only (see backends/sql.ts).
    if (n.kind === 'swizzle') engines.delete('sql');
    if (n.kind === 'str') engines.delete('gpu');
  });
  // SQL splits a vector into per-component columns at the top level only (`toSqlColumns`),
  // so a vector anywhere below it — `test ? [1, 0, 0] : [0, 0, 1]` — has no SQL form. Missed
  // here, the optimizer placed such a node in SQL and emission failed.
  const inner = e.kind === 'vec' ? e.components : [e];
  if (inner.some((c) => { let found = false; walk(c, (n) => { if (n.kind === 'vec') found = true; }); return found; })) {
    engines.delete('sql');
  }
  return engines;
}

/**
 * Whether a predicate is in the subset a GPU stream-compaction engine can evaluate: numeric
 * columns, literals and parameters, `+ - * /`, comparisons, `&& || !`. No `%`, no function
 * calls, no vectors, swizzles, conditionals or strings — the closed expression language of
 * luma.gl's GPU Dataframe, which is the engine this capability was written against.
 *
 * The root must be boolean. That is a type question the IR does not otherwise ask, so it is
 * answered here by shape: a comparison, a logical connective, or a negation of one.
 *
 * `toLumaExpr` in `src/luma` is a second implementation of the same rule; a browser test
 * asserts the two agree.
 */
export function compactable(e: Expr): boolean {
  return kindOf(e) === 'bool';

  function kindOf(n: Expr): 'num' | 'bool' | null {
    switch (n.kind) {
      case 'num':
      case 'col':
      case 'param':
        return 'num';
      case 'unary': {
        const inner = kindOf(n.operand);
        if (n.op === '-' && inner === 'num') return 'num';
        if (n.op === '!' && inner === 'bool') return 'bool';
        return null;
      }
      case 'binary': {
        const l = kindOf(n.left);
        const r = kindOf(n.right);
        if (n.op === '&&' || n.op === '||') return l === 'bool' && r === 'bool' ? 'bool' : null;
        if (l !== 'num' || r !== 'num') return null;
        if (n.op === '%') return null;
        return ['+', '-', '*', '/'].includes(n.op) ? 'num' : 'bool';
      }
      default:
        return null;
    }
  }
}

export function isAggregate(e: Expr): boolean {
  let agg = false;
  walk(e, (n) => {
    if (n.kind === 'call' && FUNCTIONS[n.fn].aggregate) agg = true;
  });
  return agg;
}

// ---------------------------------------------------------------------------
// Width inference — WGSL needs to know f32 vs vec3<f32>
// ---------------------------------------------------------------------------

export type WidthEnv = (name: string) => number;

const SWIZZLE_OK = /^[xyzw]+$|^[rgba]+$/;

export function widthOf(e: Expr, env: WidthEnv): number {
  switch (e.kind) {
    case 'num':
    case 'str':
    case 'param':
      return 1;
    case 'col':
      return env(e.name);
    case 'unary':
      return widthOf(e.operand, env);
    case 'binary': {
      // Comparisons and logic are scalar-ish; arithmetic broadcasts.
      const w = Math.max(widthOf(e.left, env), widthOf(e.right, env));
      return ['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(e.op) ? 1 : w;
    }
    case 'vec':
      return e.components.length;
    case 'swizzle': {
      if (!SWIZZLE_OK.test(e.channels)) {
        throw new ExprError(`Mixed swizzle sets not allowed: .${e.channels}`);
      }
      const of = widthOf(e.target, env);
      const last = Math.max(...[...e.channels].map((c) => 'xyzwrgba'.indexOf(c) % 4));
      if (of > 1 && last >= of) {
        throw new ExprError(`.${e.channels} reads component ${last} of a value with ${of} (0 to ${of - 1})`);
      }
      return e.channels.length;
    }
    case 'cond':
      return Math.max(widthOf(e.then, env), widthOf(e.else, env));
    case 'call': {
      const spec = FUNCTIONS[e.fn];
      if (typeof spec.width === 'number') return spec.width;
      return e.args.reduce((m, a) => Math.max(m, widthOf(a, env)), 1);
    }
  }
}

export { SQL_BINARY };
