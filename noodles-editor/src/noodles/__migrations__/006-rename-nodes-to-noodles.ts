import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to rename Theatre sheet ID from "Nodes" to "Noodles"
//
// This migration:
// 1. Renames the sheet ID in timeline.sheetsById from "Nodes" to "Noodles"
// 2. Preserves all other timeline state

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, ...rest } = project

  const sheetsById = timeline.sheetsById as Record<string, unknown>

  // If "Nodes" sheet doesn't exist, nothing to migrate
  if (!sheetsById?.Nodes) {
    return project
  }

  // Rename "Nodes" to "Noodles"
  const { Nodes, ...otherSheets } = sheetsById
  const newSheetsById = {
    ...otherSheets,
    Noodles: Nodes,
  }

  return {
    ...rest,
    timeline: {
      ...timeline,
      sheetsById: newSheetsById,
    },
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, ...rest } = project

  const sheetsById = timeline.sheetsById as Record<string, unknown>

  // If "Noodles" sheet doesn't exist, nothing to migrate
  if (!sheetsById?.Noodles) {
    return project
  }

  // Rename "Noodles" back to "Nodes"
  const { Noodles, ...otherSheets } = sheetsById
  const newSheetsById = {
    ...otherSheets,
    Nodes: Noodles,
  }

  return {
    ...rest,
    timeline: {
      ...timeline,
      sheetsById: newSheetsById,
    },
  }
}
