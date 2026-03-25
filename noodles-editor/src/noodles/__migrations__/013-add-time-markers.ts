// Migration to add time markers support to timeline
// Projects without markers get an empty markers array initialized

import type { NoodlesProjectJSON } from '../utils/serialization'

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, ...rest } = project

  // No timeline data - nothing to migrate
  if (!timeline) {
    return project
  }

  const sheetsById = (timeline as { sheetsById?: Record<string, unknown> })?.sheetsById
  const noodlesSheet = (sheetsById?.Noodles ?? {}) as {
    sequence?: Record<string, unknown>
    staticOverrides?: unknown
  }

  // No sequence - nothing to migrate
  if (!noodlesSheet.sequence) {
    return project
  }

  // Add empty markers array if not present
  const newSequence = {
    ...noodlesSheet.sequence,
    markers: noodlesSheet.sequence.markers ?? [],
  }

  return {
    ...rest,
    timeline: {
      ...timeline,
      sheetsById: {
        ...sheetsById,
        Noodles: {
          ...noodlesSheet,
          sequence: newSequence,
        },
      },
    },
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, ...rest } = project

  // No timeline data - nothing to migrate
  if (!timeline) {
    return project
  }

  const sheetsById = (timeline as { sheetsById?: Record<string, unknown> })?.sheetsById
  const noodlesSheet = (sheetsById?.Noodles ?? {}) as {
    sequence?: Record<string, unknown>
    staticOverrides?: unknown
  }

  // No sequence or no markers - nothing to do
  if (!noodlesSheet.sequence || !('markers' in noodlesSheet.sequence)) {
    return project
  }

  // Remove markers field when downgrading
  const { markers: _, ...sequenceWithoutMarkers } = noodlesSheet.sequence

  return {
    ...rest,
    timeline: {
      ...timeline,
      sheetsById: {
        ...sheetsById,
        Noodles: {
          ...noodlesSheet,
          sequence: sequenceWithoutMarkers,
        },
      },
    },
  }
}
