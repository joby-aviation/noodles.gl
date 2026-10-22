/**
 * The editor document: what a node editor saves, before it becomes a graph.
 *
 * A document is operators wired port to port, as a person draws them — nested in subnets,
 * some bypassed, parameters holding literals, expressions or references to other
 * parameters, a timeline of keyframes. None of that is the planner's business, so it never
 * sees a document. `lowerDocument` (in `lower.ts`) turns one into a `Graph` plus a scalar
 * program that computes every parameter's value at a given time; this file holds the types
 * and the purely structural passes — paths, subnet flattening, bypass.
 *
 * Node ids are opaque and stable; names are what a person reads and what paths use, the
 * way Houdini's `ch("../grid/size")` names a node rather than an internal id. A name is
 * unique within its network (the root, or one subnet).
 */

import type { Timeline } from './keyframes.js';

/**
 * A parameter's value. A literal; an expression over time, frame and references
 * (`{ expr: "ch('../ctl/k') * 2 + T" }`); or a reference, which is the one-call expression.
 */
export type ParamValue =
  | number | string | boolean | number[]
  | { expr: string }
  | { ref: string };

export interface PromotedParam {
  /** Name on the subnet. */
  name: string;
  label?: string;
  /** The child's id and parameter this drives. */
  node: string;
  param: string;
}

export interface DocNode {
  id: string;
  op: string;
  /** Unique within its network. Defaults to the id. */
  name?: string;
  /** Enclosing subnet's id; absent at the root. */
  parent?: string;
  x: number;
  y: number;
  params: Record<string, ParamValue>;
  flags?: {
    /** Pass the first table input straight through; a bypassed layer is not drawn. */
    bypass?: boolean;
    /** Preview this node's rows as a scatter layer, and show them in the spreadsheet. */
    display?: boolean;
  };
  /** Subnets: parameters exposed on the subnet that drive a child's parameter. */
  promoted?: PromotedParam[];
}

export interface DocEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  /** An input port, or `par:<name>` to drive a parameter from a number output. */
  targetPort: string;
  /** Order among edges into the same multi-input port. */
  index?: number;
}

export interface EditorDoc {
  version: 1;
  name: string;
  description?: string;
  nodes: DocNode[];
  edges: DocEdge[];
  timeline?: Timeline;
  /** Attribution for the data a document uses. */
  credits?: string[];
}

export class DocumentError extends Error {
  constructor(message: string, readonly nodeId?: string) {
    super(message);
  }
}

export const nameOf = (n: DocNode): string => n.name ?? n.id;

export function isExpr(v: ParamValue | undefined): v is { expr: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'expr' in v;
}
export function isRef(v: ParamValue | undefined): v is { ref: string } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'ref' in v;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** `/`, or `/subnet/inner` for a node inside nested subnets. The network a node lives in. */
export function networkPath(doc: EditorDoc, node: DocNode): string {
  const parts: string[] = [];
  let parent = node.parent;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  while (parent) {
    const p = byId.get(parent);
    if (!p) break;
    parts.unshift(nameOf(p));
    parent = p.parent;
  }
  return `/${parts.join('/')}`;
}

/** A node's full path, e.g. `/ports/filter1`. */
export function nodePath(doc: EditorDoc, node: DocNode): string {
  const net = networkPath(doc, node);
  return net === '/' ? `/${nameOf(node)}` : `${net}/${nameOf(node)}`;
}

/**
 * Resolve a parameter reference, Houdini-style, from the node that holds it.
 *
 *   `k`                 parameter `k` on the same node
 *   `ctl/k`             parameter `k` on sibling `ctl`
 *   `../ctl/k`          on `ctl` in the enclosing network
 *   `/net/ctl/k`        absolute from the root
 *   `#id.k`             by id, which is what a promoted parameter becomes when flattened
 *
 * Returns `nodeId.param`, the key the scalar program uses.
 */
export function resolveRef(doc: Pick<EditorDoc, 'nodes'>, from: DocNode, ref: string): string {
  // `#id.param` is a key already: what flattening writes for a promoted parameter, which has
  // to keep resolving after the subnet that gave it a path is gone.
  if (ref.startsWith('#')) return ref.slice(1);
  const parts = ref.split('/');
  const param = parts.pop()!;
  if (!param) throw new DocumentError(`Reference '${ref}' names no parameter`, from.id);
  if (parts.length === 0) return `${from.id}.${param}`;
  const absolute = parts[0] === '';
  let network: string | undefined = absolute ? undefined : from.parent;
  const segments = absolute ? parts.slice(1) : parts;
  let target: DocNode | undefined;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '.' || seg === '') continue;
    if (seg === '..') {
      const up = doc.nodes.find((n) => n.id === network);
      if (!up) throw new DocumentError(`Reference '${ref}' climbs above the root`, from.id);
      // `..` from inside a subnet names the subnet's own network; a node in it is a sibling
      // of the subnet.
      network = up.parent;
      target = up;
      continue;
    }
    target = doc.nodes.find((n) => n.parent === network && nameOf(n) === seg);
    if (!target) throw new DocumentError(`Reference '${ref}': no node '${seg}' in ${network ?? '/'}`, from.id);
    // Descending into a subnet: the next segment is inside it.
    if (i < segments.length - 1) network = target.id;
  }
  if (!target) throw new DocumentError(`Reference '${ref}' names no node`, from.id);
  return `${target.id}.${param}`;
}

