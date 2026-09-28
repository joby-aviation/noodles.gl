import { describe, expect, it } from 'vitest'
import { aggregate, compare, type RunRow, renderMarkdown, type Summary } from './summary'

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    taskId: 't2-a',
    tier: 'T2',
    provider: 'webllm',
    model: 'Qwen3-4B',
    contextWindow: 4096,
    knobs: '',
    repeat: 0,
    score: 4,
    pass: true,
    mechanicalFailure: false,
    steps: 2,
    toolCalls: 1,
    inputTokens: 3000,
    outputTokens: 100,
    diagnostics: {},
    ms: 10_000,
    loadMs: 1000,
    timedOut: false,
    ...overrides,
  }
}

function summary(runId: string, rows: RunRow[]): Summary {
  return {
    runId,
    startedAt: '2026-09-26T00:00:00Z',
    environment: {
      gitSha: 'abc123',
      dirty: false,
      userAgent: 'test',
      gpu: { vendor: 'apple', description: 'Apple M3' },
      deviceMemoryGb: 8,
      cpuCores: 8,
      machine: 'mac',
    },
    rows,
  }
}

describe('aggregate', () => {
  it('rolls runs up per config and tier with an overall row first', () => {
    const stats = aggregate([
      row({ tier: 'T1', score: 4, pass: true }),
      row({ tier: 'T2', score: 0, pass: false, diagnostics: { context_trimmed: 2 } }),
      row({ tier: 'T2', score: 2, pass: false, timedOut: true }),
    ])
    expect(stats.map(s => s.tier)).toEqual(['all', 'T1', 'T2'])

    const t2 = stats.find(s => s.tier === 'T2')
    expect(t2?.passRate).toBe(0)
    expect(t2?.meanScorePct).toBe(25)
    expect(t2?.trimmed).toBe(2)
    expect(t2?.timeouts).toBe(1)
    // 200 output tokens over 20s
    expect(t2?.outputTokensPerSecond).toBe(10)
  })

  it('keeps context windows apart', () => {
    const stats = aggregate([row(), row({ contextWindow: 16_384 })])
    expect(stats.filter(s => s.tier === 'all')).toHaveLength(2)
  })

  it('renders a table row per config and tier', () => {
    const table = renderMarkdown(summary('run', [row(), row({ tier: 'T1' })]))
    expect(table).toContain('Apple M3')
    // Header, separator, then all + T1 + T2
    expect(table.split('\n').filter(l => l.startsWith('| '))).toHaveLength(5)
  })

  it('averages the judge over judged runs only', () => {
    const [all] = aggregate([row({ judge: 2 }), row()])
    expect(all.meanJudgePct).toBe(50)
    expect(aggregate([row()])[0].meanJudgePct).toBeNull()
  })
})

describe('compare', () => {
  it('flags a task whose mean score dropped by the threshold', () => {
    const before = summary('a', [row({ taskId: 'x', score: 4 }), row({ taskId: 'y', score: 2 })])
    const after = summary('b', [row({ taskId: 'x', score: 3 }), row({ taskId: 'y', score: 2 })])
    const deltas = compare(before, after)

    expect(deltas[0]).toMatchObject({ taskId: 'x', deltaPct: -25, regression: true })
    expect(deltas[1]).toMatchObject({ taskId: 'y', deltaPct: 0, regression: false })
  })

  it('ignores tasks only one side ran', () => {
    const before = summary('a', [row({ taskId: 'x' })])
    const after = summary('b', [row({ taskId: 'z' })])
    expect(compare(before, after)).toEqual([])
  })
})
