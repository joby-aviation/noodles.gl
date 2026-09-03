import type { Edge, Node } from '@xyflow/react'
import { edgeId } from '../utils/migration-utils'
import type { NoodlesProjectJSON } from '../utils/serialization'

const DEFAULT_LONGITUDE = -74.006
const DEFAULT_LATITUDE = 40.7128

type ProjectNode = Node<{
  inputs?: Record<string, unknown>
  visibleInputs?: string[]
  inputPortModes?: Record<string, 'whole' | 'channels'>
}>

type TimelineObject = {
  trackIdByPropPath?: Record<string, string>
  trackData?: Record<string, { __debugName?: string; [key: string]: unknown }>
}

function objectNameForNode(id: string): string {
  return id.replace(/^\//, '').split('/').join(' / ')
}

function renamePropPath(path: string, direction: 'up' | 'down'): string {
  const pairs =
    direction === 'up'
      ? [
          ['longitude', 'center / lng'],
          ['latitude', 'center / lat'],
        ]
      : [
          ['center / lng', 'longitude'],
          ['center / lat', 'latitude'],
        ]
  for (const [from, to] of pairs) {
    if (path === from) return to
  }

  try {
    const parsed = JSON.parse(path)
    if (Array.isArray(parsed)) {
      if (direction === 'up' && parsed.length === 1 && parsed[0] === 'longitude') {
        return JSON.stringify(['center', 'lng'])
      }
      if (direction === 'up' && parsed.length === 1 && parsed[0] === 'latitude') {
        return JSON.stringify(['center', 'lat'])
      }
      if (
        direction === 'down' &&
        parsed.length === 2 &&
        parsed[0] === 'center' &&
        parsed[1] === 'lng'
      ) {
        return JSON.stringify(['longitude'])
      }
      if (
        direction === 'down' &&
        parsed.length === 2 &&
        parsed[0] === 'center' &&
        parsed[1] === 'lat'
      ) {
        return JSON.stringify(['latitude'])
      }
    }
  } catch {
    // Non-JSON property paths use the slash-delimited format handled above.
  }
  return path
}

function migrateTimeline(
  timeline: Record<string, unknown>,
  nodes: ProjectNode[],
  direction: 'up' | 'down'
): Record<string, unknown> {
  const migrated = structuredClone(timeline)
  const sheet = (
    migrated as {
      sheetsById?: {
        Noodles?: {
          sequence?: {
            tracksByObject?: Record<string, TimelineObject>
            markers?: Array<{ connections?: Array<{ trackPath?: string }> }>
          }
          staticOverrides?: { byObject?: Record<string, Record<string, unknown>> }
        }
      }
    }
  ).sheetsById?.Noodles
  if (!sheet) return migrated

  const mapViewStateNodes = nodes.filter(node => node.type === 'MapViewStateOp')
  for (const node of mapViewStateNodes) {
    const objectNames = [objectNameForNode(node.id), node.id]
    for (const objectName of objectNames) {
      const timelineObject = sheet.sequence?.tracksByObject?.[objectName]
      if (timelineObject?.trackIdByPropPath) {
        timelineObject.trackIdByPropPath = Object.fromEntries(
          Object.entries(timelineObject.trackIdByPropPath).map(([path, trackId]) => [
            renamePropPath(path, direction),
            trackId,
          ])
        )
        for (const track of Object.values(timelineObject.trackData ?? {})) {
          if (!track.__debugName) continue
          track.__debugName =
            direction === 'up'
              ? track.__debugName
                  .replace('["longitude"]', '["center","lng"]')
                  .replace('["latitude"]', '["center","lat"]')
              : track.__debugName
                  .replace('["center","lng"]', '["longitude"]')
                  .replace('["center","lat"]', '["latitude"]')
        }
      }

      const overrides = sheet.staticOverrides?.byObject?.[objectName]
      if (overrides) {
        if (direction === 'up') {
          const longitude = overrides.longitude
          const latitude = overrides.latitude
          if (longitude !== undefined || latitude !== undefined) {
            overrides.center = {
              lng: longitude ?? DEFAULT_LONGITUDE,
              lat: latitude ?? DEFAULT_LATITUDE,
            }
            delete overrides.longitude
            delete overrides.latitude
          }
        } else {
          const center = overrides.center as { lng?: unknown; lat?: unknown } | undefined
          if (center) {
            overrides.longitude = center.lng ?? DEFAULT_LONGITUDE
            overrides.latitude = center.lat ?? DEFAULT_LATITUDE
            delete overrides.center
          }
        }
      }
    }

    for (const marker of sheet.sequence?.markers ?? []) {
      for (const connection of marker.connections ?? []) {
        if (!connection.trackPath) continue
        const prefixes = [objectNameForNode(node.id), node.id.replace(/^\//, ''), node.id]
        for (const prefix of prefixes) {
          const replacements =
            direction === 'up'
              ? [
                  [`${prefix} / longitude`, `${prefix} / center / lng`],
                  [`${prefix} / latitude`, `${prefix} / center / lat`],
                  [`${prefix}.par.longitude`, `${prefix}.par.center.lng`],
                  [`${prefix}.par.latitude`, `${prefix}.par.center.lat`],
                ]
              : [
                  [`${prefix} / center / lng`, `${prefix} / longitude`],
                  [`${prefix} / center / lat`, `${prefix} / latitude`],
                  [`${prefix}.par.center.lng`, `${prefix}.par.longitude`],
                  [`${prefix}.par.center.lat`, `${prefix}.par.latitude`],
                ]
          for (const [from, to] of replacements) {
            if (connection.trackPath === from) connection.trackPath = to
          }
        }
      }
    }
  }

  return migrated
}

function migrateEdges(
  edges: Edge[],
  mapViewStateIds: Set<string>,
  direction: 'up' | 'down'
): Edge[] {
  return edges.map(edge => {
    let sourceHandle = edge.sourceHandle
    let targetHandle = edge.targetHandle
    if (direction === 'up') {
      if (mapViewStateIds.has(edge.target)) {
        if (targetHandle === 'par.longitude') targetHandle = 'par.center.lng'
        if (targetHandle === 'par.latitude') targetHandle = 'par.center.lat'
      }
      if (mapViewStateIds.has(edge.source)) {
        if (sourceHandle === 'par.longitude') sourceHandle = 'par.center.lng'
        if (sourceHandle === 'par.latitude') sourceHandle = 'par.center.lat'
      }
    } else {
      if (mapViewStateIds.has(edge.target)) {
        if (targetHandle === 'par.center.lng') targetHandle = 'par.longitude'
        if (targetHandle === 'par.center.lat') targetHandle = 'par.latitude'
      }
      if (mapViewStateIds.has(edge.source)) {
        if (sourceHandle === 'par.center.lng') sourceHandle = 'par.longitude'
        if (sourceHandle === 'par.center.lat') sourceHandle = 'par.latitude'
      }
    }
    if (sourceHandle === edge.sourceHandle && targetHandle === edge.targetHandle) return edge
    const migrated = { ...edge, sourceHandle, targetHandle }
    return { ...migrated, id: edgeId(migrated) }
  })
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const nodes: ProjectNode[] = (project.nodes as ProjectNode[]).map(node => {
    if (node.type !== 'MapViewStateOp') return node
    const inputs = { ...(node.data?.inputs ?? {}) }
    const longitude = inputs.longitude ?? DEFAULT_LONGITUDE
    const latitude = inputs.latitude ?? DEFAULT_LATITUDE
    delete inputs.longitude
    delete inputs.latitude
    inputs.center = { lng: longitude, lat: latitude }

    const visibleInputs = node.data?.visibleInputs
      ? Array.from(
          new Set(
            node.data.visibleInputs.map(name =>
              name === 'longitude' || name === 'latitude' ? 'center' : name
            )
          )
        )
      : undefined

    return {
      ...node,
      data: {
        ...node.data,
        inputs,
        ...(visibleInputs ? { visibleInputs } : {}),
        inputPortModes: { ...node.data?.inputPortModes, center: 'channels' as const },
      },
    }
  })
  const ids = new Set(nodes.filter(node => node.type === 'MapViewStateOp').map(node => node.id))
  return {
    ...project,
    nodes,
    edges: migrateEdges(project.edges, ids, 'up'),
    timeline: migrateTimeline(project.timeline, nodes, 'up'),
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const nodes: ProjectNode[] = (project.nodes as ProjectNode[]).map(node => {
    if (node.type !== 'MapViewStateOp') return node
    const inputs = { ...(node.data?.inputs ?? {}) }
    const center = inputs.center as { lng?: unknown; lat?: unknown } | undefined
    delete inputs.center
    if (center) {
      inputs.longitude = center.lng ?? DEFAULT_LONGITUDE
      inputs.latitude = center.lat ?? DEFAULT_LATITUDE
    }
    const inputPortModes = { ...node.data?.inputPortModes }
    delete inputPortModes.center
    return {
      ...node,
      data: {
        ...node.data,
        inputs,
        ...(node.data?.visibleInputs
          ? {
              visibleInputs: node.data.visibleInputs.flatMap(name =>
                name === 'center' ? ['longitude', 'latitude'] : [name]
              ),
            }
          : {}),
        inputPortModes: Object.keys(inputPortModes).length > 0 ? inputPortModes : undefined,
      },
    }
  })
  const ids = new Set(nodes.filter(node => node.type === 'MapViewStateOp').map(node => node.id))
  return {
    ...project,
    nodes,
    edges: migrateEdges(project.edges, ids, 'down'),
    timeline: migrateTimeline(project.timeline, nodes, 'down'),
  }
}
