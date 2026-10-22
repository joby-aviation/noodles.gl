/**
 * Relational lowering: each node that changes the row set becomes one DuckDB SELECT.
 *
 * These are the nodes `plan()` cannot take — it has one source and emits one statement — so
 * `compileProgram` splits a graph at them. Each lowers to a SELECT over its inputs' relations,
 * referenced as a temp table when the input is materialized and as a subquery when it is not.
 *
 * Two rules hold for every function here, and both are about what a relation is *for*:
 *
 *   - **Parameters are inlined as literals, never bound.** A relation is memoized under a hash
 *     that already includes the values it read, so a changed value is a different relation,
 *     not a rebind of the same one. Binds would also have nowhere to live: a
 *     `CREATE TABLE … AS` is executed once, not prepared.
 *   - **Computed numbers are DOUBLE, not FLOAT.** A relation is read again by SQL, so it keeps
 *     full precision; only the final layer query narrows to f32 for the buffer.
 */

import { type Expr, parseExpr, columnsOf } from './expr.js';
import { toSql, toSqlColumns, castToDouble, quoteIdent, SqlParams } from './backends/sql.js';
import { escapeLiteral } from './source.js';
import type {
  SourceNode, JoinNode, UnionNode, SortNode, LimitNode, SqlNode, GenerateNode, UnnestNode,
  Graph, GraphNode,
} from './types.js';
import { analyze, PlanError, type ColumnType, type AnalyzedNode } from './analyze.js';
import { GEO_PRELUDE } from './geo.js';

/** One column of a relation, as DuckDB describes it. */
export interface RelColumn {
  name: string;
  type: ColumnType;
  /** DuckDB's own type name, for display. */
  duckType: string;
}

/**
 * A vector attribute stored as scalar component columns (`P_0, P_1, P_2`). SQL columns are
 * scalars, so this is how a `vec3` survives a relation; the layer planner re-packs it.
 */
export interface RelVector {
  name: string;
  width: number;
}

export interface RelShape {
  columns: RelColumn[];
  vectors: RelVector[];
}

/** Numeric DuckDB types: everything a buffer can hold after a cast. */
const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|REAL|DOUBLE|DECIMAL|BOOLEAN)/i;
const STRING = /^(VARCHAR|TEXT|STRING|CHAR|BPCHAR|ENUM|UUID)/i;

/** Classify a DuckDB type name. */
export function columnTypeOf(duckType: string): ColumnType {
  if (NUMERIC.test(duckType)) return 'num';
  if (STRING.test(duckType)) return 'str';
  return 'other';
}

/** A literal for an inlined parameter. Numbers are cast so DuckDB never infers DECIMAL. */
export function sqlLiteral(value: number | string): string {
  if (typeof value === 'string') return `'${escapeLiteral(value)}'`;
  if (!Number.isFinite(value)) return 'CAST(NULL AS DOUBLE)';
  return `CAST(${value} AS DOUBLE)`;
}

/** Replace every `{{name}}` in literal SQL text with its value. */
export function inlineParamsInText(
  text: string,
  values: Record<string, number | string>,
  where: string,
  skip: ReadonlySet<string> = new Set(),
): { text: string; params: string[] } {
  const used = new Set<string>();
  const out = text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (m, name: string) => {
    if (skip.has(name)) return m;
    const v = values[name];
    if (v === undefined) throw new PlanError(`${where}: parameter '${name}' is not declared`);
    used.add(name);
    return sqlLiteral(v);
  });
  return { text: out, params: [...used] };
}

/** Substitute parameter values into a tree, so it emits with no binds. */
function inlineParams(e: Expr, values: Record<string, number | string>, used: Set<string>, where: string): Expr {
  const go = (n: Expr): Expr => {
    switch (n.kind) {
      case 'param': {
        const v = values[n.name];
        if (v === undefined) throw new PlanError(`${where}: parameter '${n.name}' is not declared`);
        used.add(n.name);
        return typeof v === 'string' ? { kind: 'str', value: v } : { kind: 'num', value: v };
      }
      case 'unary': return { ...n, operand: go(n.operand) };
      case 'binary': return { ...n, left: go(n.left), right: go(n.right) };
      case 'call': return { ...n, args: n.args.map(go) };
      case 'vec': return { ...n, components: n.components.map(go) };
      case 'swizzle': return { ...n, target: go(n.target) };
      case 'cond': return { ...n, test: go(n.test), then: go(n.then), else: go(n.else) };
      default: return n;
    }
  };
  return go(e);
}

function renderOption(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) return `[${value.map((v) => `'${escapeLiteral(v)}'`).join(', ')}]`;
  if (typeof value === 'string') return `'${escapeLiteral(value)}'`;
  return String(value);
}