// ---------------------------------------------------------------------------
// Structural passes
// ---------------------------------------------------------------------------

export const SUBNET = 'subnet';
export const SUBNET_INPUT = 'subnet-input';
export const SUBNET_OUTPUT = 'subnet-output';

/**
 * Remove subnets, leaving one flat network whose edges connect real operators.
 *
 * A subnet's port `inN` connects inside to a `subnet-input` node whose `index` is N; its port
 * `outN` is whatever feeds the `subnet-output` with that index. Flattening rewires each edge
 * that crosses a boundary to its real endpoint, innermost subnets first so nesting is just
 * repetition. Children keep their ids, which is what keeps parameter keys, keyframe tracks and
 * relation hashes stable when a selection is collapsed into a subnet: collapsing is free.
 */
export function flattenSubnets(doc: EditorDoc): { nodes: DocNode[]; edges: DocEdge[] } {
  let nodes = [...doc.nodes];
  let edges = [...doc.edges];
  const depth = (n: DocNode): number => {
    let d = 0;
    let p = n.parent;
    while (p) { d++; p = nodes.find((x) => x.id === p)?.parent; }
    return d;
  };
  const subnets = nodes.filter((n) => n.op === SUBNET).sort((a, b) => depth(b) - depth(a));

  for (const sub of subnets) {
    const children = nodes.filter((n) => n.parent === sub.id);
    const portIndex = (port: string, prefix: 'in' | 'out') => {
      const m = new RegExp(`^${prefix}(\\d+)$`).exec(port);
      return m ? Number(m[1]) : 0;
    };
    const inputNode = (i: number) => children.find((c) => c.op === SUBNET_INPUT && Number(c.params.index ?? 0) === i);
    const outputNode = (i: number) => children.find((c) => c.op === SUBNET_OUTPUT && Number(c.params.index ?? 0) === i);

    const next: DocEdge[] = [];
    for (const e of edges) {
      // Into the subnet from outside: fan out to whatever reads the matching subnet-input.
      if (e.target === sub.id) {
        const inner = inputNode(portIndex(e.targetPort, 'in'));
        if (!inner) continue;
        for (const x of edges.filter((x) => x.source === inner.id)) {
          next.push({ ...x, id: `${e.id}>${x.id}`, source: e.source, sourcePort: e.sourcePort });
        }
        continue;
      }
      // Out of the subnet: whatever feeds the matching subnet-output.
      if (e.source === sub.id) {
        const inner = outputNode(portIndex(e.sourcePort, 'out'));
        const feed = inner && edges.find((x) => x.target === inner.id);
        if (!feed) continue;
        next.push({ ...e, id: `${feed.id}>${e.id}`, source: feed.source, sourcePort: feed.sourcePort });
        continue;
      }
      const bridge = (id: string) => children.some((c) => c.id === id && (c.op === SUBNET_INPUT || c.op === SUBNET_OUTPUT));
      if (bridge(e.source) || bridge(e.target)) continue;
      next.push(e);
    }
    edges = next;
    // Promoted parameters: the child reads the subnet's value.
    const promoted = new Map((sub.promoted ?? []).map((p) => [`${p.node}.${p.param}`, p.name]));
    nodes = nodes
      .filter((n) => n.id !== sub.id && !(n.parent === sub.id && (n.op === SUBNET_INPUT || n.op === SUBNET_OUTPUT)))
      .map((n) => {
        const out = n.parent === sub.id ? { ...n, parent: sub.parent } : n;
        if (n.parent !== sub.id) return out;
        const params = { ...out.params };
        for (const [key, name] of promoted) {
          const [nodeId, param] = key.split('.');
          if (nodeId === n.id) params[param] = { ref: `#${sub.id}.${name}` };
        }
        return { ...out, params };
      });
    // The subnet's own values survive as a parameter holder, so the refs above resolve.
    nodes.push({ ...sub, op: 'subnet-params', params: { ...sub.params }, parent: sub.parent });
  }
  return { nodes, edges };
}

/**
 * Bypass: a bypassed node's consumers read its first input instead. A node with no input to
 * pass through (a source, a layer) simply drops out of the graph.
 */
export function applyBypass(nodes: DocNode[], edges: DocEdge[], firstInputPort: (n: DocNode) => string | undefined): DocEdge[] {
  let out = edges;
  for (const n of nodes) {
    if (!n.flags?.bypass) continue;
    const port = firstInputPort(n);
    const feed = port ? out.find((e) => e.target === n.id && e.targetPort === port) : undefined;
    out = out.flatMap((e) => {
      if (e.target === n.id) return [];
      if (e.source !== n.id) return [e];
      return feed ? [{ ...e, source: feed.source, sourcePort: feed.sourcePort }] : [];
    });
  }
  return out;
}
