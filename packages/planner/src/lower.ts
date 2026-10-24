/**
 * Document -> graph, plus the scalar program that feeds it.
 *
 * Lowering splits an editor document into the two things that change at different speeds:
 *
 *   - a `Graph` for `compileProgram`, rebuilt only on a structural edit — a new node, a new
 *     wire, a different column in a menu;
 *   - a `ScalarProgram` that computes every parameter's value at a time `T`, evaluated every
 *     frame. It holds everything that is "just a number": sliders, expressions, `ch()`
 *     references between parameters, wires from Number, Math, Time and Expression nodes, and
 *     keyframe tracks.
 *
 * The seam between them is the parameter placeholder. A value parameter lowers to
 * `{{node__param}}` in the graph; the scalar program supplies its value; the planner decides
 * whether a change is a uniform write, a rebind, a CPU pass or a rematerialize. So a keyframed
 * threshold or a camera flying along its keyframes never recompiles anything — and because the
 * program knows which parameters are animated, it declares them with `changeRate = fps`, which
 * is what lets the optimizer price an animation like the slider it effectively is.
 */

import type { UdfSpec } from './udfs.js';
import { statParamName, type Graph, type GraphNode, type ParamSpec, type DeckNode, type LayerNode, type StatOp } from './types.js';
import { parseExpr, type Expr } from './expr.js';
import { toJs } from './backends/js.js';
import { evaluateTrack, type Track } from './keyframes.js';
import {
  type EditorDoc, type DocNode, type DocEdge, type ParamValue,
  DocumentError, flattenSubnets, applyBypass, resolveRef, isExpr, isRef, nameOf,
} from './doc.js';
import {
  type OpDef, type ParamDef, type LowerCtx, OPERATOR_INDEX, bindingOf, safeId,
} from './operators.js';

export type SlotValue = number | string | boolean | number[];

/** The time, and the pointer over the map in CSS pixels (`MX`, `MY`) when the host tracks it. */
export interface Clock { T: number; F: number; MX?: number; MY?: number }

type Source =
  | { kind: 'literal'; value: SlotValue }
  | { kind: 'expr'; text: string; deps: string[]; clock: boolean; pointer?: boolean; run: (deps: number[], clock: Clock) => number }
  | { kind: 'alias'; key: string }
  | { kind: 'track'; track: Track; fallback: Source }
  | { kind: 'scalar'; node: DocNode; op: OpDef; port?: string }
  | { kind: 'error'; message: string };

/** Keys of slot `nodeId.param`, and of a scalar node's output `nodeId.out`. */
export const slotKey = (nodeId: string, param: string): string => `${nodeId}.${param}`;

/**
 * Compile a parameter expression — `ch('../ctl/k') * 2 + sin(T)` — through the JS backend, so
 * it has exactly the semantics the CPU stage gives the same functions, `%` included.
 * `vars` maps a bare name to the slot it reads; `T` and `F` are the clock.
 */
function compileScalar(
  text: string,
  resolve: (ref: string) => string,
  vars: Record<string, string> = {},
): Extract<Source, { kind: 'expr' }> {
  const tree = parseExpr(text, { functions: new Map([['ch', { params: ['path'] }]]) });
  const deps: string[] = [];
  let clock = false;
  let pointer = false;
  const depVar = (key: string) => {
    let i = deps.indexOf(key);
    if (i < 0) { deps.push(key); i = deps.length - 1; }
    return `d${i}`;
  };
  const rewrite = (n: Expr): Expr => {
    switch (n.kind) {
      case 'call':
        if (n.fn === 'ch') {
          const arg = n.args[0];
          if (arg?.kind !== 'str') throw new DocumentError(`ch() takes a quoted path, e.g. ch('../ctl/value')`);
          return { kind: 'param', name: depVar(resolve(arg.value)) };
        }
        return { ...n, args: n.args.map(rewrite) };
      case 'col':
        if (n.name === 'T' || n.name === 'F') { clock = true; return { kind: 'param', name: n.name }; }
        if (n.name === 'MX' || n.name === 'MY') { pointer = true; return { kind: 'param', name: n.name }; }
        if (vars[n.name]) return { kind: 'param', name: depVar(vars[n.name]) };
        throw new DocumentError(`Unknown name '${n.name}' in '${text}'. Use T, F, MX, MY or ch('path').`);
      case 'unary': return { ...n, operand: rewrite(n.operand) };
      case 'binary': return { ...n, left: rewrite(n.left), right: rewrite(n.right) };
      case 'vec': return { ...n, components: n.components.map(rewrite) };
      case 'swizzle': return { ...n, target: rewrite(n.target) };
      case 'cond': return { ...n, test: rewrite(n.test), then: rewrite(n.then), else: rewrite(n.else) };
      default: return n;
    }
  };
  const js = toJs(rewrite(tree), () => { throw new DocumentError('unreachable'); });
  if (js.width !== 1) throw new DocumentError(`'${text}' is a vector; a parameter holds one number`);
  const body = `return (${js.components[0]});`;
  const fn = new Function('p', body) as (p: Record<string, number>) => number;
  return {
    kind: 'expr', text, deps, clock, pointer,
    run: (values, c) => {
      const p: Record<string, number> = { T: c.T, F: c.F, MX: c.MX ?? 0, MY: c.MY ?? 0 };
      values.forEach((v, i) => { p[`d${i}`] = v; });
      return fn(p);
    },
  };
}

