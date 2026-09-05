import { describe, expect, it } from 'vitest'
import type { ToolResult } from '../types'
import { capToolResult, resultBudgetChars, serialize } from './result-budget'

// Mirrors the shape mcp-tools listNodes returns, at a size that used to blow
// the context budget in one call
function syntheticListNodesResult(nodeCount: number): ToolResult {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `/node-${i}`,
    type: i % 3 === 0 ? 'CodeOp' : 'ScatterplotLayerOp',
    inputs:
      i % 3 === 0
        ? { code: `// transform step ${i}\n${'return data.filter(d => d.value > 0)\n'.repeat(20)}` }
        : { opacity: 0.8, visible: true, radiusScale: 12 },
    locked: false,
    executionState: { status: 'success', lastExecuted: 1_700_000_000_000, executionTime: 4 },
  }))
  return { success: true, data: { nodes, totalCount: nodes.length, byType: { CodeOp: 34 } } }
}

describe('resultBudgetChars', () => {
  it('scales with the provider context window', () => {
    const nano = resultBudgetChars(6144)
    const claude = resultBudgetChars(200_000)
    expect(nano).toBeLessThan(claude)
  })

  it('clamps to a usable floor for tiny on-device windows', () => {
    expect(resultBudgetChars(1024)).toBeGreaterThanOrEqual(600)
  })

  it('clamps to a ceiling so huge windows do not invite huge results', () => {
    expect(resultBudgetChars(2_000_000)).toBe(resultBudgetChars(1_000_000))
  })
})

describe('capToolResult', () => {
  it('leaves results that already fit untouched', () => {
    const result: ToolResult = { success: true, data: { nodes: [{ id: '/a', type: 'FileOp' }] } }
    const capped = capToolResult('list_nodes', result, 4000)
    expect(capped.truncated).toBe(false)
    expect(capped.result).toBe(result)
  })

  it('keeps a 100-node project under budget', () => {
    const budget = resultBudgetChars(200_000)
    const raw = serialize(syntheticListNodesResult(100))
    expect(raw.length).toBeGreaterThan(budget)

    const capped = capToolResult('list_nodes', syntheticListNodesResult(100), budget)
    expect(capped.truncated).toBe(true)
    expect(capped.chars).toBeLessThanOrEqual(budget)
  })

  it('keeps a 100-node project under a tiny on-device budget', () => {
    const budget = resultBudgetChars(6144)
    const capped = capToolResult('list_nodes', syntheticListNodesResult(100), budget)
    expect(capped.chars).toBeLessThanOrEqual(budget)
  })

  it('produces valid JSON with a truncation marker naming the total', () => {
    const capped = capToolResult('list_nodes', syntheticListNodesResult(100), 1500)
    const parsed = JSON.parse(serialize(capped.result))
    expect(parsed.success).toBe(true)

    const nodes = parsed.data.nodes as unknown[]
    const marker = nodes[nodes.length - 1] as { _truncated?: { total: number; hint: string } }
    expect(marker._truncated?.total).toBe(100)
    expect(marker._truncated?.hint).toContain('get_node_info')
  })

  it('clips long strings with a marker rather than cutting mid-JSON', () => {
    const result: ToolResult = {
      success: true,
      data: { code: 'x'.repeat(50_000) },
    }
    const capped = capToolResult('get_source_code', result, 3000)
    expect(capped.chars).toBeLessThanOrEqual(3000)

    const parsed = JSON.parse(serialize(capped.result))
    const text = serialize(parsed)
    expect(text).toContain('clipped')
    expect(text).toContain('50000 chars total')
  })

  it('preserves the error field when shrinking a failed result', () => {
    const result: ToolResult = {
      success: false,
      error: 'Node not found: /missing',
      data: { candidates: Array.from({ length: 500 }, (_, i) => `/node-${i}`) },
    }
    const capped = capToolResult('get_node_info', result, 800)
    expect(capped.result.success).toBe(false)
    expect(capped.result.error).toBe('Node not found: /missing')
  })

  it('falls back to a preview when even the tightest limits overflow', () => {
    const result: ToolResult = { success: true, data: { blob: 'y'.repeat(10_000) } }
    const capped = capToolResult('search_code', result, 620)
    expect(capped.chars).toBeLessThanOrEqual(620)
    expect(JSON.parse(serialize(capped.result))).toBeTruthy()
  })

  it('uses a generic hint for tools without a specific one', () => {
    const result: ToolResult = {
      success: true,
      data: { rows: Array.from({ length: 400 }, (_, i) => ({ i, pad: 'z'.repeat(40) })) },
    }
    const capped = capToolResult('some_unknown_tool', result, 1200)
    expect(serialize(capped.result)).toContain('narrow your query')
  })
})

describe('serialize', () => {
  it('emits compact JSON, not indented', () => {
    expect(serialize({ a: 1, b: 2 })).toBe('{"a":1,"b":2}')
  })

  it('drops functions', () => {
    expect(serialize({ a: 1, fn: () => 1 })).toBe('{"a":1}')
  })

  it('cuts cycles without dropping legitimately repeated references', () => {
    const shared = { name: 'shared' }
    const cyclic: Record<string, unknown> = { shared, also: shared }
    cyclic.self = cyclic

    const text = serialize(cyclic)
    // The repeated sibling reference survives in both positions
    expect(text.match(/"name":"shared"/g)).toHaveLength(2)
    expect(text).toContain('[circular]')
  })
})
