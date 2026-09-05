import { describe, expect, it } from 'vitest'
import core from './core.md?raw'
import basicPlotting from './sections/basic-plotting.md?raw'
import dataAndSql from './sections/data-and-sql.md?raw'
import debugging from './sections/debugging.md?raw'
import operatorCheatsheet from './sections/operator-cheatsheet.md?raw'
import timelineAnimation from './sections/timeline-animation.md?raw'
import updatingVisualizations from './sections/updating-visualizations.md?raw'

// The old monolithic system-prompt.md was 10,184 chars — around 2,800 tokens,
// most of a small model's whole window before any tool result landed. The point
// of the split is that this stays small, so guard the ceiling.
const CORE_MAX_CHARS = 3200

const SECTIONS = {
  'basic-plotting': basicPlotting,
  'data-and-sql': dataAndSql,
  debugging,
  'operator-cheatsheet': operatorCheatsheet,
  'timeline-animation': timelineAnimation,
  'updating-visualizations': updatingVisualizations,
}

describe('core prompt', () => {
  it('stays small enough for a small-model context window', () => {
    expect(core.length).toBeLessThanOrEqual(CORE_MAX_CHARS)
  })

  it('keeps the handle-format rules, the most common failure mode', () => {
    expect(core).toContain('out.{fieldName}')
    expect(core).toContain('par.{fieldName}')
    expect(core).toContain('**NEVER use**: `in.{fieldName}`, `input.{fieldName}`')
    expect(core).toContain('"sourceHandle": "out.data"')
  })

  it('names the always-on tools so the model does not hunt for them', () => {
    for (const tool of [
      'list_nodes',
      'get_node_info',
      'get_node_output',
      'apply_modifications',
      'find_tools',
    ]) {
      expect(core, tool).toContain(tool)
    }
  })

  it('points at find_tools and get_documentation for everything else', () => {
    expect(core).toContain('find_tools({ query:')
    expect(core).toContain('get_documentation')
  })

  it('explains the truncation marker the result budget appends', () => {
    expect(core).toContain('_truncated')
  })
})

describe('prompt sections', () => {
  it('each opens with an H1, which generate-context.ts reads as the title', () => {
    for (const [name, content] of Object.entries(SECTIONS)) {
      expect(content.match(/^#\s+(.+)$/m)?.[1], name).toBeTruthy()
    }
  })

  it('each is substantial enough to be worth a retrieval round-trip', () => {
    for (const [name, content] of Object.entries(SECTIONS)) {
      expect(content.length, name).toBeGreaterThan(500)
    }
  })

  it('together they are far larger than the core prompt they were cut from', () => {
    const total = Object.values(SECTIONS).reduce((sum, content) => sum + content.length, 0)
    expect(total).toBeGreaterThan(core.length * 2)
  })

  it('covers each workflow the core prompt promises', () => {
    // core.md tells the model these walkthroughs exist; a missing one is a
    // promise the docs cannot keep
    expect(basicPlotting).toContain('AccessorOp')
    expect(updatingVisualizations).toContain('get_node_info')
    expect(debugging).toContain('get_console_errors')
    expect(dataAndSql).toContain('DuckDbOp')
    expect(timelineAnimation).toContain('set_keyframe')
    expect(operatorCheatsheet).toContain('ScatterplotLayerOp')
  })
})
