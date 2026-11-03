import { edgeId } from '../utils/migration-utils'
import type { NoodlesProjectJSON } from '../utils/serialization'

// MapViewStateOp's longitude and latitude inputs became one Point2D input, `center`.
// A node whose longitude or latitude was connected or an expression gets `center` split
// into channel ports, so `par.longitude` becomes `par.center.lng` and an expression
// moves into its channel. `par.longitude` reads in code and mustache references keep
// working through MapViewStateOp.inputAliases, so they aren't rewritten.

type ProjectNode = NoodlesProjectJSON['nodes'][number]
type ProjectEdge = NoodlesProjectJSON['edges'][number]

const TYPE = 'MapViewStateOp'
// The defaults of the old inputs, as of this migration
const DEFAULT_LONGITUDE = -74.006
const DEFAULT_LATITUDE = 40.7128
const CHANNELS = [
  ['longitude', 'lng'],
  ['latitude', 'lat'],
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExpression(value: unknown): boolean {
  return isRecord(value) && typeof value.$expr === 'string'
}

function nodeData(node: ProjectNode): Record<string, unknown> {
  return isRecord(node.data) ? node.data : {}
}

function renameEdges(edges: ProjectEdge[], ids: Set<string>, renames: Map<string, string>) {
  return edges.map(edge => {
    const targetHandle = edge.targetHandle ? renames.get(edge.targetHandle) : undefined
    if (!ids.has(edge.target) || !targetHandle) return edge
    const renamed = { ...edge, targetHandle }
    return { ...renamed, id: edgeId(renamed) }
  })
}

function renameVisibleInputs(visible: unknown, renames: Record<string, string[]>) {
  if (!Array.isArray(visible)) return undefined
  return [...new Set(visible.flatMap(name => renames[name] ?? [name]))]
}

// Track paths are "camera / center / lng". A project saves them grouped by object name
// with the rest as a prop path, "center.lng" or '["center","lng"]'.
function renameTracks(timeline: Record<string, unknown>, renames: Map<string, string>) {
  // Hand-written project files can leave out the timeline
  if (renames.size === 0 || !isRecord(timeline)) return timeline
  const migrated = structuredClone(timeline) as {
    sheetsById?: {
      Noodles?: {
        sequence?: {
          tracksByObject?: Record<string, { trackIdByPropPath?: Record<string, string> }>
          markers?: { connections?: { trackPath?: string }[] }[]
        }
      }
    }
  }
  const sequence = migrated.sheetsById?.Noodles?.sequence
  if (!sequence) return timeline

  for (const [objectName, object] of Object.entries(sequence.tracksByObject ?? {})) {
    if (!isRecord(object?.trackIdByPropPath)) continue
    const entries = Object.entries(object.trackIdByPropPath).map(([propPath, trackId]) => {
      let propParts: string[]
      let json = false
      try {
        const parsed = JSON.parse(propPath)
        json = Array.isArray(parsed)
        propParts = json ? parsed.map(String) : propPath.split('.')
      } catch {
        propParts = propPath.split('.')
      }
      const renamed = renames.get([objectName, ...propParts].join(' / '))
      if (!renamed?.startsWith(`${objectName} / `)) return [propPath, trackId]
      const nextParts = renamed.slice(objectName.length + 3).split(' / ')
      const next =
        json || nextParts.some(part => part.includes('.'))
          ? JSON.stringify(nextParts)
          : nextParts.join('.')
      return [next, trackId]
    })
    object.trackIdByPropPath = Object.fromEntries(entries)
  }

  for (const marker of sequence.markers ?? []) {
    for (const connection of marker.connections ?? []) {
      const renamed = connection.trackPath ? renames.get(connection.trackPath) : undefined
      if (renamed) connection.trackPath = renamed
    }
  }
  return migrated as Record<string, unknown>
}

function trackRenames(ids: Set<string>, direction: 'up' | 'down') {
  const renames = new Map<string, string>()
  for (const id of ids) {
    const object = id.slice(1).split('/').join(' / ')
    for (const [oldName, channel] of CHANNELS) {
      const before = `${object} / ${oldName}`
      const after = `${object} / center / ${channel}`
      if (direction === 'up') renames.set(before, after)
      else renames.set(after, before)
    }
  }
  return renames
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const ids = new Set(project.nodes.filter(node => node.type === TYPE).map(node => node.id))
  if (ids.size === 0) return project

  const handles = new Map<string, string>(
    CHANNELS.map(([oldName, channel]) => [`par.${oldName}`, `par.center.${channel}`])
  )
  const edges = renameEdges(project.edges, ids, handles)
  const connected = new Set(
    project.edges
      .filter(edge => ids.has(edge.target) && handles.has(edge.targetHandle ?? ''))
      .map(edge => edge.target)
  )

  const nodes = project.nodes.map(node => {
    if (node.type !== TYPE) return node
    const data = nodeData(node)
    const { longitude, latitude, ...inputs } = isRecord(data.inputs) ? data.inputs : {}
    const split = connected.has(node.id) || isExpression(longitude) || isExpression(latitude)
    if (longitude !== undefined || latitude !== undefined) {
      inputs.center = { lng: longitude ?? DEFAULT_LONGITUDE, lat: latitude ?? DEFAULT_LATITUDE }
    }
    const visibleInputs = renameVisibleInputs(data.visibleInputs, {
      longitude: ['center'],
      latitude: ['center'],
    })
    const inputPortModes = isRecord(data.inputPortModes) ? data.inputPortModes : {}
    return {
      ...node,
      data: {
        ...data,
        inputs,
        ...(visibleInputs && { visibleInputs }),
        ...(split && { inputPortModes: { ...inputPortModes, center: 'channels' } }),
      },
    }
  })

  return {
    ...project,
    nodes,
    edges,
    timeline: renameTracks(project.timeline, trackRenames(ids, 'up')),
  }
}

// A whole-value edge or expression on `center` has no equivalent in two number inputs,
// so it is dropped and longitude and latitude fall back to their defaults
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const ids = new Set(project.nodes.filter(node => node.type === TYPE).map(node => node.id))
  if (ids.size === 0) return project

  const handles = new Map<string, string>(
    CHANNELS.map(([oldName, channel]) => [`par.center.${channel}`, `par.${oldName}`])
  )
  const edges = renameEdges(
    project.edges.filter(edge => !(ids.has(edge.target) && edge.targetHandle === 'par.center')),
    ids,
    handles
  )

  const nodes = project.nodes.map(node => {
    if (node.type !== TYPE) return node
    const data = nodeData(node)
    const { center, ...inputs } = isRecord(data.inputs) ? data.inputs : {}
    if (Array.isArray(center)) {
      inputs.longitude = center[0]
      inputs.latitude = center[1]
    } else if (isRecord(center) && !isExpression(center)) {
      if (center.lng !== undefined) inputs.longitude = center.lng
      if (center.lat !== undefined) inputs.latitude = center.lat
    }
    const visibleInputs = renameVisibleInputs(data.visibleInputs, {
      center: ['longitude', 'latitude'],
    })
    const { center: _mode, ...inputPortModes } = isRecord(data.inputPortModes)
      ? data.inputPortModes
      : {}
    const { inputPortModes: _modes, ...rest } = data
    return {
      ...node,
      data: {
        ...rest,
        inputs,
        ...(visibleInputs && { visibleInputs }),
        ...(Object.keys(inputPortModes).length > 0 && { inputPortModes }),
      },
    }
  })

  return {
    ...project,
    nodes,
    edges,
    timeline: renameTracks(project.timeline, trackRenames(ids, 'down')),
  }
}
