// Interim validateProject(): schema + registry handle-lint inline, until 04's
// composite CLI exists (07 step 2 sanctions this exactly). Check list mirrors
// the composite spec in 04 D4 minus the runtime-only checks (migrations,
// anything needing the Vite-built world). Stamped validatorVersion interim-1;
// results freeze it per run (07 D5 regrade semantics).

import type { Registry } from './registry'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

interface ProjectEdge {
  id?: string
  source?: string
  target?: string
  sourceHandle?: string
  targetHandle?: string
}

interface ProjectNode {
  id?: string
  type?: string
  data?: {
    inputs?: Record<string, unknown>
    /** promoted parameters (interim-3): user-defined dynamic fields */
    customInputs?: Array<{ name?: string }>
  }
}

const NODE_ID_RE = /^\/[A-Za-z0-9_\-./ ]*$/

function isDirectChild(childId: string | undefined, parentId: string | undefined): boolean {
  if (!childId || !parentId) return false
  return childId.startsWith(`${parentId}/`) && !childId.slice(parentId.length + 1).includes('/')
}

function isContainerBridge(
  edge: ProjectEdge,
  nodeById: Map<string, ProjectNode>
): boolean {
  const source = edge.source ? nodeById.get(edge.source) : undefined
  const target = edge.target ? nodeById.get(edge.target) : undefined
  if (
    source?.type === 'ContainerOp' &&
    target?.type === 'GraphInputOp' &&
    edge.sourceHandle === 'par.in' &&
    edge.targetHandle === 'par.parentValue' &&
    isDirectChild(edge.target, edge.source)
  ) {
    return true
  }
  if (
    source?.type === 'GraphOutputOp' &&
    target?.type === 'ContainerOp' &&
    edge.sourceHandle === 'out.propagatedValue' &&
    edge.targetHandle === 'out.out' &&
    isDirectChild(edge.source, edge.target)
  ) {
    return true
  }
  return false
}

