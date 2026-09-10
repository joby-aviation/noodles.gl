import { describe, expect, it } from 'vitest'
import { describeToolUses } from './session'

describe('describeToolUses', () => {
  it('is empty when the turn used no tools', () => {
    expect(describeToolUses(undefined)).toBe('')
    expect(describeToolUses([])).toBe('')
  })

  it('names each call with its arguments', () => {
    const note = describeToolUses([
      { name: 'get_node_info', params: { nodeId: '/scatterplot' }, ok: true },
      { name: 'apply_modifications', params: { modifications: [] }, ok: true },
    ])

    expect(note).toBe(
      '[tools used: get_node_info(nodeId="/scatterplot"), apply_modifications(modifications=[])]'
    )
  })

  it('marks a failed call, since that is usually what a follow-up is about', () => {
    expect(describeToolUses([{ name: 'get_node_output', ok: false }])).toBe(
      '[tools used: get_node_output() — failed]'
    )
  })

  it('clips a long argument rather than replaying the whole payload', () => {
    const note = describeToolUses([
      { name: 'search_code', params: { pattern: 'x'.repeat(200) }, ok: true },
    ])

    // The point of keeping tool uses is cheap recall, so one call stays one line
    expect(note.length).toBeLessThan(120)
    expect(note).toContain('…')
  })
})
