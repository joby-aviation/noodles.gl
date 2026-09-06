// animate-camera: SF → LA over 5 seconds. Direct timeline JSON edits are a
// legitimate path (07 D2). Position units are seconds; prop paths appear as
// JSON-array form (["viewState","longitude"], Theatre-era files) or dot form
// ("viewState.longitude", current exporter) — both accepted.

import { type CheckContext, type CheckResult, type ProjectJson } from './types'

const SF = { longitude: -122.42, latitude: 37.77 }
const LA = { longitude: -118.24, latitude: 34.05 }
const TOLERANCE = 0.5
const CAMERA_TYPES = new Set(['MaplibreBasemapOp', 'MapViewStateOp', 'MapViewOp', 'MapboxOp'])

interface Keyframe {
  id?: string
  position?: number
  value?: unknown
}

export function customChecks(ctx: CheckContext): Record<string, CheckResult> {
  const checks: Record<string, CheckResult> = {}
  const { after } = ctx
  if (!after) {
    return { artifactPresent: { pass: false, detail: 'no parseable project produced' } }
  }

  const found = findCameraTracks(after)
  if (!found) {
    return {
      'camera-tracks-present': {
        pass: false,
        detail: 'no timeline tracks bound to a camera node (viewState longitude+latitude)',
      },
    }
  }
  checks['camera-tracks-present'] = { pass: true, detail: `on ${found.nodeId} (${found.nodeType})` }

  checks['sequence-covers-5s'] = {
    pass: found.sequenceLength >= 4.5,
    detail: `sequence.length = ${found.sequenceLength}`,
  }

  for (const [axis, start, end] of [
    ['longitude', SF.longitude, LA.longitude],
    ['latitude', SF.latitude, LA.latitude],
  ] as const) {
    const kfs = found[axis]
    if (!kfs || kfs.length < 2) {
      checks[`${axis}-keyframes`] = { pass: false, detail: `${kfs?.length ?? 0} keyframe(s), need ≥ 2` }
      continue
    }
    const first = kfs[0]
    const last = kfs[kfs.length - 1]
    const spanOk = (first.position ?? 99) <= 0.75 && (last.position ?? 0) >= 4.25
    const startOk = near(first.value, start)
    const endOk = near(last.value, end)
    checks[`${axis}-keyframes`] = {
      pass: spanOk && startOk && endOk,
      detail: `${kfs.length} kfs, ${first.position}s→${last.position}s, ${first.value}→${last.value} (want ~${start}→~${end})`,
    }
  }

  return checks
}

function near(value: unknown, target: number): boolean {
  return typeof value === 'number' && Math.abs(value - target) <= TOLERANCE
}

function findCameraTracks(project: ProjectJson): {
  nodeId: string
  nodeType: string
  sequenceLength: number
  longitude?: Keyframe[]
  latitude?: Keyframe[]
} | null {
  const typeById = new Map((project.nodes ?? []).map(n => [n.id, n.type]))
  const sheets = (project.timeline as { sheetsById?: Record<string, unknown> })?.sheetsById ?? {}
  for (const sheet of Object.values(sheets)) {
    const sequence = (sheet as { sequence?: Record<string, unknown> })?.sequence
    if (!sequence) continue
    const tracksByObject = (sequence.tracksByObject ?? {}) as Record<string, unknown>
    for (const [objectKey, entry] of Object.entries(tracksByObject)) {
      // object key = node id minus leading slash; nested = "a / b"
      const nodeId = `/${objectKey.split(' / ').join('/')}`
      const nodeType = typeById.get(nodeId)
      if (!nodeType || !CAMERA_TYPES.has(nodeType)) continue
      const trackIdByPropPath = ((entry as Record<string, unknown>).trackIdByPropPath ?? {}) as Record<string, string>
      const trackData = ((entry as Record<string, unknown>).trackData ?? {}) as Record<string, { keyframes?: Keyframe[] }>
      const axisKeyframes = (axis: string): Keyframe[] | undefined => {
        for (const [propPath, trackId] of Object.entries(trackIdByPropPath)) {
          const normalized = normalizePropPath(propPath)
          if (normalized === `viewState.${axis}` || normalized === axis) {
            return trackData[trackId]?.keyframes
          }
        }
        return undefined
      }
      const longitude = axisKeyframes('longitude')
      const latitude = axisKeyframes('latitude')
      if (longitude || latitude) {
        return {
          nodeId,
          nodeType,
          sequenceLength: Number(sequence.length ?? 0),
          longitude,
          latitude,
        }
      }
    }
  }
  return null
}

function normalizePropPath(propPath: string): string {
  try {
    const parsed = JSON.parse(propPath)
    if (Array.isArray(parsed)) return parsed.join('.')
  } catch {
    /* dot form */
  }
  return propPath
}
