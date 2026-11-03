// Registry-aware checks for a project file, a document (`"version": 1`). Pure: takes parsed
// JSON and a registry, returns diagnostics. No editor code, so it runs in plain Node.

import { getOperator, isTypo, portProblem, unknownParam, unknownType } from './fields.ts'
import type {
  Diagnostic,
  OperatorInfo,
  PortType,
  Registry,
  Rule,
  Severity,
  ValidationResult,
} from './types.ts'

type Json = Record<string, unknown>
type Report = (severity: Severity, rule: Rule, at: string, message: string, id?: string) => void

const SUBNET = 'subnet'

interface NodeRecord {
  id: string
  op: string
  name: string
  parent?: string
  index: number
  params: Json
  promoted: string[]
  def?: OperatorInfo
}

export function validateProject(project: unknown, registry: Registry): ValidationResult {
  const diagnostics = lintProject(project, registry)
  const errors = diagnostics.filter(d => d.severity === 'error')
  const warnings = diagnostics.filter(d => d.severity === 'warning')
  return { valid: errors.length === 0, errors, warnings }
}

export function lintProject(project: unknown, registry: Registry): Diagnostic[] {
  const out: Diagnostic[] = []
  const report: Report = (severity, rule, at, message, id) =>
    out.push({ severity, rule, at, message, ...(id !== undefined && { id }) })

  if (!isObject(project)) {
    report(
      'error',
      'project-shape',
      '$',
      'A project file is a JSON object with version, name, nodes and edges.'
    )
    return out
  }
  if (!checkVersion(project, registry, report)) return out

  if (typeof project.name !== 'string') {
    report('error', 'project-shape', 'name', 'name is missing. A document has "name": "<project>".')
  }
  const nodes = new Map<string, NodeRecord>()
  if (!Array.isArray(project.nodes)) {
    report(
      'error',
      'project-shape',
      'nodes',
      'nodes is missing or not an array. An empty project has "nodes": [].'
    )
  } else {
    project.nodes.forEach((node, index) => {
      checkNode(node, index, registry, nodes, report)
    })
    checkNetworks(nodes, report)
    for (const node of nodes.values()) checkParams(node, nodes, report)
  }

  if (!Array.isArray(project.edges)) {
    report(
      'error',
      'project-shape',
      'edges',
      'edges is missing or not an array. A project with no connections has "edges": [].'
    )
  } else if (Array.isArray(project.nodes)) {
    checkEdges(project.edges, nodes, report)
  }
  if (isObject(project.timeline)) checkTimeline(project.timeline, nodes, report)
  return out
}

// False when the rest of the file can't be checked as a document
function checkVersion(project: Json, registry: Registry, report: Report): boolean {
  const { version } = project
  const current = registry.documentVersion
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    report(
      'error',
      'project-shape',
      'version',
      `version is missing or not an integer. A document has "version": ${current}.`
    )
    return false
  }
  if (version === current && !isOperatorGraph(project)) return true
  if (version >= 1 && version <= registry.convertsFrom) {
    report(
      'warning',
      'operator-graph',
      'version',
      `This is an operator-graph file (schema ${version}), the format before documents. The editor converts it when it opens; open it and save to write it as a document. Only documents are checked further: nodes with "op" and "params", edges with "sourcePort" and "targetPort".`
    )
    return false
  }
  report(
    'error',
    'version',
    'version',
    `version is ${version}; a document has "version": ${current}. Older operator-graph files (schema 1 to ${registry.convertsFrom}) are converted by the editor when they open.`
  )
  return false
}

// Schema 1 of the operator graph shares the document's version number; its nodes have a type
function isOperatorGraph(project: Json): boolean {
  const nodes = Array.isArray(project.nodes) ? project.nodes : []
  const edges = Array.isArray(project.edges) ? project.edges : []
  return (
    nodes.some(n => isObject(n) && typeof n.type === 'string' && n.op === undefined) ||
    edges.some(e => isObject(e) && typeof e.sourceHandle === 'string')
  )
}

