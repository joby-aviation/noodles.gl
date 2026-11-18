// What a node's info card says about the layer it drew
import { describe, expect, it } from 'vitest'
import type { EngineState } from './doc-engine'
import { infoLines, MANY_LABELS } from './doc-node'

const drew = (kind: string, rows: number) =>
  ({
    layers: [{ id: 'n', kind, rows, queryMs: 1, evalMs: 1, bindings: [] }],
  }) as unknown as EngineState

describe('infoLines', () => {
  // #888: a label per vertex, or per row of a large table, is easy to make by accident
  it('warns about a text layer with more labels than a map shows', () => {
    const warning = (lines: string[]) => lines.some(l => l.includes('Max rows'))
    expect(warning(infoLines('n', drew('text', MANY_LABELS + 1)))).toBe(true)
    expect(warning(infoLines('n', drew('text', MANY_LABELS)))).toBe(false)
    // An icon is one quad; many are cheap
    expect(warning(infoLines('n', drew('icon', MANY_LABELS * 2)))).toBe(false)
  })
})
