// Layer 3 — process metrics, counted not judged (07 D4). The boundary rule:
// anything a parser can compute from the transcript belongs here. All lookups
// at T0 are file reads/greps, so "schema lookup for operator type X" is
// approximated as: any prior Read/Grep/Bash tool_use whose input mentions X or
// operators.ts. Approximations are documented in evals/README.md.

import type { Registry } from './registry'

export interface ProcessMetrics {
  toolCalls: number
  lookups: number
  hallucinatedHandles: string[]
  lookupPrecededEdgeRatio: number | null
  identicalLookupRepetitions: number
  toolErrorCount: number
}

interface ToolUse {
  name: string
  input: string
  index: number
}

export function computeProcessMetrics(
  transcriptJsonl: string,
  finalProject: { nodes?: Array<{ id?: string; type?: string }>; edges?: Array<Record<string, unknown>> } | null,
  registry: Registry | null
): ProcessMetrics {
  const toolUses: ToolUse[] = []
  let toolErrorCount = 0

  for (const line of transcriptJsonl.split('\n')) {
    if (!line.trim()) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const content = (event.message as { content?: unknown })?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const b = block as Record<string, unknown>
      if (b.type === 'tool_use') {
        toolUses.push({ name: String(b.name), input: JSON.stringify(b.input ?? {}), index: toolUses.length })
      } else if (b.type === 'tool_result' && b.is_error) {
        toolErrorCount++
      }
    }
  }

  const isLookup = (t: ToolUse) => ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'].includes(t.name)
  const lookups = toolUses.filter(isLookup)

  // identical-lookup repetition: same (tool, input) seen 3+ times
  const seen = new Map<string, number>()
  for (const t of lookups) {
    const sig = `${t.name}:${t.input}`
    seen.set(sig, (seen.get(sig) ?? 0) + 1)
  }
  const identicalLookupRepetitions = [...seen.values()].filter(n => n >= 3).length

  // Handle lint over the final artifact + lookup-preceded-edge ratio.
  const hallucinatedHandles: string[] = []
  let lookupPrecededEdgeRatio: number | null = null
  if (finalProject?.edges && finalProject.nodes && registry) {
    const typeById = new Map<string, string>()
    for (const n of finalProject.nodes) if (n.id && n.type) typeById.set(n.id, n.type)

    const hadLookup = (opType: string | undefined, beforeIndex: number) => {
      if (!opType) return false
      return lookups.some(
        t => t.index < beforeIndex && (t.input.includes(opType) || t.input.includes('operators.ts'))
      )
    }
    // The artifact is written by the last Write/Edit touching it — use the last
    // write-ish tool call as the "edge written" point (a per-edge write index
    // isn't recoverable from a whole-file Write).
    const lastWriteIndex = Math.max(
      0,
      ...toolUses.filter(t => ['Write', 'Edit', 'NotebookEdit'].includes(t.name)).map(t => t.index)
    )

    let preceded = 0
    for (const edge of finalProject.edges) {
      const sourceType = typeById.get(String(edge.source))
      const targetType = typeById.get(String(edge.target))
      for (const [handle, type, side] of [
        [edge.sourceHandle, sourceType, 'outputs'],
        [edge.targetHandle, targetType, 'inputs'],
      ] as const) {
        if (typeof handle !== 'string' || !type) continue
        const field = handle.replace(/^(out|par)\./, '')
        const schema = registry.schemas.get(type)
        const open = side === 'inputs' ? schema?.inputsOpen : schema?.outputsOpen
        if (schema && !open && schema[side].size > 0 && !schema[side].has(field)) {
          hallucinatedHandles.push(`${edge.source}->${edge.target}: ${handle} (${type})`)
        }
      }
      if (hadLookup(sourceType, lastWriteIndex) && hadLookup(targetType, lastWriteIndex)) preceded++
    }
    lookupPrecededEdgeRatio = finalProject.edges.length > 0 ? preceded / finalProject.edges.length : null
  }

  return {
    toolCalls: toolUses.length,
    lookups: lookups.length,
    hallucinatedHandles,
    lookupPrecededEdgeRatio,
    identicalLookupRepetitions,
    toolErrorCount,
  }
}