export class ScalarProgram {
  private readonly animatedMemo = new Map<string, boolean>();

  constructor(private readonly sources: Map<string, Source>) {}

  has(key: string): boolean {
    return this.sources.has(key);
  }

  /** Every slot's value at one instant. Cycles and bad expressions come back as errors. */
  evaluate(clock: Clock, external?: External): { values: Map<string, SlotValue>; errors: Map<string, string> } {
    const values = new Map<string, SlotValue>();
    const errors = new Map<string, string>();
    const visiting = new Set<string>();
    const get = (key: string): SlotValue => {
      const done = values.get(key);
      if (done !== undefined) return done;
      if (visiting.has(key)) {
        errors.set(key, `cycle through ${key}`);
        return NaN;
      }
      const src = this.sources.get(key);
      if (!src) {
        // A host operator's output, which the host application computes
        const outside = external?.get(key) as SlotValue | undefined;
        if (outside !== undefined && outside !== null) { values.set(key, outside); return outside; }
        errors.set(key, `nothing named ${key}`);
        return NaN;
      }
      visiting.add(key);
      const v = this.run(src, key, get, clock, errors);
      visiting.delete(key);
      values.set(key, v);
      return v;
    };
    for (const key of this.sources.keys()) get(key);
    return { values, errors };
  }

  private run(src: Source, key: string, get: (k: string) => SlotValue, clock: Clock, errors: Map<string, string>): SlotValue {
    switch (src.kind) {
      case 'literal': return src.value;
      case 'alias': return get(src.key);
      case 'error': errors.set(key, src.message); return NaN;
      case 'track': {
        const v = evaluateTrack(src.track, clock.T);
        return v ?? this.run(src.fallback, key, get, clock, errors);
      }
      case 'expr': {
        try {
          return src.run(src.deps.map((d) => Number(get(d))), clock);
        } catch (err) {
          errors.set(key, (err as Error).message);
          return NaN;
        }
      }
      case 'scalar': {
        const id = src.node.id;
        const num = (p: string) => Number(get(slotKey(id, p)));
        // An object (a curve, a list of stops) reaches a scalar operator as JSON
        const str = (p: string) => {
          const v = get(slotKey(id, p));
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
        };
        if (src.op.type === 'expression') return get(slotKey(id, '__expr'));
        if (src.port !== undefined) return src.op.scalarPorts?.[src.port]?.({ num, str }, clock) ?? NaN;
        return src.op.scalar ? src.op.scalar({ num, str }, clock) : NaN;
      }
    }
  }

  /** True when a slot reads the pointer, so the host should move the clock's `MX`, `MY`. */
  readsPointer(): boolean {
    for (const src of this.sources.values()) {
      if (src.kind === 'expr' && src.pointer) return true;
      if (src.kind === 'scalar' && src.op.readsPointer) return true;
    }
    return false;
  }

  /** True when a slot's value can change without an edit: keyframed, or reading the clock. */
  animated(key: string, seen = new Set<string>()): boolean {
    const memo = this.animatedMemo.get(key);
    if (memo !== undefined) return memo;
    if (seen.has(key)) return false;
    seen.add(key);
    const src = this.sources.get(key);
    let out = false;
    if (src) {
      switch (src.kind) {
        case 'track': out = src.track.keyframes.length > 1; break;
        case 'alias': out = this.animated(src.key, seen); break;
        case 'expr': out = src.clock || src.deps.some((d) => this.animated(d, seen)); break;
        case 'scalar':
          out = src.op.type === 'time' ||
            [...this.sources.keys()].some((k) => k.startsWith(`${src.node.id}.`) && k !== key && this.animated(k, seen));
          break;
        default: out = false;
      }
    }
    this.animatedMemo.set(key, out);
    return out;
  }

