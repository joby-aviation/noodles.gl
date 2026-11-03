// A graph edit the assistant proposed and the user has not yet accepted or
// rejected. apply_modifications has already validated it against the project and
// the operator registry (mcp-tools.ts), so this only holds it and says what it
// would do. Accepting runs it through the same applier the panel always used.

import type { ProjectModification } from './types'

export interface ProposalLine {
  // One line for the review card, with every value cut to a short preview
  text: string
  // The values the preview cut short, in full, for an expandable view
  detail?: string
}

export interface ModificationProposal {
  modifications: ProjectModification[]
  // One line per modification, for the review card
  lines: ProposalLine[]
}

export function createProposal(modifications: ProjectModification[]): ModificationProposal {
  return { modifications, lines: modifications.map(describeModification) }
}

// Long enough for a number, a color or a short string; code and data get cut
const PREVIEW_CHARS = 40

export function describeModification(modification: ProjectModification): ProposalLine {
  switch (modification.type) {
    case 'add_node': {
      const { type, id, data } = modification.data
      const values = describeInputs(inputsOf(data))
      return withDetail(
        values ? `Add ${type} ${id} with ${values.text}` : `Add ${type} ${id}`,
        values?.detail
      )
    }
    case 'update_node': {
      const { id, data, position, ...rest } = modification.data
      const values = describeInputs(inputsOf(data))
      const moveTo = position ? `(${Math.round(position.x)}, ${Math.round(position.y)})` : null
      const { inputs: _inputs, ...otherData } = (data ?? {}) as Record<string, unknown>
      const other = [...Object.keys(otherData), ...Object.keys(rest)]

      // Every changed part is listed, so a move cannot hide behind an input change
      if (values && !moveTo && other.length === 0)
        return withDetail(`Set ${values.text} on ${id}`, values.detail)
      if (moveTo && !values && other.length === 0) return { text: `Move ${id} to ${moveTo}` }
      const parts = [
        values && `set ${values.text}`,
        moveTo && `move to ${moveTo}`,
        other.length > 0 && `change ${other.join(', ')}`,
      ].filter(Boolean)
      if (parts.length === 0) return { text: `Update ${id}` }
      return withDetail(`Update ${id}: ${parts.join('; ')}`, values?.detail)
    }
    case 'delete_node':
      return { text: `Delete ${modification.data.id}` }
    case 'add_edge': {
      const { source, sourceHandle, target, targetHandle } = modification.data
      return {
        text: `Connect ${source}${sourceHandle ? `.${sourceHandle}` : ''} to ${target}${targetHandle ? `.${targetHandle}` : ''}`,
      }
    }
    case 'delete_edge':
      return { text: `Disconnect ${modification.data.id}` }
  }
}

function inputsOf(data: unknown): Record<string, unknown> {
  const inputs = (data as { inputs?: unknown } | undefined)?.inputs
  return typeof inputs === 'object' && inputs !== null ? (inputs as Record<string, unknown>) : {}
}

// "radius = 4000, color = [255,0,0]", plus the full values of any cut short
function describeInputs(inputs: Record<string, unknown>) {
  const entries = Object.entries(inputs)
  if (entries.length === 0) return null
  const details: string[] = []
  const text = entries
    .map(([name, value]) => {
      const oneLine = formatValue(value)
      if (oneLine.length <= PREVIEW_CHARS) return `${name} = ${oneLine}`
      details.push(`${name}:\n${typeof value === 'string' ? value : formatValue(value, 2)}`)
      return `${name} = ${oneLine.slice(0, PREVIEW_CHARS - 1)}…`
    })
    .join(', ')
  return { text, detail: details.length > 0 ? details.join('\n\n') : undefined }
}

function formatValue(value: unknown, indent?: number): string {
  try {
    return JSON.stringify(value, null, indent) ?? String(value)
  } catch {
    return String(value)
  }
}

function withDetail(text: string, detail: string | undefined): ProposalLine {
  return detail ? { text, detail } : { text }
}
