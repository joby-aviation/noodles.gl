// Registry-aware checks for a noodles.json project file. Pure: takes parsed JSON
// and a registry, returns diagnostics. No editor code, so it runs in plain Node.

import {
  fieldNames,
  getOperator,
  handleProblem,
  isTypo,
  type Side,
  unknownInput,
  unknownType,
} from './fields.ts'
import type { Diagnostic, Registry, Rule, Severity, ValidationResult } from './types.ts'

// React Flow group nodes carry no operator
const SPECIAL_NODE_TYPES = new Set(['group'])
// Derived from op() references on load; a saved one is ignored
const REFERENCE_EDGE_TYPE = 'ReferenceEdge'
// The only fields that take more than one incoming edge
const MULTI_INPUT_FIELD_TYPE = 'ListField'

type Json = Record<string, unknown>

interface NodeRecord {
  id: string
  type: string
  index: number
  customInputs: string[]
  // Keys of data.inputs, checked once every node is known
  inputs: string[]
}

// Mirrors its parent container's custom inputs as an input and an output each
const GRAPH_INPUT_TYPE = 'GraphInputOp'
const CONTAINER_TYPE = 'ContainerOp'

export function validateProject(project: unknown, registry: Registry): ValidationResult {
  const diagnostics = lintProject(project, registry)
  const errors = diagnostics.filter(d => d.severity === 'error')
  const warnings = diagnostics.filter(d => d.severity === 'warning')
  return { valid: errors.length === 0, errors, warnings }
}

export function lintProject(project: unknown, registry: Registry): Diagnostic[] {
  const out: Diagnostic[] = []
  const report = (severity: Severity, rule: Rule, at: string, message: string, id?: string) =>
    out.push({ severity, rule, at, message, ...(id !== undefined && { id }) })

  if (!isObject(project)) {
    report(
      'error',
      'project-shape',
      '$',
      'A project file is a JSON object with version, nodes and edges.'
    )
    return out
  }

  checkVersion(project.version, registry, report)

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
    checkInputNames(registry, nodes, report)
  }

  if (!Array.isArray(project.edges)) {
    report(
      'error',
      'project-shape',
      'edges',
      'edges is missing or not an array. A project with no connections has "edges": [].'
    )
  } else if (Array.isArray(project.nodes)) {
    checkEdges(project.edges, registry, nodes, report)
  }

  return out
}

type Report = (severity: Severity, rule: Rule, at: string, message: string, id?: string) => void

function checkVersion(version: unknown, registry: Registry, report: Report) {
  const current = registry.projectVersion
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    report(
      'error',
      'project-shape',
      'version',
      `version is missing or not an integer. A current project file has "version": ${current}.`
    )
  } else if (version < current) {
    report(
      'error',
      'version',
      'version',
      `version is ${version}; the current schema version is ${current}. Migrate the file rather than changing the number, since migrations also rewrite nodes and edges: open it in the editor and save, or put it under noodles-editor/src/examples/<name>/ and run "npm run migrate-projects" from noodles-editor/. Field and handle errors below may be ones the migration fixes.`
    )
  } else if (version > current) {
    report(
      'error',
      'version',
      'version',
      `version is ${version}, newer than this checkout's schema version ${current}. Update the checkout, or regenerate registry.json with "npm run generate:registry" from noodles-editor/.`
    )
  }
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
    report('error', 'project-shape', at, 'Each node is an object with id, type, position and data.')
    return
  }
  const { id, type } = node
  if (typeof id !== 'string' || !isNodePath(id)) {
    report(
      'error',
      'node-id',
      at,
      `Node id ${JSON.stringify(id)} is not an absolute path. Node ids look like /earthquake-data, or /container/child inside a container.`
    )
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
  if (typeof type !== 'string' || !type) {
    report(
      'error',
      'project-shape',
      at,
      `${id} has no type. Operator types end in "Op", e.g. FileOp.`,
      id
    )
    return
  }

  const data = isObject(node.data) ? node.data : {}
  const customInputs = checkCustomInputs(data, id, at, registry, report)
  const inputs = isObject(data.inputs) ? Object.keys(data.inputs) : []
  nodes.set(id, { id, type, index, customInputs, inputs })

  if (SPECIAL_NODE_TYPES.has(type)) return
  if (!getOperator(registry, type)) {
    report('error', 'unknown-operator', at, `${id}: ${unknownType(type, registry)}`, id)
    return
  }

  if (data.inputs !== undefined && !isObject(data.inputs)) {
    report(
      'error',
      'project-shape',
      at,
      `${id} data.inputs is not an object of input names to values.`,
      id
    )
  }

  // Checked by the old scripts/validate-examples.js, and in the graph design
  // guidelines. Only an operator's name and a number, as the editor names new
  // nodes (/file-1, /duckdb-0); /flights-2024 or /route-66 say what they hold
  if (isGenericName(id, registry)) {
    report(
      'warning',
      'generic-node-name',
      at,
      `${id} has a generic name. Name nodes for what they hold, e.g. /earthquake-data rather than /file-1.`,
      id
    )
  }
}

