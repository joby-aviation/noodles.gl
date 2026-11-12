// Migration to rename timeline objects saved under their operator ID ("/camera/camera-1")
// to the object name the timeline binds to ("camera / camera-1").
//
// Projects saved around schema v6-v9 keyed tracksByObject by operator ID. The timeline
// builds track paths as "<objectName> / <field>" and binds fields with opIdToObjectName,
// so those tracks loaded but never matched a field and their keyframes did nothing.
// Marker connections stored track paths built from the same names, so they're renamed too.

import type { NoodlesProjectJSON } from '../utils/serialization'

type TrackObject = {
  trackIdByPropPath?: Record<string, string>
  trackData?: Record<string, unknown>
}

type Marker = {
  connections?: { trackPath?: string }[]
}

// Same as opIdToObjectName in timeline/field-bindings.ts, copied so this migration stays fixed
function opIdToObjectName(opId: string): string {
  return opId.slice(1).split('/').join(' / ')
}

function renameTrackPath(trackPath: string): string {
  if (!trackPath.startsWith('/')) return trackPath
  const [objectName, ...rest] = trackPath.split(' / ')
  return [opIdToObjectName(objectName), ...rest].join(' / ')
}

// The loader reads a prop path as a JSON array ('["viewState","zoom"]') or dot-separated
// ("viewState.zoom"), so two different keys can name the same field. Copied from
// loadTimeline in timeline/timeline-store.ts so this migration stays fixed.
function decodePropPath(propPath: string): string {
  try {
    const parsed = JSON.parse(propPath)
    if (Array.isArray(parsed)) return parsed.map(String).join(' / ')
  } catch {}
  return propPath.split('.').join(' / ')
}

// Copy the legacy object's tracks into the target, keeping tracks the target already has
function mergeTrackObjects(target: TrackObject, legacy: TrackObject): TrackObject {
  const trackIdByPropPath = { ...target.trackIdByPropPath }
  const trackData = { ...target.trackData }
  const fields = new Set(Object.keys(trackIdByPropPath).map(decodePropPath))
  for (const [propPath, trackId] of Object.entries(legacy.trackIdByPropPath ?? {})) {
    const field = decodePropPath(propPath)
    if (fields.has(field)) continue
    fields.add(field)
    let id = trackId
    while (id in trackData) id = `${id}_`
    trackIdByPropPath[propPath] = id
    trackData[id] = legacy.trackData?.[trackId]
  }
  return { ...target, trackIdByPropPath, trackData }
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline } = project
  const sheetsById = (timeline as { sheetsById?: Record<string, unknown> })?.sheetsById
  const noodlesSheet = sheetsById?.Noodles as
    | { sequence?: { tracksByObject?: Record<string, TrackObject>; markers?: Marker[] } }
    | undefined
  const sequence = noodlesSheet?.sequence
  const tracksByObject = sequence?.tracksByObject ?? {}

  if (!Object.keys(tracksByObject).some(name => name.startsWith('/'))) {
    return project
  }

  // Plain names first so they win when a legacy name renames onto an existing object
  const renamed: Record<string, TrackObject> = {}
  for (const [name, object] of Object.entries(tracksByObject)) {
    if (!name.startsWith('/')) renamed[name] = object
  }
  for (const [name, object] of Object.entries(tracksByObject)) {
    if (!name.startsWith('/')) continue
    const newName = opIdToObjectName(name)
    renamed[newName] = renamed[newName] ? mergeTrackObjects(renamed[newName], object) : object
  }

  const markers = sequence?.markers?.map(marker => ({
    ...marker,
    connections: marker.connections?.map(connection =>
      typeof connection.trackPath === 'string'
        ? { ...connection, trackPath: renameTrackPath(connection.trackPath) }
        : connection
    ),
  }))

  return {
    ...project,
    timeline: {
      ...timeline,
      sheetsById: {
        ...sheetsById,
        Noodles: {
          ...noodlesSheet,
          sequence: {
            ...sequence,
            tracksByObject: renamed,
            ...(markers ? { markers } : {}),
          },
        },
      },
    },
  }
}

// The operator-ID names never bound to anything, so there is nothing to restore
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
