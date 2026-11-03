// Migration to convert keyframes saved by Theatre.js to the native timeline's easing.
//
// Both store handles as [leftX, leftY, rightX, rightY], but read them differently. Theatre
// eased the segment from k to the next keyframe with
// cubic-bezier(k.rightX, k.rightY, next.leftX, next.leftY). The native timeline reads a
// keyframe's four numbers as the cubic-bezier of its outgoing segment, so Theatre's default
// [0.5, 1, 0.5, 0] (ease-in-out) played as cubic-bezier(0.5, 1, 0.5, 0): fast, a pause, fast.
// Theatre also marked step keyframes with type 'hold' and left connectedRight true, which the
// native timeline only reads as a hold when connectedRight is false.
//
// Theatre wrote `type` on every keyframe and the native timeline never does, so tracks
// whose keyframes carry it are the ones to convert. Dropping it makes this run once.

import type { NoodlesProjectJSON } from '../utils/serialization'

type Handles = [number, number, number, number]

type Keyframe = {
  position: number
  connectedRight?: boolean
  handles?: Handles
  type?: string
  [key: string]: unknown
}

type TrackData = { keyframes?: Keyframe[]; [key: string]: unknown }

type TrackObject = {
  trackIdByPropPath?: Record<string, string>
  trackData?: Record<string, TrackData>
}

// Theatre's default handles, used when a keyframe has none
const THEATRE_HANDLES: Handles = [0.5, 1, 0.5, 0]

function isTheatreTrack(
  track: TrackData | undefined
): track is TrackData & { keyframes: Keyframe[] } {
  return Array.isArray(track?.keyframes) && track.keyframes.some(kf => typeof kf?.type === 'string')
}

function handlesOf(kf: Keyframe): Handles {
  return Array.isArray(kf.handles) && kf.handles.length === 4 ? kf.handles : THEATRE_HANDLES
}

function convertKeyframes(keyframes: Keyframe[]): Keyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.position - b.position)
  return sorted.map((kf, i) => {
    const own = handlesOf(kf)
    // The last keyframe has no outgoing segment. Pair its right handle with its own left
    // one, as Theatre would with a new keyframe that has the same handles.
    const next = i + 1 < sorted.length ? handlesOf(sorted[i + 1]) : own
    const { type, ...rest } = kf
    return {
      ...rest,
      connectedRight: kf.connectedRight !== false && type !== 'hold',
      handles: [own[2], own[3], next[0], next[1]],
    }
  })
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline } = project
  const sheetsById = (timeline as { sheetsById?: Record<string, unknown> })?.sheetsById
  const noodlesSheet = sheetsById?.Noodles as
    | { sequence?: { tracksByObject?: Record<string, TrackObject> } }
    | undefined
  const sequence = noodlesSheet?.sequence
  const tracksByObject = sequence?.tracksByObject ?? {}

  let changed = false
  const converted: Record<string, TrackObject> = {}
  for (const [name, object] of Object.entries(tracksByObject)) {
    const trackData = object?.trackData
    if (!trackData || !Object.values(trackData).some(isTheatreTrack)) {
      converted[name] = object
      continue
    }
    changed = true
    converted[name] = {
      ...object,
      trackData: Object.fromEntries(
        Object.entries(trackData).map(([id, track]) => [
          id,
          isTheatreTrack(track)
            ? { ...track, keyframes: convertKeyframes(track.keyframes) }
            : track,
        ])
      ),
    }
  }

  if (!changed) return project

  return {
    ...project,
    timeline: {
      ...timeline,
      sheetsById: {
        ...sheetsById,
        Noodles: {
          ...noodlesSheet,
          sequence: { ...sequence, tracksByObject: converted },
        },
      },
    },
  }
}

// The converted keyframes are in the form v22 reads, so they already play correctly there
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
