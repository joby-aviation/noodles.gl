// Any project file as an editor document. Documents are saved as `EditorDoc` JSON; older
// projects are operator graphs (noodles.json schema 1–21), migrated to the latest schema and converted.

import type { EditorDoc } from '@noodles.gl/planner'
import { migrateProject } from '../noodles/utils/migrate-schema'
import type { NoodlesProjectJSON } from '../noodles/utils/serialization'
import { type NoodlesProject, toEditorDoc } from '../runtime/migrate/to-editor-doc'

export interface LoadedDoc {
  doc: EditorDoc
  /** What the conversion of an older project dropped, for the user to review. */
  warnings: string[]
}

/**
 * Whether a file is an editor document. Both formats have small version numbers, so the shape
 * decides: a document's nodes name an `op`, an operator graph's a `type`.
 */
export function isEditorDoc(json: unknown): json is EditorDoc {
  const j = json as { version?: unknown; nodes?: unknown; edges?: unknown }
  return (
    j?.version === 1 &&
    Array.isArray(j.nodes) &&
    Array.isArray(j.edges) &&
    j.nodes.every(n => typeof (n as { op?: unknown }).op === 'string') &&
    j.edges.every(e => typeof (e as { sourcePort?: unknown }).sourcePort === 'string')
  )
}

export async function loadDoc(json: unknown, name?: string): Promise<LoadedDoc> {
  if (isEditorDoc(json)) return { doc: name ? { ...json, name } : json, warnings: [] }
  const project = await migrateProject(json as NoodlesProjectJSON)
  const { doc, warnings } = toEditorDoc({
    ...project,
    name: name ?? project.name,
  } as NoodlesProject)
  // What the migrations themselves reported, such as a TableEditor schema they could not keep
  const migrated = (project.migrationDiagnostics ?? []).map(d => d.message)
  return { doc, warnings: [...migrated, ...warnings] }
}
