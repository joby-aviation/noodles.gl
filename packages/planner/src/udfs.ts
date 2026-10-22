/**
 * JS functions, run by DuckDB as scalar UDFs.
 *
 * A graph declares them like its expression functions, with a JavaScript body:
 *
 *     "udfs": { "wobble": { "params": ["t", { "name": "code", "type": "text" }], "body": "return Math.sin(t) * code.length", "width": 1 } }
 *
 * and any expression calls `wobble(t, name)`. A call compiles to SQL only, because that is
 * where DuckDB runs JavaScript: the engine registers each function with DuckDB from its body
 * before it compiles the graph. A function returns numbers; one returning a vector of `width`
 * components is that many DuckDB functions, one per component, which the expression sees as
 * one vector. (DuckDB-Wasm's UDFs return numbers reliably; text returns do not work.)
 *
 * The DuckDB name carries a hash of the body, so a changed body is a new function and a
 * relation over the old one is never reused for the new.
 */

import { type Expr, FUNCTIONS } from './expr.js';
import { addFunction, type FunctionDef } from './functions.js';
import { hashOf } from './hash.js';

export interface UdfParam {
  name: string;
  /** How DuckDB passes it: a number (DOUBLE, the default) or text (VARCHAR). */
  type?: 'number' | 'text';
}

export interface UdfSpec {
  params: (string | UdfParam)[];
  /** A function body: `return` the value, a number or an array of `width` numbers. */
  body: string;
  /** Components returned; 1 (a number) when absent. */
  width?: number;
}

/** What the engine registers with DuckDB for one component of one function. */
export interface UdfRegistration {
  /** The DuckDB function name. */
  sqlName: string;
  params: Required<UdfParam>[];
  body: string;
  /** Which component this function returns, of `width`. */
  component: number;
  width: number;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function params(spec: UdfSpec): Required<UdfParam>[] {
  return spec.params.map((p) => (typeof p === 'string' ? { name: p, type: 'number' } : { name: p.name, type: p.type ?? 'number' }));
}

/** Every DuckDB function a graph's UDFs need, for the engine to register. */
export function udfRegistrations(udfs: Record<string, UdfSpec> | undefined): UdfRegistration[] {
  return Object.entries(udfs ?? {}).flatMap(([name, spec]) => {
    const width = Math.max(1, Math.min(4, Math.round(spec.width ?? 1)));
    const base = `udf_${name.toLowerCase()}_${hashOf({ params: spec.params, body: spec.body, width }).slice(0, 10)}`;
    return Array.from({ length: width }, (_, component) => ({
      sqlName: `${base}_${component}`,
      params: params(spec),
      body: spec.body,
      component,
      width,
    }));
  });
}

/**
 * Make a graph's UDFs callable: each component a SQL-only entry in the function table, and
 * each UDF a macro in the graph's registry expanding a call to its components.
 */
export function registerUdfs(into: Map<string, FunctionDef>, udfs: Record<string, UdfSpec> | undefined): void {
  const regs = udfRegistrations(udfs);
  for (const [name, spec] of Object.entries(udfs ?? {})) {
    if (!NAME.test(name)) throw new Error(`udfs.${name}: '${name}' is not a valid function name`);
    const mine = regs.filter((r) => r.sqlName.startsWith(`udf_${name.toLowerCase()}_`) && r.body === spec.body);
    for (const r of mine) {
      // DuckDB takes a UDF's arguments as DOUBLE or VARCHAR only, so each is cast
      const casts = r.params.map((p) => (p.type === 'text' ? 'VARCHAR' : 'DOUBLE'));
      FUNCTIONS[r.sqlName] = {
        arity: [r.params.length, r.params.length],
        sql: (args) => `${r.sqlName}(${args.map((a, i) => `CAST(${a} AS ${casts[i]})`).join(', ')})`,
        wgsl: null,
        width: 1,
        textArgs: r.params.map((p) => p.type === 'text'),
      };
    }
    const call = (fn: string, args: readonly Expr[]): Expr => ({ kind: 'call', fn, args: [...args] });
    addFunction(into, {
      name,
      params: mine[0]?.params.map((p) => p.name) ?? [],
      expand: (args) =>
        mine.length === 1 ? call(mine[0].sqlName, args) : { kind: 'vec', components: mine.map((r) => call(r.sqlName, args)) },
      source: `udfs.${name}`,
    });
  }
}