// ---------------------------------------------------------------------------
// One function per relational node
// ---------------------------------------------------------------------------

export function sourceSql(node: SourceNode): string {
  const file = node.file;
  if (!file) {
    throw new PlanError(`Source ${node.id}: a program source needs 'file' (format and url)`);
  }
  const reader = file.format === 'csv' ? 'read_csv_auto'
    : file.format === 'json' ? 'read_json_auto'
    : 'read_parquet';
  const options = Object.entries(file.options ?? {}).map(([k, v]) => `, ${k} = ${renderOption(v)}`).join('');
  return `SELECT * FROM ${reader}('${escapeLiteral(file.url)}'${options})`;
}

export function joinSql(
  node: JoinNode,
  left: string,
  right: string,
  leftShape: RelShape,
  rightShape: RelShape,
): { sql: string; vectors: RelVector[] } {
  const how = node.how ?? 'inner';
  const prefix = node.prefix ?? '';
  const leftNames = new Set(leftShape.columns.map((c) => c.name));
  const rightItems: string[] = [];
  for (const c of rightShape.columns) {
    const out = `${prefix}${c.name}`;
    if (leftNames.has(out)) {
      throw new PlanError(
        `Join ${node.id}: both sides have a column '${out}'. Set 'prefix' to name the right side's columns apart.`,
      );
    }
    rightItems.push(`"r".${quoteIdent(c.name)} AS ${quoteIdent(out)}`);
  }
  let clause: string;
  if (how === 'cross') {
    if (node.on?.length) throw new PlanError(`Join ${node.id}: a cross join takes no 'on' keys`);
    clause = 'CROSS JOIN';
  } else {
    if (!node.on?.length) throw new PlanError(`Join ${node.id}: '${how}' needs at least one 'on' pair`);
    clause = how === 'left' ? 'LEFT JOIN' : 'JOIN';
  }
  const rightNames = new Set(rightShape.columns.map((c) => c.name));
  const keys = (node.on ?? []).map(([l, r]) => {
    if (!leftNames.has(l)) throw new PlanError(`Join ${node.id}: left side has no column '${l}'`);
    if (!rightNames.has(r)) throw new PlanError(`Join ${node.id}: right side has no column '${r}'`);
    return `"l".${quoteIdent(l)} = "r".${quoteIdent(r)}`;
  });
  const on = keys.length ? ` ON ${keys.join(' AND ')}` : '';
  const select = ['"l".*', ...rightItems].join(', ');
  return {
    sql: `SELECT ${select} FROM ${left} AS "l" ${clause} ${right} AS "r"${on}`,
    vectors: [
      ...leftShape.vectors,
      ...rightShape.vectors.map((v) => ({ name: `${prefix}${v.name}`, width: v.width })),
    ],
  };
}

export function unionSql(node: UnionNode, inputs: string[], shapes: RelShape[]): { sql: string; vectors: RelVector[] } {
  if (inputs.length < 2) throw new PlanError(`Union ${node.id}: needs at least two inputs`);
  const op = node.distinct ? 'UNION BY NAME' : 'UNION ALL BY NAME';
  // A vector survives only if every input carries it at the same width.
  const vectors = shapes[0].vectors.filter((v) =>
    shapes.every((s) => s.vectors.some((w) => w.name === v.name && w.width === v.width)));
  return { sql: inputs.map((r) => `SELECT * FROM ${r}`).join(` ${op} `), vectors };
}