function checkInputNames(registry: Registry, nodes: Map<string, NodeRecord>, report: Report) {
  for (const node of nodes.values()) {
    if (!getOperator(registry, node.type)) continue
    const known = [
      ...fieldNames(registry, node.type, 'inputs'),
      ...node.customInputs,
      ...containerFields(node, nodes),
    ]
    for (const name of node.inputs) {
      if (!known.includes(name)) {
        report(
          'error',
          'unknown-input',
          `nodes[${node.index}]`,
          unknownInput(node.id, node.type, name, known),
          node.id
        )
      }
    }
  }
}

// A GraphInputOp has an input and an output for each of its container's custom
// inputs, as GraphInputOp.rebuildFromContainer builds them
function containerFields(node: NodeRecord, nodes: Map<string, NodeRecord>): string[] {
  if (node.type !== GRAPH_INPUT_TYPE) return []
  const parent = nodes.get(node.id.slice(0, node.id.lastIndexOf('/')))
  return parent?.type === CONTAINER_TYPE ? parent.customInputs : []
}

function checkEdges(
  edges: unknown[],
  registry: Registry,
  nodes: Map<string, NodeRecord>,
  report: Report
) {
  const connections = new Map<string, number>()
  const ids = new Map<string, number>()
  // target + targetHandle -> indexes of the edges into it
  const incoming = new Map<string, number[]>()
  // source -> target -> index of an edge that makes target depend on source
  const dependsOn = new Map<string, Map<string, number>>()

  edges.forEach((edge, index) => {
    const at = `edges[${index}]`
    if (!isObject(edge)) {
      report(
        'error',
        'edge-shape',
        at,
        'Each edge is an object with id, source, sourceHandle, target and targetHandle.'
      )
      return
    }
    if (edge.type === REFERENCE_EDGE_TYPE) return

    const { id, source, target, sourceHandle, targetHandle } = edge
    const label = typeof id === 'string' ? id : undefined
    const missing = (['id', 'source', 'sourceHandle', 'target', 'targetHandle'] as const).filter(
      key => typeof edge[key] !== 'string' || !edge[key]
    )
    if (missing.length > 0) {
      report(
        'error',
        'edge-shape',
        at,
        `Edge is missing ${missing.join(', ')}. An edge looks like {"id": "/a.out.data->/b.par.data", "source": "/a", "sourceHandle": "out.data", "target": "/b", "targetHandle": "par.data"}.`,
        label
      )
      return
    }
    const s = source as string
    const t = target as string
    const sh = sourceHandle as string
    const th = targetHandle as string
    const edgeId = id as string

    const canonical = `${s}.${sh}->${t}.${th}`
    const connection = JSON.stringify([s, sh, t, th])
    const earlier = connections.get(connection)
    if (earlier !== undefined) {
      report(
        'error',
        'duplicate-edge',
        at,
        `Edge ${edgeId} repeats the connection of edges[${earlier}]. Delete one of them.`,
        edgeId
      )
      return
    }
    connections.set(connection, index)

    const sameId = ids.get(edgeId)
    if (sameId !== undefined) {
      report(
        'error',
        'duplicate-edge-id',
        at,
        `Edge id ${edgeId} is also used by edges[${sameId}], which connects different handles. Set this edge's id to ${canonical}.`,
        edgeId
      )
    } else {
      ids.set(edgeId, index)
    }

    // Migrations keep legacy ids ("/a.layer->/b.basemap") and suffix repaired
    // ones "#2", so only an id in the canonical shape that names other
    // endpoints is out of date
    const unsuffixed = edgeId.replace(/#\d+$/, '')
    if (hasCanonicalShape(unsuffixed) && unsuffixed !== canonical) {
      report(
        'warning',
        'stale-edge-id',
        at,
        `Edge id ${edgeId} doesn't match its endpoints. When an edge's endpoints change, its id becomes ${canonical}.`,
        edgeId
      )
    }

    const sourceOk = checkEndpoint(s, sh, 'source', t, registry, nodes, at, edgeId, report)
    const targetOk = checkEndpoint(t, th, 'target', s, registry, nodes, at, edgeId, report)
    if (sourceOk && targetOk) {
      const key = `${t}\u0000${th}`
      incoming.set(key, [...(incoming.get(key) ?? []), index])
      // As in transform-graph.ts: an edge from a node's own par. field to itself
      // or into its children is no dependency, or every container would loop
      const enclosed = sh.startsWith('par.') && (t === s || t.startsWith(`${s}/`))
      if (!enclosed) {
        const targets = dependsOn.get(s) ?? new Map<string, number>()
        if (!targets.has(t)) targets.set(t, index)
        dependsOn.set(s, targets)
      }
    }
  })

  for (const loop of findLoops(dependsOn)) {
    const [first, second] = loop
    const index = dependsOn.get(first)?.get(second) ?? 0
    report(
      'error',
      'cycle',
      `edges[${index}]`,
      `Edges form a loop: ${[...loop, first].join(' -> ')}. The editor never runs nodes in a loop; remove one of these edges.`,
      first
    )
  }

  for (const [key, indexes] of incoming) {
    if (indexes.length < 2) continue
    const [target, handle] = key.split('\u0000')
    const node = nodes.get(target)
    const field = handle.startsWith('par.') ? handle.slice(4) : null
    if (!node || !field) continue
    const inputs = getOperator(registry, node.type)?.inputs ?? {}
    if (Object.hasOwn(inputs, field) && inputs[field].type === MULTI_INPUT_FIELD_TYPE) continue
    report(
      'error',
      'multiple-inputs',
      `edges[${indexes[1]}]`,
      `${target} ${handle} has ${indexes.length} incoming edges (${indexes.map(i => `edges[${i}]`).join(', ')}). Only list inputs take more than one; keep one edge, or merge the data upstream.`,
      target
    )
  }
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

// True when the node exists and the handle names one of its fields
function checkEndpoint(
  nodeId: string,
  handle: string,
  role: 'source' | 'target',
  otherId: string,
  registry: Registry,
  nodes: Map<string, NodeRecord>,
  at: string,
  edgeId: string,
  report: Report
): boolean {
  const node = nodes.get(nodeId)
  if (!node) {
    const near = [...nodes.keys()].filter(id => isTypo(id, nodeId) || id.endsWith(nodeId))
    const hint = near.length > 0 ? ` Did you mean ${near.slice(0, 5).join(', ')}?` : ''
    report(
      'error',
      'edge-unknown-node',
      at,
      `Edge ${role} ${nodeId} is not a node in this project.${hint} If a node was renamed, update the edge's ${role} and id.`,
      edgeId
    )
    return false
  }
  // An unknown type is reported on the node itself
  if (!getOperator(registry, node.type)) {
    if (SPECIAL_NODE_TYPES.has(node.type)) {
      report(
        'error',
        'edge-handle',
        at,
        `Edge ${role} ${nodeId} is a ${node.type} node, which has no inputs or outputs.`,
        edgeId
      )
    }
    return false
  }

  // A container passes values across its boundary from its own side: the edge
  // into its GraphInputOp starts at the container's input (par.), and the edge
  // out of its GraphOutputOp ends at the container's output (out.)
  const crossesBoundary = isDirectChild(otherId, nodeId)
  const side: Side = (role === 'source') !== crossesBoundary ? 'outputs' : 'inputs'
  const known = [
    ...fieldNames(registry, node.type, side),
    ...(side === 'inputs' ? node.customInputs : []),
    ...containerFields(node, nodes),
  ]
  const problem = handleProblem(nodeId, node.type, handle, side, known)
  if (problem) {
    report('error', 'edge-handle', at, `Edge ${edgeId}: ${problem}`, edgeId)
    return false
  }
  return true
}

// `${source}.${sourceHandle}->${target}.${targetHandle}`, split rather than
// matched with one regex, which backtracks badly on long ids
function hasCanonicalShape(id: string): boolean {
  const arrow = id.indexOf('->')
  if (arrow < 0) return false
  return [id.slice(0, arrow), id.slice(arrow + 2)].every(
    side => side.startsWith('/') && /\.(out|par)\./.test(side)
  )
}

function isGenericName(id: string, registry: Registry): boolean {
  // String slicing, not one regex: a pattern that has to find where the name
  // part starts backtracks on long ids (CodeQL js/polynomial-redos)
  const segment = id.slice(id.lastIndexOf('/') + 1)
  const dash = segment.lastIndexOf('-')
  const prefix = segment.slice(0, dash)
  if (dash < 1 || !/^\d+$/.test(segment.slice(dash + 1))) return false
  return Object.values(registry.operators).some(op =>
    [op.name, op.type.replace(/Op$/, '')].some(
      name =>
        prefix === name.toLowerCase() ||
        prefix === name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    )
  )
}

function isNodePath(id: string): boolean {
  return (
    id.startsWith('/') &&
    id
      .slice(1)
      .split('/')
      .every(part => part !== '' && !/\s/.test(part))
  )
}

function isDirectChild(childId: string, parentId: string): boolean {
  return childId.startsWith(`${parentId}/`) && !childId.slice(parentId.length + 1).includes('/')
}

// A node may declare its own inputs alongside the values for them. The editor
// throws while loading one whose type it doesn't know, so check each
// definition; the names still count, so one bad type is one error
function checkCustomInputs(
  data: Json,
  id: string,
  at: string,
  registry: Registry,
  report: Report
): string[] {
  const custom = data.customInputs
  if (custom === undefined) return []
  if (!Array.isArray(custom)) {
    report(
      'error',
      'custom-input',
      at,
      `${id} data.customInputs is not an array of input definitions.`,
      id
    )
    return []
  }
  const names: string[] = []
  const types = registry.customFieldTypes
  custom.forEach((def, i) => {
    const where = `${id} data.customInputs[${i}]`
    if (!isObject(def) || typeof def.name !== 'string' || !def.name) {
      report(
        'error',
        'custom-input',
        at,
        `${where} has no name. A custom input looks like {"id": "<uuid>", "name": "threshold", "type": "number", "order": 0}.`,
        id
      )
      return
    }
    names.push(def.name)
    if (types && (typeof def.type !== 'string' || !types.includes(def.type))) {
      report(
        'error',
        'custom-input',
        at,
        `${where} (${def.name}) has type ${JSON.stringify(def.type)}, which the editor can't load. Custom input types are: ${types.join(', ')}.`,
        id
      )
    }
  })
  return names
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