function checkNode(
  node: unknown,
  index: number,
  registry: Registry,
  nodes: Map<string, NodeRecord>,
  report: Report
) {
  const at = `nodes[${index}]`
  if (!isObject(node)) {
    report(
      'error',
      'project-shape',
      at,
      'Each node is an object with id, op, name, x, y and params.'
    )
    return
  }
  const { id, op } = node
  if (typeof id !== 'string' || !id) {
    report('error', 'node-id', at, `Node id ${JSON.stringify(id)} is not a non-empty string.`)
    return
  }
  if (nodes.has(id)) {
    report(
      'error',
      'duplicate-node-id',
      at,
      `Node id ${id} is also used by nodes[${nodes.get(id)?.index}]. Give one of them a different id and update its edges.`,
      id
    )
    return
  }
  if (typeof op !== 'string' || !op) {
    const hint =
      typeof node.type === 'string' ? ` It has "type": "${node.type}", the older format.` : ''
    report('error', 'project-shape', at, `${id} has no op, e.g. "op": "scatter".${hint}`, id)
    return
  }
  if (node.params !== undefined && !isObject(node.params)) {
    report('error', 'project-shape', at, `${id} params is not an object of names to values.`, id)
  }
  for (const key of ['x', 'y'] as const) {
    if (typeof node[key] !== 'number') {
      report('error', 'project-shape', at, `${id} has no ${key} position, a number.`, id)
    }
  }
  const name = typeof node.name === 'string' && node.name ? node.name : id
  const promoted = Array.isArray(node.promoted)
    ? node.promoted.flatMap(p => (isObject(p) && typeof p.name === 'string' ? [p.name] : []))
    : []
  const def = getOperator(registry, op)
  nodes.set(id, {
    id,
    op,
    name,
    index,
    params: isObject(node.params) ? node.params : {},
    promoted,
    def,
    ...(typeof node.parent === 'string' && { parent: node.parent }),
  })
  if (!def) {
    report('error', 'unknown-operator', at, `${id}: ${unknownType(op, registry)}`, id)
    return
  }
  // The editor names a new node after its operator: scatter1, file2. A name says what it holds
  if (new RegExp(`^${op.replace(/[^\w]/g, '_')}\\d+$`).test(name)) {
    report(
      'warning',
      'generic-node-name',
      at,
      `${id} is named ${name}. Name nodes for what they hold, e.g. quakes or quake-points.`,
      id
    )
  }
}

// Parents are subnets, and a name is unique in its network
function checkNetworks(nodes: Map<string, NodeRecord>, report: Report) {
  const names = new Map<string, NodeRecord>()
  for (const node of nodes.values()) {
    const at = `nodes[${node.index}]`
    if (node.parent !== undefined) {
      const parent = nodes.get(node.parent)
      if (!parent || parent.op !== SUBNET) {
        report(
          'error',
          'unknown-parent',
          at,
          `${node.id} has parent ${node.parent}, which is ${parent ? `a ${parent.op} node, not a subnet` : 'not a node'}.`,
          node.id
        )
      }
    }
    const key = `${node.parent ?? ''}\u0000${node.name}`
    const other = names.get(key)
    if (other) {
      report(
        'error',
        'duplicate-name',
        at,
        `${node.id} and ${other.id} are both named ${node.name} in ${node.parent ?? 'the root network'}. Names are unique in a network; paths and references use them.`,
        node.id
      )
    } else {
      names.set(key, node)
    }
  }
}

function checkParams(node: NodeRecord, nodes: Map<string, NodeRecord>, report: Report) {
  if (!node.def) return
  const at = `nodes[${node.index}]`
  const known = [...Object.keys(node.def.params), ...node.promoted]
  for (const [name, value] of Object.entries(node.params)) {
    if (!known.includes(name)) {
      report('error', 'unknown-param', at, unknownParam(node.id, node.op, name, known), node.id)
      continue
    }
    if (isObject(value) && ('expr' in value || 'ref' in value)) {
      const text = 'expr' in value ? value.expr : value.ref
      if (typeof text !== 'string' || Object.keys(value).length !== 1) {
        report(
          'error',
          'param-value',
          at,
          `${node.id} ${name} is ${JSON.stringify(value)}. An expression is {"expr": "<text>"} and a reference {"ref": "<node>/<param>"}, nothing else.`,
          node.id
        )
        continue
      }
      const refs = 'ref' in value ? [text] : chCalls(text)
      for (const ref of refs) checkReference(node, name, ref, nodes, at, report)
      continue
    }
    const def = node.def.params[name]
    if (def.kind === 'menu' && def.options && !def.options.includes(String(value))) {
      report(
        'error',
        'param-value',
        at,
        `${node.id} ${name} is ${JSON.stringify(value)}, not one of its choices: ${def.options.join(', ')}.`,
        node.id
      )
    }
    if (typeof value === 'string' && (def.kind === 'expr' || def.kind === 'code')) {
      for (const ref of chCalls(value)) checkReference(node, name, ref, nodes, at, report)
    }
  }
}