export function validateProject(
  raw: string,
  registry: Registry,
  expectedVersion: number
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  let project: Record<string, unknown>
  try {
    project = JSON.parse(raw)
  } catch (e) {
    return { valid: false, errors: [`not valid JSON: ${(e as Error).message}`], warnings }
  }

  if (project.version !== expectedVersion) {
    errors.push(
      `version is ${JSON.stringify(project.version)}, expected ${expectedVersion} — run \`npm run migrate-projects\``
    )
  }

  const nodes = Array.isArray(project.nodes) ? (project.nodes as ProjectNode[]) : null
  const edges = Array.isArray(project.edges) ? (project.edges as ProjectEdge[]) : null
  if (!nodes) errors.push('nodes is missing or not an array')
  if (!edges) errors.push('edges is missing or not an array')
  if (!nodes || !edges) return { valid: false, errors, warnings }

  const nodeById = new Map<string, ProjectNode>()
  for (const node of nodes) {
    if (typeof node.id !== 'string' || !NODE_ID_RE.test(node.id)) {
      errors.push(`node id ${JSON.stringify(node.id)} is not a Unix-style absolute path`)
      continue
    }
    if (nodeById.has(node.id)) errors.push(`duplicate node id ${node.id}`)
    nodeById.set(node.id, node)

    if (typeof node.type !== 'string' || !registry.types.has(node.type)) {
      errors.push(`node ${node.id} has unknown type ${JSON.stringify(node.type)}`)
      continue
    }
    const schema = registry.schemas.get(node.type)
    if (schema && !schema.inputsOpen && schema.inputs.size > 0) {
      // interim-3: promoted parameters (data.customInputs) declare dynamic
      // input names that are as valid as registry fields.
      const promoted = new Set(
        (node.data?.customInputs ?? []).map(d => d?.name).filter((n): n is string => typeof n === 'string')
      )
      for (const key of Object.keys(node.data?.inputs ?? {})) {
        if (!schema.inputs.has(key) && !promoted.has(key)) {
          errors.push(`node ${node.id} (${node.type}) serializes unknown input "${key}"`)
        }
      }
    }
  }

  const edgeIds = new Set<string>()
  for (const edge of edges) {
    const label = edge.id ?? `${edge.source}->${edge.target}`
    if (edge.id) {
      if (edgeIds.has(edge.id)) errors.push(`duplicate edge id ${edge.id}`)
      edgeIds.add(edge.id)
    }
    for (const [end, id] of [
      ['source', edge.source],
      ['target', edge.target],
    ] as const) {
      if (typeof id !== 'string' || !nodeById.has(id)) {
        errors.push(`edge ${label}: ${end} ${JSON.stringify(id)} does not reference an existing node`)
      }
    }

    // Container bridge edges (created by the app itself, node-creation-utils):
    // ContainerOp.par.in → child GraphInputOp.par.parentValue (input→input) and
    // child GraphOutputOp.out.propagatedValue → ContainerOp.out.out (out→out).
    // interim-2: these two exact shapes are exempt from the prefix rules.
    if (isContainerBridge(edge, nodeById)) continue

    if (typeof edge.sourceHandle !== 'string' || !edge.sourceHandle.startsWith('out.')) {
      errors.push(`edge ${label}: sourceHandle ${JSON.stringify(edge.sourceHandle)} must carry the "out." prefix`)
    }
    if (typeof edge.targetHandle !== 'string' || !edge.targetHandle.startsWith('par.')) {
      errors.push(`edge ${label}: targetHandle ${JSON.stringify(edge.targetHandle)} must carry the "par." prefix (never "in.")`)
    }

    // Field names must exist on the resolved operator schema.
    const checkField = (
      nodeId: string | undefined,
      handle: string | undefined,
      prefix: 'out.' | 'par.',
      side: 'outputs' | 'inputs'
    ) => {
      if (typeof nodeId !== 'string' || typeof handle !== 'string' || !handle.startsWith(prefix)) return
      const node = nodeById.get(nodeId)
      if (!node?.type) return
      const schema = registry.schemas.get(node.type)
      if (!schema || schema[side].size === 0) return // unparsed type: no field-level lint
      if (side === 'inputs' ? schema.inputsOpen : schema.outputsOpen) return // spread-built side: open
      const field = handle.slice(prefix.length)
      if (!schema[side].has(field)) {
        errors.push(
          `edge ${label}: ${side === 'outputs' ? 'sourceHandle' : 'targetHandle'} names "${field}", which is not a field of ${node.type}`
        )
      }
    }
    checkField(edge.source, edge.sourceHandle, 'out.', 'outputs')
    checkField(edge.target, edge.targetHandle, 'par.', 'inputs')

    // Canonical edge-id formula. Interim-1 demotes a mismatch to a warning:
    // committed, working examples (custom-maplibre-layer-test) carry ids
    // without handle prefixes and the app loads them fine — failing Layer 1 on
    // a formatting nit the app tolerates would mis-measure "does it validate/
    // load". 04's composite validator owns escalating this.
    const canonical = `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`
    if (edge.id !== canonical) {
      warnings.push(`edge id ${JSON.stringify(edge.id)} does not match the canonical formula ${canonical}`)
    }
  }

  validateTimeline(project.timeline, nodeById, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

// Timeline integrity: track paths resolve, keyframes sorted by position,
// unique keyframe/marker ids. (Marker→keyframe connections are 04-runtime
// territory; interim checks structure only.)
function validateTimeline(
  timeline: unknown,
  nodeById: Map<string, unknown>,
  errors: string[],
  warnings: string[]
): void {
  if (!timeline || typeof timeline !== 'object') return
  const sheets = (timeline as { sheetsById?: Record<string, unknown> }).sheetsById
  if (!sheets) return
  for (const [sheetId, sheet] of Object.entries(sheets)) {
    const sequence = (sheet as { sequence?: Record<string, unknown> })?.sequence
    if (!sequence) continue
    const tracksByObject = (sequence.tracksByObject ?? {}) as Record<string, unknown>
    for (const [objectKey, entry] of Object.entries(tracksByObject)) {
      if (!nodeById.has(`/${objectKey}`) && !nodeById.has(objectKey)) {
        errors.push(`timeline sheet ${sheetId}: track object "${objectKey}" does not resolve to an existing node`)
      }
      const trackData = ((entry as { trackData?: Record<string, unknown> })?.trackData ?? {}) as Record<
        string,
        unknown
      >
      for (const [trackId, track] of Object.entries(trackData)) {
        const keyframes = (track as { keyframes?: Array<{ id?: string; position?: number }> })?.keyframes
        if (!Array.isArray(keyframes)) continue
        const seen = new Set<string>()
        let lastPosition = Number.NEGATIVE_INFINITY
        for (const kf of keyframes) {
          if (typeof kf.id !== 'string' || kf.id.length === 0) {
            errors.push(`timeline track ${trackId}: keyframe without an id`)
          } else if (seen.has(kf.id)) {
            errors.push(`timeline track ${trackId}: duplicate keyframe id ${kf.id}`)
          } else {
            seen.add(kf.id)
          }
          if (typeof kf.position !== 'number' || kf.position < lastPosition) {
            errors.push(`timeline track ${trackId}: keyframes not sorted by position`)
            break
          }
          lastPosition = kf.position
        }
      }
    }
    const markers = (sequence.markers ?? []) as Array<{ id?: string }>
    if (Array.isArray(markers)) {
      const seen = new Set<string>()
      for (const marker of markers) {
        if (marker.id && seen.has(marker.id)) errors.push(`timeline sheet ${sheetId}: duplicate marker id ${marker.id}`)
        if (marker.id) seen.add(marker.id)
      }
    } else {
      warnings.push(`timeline sheet ${sheetId}: markers is not an array`)
    }
  }
}
