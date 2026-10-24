// The graph update an assistant run made, waiting on the user's Accept or Reject. The run's
// edits land on the document as it goes, so the assistant can read the outputs and errors
// they cause and fix them; the proposal is the document from before the run (a `DocMark`),
// kept as one undo step on Accept and restored on Reject. Its lines say what changed,
// read off the two documents, whichever tool made the change.

import type { DocNode, EditorDoc } from '@noodles.gl/planner'
import type { DocMark } from '../editor/doc-store'

export interface ProposalLine {
  // One line for the review card, with every value cut to a short preview
  text: string
  // The values the preview cut short, in full, for an expandable view
  detail?: string
}

export interface ModificationProposal {
  mark: DocMark
  // One line per change, for the review card
  lines: ProposalLine[]
}

export function createProposal(mark: DocMark, after: EditorDoc): ModificationProposal {
  return { mark, lines: describeChanges(mark.doc, after) }
}

// Long enough for a number, a color or a short string; code and data get cut
const PREVIEW_CHARS = 40

const nameOf = (n: DocNode) => n.name ?? n.id

/** What turned `before` into `after`: nodes added, changed, moved and removed, wires too. */
export function describeChanges(before: EditorDoc, after: EditorDoc): ProposalLine[] {
  const lines: ProposalLine[] = []
  const was = new Map(before.nodes.map(n => [n.id, n]))
  const is = new Map(after.nodes.map(n => [n.id, n]))
  const label = (id: string) => {
    const n = is.get(id) ?? was.get(id)
    return n ? nameOf(n) : id
  }
  for (const n of after.nodes) {
    const old = was.get(n.id)
    if (!old) {
      const values = describeParams(n.params)
      lines.push(
        withDetail(
          values ? `Add ${n.op} ${nameOf(n)} with ${values.text}` : `Add ${n.op} ${nameOf(n)}`,
          values?.detail
        )
      )
      continue
    }
    const changed: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(old.params), ...Object.keys(n.params)])) {
      if (JSON.stringify(old.params[k]) !== JSON.stringify(n.params[k])) changed[k] = n.params[k]
    }
    const values = describeParams(changed)
    const moved = old.x !== n.x || old.y !== n.y
    const renamed = old.name !== n.name
    const parts = [
      values && `set ${values.text}`,
      moved && `move to (${Math.round(n.x)}, ${Math.round(n.y)})`,
      renamed && `rename from ${nameOf(old)}`,
    ].filter(Boolean)
    if (parts.length === 0) continue
    // Every changed part is listed, so a move cannot hide behind a parameter change
    const text =
      values && !moved && !renamed
        ? `Set ${values.text} on ${nameOf(n)}`
        : moved && !values && !renamed
          ? `Move ${nameOf(n)} to (${Math.round(n.x)}, ${Math.round(n.y)})`
          : `Update ${nameOf(n)}: ${parts.join('; ')}`
    lines.push(withDetail(text, values?.detail))
  }
  const edgeKey = (e: EditorDoc['edges'][number]) =>
    `${e.source}.${e.sourcePort}->${e.target}.${e.targetPort}`
  const oldEdges = new Set(before.edges.map(edgeKey))
  const newEdges = new Set(after.edges.map(edgeKey))
  for (const e of after.edges) {
    if (!oldEdges.has(edgeKey(e))) {
      lines.push({
        text: `Connect ${label(e.source)}.${e.sourcePort} to ${label(e.target)}.${e.targetPort}`,
      })
    }
  }
  for (const e of before.edges) {
    if (!newEdges.has(edgeKey(e))) {
      lines.push({
        text: `Disconnect ${label(e.source)}.${e.sourcePort} from ${label(e.target)}.${e.targetPort}`,
      })
    }
  }
  for (const n of before.nodes) if (!is.has(n.id)) lines.push({ text: `Delete ${nameOf(n)}` })
  if (JSON.stringify(before.timeline ?? null) !== JSON.stringify(after.timeline ?? null)) {
    lines.push({ text: 'Change keyframes' })
  }
  return lines
}

// "radius = 4000, color = [255,0,0]", plus the full values of any cut short
function describeParams(params: Record<string, unknown>) {
  const entries = Object.entries(params)
  if (entries.length === 0) return null
  const details: string[] = []
  const text = entries
    .map(([name, value]) => {
      if (value === undefined) return `${name} reset`
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