// ch('path/param') calls in an expression or a query
function chCalls(text: string): string[] {
  return [...text.matchAll(/\bch\(\s*(['"])([^'"]+)\1\s*\)/g)].map(m => m[2])
}

// The planner's resolveRef: `k`, `ctl/k`, `../ctl/k`, `/net/ctl/k`, `#id.k`
function checkReference(
  from: NodeRecord,
  param: string,
  ref: string,
  nodes: Map<string, NodeRecord>,
  at: string,
  report: Report
) {
  const problem = referenceProblem(from, ref, nodes)
  if (problem) {
    report(
      'error',
      'unknown-reference',
      at,
      `${from.id} ${param} references ${ref}: ${problem}`,
      from.id
    )
  }
}

function referenceProblem(
  from: NodeRecord,
  ref: string,
  nodes: Map<string, NodeRecord>
): string | null {
  let target: NodeRecord | undefined
  let name: string
  if (ref.startsWith('#')) {
    const dot = ref.indexOf('.')
    target = nodes.get(ref.slice(1, dot))
    name = ref.slice(dot + 1)
    if (!target) return `no node has id ${ref.slice(1, dot)}.`
  } else {
    const parts = ref.split('/')
    name = parts.pop() ?? ''
    if (!name) return 'it names no parameter; a reference ends in /<param>.'
    if (parts.length === 0) {
      target = from
    } else {
      const absolute = parts[0] === ''
      let network = absolute ? undefined : from.parent
      for (const [i, seg] of (absolute ? parts.slice(1) : parts).entries()) {
        if (seg === '.' || seg === '') continue
        if (seg === '..') {
          const up = network === undefined ? undefined : nodes.get(network)
          if (!up) return 'it climbs above the root network.'
          network = up.parent
          target = up
          continue
        }
        target = [...nodes.values()].find(n => n.parent === network && n.name === seg)
        if (!target) {
          const near = [...nodes.values()]
            .filter(n => n.parent === network && isTypo(n.name, seg))
            .map(n => n.name)
          const hint = near.length > 0 ? ` Did you mean ${near.join(', ')}?` : ''
          return `no node named ${seg} in ${network === undefined ? 'the root network' : nodes.get(network)?.name}.${hint}`
        }
        if (i < parts.length - 1) network = target.id
      }
      if (!target) return 'it names no node.'
    }
  }
  if (!target.def) return null
  // A host operator's output can be read by reference too (`out.location.lat`)
  const head = name.split('.')[0]
  const params = [...Object.keys(target.def.params), ...target.promoted]
  if (params.includes(name) || params.includes(head)) return null
  if (head === 'out' && Object.keys(target.def.outputs).length > 0) return null
  return `${target.name} (${target.op}) has no parameter ${name}.`
}

function checkEdges(edges: unknown[], nodes: Map<string, NodeRecord>, report: Report) {
  const connections = new Map<string, number>()
  const ids = new Map<string, number>()
  // target + port -> indexes of the edges into it
  const incoming = new Map<string, number[]>()
  const dependsOn = new Map<string, Map<string, number>>()

  edges.forEach((edge, index) => {
    const at = `edges[${index}]`
    if (!isObject(edge)) {
      report(
        'error',
        'edge-shape',
        at,
        'Each edge is an object with id, source, sourcePort, target and targetPort.'
      )
      return
    }
    const missing = (['id', 'source', 'sourcePort', 'target', 'targetPort'] as const).filter(
      key => typeof edge[key] !== 'string' || !edge[key]
    )
    const label = typeof edge.id === 'string' ? edge.id : undefined
    if (missing.length > 0) {
      report(
        'error',
        'edge-shape',
        at,
        `Edge is missing ${missing.join(', ')}. An edge looks like {"id": "e1", "source": "quakes", "sourcePort": "out", "target": "points", "targetPort": "in"}.`,
        label
      )
      return
    }
    const id = edge.id as string
    const s = edge.source as string
    const t = edge.target as string
    const sp = edge.sourcePort as string
    const tp = edge.targetPort as string

    const connection = JSON.stringify([s, sp, t, tp])
    const earlier = connections.get(connection)
    if (earlier !== undefined) {
      report(
        'error',
        'duplicate-edge',
        at,
        `Edge ${id} repeats the connection of edges[${earlier}]. Delete one of them.`,
        id
      )
      return
    }
    connections.set(connection, index)
    const sameId = ids.get(id)
    if (sameId !== undefined) {
      report(
        'error',
        'duplicate-edge-id',
        at,
        `Edge id ${id} is also used by edges[${sameId}]. Give each edge its own id.`,
        id
      )
    } else {
      ids.set(id, index)
    }

    const from = endpoint(s, 'source', nodes, at, id, report)
    const to = endpoint(t, 'target', nodes, at, id, report)
    if (!from || !to || !from.def || !to.def) return
    const outProblem = portProblem(s, from.op, sp, 'outputs', Object.keys(from.def.outputs), [])
    const inProblem = portProblem(t, to.op, tp, 'inputs', Object.keys(to.def.inputs), [
      ...Object.keys(to.def.params),
      ...to.promoted,
    ])
    if (outProblem || inProblem) {
      for (const problem of [outProblem, inProblem]) {
        if (problem) report('error', 'edge-port', at, `Edge ${id}: ${problem}`, id)
      }
      return
    }
    if (from.parent !== to.parent) {
      report(
        'error',
        'edge-network',
        at,
        `Edge ${id} joins ${s} and ${t}, which are in different networks. Wire into a subnet through its in0/in1 ports and a subnet-input node inside.`,
        id
      )
      return
    }
    const fromType = from.def.outputs[sp].type
    const toType = tp.startsWith('par:')
      ? (to.def.params[tp.slice(4)]?.portType ?? 'param')
      : to.def.inputs[tp].type
    if (!canConnect(fromType, toType)) {
      report(
        'error',
        'edge-type',
        at,
        `Edge ${id}: ${s}.${sp} is a ${fromType} output, and ${t}.${tp} takes ${toType === 'param' ? 'a number' : `a ${toType}`}.`,
        id
      )
      return
    }
    const key = `${t}\u0000${tp}`
    incoming.set(key, [...(incoming.get(key) ?? []), index])
    const targets = dependsOn.get(s) ?? new Map<string, number>()
    if (!targets.has(t)) targets.set(t, index)
    dependsOn.set(s, targets)
  })

  for (const loop of findLoops(dependsOn)) {
    const [first, second] = loop
    report(
      'error',
      'cycle',
      `edges[${dependsOn.get(first)?.get(second) ?? 0}]`,
      `Edges form a loop: ${[...loop, first].join(' -> ')}. Remove one of these edges.`,
      first
    )
  }

  for (const [key, indexes] of incoming) {
    if (indexes.length < 2) continue
    const [target, port] = key.split('\u0000')
    const def = nodes.get(target)?.def
    if (!port.startsWith('par:') && def?.inputs[port]?.multi) continue
    report(
      'error',
      'multiple-inputs',
      `edges[${indexes[1]}]`,
      `${target} ${port} has ${indexes.length} incoming edges (${indexes.map(i => `edges[${i}]`).join(', ')}). Only a multi-input port, such as a deck's layers, takes more than one.`,
      target
    )
  }
}

// The planner's canConnect
function canConnect(from: PortType, to: PortType | 'param'): boolean {
  if (from === 'any' || to === 'any') return true
  if (to === 'param') return from === 'number'
  if (to === 'value') return true
  if (from === 'value') return to === 'layer'
  return from === to
}

function endpoint(
  nodeId: string,
  role: 'source' | 'target',
  nodes: Map<string, NodeRecord>,
  at: string,
  edgeId: string,
  report: Report
): NodeRecord | undefined {
  const node = nodes.get(nodeId)
  if (node) return node
  const byName = [...nodes.values()].filter(n => n.name === nodeId).map(n => n.id)
  const near = [...nodes.keys()].filter(id => isTypo(id, nodeId))
  const hint =
    byName.length > 0
      ? ` Edges use node ids; ${nodeId} is the name of ${byName.join(', ')}.`
      : near.length > 0
        ? ` Did you mean ${near.slice(0, 5).join(', ')}?`
        : ''
  report(
    'error',
    'edge-unknown-node',
    at,
    `Edge ${edgeId} ${role} ${nodeId} is not a node id in this project.${hint}`,
    edgeId
  )
  return undefined
}

// Tracks target `nodeId.param`, or `nodeId.param.<component>`
function checkTimeline(timeline: Json, nodes: Map<string, NodeRecord>, report: Report) {
  if (!Array.isArray(timeline.tracks)) return
  timeline.tracks.forEach((track, index) => {
    if (!isObject(track) || typeof track.target !== 'string') return
    const [nodeId, param] = splitTarget(track.target, nodes)
    const node = nodeId === undefined ? undefined : nodes.get(nodeId)
    const at = `timeline.tracks[${index}]`
    if (!node) {
      report(
        'warning',
        'timeline-target',
        at,
        `Track ${track.target} names no node; a track's target is "<node id>.<param>".`
      )
    } else if (node.def && !(param in node.def.params) && !node.promoted.includes(param)) {
      report(
        'warning',
        'timeline-target',
        at,
        `Track ${track.target}: ${unknownParam(node.id, node.op, param, Object.keys(node.def.params))}`,
        node.id
      )
    }
  })
}

// Node ids may hold dots, so take the longest id the target starts with
function splitTarget(target: string, nodes: Map<string, NodeRecord>): [string | undefined, string] {
  const ids = [...nodes.keys()]
    .filter(id => target.startsWith(`${id}.`))
    .sort((a, b) => b.length - a.length)
  const id = ids[0]
  if (id === undefined) return [undefined, '']
  return [id, target.slice(id.length + 1).split('.')[0]]
}

// One loop per strongly connected component (Tarjan), as the node ids in order
function findLoops(graph: Map<string, Map<string, number>>): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const loops: string[][] = []
  let counter = 0
  const next = (id: string) => [...(graph.get(id)?.keys() ?? [])]

  const visit = (id: string) => {
    index.set(id, counter)
    low.set(id, counter)
    counter++
    stack.push(id)
    onStack.add(id)
    for (const to of next(id)) {
      if (!index.has(to)) {
        visit(to)
        low.set(id, Math.min(low.get(id) ?? 0, low.get(to) ?? 0))
      } else if (onStack.has(to)) {
        low.set(id, Math.min(low.get(id) ?? 0, index.get(to) ?? 0))
      }
    }
    if (low.get(id) !== index.get(id)) return
    const component = new Set<string>()
    let member: string | undefined
    do {
      member = stack.pop()
      if (member === undefined) break
      onStack.delete(member)
      component.add(member)
    } while (member !== id)
    if (component.size > 1 || next(id).includes(id)) loops.push(loopThrough(id, component, next))
  }

  for (const id of graph.keys()) if (!index.has(id)) visit(id)
  return loops
}

// The shortest path from start back to start inside one component
function loopThrough(
  start: string,
  component: Set<string>,
  next: (id: string) => string[]
): string[] {
  const parent = new Map<string, string>([[start, start]])
  const queue = [start]
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]
    for (const to of next(at)) {
      if (to === start) {
        const path = [at]
        while (path[0] !== start) path.unshift(parent.get(path[0]) ?? start)
        return path
      }
      if (component.has(to) && !parent.has(to)) {
        parent.set(to, at)
        queue.push(to)
      }
    }
  }
  return [start]
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
