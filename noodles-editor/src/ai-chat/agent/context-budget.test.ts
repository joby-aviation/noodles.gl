// How much of each provider's window the first turn spends before the model has
// done anything: system prompt, tool schemas, the output reserve, and one typical
// tool result. What is left is the room the model has to actually work in.
//
// context-cost.test.ts measures the payload against the old client; this measures
// it against the windows the payload has to fit. Re-run with `npx vitest run
// src/ai-chat/agent/context-budget.test.ts --silent=false` to print the table. The
// snapshot is rounded so it only moves when the prompt or schemas grow for real.

import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../conversation-compaction'
import { MCPTools } from '../mcp-tools'
import { getSystemPrompt } from '../system-prompt'
import type { NoodlesProject, ToolResult } from '../types'
import { preamble } from './providers/json-tools'
import { capToolResult, resultBudgetChars } from './result-budget'
import { sampleProject } from './sample-project'
import { ToolRouter } from './tool-router'

interface Target {
  label: string
  window: number
  // What the provider holds back for the answer
  outputReserve: number
  // Providers without native tools carry the schemas inside the system prompt
  jsonTools: boolean
}

// Output reserves are each provider's own: MAX_OUTPUT_TOKENS in webllm.ts,
// OUTPUT_HEADROOM_TOKENS in chrome.ts, MAX_TOKENS in session.ts
const TARGETS: Target[] = [
  { label: 'webllm 4k (today)', window: 4096, outputReserve: 768, jsonTools: true },
  { label: 'chrome 6k (fallback)', window: 6144, outputReserve: 1000, jsonTools: true },
  { label: 'webllm 16k', window: 16_384, outputReserve: 768, jsonTools: true },
  { label: 'webllm 32k', window: 32_768, outputReserve: 768, jsonTools: true },
  { label: 'anthropic 200k', window: 200_000, outputReserve: 8192, jsonTools: false },
]

// Snapshot granularity, so an operator or doc added in an unrelated PR does not
// churn the snapshot
const round = (tokens: number) => Math.round(tokens / 50) * 50

function budgetFor(target: Target, listNodes: ToolResult) {
  const system = getSystemPrompt()
  const tools = new ToolRouter(target.window).getTools()

  const systemTokens = estimateTokens(system)
  const toolsTokens = target.jsonTools
    ? estimateTokens(preamble({ system: '', messages: [], tools, maxTokens: 0 }))
    : estimateTokens(
        tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
      )
  // chars is the serialized size of what the loop would send, so /4 matches
  // estimateTokens without serializing twice
  const resultTokens = Math.ceil(
    capToolResult('list_nodes', listNodes, resultBudgetChars(target.window)).chars / 4
  )

  const fixed = systemTokens + toolsTokens + target.outputReserve
  return {
    target: target.label,
    window: target.window,
    system: systemTokens,
    tools: toolsTokens,
    outputReserve: target.outputReserve,
    listNodes: resultTokens,
    // Before any tool result: all a turn with no tool call can use
    headroom: target.window - fixed,
    // After one list_nodes: what a typical inspect-then-act turn has left
    headroomAfterInspect: target.window - fixed - resultTokens,
  }
}

describe('context budget', () => {
  it('reports first-turn headroom per provider window', async () => {
    const tools = new MCPTools()
    tools.setProject(sampleProject() as unknown as NoodlesProject)
    const listNodes = await tools.listNodes()
    const rows = TARGETS.map(target => budgetFor(target, listNodes))

    console.table(rows)

    // A 16k window is the smallest the on-device providers should be sized to, and
    // it has to leave room for several real tool results, not one
    for (const row of rows.filter(r => r.window >= 16_384)) {
      expect(row.headroomAfterInspect, row.target).toBeGreaterThanOrEqual(1500)
    }

    expect(
      rows.map(r => ({
        target: r.target,
        system: round(r.system),
        tools: round(r.tools),
        headroom: round(r.headroom),
        headroomAfterInspect: round(r.headroomAfterInspect),
      }))
    ).toMatchSnapshot()
  })
})
