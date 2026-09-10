// Glue between the lazily-loaded WebMCP chunk and the React editor state.
// Kept dependency-free (type-only imports) so noodles.tsx can import it
// without pulling the WebMCP chunk into the main bundle.

import type { NoodlesProject } from '../ai-chat/types'
import type {
  ModificationResult,
  ProjectModification,
} from '../noodles/hooks/use-project-modifications'

type ModificationApplier = (modifications: ProjectModification[]) => ModificationResult

let applier: ModificationApplier | null = null
let project: NoodlesProject | null = null
const projectListeners = new Set<(project: NoodlesProject) => void>()

// The editor registers its useProjectModifications applier here so WebMCP
// tool calls can actually mutate React Flow state
export function setModificationApplier(fn: ModificationApplier | null) {
  applier = fn
}

export function getModificationApplier(): ModificationApplier | null {
  return applier
}

export function setCurrentProject(next: NoodlesProject) {
  project = next
  for (const listener of projectListeners) {
    listener(next)
  }
}

export function getCurrentProject(): NoodlesProject | null {
  return project
}

export function onProjectChange(listener: (project: NoodlesProject) => void): () => void {
  projectListeners.add(listener)
  return () => {
    projectListeners.delete(listener)
  }
}
