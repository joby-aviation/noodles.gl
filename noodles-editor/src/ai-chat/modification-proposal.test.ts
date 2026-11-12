import type { EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { describeChanges } from './modification-proposal'

const doc = (nodes: EditorDoc['nodes'], edges: EditorDoc['edges'] = []): EditorDoc => ({
  version: 1,
  name: 'p',
  nodes,
  edges,
})

const before = doc(
  [
    { id: 'n1', op: 'scatter', name: 'points', x: 0, y: 0, params: { radiusScale: 1 } },
    { id: 'n2', op: 'number', name: 'scratch', x: 0, y: 0, params: {} },
    { id: 'n3', op: 'deck', name: 'deck', x: 0, y: 0, params: {} },
  ],
  [{ id: 'e1', source: 'n2', sourcePort: 'out', target: 'n1', targetPort: 'par:radiusScale' }]
)

describe('describeChanges', () => {
  it('describes each change on one line: added, set, moved, wired, deleted', () => {
    const after = doc(
      [
        { id: 'n1', op: 'scatter', name: 'points', x: 0, y: 0, params: { radiusScale: 4 } },
        { id: 'n3', op: 'deck', name: 'deck', x: 800, y: 200, params: {} },
        { id: 'n4', op: 'number', name: 'threshold', x: 0, y: 0, params: { value: 2 } },
      ],
      [{ id: 'e2', source: 'n4', sourcePort: 'out', target: 'n1', targetPort: 'par:radiusScale' }]
    )
    expect(describeChanges(before, after).map(l => l.text)).toEqual([
      'Set radiusScale = 4 on points',
      'Move deck to (800, 200)',
      'Add number threshold with value = 2',
      'Connect threshold.out to points.par:radiusScale',
      'Disconnect scratch.out from points.par:radiusScale',
      'Delete scratch',
    ])
  })

  it('shows the new values, so 4 and 4000 read differently', () => {
    const at = (r: number) =>
      doc([{ id: 'n1', op: 'scatter', name: 'points', x: 0, y: 0, params: { radiusScale: r } }])
    expect(describeChanges(at(1), at(4))[0].text).toBe('Set radiusScale = 4 on points')
    expect(describeChanges(at(1), at(4000))[0].text).toBe('Set radiusScale = 4000 on points')
  })

  it('cuts long values to a preview and keeps them in full in the detail', () => {
    const code = 'const rows = d.filter(r => r.value > 10)\nreturn rows.map(r => r.value * 2)'
    const [line] = describeChanges(
      doc([{ id: 'c', op: 'code', name: 'code', x: 0, y: 0, params: {} }]),
      doc([{ id: 'c', op: 'code', name: 'code', x: 0, y: 0, params: { code } }])
    )
    expect(line.text).toMatch(/^Set code = "const rows .*… on code$/)
    expect(line.detail).toBe(`code:\n${code}`)
  })

  it('says nothing when nothing changed', () => {
    expect(describeChanges(before, structuredClone(before))).toEqual([])
  })
})