export function sortSql(node: SortNode, input: string, shape: RelShape): string {
  const names = new Set(shape.columns.map((c) => c.name));
  const by = node.by.map((term) => {
    const m = /^\s*(\S+?)(?:\s+(asc|desc))?\s*$/i.exec(term);
    if (!m || !names.has(m[1])) throw new PlanError(`Sort ${node.id}: no column '${term}'`);
    return `${quoteIdent(m[1])}${m[2] ? ` ${m[2].toUpperCase()}` : ''}`;
  });
  if (by.length === 0) throw new PlanError(`Sort ${node.id}: 'by' is empty`);
  const limit = node.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(node.limit))}` : '';
  return `SELECT * FROM ${input} ORDER BY ${by.join(', ')}${limit}`;
}

export function limitSql(node: LimitNode, input: string): string {
  const offset = node.offset ? ` OFFSET ${Math.max(0, Math.floor(node.offset))}` : '';
  return `SELECT * FROM ${input} LIMIT ${Math.max(0, Math.floor(node.count))}${offset}`;
}

export function sqlNodeSql(
  node: SqlNode,
  inputs: string[],
  values: Record<string, number | string>,
): { sql: string; params: string[] } {
  const inputNames = new Set(['input', ...inputs.map((_, i) => `input${i}`)]);
  let text = node.query.replace(/\{\{\s*(input\d*)\s*\}\}/g, (_m, name: string) => {
    const index = name === 'input' ? 0 : Number(name.slice(5));
    const ref = inputs[index];
    if (ref === undefined) throw new PlanError(`SQL ${node.id}: {{${name}}} but only ${inputs.length} input(s) are connected`);
    return ref;
  });
  const inlined = inlineParamsInText(text, values, `SQL ${node.id}`, inputNames);
  text = inlined.text.trim().replace(/;+\s*$/, '');
  if (!/^\s*(select|with|from|values|\()/i.test(text)) {
    throw new PlanError(`SQL ${node.id}: the query must be a single SELECT (or WITH … SELECT)`);
  }
  return { sql: text, params: inlined.params };
}

export function generateSql(node: GenerateNode, values: Record<string, number | string>): { sql: string; params: string[] } {
  const name = node.name ?? 'i';
  let count: number;
  const params: string[] = [];
  if (typeof node.count === 'string') {
    const m = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/.exec(node.count);
    const v = m ? values[m[1]] : Number(node.count);
    if (m) params.push(m[1]);
    count = Number(v);
  } else {
    count = node.count;
  }
  if (!Number.isFinite(count) || count < 0) throw new PlanError(`Generate ${node.id}: count must be a non-negative number`);
  return {
    sql: `SELECT CAST("range" AS DOUBLE) AS ${quoteIdent(name)} FROM range(${Math.floor(count)})`,
    params,
  };
}

/**
 * Unnest in lockstep by indexing rather than by `unnest()` on each list: `unnest` of two
 * lists in one SELECT zips them, but pads the shorter with NULL, and pairing a vertex with the
 * wrong timestamp is worse than dropping it. One `generate_series` over the first list's
 * length gives each row an index; every list is read at that index.
 */
export function unnestSql(node: UnnestNode, input: string, shape: RelShape): { sql: string; vectors: RelVector[] } {
  if (node.lists.length === 0) throw new PlanError(`Unnest ${node.id}: 'lists' is empty`);
  const names = new Set(shape.columns.map((c) => c.name));
  for (const l of node.lists) {
    if (!names.has(l)) throw new PlanError(`Unnest ${node.id}: no column '${l}'`);
  }
  const rowId = node.rowId ?? 'row';
  const index = node.index ?? 'index';
  const first = quoteIdent(node.lists[0]);
  const items: string[] = [];
  for (const l of node.lists) {
    const at = `${quoteIdent(l)}[${quoteIdent(index)}]`;
    const split = node.split?.[l];
    if (split?.length) {
      split.forEach((component, c) => items.push(`${castToDouble(`${at}[${c + 1}]`)} AS ${quoteIdent(component)}`));
    } else {
      items.push(`${at} AS ${quoteIdent(node.as?.[l] ?? l)}`);
    }
  }
  const exclude = node.lists.map(quoteIdent).join(', ');
  const numbered = `SELECT *, CAST(row_number() OVER () AS DOUBLE) AS ${quoteIdent(rowId)} FROM ${input}`;
  const expanded = `SELECT *, unnest(generate_series(1, len(${first}))) AS ${quoteIdent(index)} FROM (${numbered})`;
  return {
    sql: `SELECT * EXCLUDE (${exclude}), ${items.join(', ')} FROM (${expanded})`,
    vectors: [],
  };
}

// ---------------------------------------------------------------------------
// Row-wise chains lowered into a relation
// ---------------------------------------------------------------------------

/**
 * Lower row-wise nodes to SQL, for when they feed a relational node.
 *
 * A filter ahead of a join has to run *in* SQL, because the join reads a relation. So the
 * chain between the nearest relation and the join's input is analyzed exactly as `plan()`
 * would analyze it — same parser, same function inlining, same width and string tracking —
 * and then every node is emitted as SQL. A node with no SQL form (a `ramp()`, a swizzle) is
 * an error here with the reason, not a surprise at execution.
 */
export function rowwiseSql(
  chain: GraphNode[],
  input: string,
  shape: RelShape,
  values: Record<string, number | string>,
  graph: Pick<Graph, 'functions' | 'params'>,
  label: string,
): { sql: string; vectors: RelVector[]; params: string[] } {
  if (chain.length === 0) return { sql: `SELECT * FROM ${input}`, vectors: shape.vectors, params: [] };
  const schema = new Map<string, number>();
  const types = new Map<string, ColumnType>();
  for (const c of shape.columns) {
    types.set(c.name, c.type);
    if (c.type === 'num') schema.set(c.name, 1);
  }
  const last = chain[chain.length - 1];
  const sourceId = '__rel';
  const rewire = (n: GraphNode): GraphNode => {
    const copy = structuredClone(n) as GraphNode & { input?: string; inputs?: string[] };
    const ids = new Set(chain.map((c) => c.id));
    const fix = (id: string) => (ids.has(id) ? id : sourceId);
    if (typeof copy.input === 'string') copy.input = fix(copy.input);
    if (copy.inputs) copy.inputs = copy.inputs.map(fix);
    return copy;
  };
  const sub: Graph = {
    params: graph.params,
    functions: graph.functions,
    nodes: [
      { id: sourceId, type: 'source', dataset: { ref: sourceId } },
      ...chain.map(rewire),
      { id: '__out', type: 'render', input: last.id, mode: 'points' },
    ],
    output: '__out',
  };
  // Parameters are inlined as literals below, and DuckDB folds a literal subexpression itself.
  const analysis = analyze(sub, schema, undefined, types, { hoist: false });
  const used = new Set<string>();
  const vectors = [...shape.vectors];
  const vectorNames = new Set(vectors.map((v) => v.name));
  let columns = new Set(shape.columns.map((c) => c.name));
  let sql = `SELECT * FROM ${input}`;

  const excluding = (names: string[]) => {
    const shadowed = names.filter((n) => columns.has(n));
    return shadowed.length ? `* EXCLUDE (${shadowed.map(quoteIdent).join(', ')})` : '*';
  };
  const noVectorReads = (node: AnalyzedNode) => {
    const read = node.expr ? columnsOf(node.expr).filter((c) => vectorNames.has(c)) : [];
    if (read.length) {
      throw new PlanError(
        `Node ${node.id}: reads vector '${read[0]}' inside ${label}; SQL sees only its components (${read[0]}_0, …)`,
      );
    }
  };

  for (const node of analysis.order) {
    if (!node.feasible.has('sql')) {
      throw new PlanError(`Node ${node.id}: feeds ${label}, so it must run in SQL, and it has no SQL form`);
    }
    noVectorReads(node);
    switch (node.kind) {
      case 'filter': {
        const e = inlineParams(node.expr!, values, used, `Node ${node.id}`);
        sql = `SELECT * FROM (${sql}) WHERE ${toSql(e, new SqlParams()).code}`;
        break;
      }
      case 'attribute': {
        const e = inlineParams(node.expr!, values, used, `Node ${node.id}`);
        const name = node.name!;
        if (analysis.strings.has(name)) {
          sql = `SELECT ${excluding([name])}, ${toSql(e, new SqlParams()).code} AS ${quoteIdent(name)} FROM (${sql})`;
          columns.add(name);
          break;
        }
        const { items } = toSqlColumns(e, name, new SqlParams(), castToDouble);
        const outNames = node.width === 1 ? [name] : Array.from({ length: node.width }, (_, i) => `${name}_${i}`);
        sql = `SELECT ${excluding(outNames)}, ${items.join(', ')} FROM (${sql})`;
        for (const n of outNames) columns.add(n);
        if (node.width > 1 && !vectorNames.has(name)) {
          vectors.push({ name, width: node.width });
          vectorNames.add(name);
        }
        break;
      }
      case 'aggregate': {
        const groups = node.groupBy!.map(quoteIdent);
        const aggs = node.aggs!.map((a) => {
          const e = inlineParams(a.expr, values, used, `Node ${node.id}`);
          return `${castToDouble(toSql(e, new SqlParams()).code)} AS ${quoteIdent(a.name)}`;
        });
        sql = `SELECT ${[...groups, ...aggs].join(', ')} FROM (${sql}) GROUP BY ${groups.join(', ')}`;
        columns = new Set([...node.groupBy!, ...node.aggs!.map((a) => a.name)]);
        vectors.length = 0;
        vectorNames.clear();
        break;
      }
      default:
        throw new PlanError(`Node ${node.id}: a ${node.kind} node cannot feed ${label}`);
    }
  }
  if (analysis.statsNodes.length) {
    throw new PlanError(`${label}: stats nodes publish parameters to layers and cannot feed a relation`);
  }
  return { sql, vectors, params: [...used] };
}

/** Parse check for editor feedback: the error text for an expression, or undefined. */
export function exprError(src: string): string | undefined {
  try {
    // The prelude is in every graph's scope (`desugar`), so the editor must accept it too.
    parseExpr(src, { functions: GEO_PRELUDE });
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}
