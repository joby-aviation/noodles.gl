// A graph edit the assistant proposed and the user has not yet accepted or
// rejected. apply_modifications has already validated it against the project and
// the operator registry (mcp-tools.ts), so this only holds it and says what it
// would do. Accepting runs it through the same applier the panel always used.

import type { ProjectModification } from './types'

export interface ModificationProposal {
  modifications: ProjectModification[]
  // One line per modification, for the review card
  lines: string[]
}

export function createProposal(modifications: ProjectModification[]): ModificationProposal {
  return { modifications, lines: modifications.map(describeModification) }
}

export function describeModification(modification: ProjectModification): string {
  switch (modification.type) {
    case 'add_node':
      return `Add ${modification.data.type} ${modification.data.id}`
    case 'update_node': {
      const inputs = modification.data.data?.inputs
      const names = typeof inputs === 'object' && inputs !== null ? Object.keys(inputs) : []
      if (names.length > 0) return `Set ${names.join(', ')} on ${modification.data.id}`
      if (modification.data.position) return `Move ${modification.data.id}`
      return `Update ${modification.data.id}`
    }
    case 'delete_node':
      return `Delete ${modification.data.id}`
    case 'add_edge': {
      const { source, sourceHandle, target, targetHandle } = modification.data
      return `Connect ${source}${sourceHandle ? `.${sourceHandle}` : ''} to ${target}${targetHandle ? `.${targetHandle}` : ''}`
    }
    case 'delete_edge':
      return `Disconnect ${modification.data.id}`
  }
}
