// Measures what one turn costs in context, and guards the result against
// regressing. This is where the before/after table in dev-docs/agent-harness.md
// comes from — re-run with `npx vitest run src/ai-chat/agent/context-cost.test.ts
// --silent=false` to print the numbers again.
//
// "Before" is the old code path reconstructed here: the 13 tool schemas the old
// client sent (it filtered 9 out with exposeToChat: false) and the old listNodes
// shape, copied verbatim below.

import { describe, expect, it } from 'vitest'
import { DocStore } from '../../editor/doc-store'
import { MCPTools } from '../mcp-tools'
import { toolDefinitions } from '../tool-definitions'
import { capToolResult, resultBudgetChars } from './result-budget'
import { sampleDoc, sampleProject } from './sample-project'
import { ToolRouter } from './tool-router'

// The 9 tools the old client filtered out with exposeToChat: false, plus tools that
// did not exist then — counting a new capability against the old baseline would
// flatter the comparison rather than measure it.
const OLD_HIDDEN = new Set([
  'run_code',
  'list_files',
  'read_file',
  'write_file',
  'grep_files',
  'search_code',
  'get_source_code',
  'get_operator_schema',
  'list_operators',
  'get_documentation',
  'get_example',
  'list_examples',
  'find_symbol',
  'analyze_project',
])

// The old listNodes, verbatim minus the operator-state lookup (which is null in
// a headless test either way)
function oldListNodes(proj: ReturnType<typeof sampleProject>) {
  const nodes = proj.nodes.map(node => ({
    id: node.id,
    type: node.type,
    position: node.position,
    inputs: node.data?.inputs || {},
    locked: false,
    executionState: null,
  }))
  const byType: Record<string, number> = {}
  for (const n of nodes) byType[n.type] = (byType[n.type] || 0) + 1
  return {
    nodes,
    totalCount: nodes.length,
    byType,
    dataNodes: nodes.filter(n => ['FileOp', 'JSONOp', 'DuckDbOp', 'CSVOp'].includes(n.type)),
    layerNodes: nodes.filter(n => n.type.includes('Layer')),
    rendererNodes: nodes.filter(n => ['DeckRendererOp', 'OutOp'].includes(n.type)),
  }
}

const tokens = (chars: number) => Math.round(chars / 4)
const report = (label: string, chars: number) =>
  console.log(`${label}: ${chars} chars (~${tokens(chars)} tokens)`)

describe('context cost', () => {
  it('sends less than half the tool schema payload the old client did', () => {
    const before = toolDefinitions
      .filter(d => !OLD_HIDDEN.has(d.name))
      .map(d => ({ name: d.name, description: d.description, input_schema: d.inputSchema }))
    const after = new ToolRouter(200_000)
      .getTools()
      .map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))

    const beforeChars = JSON.stringify(before).length
    const afterChars = JSON.stringify(after).length
    report(`schemas before (${before.length} tools)`, beforeChars)
    report(`schemas after (${after.length} tools)`, afterChars)

    expect(afterChars).toBeLessThan(beforeChars * 0.6)
  })

  it('roughly halves one list_nodes result on a 60-node project', async () => {
    const proj = sampleProject()
    const doc = sampleDoc()
    const tools = new MCPTools(undefined, { store: new DocStore(doc), engine: () => undefined })
    const fresh = await tools.listNodes()

    const beforeChars = JSON.stringify(oldListNodes(proj)).length
    const large = capToolResult('list_nodes', fresh, resultBudgetChars(200_000))
    const small = capToolResult('list_nodes', fresh, resultBudgetChars(6144))

    report('list_nodes before', beforeChars)
    report('list_nodes after (200k window)', large.chars)
    report('list_nodes after (6k window)', small.chars)

    expect(large.chars).toBeLessThan(beforeChars * 0.7)
    // The point of deriving the budget from the window: the same call has to fit
    // an on-device model too
    expect(small.chars).toBeLessThan(resultBudgetChars(6144))
    expect(small.truncated).toBe(true)
  })
})