  /** Slots a slot reads, for drawing reference edges. */
  dependencies(key: string): string[] {
    const src = this.sources.get(key);
    if (!src) return [];
    switch (src.kind) {
      case 'alias': return [src.key];
      case 'expr': return src.deps;
      case 'track': return [];
      default: return [];
    }
  }
}

export interface LoweredParam {
  /** The IR parameter name. */
  name: string;
  /** The slot it reads. */
  key: string;
  /** For a color: which component. */
  component?: number;
  binding: 'value' | 'prop';
}

export interface Lowered {
  graph: Graph;
  scalars: ScalarProgram;
  /** Doc node id -> output port -> IR node id. */
  outputs: Record<string, Record<string, string>>;
  /** IR parameter name -> where its value comes from. */
  params: Record<string, LoweredParam>;
  /** Slot key -> IR parameter names it feeds, for route badges. */
  slotParams: Record<string, string[]>;
  /** Doc node id -> IR node ids it lowered to. */
  irNodes: Record<string, string[]>;
  errors: { nodeId: string; message: string }[];
  /** Parameter references (slot -> slot), for dashed edges. */
  references: { from: string; to: string }[];
  deck?: string;
}

export interface LowerOptions {
  /** Frames per second while animating: the change rate of an animated parameter. */
  fps?: number;
  /** Position expression for a node's display-flag preview, e.g. from its known columns. */
  displayPosition?: (nodeId: string) => string | undefined;
  /**
   * A query reading a host operator's table output (rows the host put in DuckDB), so planner
   * nodes can read what a host operator made. Undefined while there is none yet.
   */
  hostTable?: (nodeId: string, port: string) => string | undefined;
  /** Values the scalar program does not compute: a host application's operator outputs. */
  external?: External;
}

/**
 * Values from outside the scalar program, by key: `nodeId.out.<port>` for an operator the host
 * application runs, and `nodeId.out.<port>.<path>` for a value inside one of its outputs.
 */
export interface External { get(key: string): unknown }

/** The key an edge from an output reads: a number operator's `out`, or any other's port. */
export const outputKey = (op: OpDef | undefined, nodeId: string, port: string): string =>
  op?.category === 'number' && !op.scalarPorts ? slotKey(nodeId, 'out') : slotKey(nodeId, `out.${port}`);

const firstTablePort = (n: DocNode): string | undefined =>
  OPERATOR_INDEX.get(n.op)?.inputs.find((p) => p.type === 'table')?.name;

