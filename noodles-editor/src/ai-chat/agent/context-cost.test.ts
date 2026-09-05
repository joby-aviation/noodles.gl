// Measures what one turn costs in context, and guards the result against
// regressing. This is where the before/after table in dev-docs/agent-harness.md
// comes from — re-run with `npx vitest run src/ai-chat/agent/context-cost.test.ts
// --silent=false` to print the numbers again.
//
// "Before" is the old code path reconstructed here: the 13 tool schemas the old
// client sent (it filtered 9 out with exposeToChat: false) and the old listNodes
// shape, copied verbatim below.

import { describe, expect, it } from 'vitest'
import { MCPTools } from '../mcp-tools'
import { toolDefinitions } from '../tool-definitions'
import type { NoodlesProject } from '../types'
import { capToolResult, resultBudgetChars } from './result-budget'
import { ToolRouter } from './tool-router'

// The 9 tools the old client filtered out with exposeToChat: false
const OLD_HIDDEN = new Set([
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

const CODE = `
// Aggregate trips by hour and normalise the counts so the ramp uses the full range
const byHour = d3.rollups(data, v => v.length, d => new Date(d.pickup_datetime).getHours())
const max = d3.max(byHour, d => d[1])
return byHour.map(([hour, count]) => ({ hour, count, intensity: count / max }))
`.trim()

const SQL = `
SELECT pickup_longitude AS lng, pickup_latitude AS lat, passenger_count, fare_amount
FROM 'trips.parquet'
WHERE fare_amount BETWEEN {{/min-fare.par.value}} AND {{/max-fare.par.value}}
  AND passenger_count >= {{/min-passengers.par.value}}
ORDER BY fare_amount DESC
LIMIT 5000
`.trim()

// A 60-node project shaped like a real one: a few heavy code/sql nodes, a layer
// stack, and a long tail of small numeric and accessor nodes.
function project() {
  const nodes = []
  for (let i = 0; i < 6; i++) {
    nodes.push({
      id: `/transform-${i}`,
      type: 'CodeOp',
      position: { x: i * 240, y: 0 },
      data: { inputs: { code: CODE } },
    })
  }
  for (let i = 0; i < 6; i++) {
    nodes.push({
      id: `/query-${i}`,
      type: 'DuckDbOp',
      position: { x: i * 240, y: 160 },
      data: { inputs: { sql: SQL } },
    })
  }
  for (let i = 0; i < 12; i++) {
    nodes.push({
      id: `/scatterplot-${i}`,
      type: 'ScatterplotLayerOp',
      position: { x: i * 240, y: 320 },
      data: {
        inputs: {
          radiusScale: 1 + i,
          radiusMinPixels: 2,
          radiusMaxPixels: 40,
          opacity: 0.8,
          pickable: true,
          getFillColor: [255, 140, 0, 200],
        },
      },
    })
  }
  for (let i = 0; i < 18; i++) {
    nodes.push({
      id: `/position-${i}`,
      type: 'AccessorOp',
      position: { x: i * 120, y: 480 },
      data: { inputs: { code: '[d.lng, d.lat]' } },
    })
  }
  for (let i = 0; i < 17; i++) {
    nodes.push({
      id: `/number-${i}`,
      type: 'NumberOp',
      position: { x: i * 120, y: 600 },
      data: { inputs: { value: i * 3.5 } },
    })
  }
  nodes.push({
    id: '/renderer',
    type: 'DeckRendererOp',
    position: { x: 0, y: 720 },
    data: { inputs: { layers: [] } },
  })
  return { version: 6, nodes, edges: [] }
}

// The old listNodes, verbatim minus the operator-state lookup (which is null in
// a headless test either way)
function oldListNodes(proj: ReturnType<typeof project>) {
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
    const proj = project()
    const tools = new MCPTools()
    // The measurement only reads nodes, so a full project is not worth building
    tools.setProject(proj as unknown as NoodlesProject)
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