export function lowerDocument(doc: EditorDoc, options: LowerOptions = {}): Lowered {
  const fps = options.fps ?? doc.timeline?.fps ?? 30;
  const flat = flattenSubnets(doc);
  const nodes = flat.nodes;
  // A bypassed transform passes its input through; a bypassed layer, whose output is not a
  // table, has nothing to pass and drops out with its wires.
  const passThrough = (n: DocNode) => OPERATOR_INDEX.get(n.op)?.outputs[0]?.type === 'table' ? firstTablePort(n) : undefined;
  const edges = applyBypass(nodes, flat.edges, passThrough);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const errors: Lowered['errors'] = [];
  const tracks = new Map((doc.timeline?.tracks ?? []).map((t) => [t.target, t]));
  const docForRefs = { nodes: doc.nodes };
  // References are paths in the network a person drew, so they resolve against the original
  // nodes: after flattening a child's `parent` is gone and `..` would climb from the wrong place.
  const drawn = new Map(doc.nodes.map((n) => [n.id, n]));
  const asDrawn = (n: DocNode): DocNode => drawn.get(n.id) ?? n;

  // --- slots ------------------------------------------------------------------
  const sources = new Map<string, Source>();
  const references: Lowered['references'] = [];
  const paramEdge = new Map<string, DocEdge>();
  for (const e of edges) {
    if (e.targetPort.startsWith('par:')) paramEdge.set(slotKey(e.target, e.targetPort.slice(4)), e);
  }
  const sourceFor = (node: DocNode, def: ParamDef | undefined, param: string, value: ParamValue | undefined): Source => {
    const key = slotKey(node.id, param);
    const edge = paramEdge.get(key);
    if (edge && OPERATOR_INDEX.get(byId.get(edge.source)?.op ?? '')?.stats) {
      // A statistic binds in the plan (see `bind`); the scalar program has no value for it.
      references.push({ from: slotKey(edge.source, edge.sourcePort), to: key });
      return { kind: 'literal', value: 0 };
    }
    if (edge) {
      const from = outputKey(OPERATOR_INDEX.get(byId.get(edge.source)?.op ?? ''), edge.source, edge.sourcePort);
      references.push({ from, to: key });
      return { kind: 'alias', key: from };
    }
    let base: Source;
    try {
      if (isRef(value)) {
        const target = resolveRef(docForRefs, asDrawn(node), value.ref);
        references.push({ from: target, to: key });
        base = { kind: 'alias', key: target };
      } else if (isExpr(value) && def?.kind !== 'expr' && def?.kind !== 'code') {
        const compiled = compileScalar(value.expr, (ref) => {
          const target = resolveRef(docForRefs, asDrawn(node), ref);
          references.push({ from: target, to: key });
          return target;
        });
        base = compiled;
      } else {
        base = { kind: 'literal', value: (value ?? def?.default ?? 0) as SlotValue };
      }
    } catch (err) {
      base = { kind: 'error', message: (err as Error).message };
    }
    const track = tracks.get(key);
    return track && track.keyframes.length ? { kind: 'track', track, fallback: base } : base;
  };

  for (const node of nodes) {
    const op = OPERATOR_INDEX.get(node.op);
    const defs = op?.params ?? [];
    for (const def of defs) sources.set(slotKey(node.id, def.name), sourceFor(node, def, def.name, node.params[def.name]));
    // Parameters without a definition — a flattened subnet's promoted values — still resolve.
    for (const [param, value] of Object.entries(node.params)) {
      if (!defs.some((d) => d.name === param)) sources.set(slotKey(node.id, param), sourceFor(node, undefined, param, value));
    }
    if (op?.scalarPorts) {
      for (const port of Object.keys(op.scalarPorts)) {
        sources.set(slotKey(node.id, `out.${port}`), { kind: 'scalar', node, op, port });
      }
    } else if (op?.category === 'number') {
      sources.set(slotKey(node.id, 'out'), { kind: 'scalar', node, op });
      if (op.type === 'expression') {
        const text = node.params.expression;
        const exprText = typeof text === 'string' ? text : isExpr(text) ? text.expr : String(op.params.find((p) => p.name === 'expression')!.default);
        try {
          sources.set(slotKey(node.id, '__expr'), compileScalar(exprText, (ref) => resolveRef(docForRefs, asDrawn(node), ref), {
            a: slotKey(node.id, 'a'), b: slotKey(node.id, 'b'),
          }));
        } catch (err) {
          sources.set(slotKey(node.id, '__expr'), { kind: 'error', message: (err as Error).message });
        }
      }
    }
  }
  const scalars = new ScalarProgram(sources);
  const initial = scalars.evaluate({ T: 0, F: 0 }, options.external).values;

  // --- lowering -------------------------------------------------------------
  const outputs: Lowered['outputs'] = {};
  const irNodes: Lowered['irNodes'] = {};
  const params: Lowered['params'] = {};
  const slotParams: Lowered['slotParams'] = {};
  const specs: Record<string, ParamSpec> = {};
  const irOut: GraphNode[] = [];
  const failed = new Set<string>();
  let deckId: string | undefined;

  const registerParam = (key: string, def: ParamDef | undefined, label: string, binding: 'value' | 'prop', component?: number): string => {
    const [nodeId, param] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)];
    const name = `${safeId(nodeId)}__${safeId(param)}${component !== undefined ? `_${component}` : ''}`;
    if (!params[name]) {
      params[name] = { name, key, component, binding };
      (slotParams[key] ??= []).push(name);
      const v = initial.get(key);
      const value = component !== undefined && Array.isArray(v) ? v[component] : v;
      const animated = scalars.animated(key);
      specs[name] = {
        value: typeof value === 'string' ? value : Number(value ?? 0),
        kind: 'value',
        min: def?.min, max: def?.max, step: def?.step, label,
        // An animated parameter changes every frame while playing, and the optimizer should
        // know: that is the whole reason keyframes are declared rather than just applied.
        changeRate: animated ? fps : def?.changeRate ?? 2,
      };
    }
    return name;
  };

  const lowerNode = (id: string): Record<string, string> | undefined => {
    if (outputs[id]) return outputs[id];
    if (failed.has(id)) return undefined;
    const node = byId.get(id);
    if (!node) return undefined;
    const op = OPERATOR_INDEX.get(node.op);
    if (op && !op.lower && options.hostTable) {
      // A host operator lowers to nothing but the tables it has handed over.
      const tables = op.outputs.flatMap((p) => {
        const query = options.hostTable?.(id, p.name);
        return query ? [{ port: p.name, node: { id: `${id}#${p.name}`, type: 'sql' as const, query } }] : [];
      });
      if (tables.length === 0) return undefined;
      irOut.push(...tables.map((t) => t.node));
      irNodes[id] = tables.map((t) => t.node.id);
      outputs[id] = Object.fromEntries(tables.map((t) => [t.port, t.node.id]));
      return outputs[id];
    }
    if (!op?.lower) return undefined;
    // Placeholder so a cycle is reported instead of recursing forever.
    failed.add(id);
    const defOf = (param: string) => {
      const d = op.params.find((p) => p.name === param);
      if (!d) throw new DocumentError(`${op.label} has no parameter '${param}'`, id);
      return d;
    };
    const literal = (param: string): SlotValue => {
      const d = defOf(param);
      const raw = node.params[param];
      // Structural parameters are text in the graph. An expression in one is evaluated now,
      // so it holds; changing its inputs recompiles, which is what structural means.
      if (isExpr(raw) || isRef(raw)) return initial.get(slotKey(id, param)) ?? d.default as SlotValue;
      return (raw ?? d.default) as SlotValue;
    };
    const rewriteRefs = (text: string) => text.replace(/\bch\(\s*(['"])(.*?)\1\s*\)/g, (_m, _q, ref: string) => {
      const target = resolveRef(docForRefs, asDrawn(node), ref);
      references.push({ from: target, to: slotKey(id, '(expr)') });
      return `{{${registerParam(target, undefined, ref, 'value')}}}`;
    });
    const ctx: LowerCtx = {
      id,
      input(port) {
        const got = ctx.maybeInput(port);
        if (!got) throw new DocumentError(`${op.label}: connect its '${port}' input`, id);
        return got;
      },
      maybeInput(port) {
        const e = edges.find((x) => x.target === id && x.targetPort === port);
        if (!e) return undefined;
        const up = lowerNode(e.source);
        const ir = up?.[e.sourcePort];
        if (!ir) {
          const src = byId.get(e.source);
          const host = src && !OPERATOR_INDEX.get(src.op)?.lower;
          throw new DocumentError(`input '${nameOf(src ?? node)}' ${host ? 'has no rows yet' : 'failed'}`, id);
        }
        return ir;
      },
      inputs(port) {
        return edges
          .filter((x) => x.target === id && x.targetPort === port)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .flatMap((e) => {
            // A host operator's layers are the host's to draw; its tables are not layers.
            if (!OPERATOR_INDEX.get(byId.get(e.source)?.op ?? '')?.lower) return [];
            // A bypassed or failed layer drops out of a deck rather than failing it.
            const up = lowerNode(e.source);
            const ir = up?.[e.sourcePort];
            return ir ? [ir] : [];
          });
      },
      str: (param) => String(literal(param) ?? ''),
      num: (param) => Number(literal(param)),
      bool: (param) => { const v = literal(param); return v === true || v === 'true' || v === 1; },
      bind(param) {
        const d = defOf(param);
        const stat = paramEdge.get(slotKey(id, param));
        const statNode = stat ? byId.get(stat.source) : undefined;
        if (stat && statNode && OPERATOR_INDEX.get(statNode.op)?.stats) {
          if (!lowerNode(statNode.id)) ctx.error(`input '${nameOf(statNode)}' failed`);
          return `{{${statParamName(safeId(statNode.id), stat.sourcePort as StatOp)}}}`;
        }
        const binding = bindingOf(d);
        if (binding === 'structural') return String(literal(param));
        return `{{${registerParam(slotKey(id, param), d, `${nameOf(node)} ${d.label}`, binding)}}}`;
      },
      bindColor(param) {
        const d = defOf(param);
        return [0, 1, 2].map((c) => `{{${registerParam(slotKey(id, param), d, `${nameOf(node)} ${d.label}`, 'prop', c)}}}`);
      },
      expr(param) {
        defOf(param);
        const raw = node.params[param];
        const text = isExpr(raw) ? raw.expr : String(raw ?? defOf(param).default);
        return rewriteRefs(text);
      },
      error(message) { throw new DocumentError(message, id); },
    };
    try {
      const result = op.lower(ctx);
      irOut.push(...result.nodes);
      irNodes[id] = result.nodes.map((n) => n.id);
      outputs[id] = result.outputs;
      failed.delete(id);
      if (node.op === 'deck') deckId = id;
      return result.outputs;
    } catch (err) {
      errors.push({ nodeId: id, message: (err as Error).message });
      return undefined;
    }
  };

  for (const n of nodes) {
    // Bypassed layers and sources simply drop out; bypassed transforms were rewired above.
    if (n.flags?.bypass) continue;
    lowerNode(n.id);
  }

  // --- JS functions: declared by js-function nodes, called from any expression ------
  const udfs: Record<string, UdfSpec> = {};
  for (const n of nodes) {
    if (n.op !== 'js-function' || n.flags?.bypass) continue;
    const name = String(n.params.name ?? 'fn').trim();
    if (udfs[name]) {
      errors.push({ nodeId: n.id, message: `A JS function named '${name}' is already declared` });
      continue;
    }
    const params = String(n.params.params ?? 'x').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      const [pname, type] = p.split(':').map((x) => x.trim());
      return type === 'text' ? { name: pname, type: 'text' as const } : pname;
    });
    udfs[name] = { params, body: String(n.params.body ?? 'return x'), width: Number(n.params.width ?? 1) };
  }

  // --- display flags: a preview layer on top of the deck --------------------
  const deck = irOut.find((n): n is DeckNode => n.type === 'deck');
  // A layer a host operator reads (props added to it, a switch between it and another) is
  // compiled too: the host draws it, so the deck's own inputs do not list it.
  if (deck) {
    const layerIds = new Set(irOut.filter((n) => n.type === 'layer').map((n) => n.id));
    for (const e of edges) {
      const target = byId.get(e.target);
      if (!target || OPERATOR_INDEX.get(target.op)?.lower) continue;
      const ir = outputs[e.source]?.[e.sourcePort];
      if (ir && layerIds.has(ir) && !deck.inputs.includes(ir)) deck.inputs = [...deck.inputs, ir];
    }
  }
  for (const n of nodes) {
    if (!n.flags?.display || n.flags.bypass) continue;
    const op = OPERATOR_INDEX.get(n.op);
    const ir = outputs[n.id]?.out;
    if (!ir || op?.outputs[0]?.type !== 'table') continue;
    const position = options.displayPosition?.(n.id) ?? 'P';
    const layerId = `__display_${safeId(n.id)}`;
    let input = ir;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(position)) {
      irOut.push({ id: `${layerId}_P`, type: 'attribute', input: ir, name: `${layerId}_P`, expr: position });
      input = `${layerId}_P`;
    }
    const layer: LayerNode = {
      id: layerId, type: 'layer', kind: 'scatter', input,
      channels: { position: input === ir ? position : `${layerId}_P` },
      props: { radiusScale: 3, fillColor: [255, 230, 0], opacity: 0.9, radiusUnits: 'pixels' },
    };
    irOut.push(layer);
    if (deck) deck.inputs = [...deck.inputs, layerId];
  }

  return {
    graph: { name: doc.name, params: specs, nodes: irOut, ...(Object.keys(udfs).length ? { udfs } : {}) },
    scalars,
    outputs,
    params,
    slotParams,
    irNodes,
    errors,
    references,
    deck: deckId,
  };
}

/**
 * Every IR parameter's value at one instant, from the scalar program. `host` supplies keys the
 * scalar program does not compute: a host application's operator outputs, such as
 * `nodeId.out.location.lat` for a `ch('geocoder/out.location.lat')` reference.
 */
export function parameterValues(lowered: Lowered, clock: Clock, host?: External): {
  values: Record<string, number | string>;
  slots: Map<string, SlotValue>;
  errors: Map<string, string>;
} {
  const { values: slots, errors } = lowered.scalars.evaluate(clock, host);
  const values: Record<string, number | string> = {};
  for (const p of Object.values(lowered.params)) {
    const v = slots.get(p.key) ?? (host?.get(p.key) as SlotValue | undefined);
    const x = p.component !== undefined && Array.isArray(v) ? v[p.component] : v;
    values[p.name] = typeof x === 'string' ? x : typeof x === 'boolean' ? Number(x) : Number(x ?? 0);
  }
  return { values, slots, errors };
}
