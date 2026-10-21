/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'
import type { BenchResult } from '../../src/ai-chat/bench/bench-hook'
import type { Grade } from './grade'
import {
  buildJudgePrompt,
  checkCitations,
  type JudgeSample,
  parseJudgeReply,
  parseRubric,
  reduceSamples,
  renderTranscript,
  resolveApplicability,
  totalScore,
} from './judge'
import inAppRubric from './rubrics/in-app.yaml?raw'
import template from './rubrics/judge-prompt.md?raw'
import { parseTask } from './tasks'

const RUBRIC = `
rubricVersion: 1
family: test
dimensions:
  correctness:
    style: anchors
    weight: 0.5
    levels: { 0: none, 1: little, 2: some, 3: most, 4: all }
  honesty:
    style: checklist
    weight: 0.5
    criteria:
      - { id: claims-match, text: Claims match }
      - { id: grounded, text: Grounded, applicable_when: 'tag:knowledge' }
  efficiency:
    style: anchors
    weight: 0
    informational: true
    levels: { 0: a, 1: b, 2: c, 3: d, 4: e }
`

const rubric = parseRubric(RUBRIC, 'test.yaml')

function sample(correctness: number, verdicts: Record<string, string>): JudgeSample {
  return {
    dimensions: {
      correctness: { style: 'anchors', level: correctness, evidence: '"x" (L1)' },
      honesty: {
        style: 'checklist',
        criteria: Object.fromEntries(
          Object.entries(verdicts).map(([id, verdict]) => [
            id,
            { verdict: verdict as 'pass', evidence: '"y" (L2)' },
          ])
        ),
      },
      efficiency: { style: 'anchors', level: 0, evidence: '"z" (L3)' },
    },
    citations: { checked: 0, resolved: 0, unresolved: [] },
  }
}

const result = {
  taskId: 't',
  provider: { id: 'webllm', model: 'm', contextWindow: 4096 },
  knobs: {},
  setupApply: null,
  turns: [
    {
      prompt: 'Make it red',
      reply: 'Done.\nIt is red.',
      steps: 2,
      toolCalls: [
        { name: 'get_node_info', params: { nodeId: '/pickup' }, success: true, preview: '{}' },
      ],
      usage: { inputTokens: 1, outputTokens: 1 },
      diagnostics: [{ kind: 'json_parse_fallback', detail: 'truncated' }],
      stopReasons: ['tool_use', 'tool_use'],
      modificationsCount: 1,
      apply: { success: true },
      ms: 1,
      firstEventMs: 1,
    },
  ],
  finalProject: { nodes: [], edges: [] },
  finalOps: { '/pickup': { inputs: { color: '#ff0000' }, outputs: [] } },
  initialOperatorErrors: [],
  operatorErrors: [],
  registry: {},
  loadMs: 1,
  timedOut: false,
} as unknown as BenchResult

describe('parseRubric', () => {
  it('rejects a bare scale', () => {
    const bare = 'rubricVersion: 1\ndimensions:\n  vibes: { weight: 1 }'
    expect(() => parseRubric(bare, 'bare.yaml')).toThrow(/no bare scales/)
  })

  it('rejects anchors missing a level', () => {
    const partial = `rubricVersion: 1
dimensions:
  x: { style: anchors, weight: 1, levels: { 0: a, 1: b, 2: c, 3: d } }`
    expect(() => parseRubric(partial, 'p.yaml')).toThrow(/every level 0-4/)
  })

  it('parses the committed rubric', () => {
    const parsed = parseRubric(inAppRubric, 'in-app.yaml')
    const weights = parsed.dimensions.filter(d => !d.informational).map(d => d.weight)
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })
})

it('drops tagged criteria the task does not carry', () => {
  const ids = (tags: string[]) =>
    resolveApplicability(rubric, tags)
      .dimensions.find(d => d.name === 'honesty')
      ?.criteria?.map(c => c.id)
  expect(ids([])).toEqual(['claims-match'])
  expect(ids(['knowledge'])).toEqual(['claims-match', 'grounded'])
})

describe('renderTranscript', () => {
  const lines = renderTranscript(result)

  it('puts one event per line, flattening reply newlines', () => {
    expect(lines).toContain('[assistant] Done. ⏎ It is red.')
    expect(lines.some(l => l.startsWith('[tool] get_node_info({"nodeId":"/pickup"}) → ok'))).toBe(
      true
    )
    expect(lines).toContain('[harness] json_parse_fallback: truncated')
  })

  it('marks a turn that ended mid-tool-use as out of steps', () => {
    expect(lines).toContain('[harness] budget-exhausted: step limit')
  })
})

it('fills every slot of the committed prompt', () => {
  const task = parseTask(
    '---\nid: t\ntier: T2\nstart: nyc-taxis\ngrader:\n  checks: [{ type: applySucceeded }]\n---\nMake it red',
    't.md'
  )
  const grade: Grade = {
    score: 4,
    pass: true,
    mechanicalFailure: false,
    checks: [{ check: { type: 'applySucceeded' }, pass: true, mechanical: true, detail: '$& ok' }],
  }
  const prompt = buildJudgePrompt(template, { task, rubric, result, grade })
  expect(prompt).not.toMatch(/\{\{[A-Z]+\}\}/)
  expect(prompt).toContain('L1: [turn 1] [user] Make it red')
  expect(prompt).toContain('ops.json:3:')
  // A $ in content must not be read as a replacement pattern
  expect(prompt).toContain('PASS applySucceeded: $& ok')
})

describe('parseJudgeReply', () => {
  const reply = (dims: object) => `Here you go:\n${JSON.stringify({ dimensions: dims })}`
  const good = sample(3, { 'claims-match': 'pass' }).dimensions

  it('accepts a complete reply wrapped in prose', () => {
    const resolved = resolveApplicability(rubric, [])
    expect(parseJudgeReply(reply(good), resolved).dimensions.correctness.level).toBe(3)
  })

  it('requires a level and evidence on anchors', () => {
    const noLevel = { ...good, correctness: { style: 'anchors', evidence: 'x' } }
    expect(() => parseJudgeReply(reply(noLevel), rubric)).toThrow(/level must be/)
    const noEvidence = { ...good, correctness: { style: 'anchors', level: 2, evidence: ' ' } }
    expect(() => parseJudgeReply(reply(noEvidence), rubric)).toThrow(/evidence required/)
  })

  it('requires a verdict for every applicable criterion', () => {
    const resolved = resolveApplicability(rubric, ['knowledge'])
    expect(() => parseJudgeReply(reply(good), resolved)).toThrow(/honesty.grounded/)
  })
})

it('checks citations against the transcript and artifacts', () => {
  const dims = {
    a: { style: 'anchors' as const, level: 1, evidence: '"x" (L2) and (L9)' },
    b: {
      style: 'checklist' as const,
      criteria: {
        c: { verdict: 'pass' as const, evidence: 'ops.json:3 and project.json:99' },
      },
    },
  }
  const citations = checkCitations(dims, 5, { 'ops.json': 10, 'project.json': 20 })
  expect(citations.checked).toBe(4)
  expect(citations.resolved).toBe(2)
  expect(citations.unresolved).toEqual([
    'L9 (transcript has 5 lines)',
    'project.json:99 does not resolve',
  ])
})

describe('scoring', () => {
  const resolved = resolveApplicability(rubric, [])

  it('takes the median per dimension and ignores informational weight', () => {
    const score = reduceSamples(
      [
        sample(1, { 'claims-match': 'fail' }),
        sample(3, { 'claims-match': 'pass' }),
        sample(4, { 'claims-match': 'pass' }),
      ],
      resolved
    )
    expect(score.perDimension.correctness.median).toBe(3)
    expect(score.perDimension.honesty.median).toBe(4)
    expect(score.weighted).toBe(3.5)
  })

  it('scores only the criteria the rubric applies to the task', () => {
    // 'grounded' is tagged knowledge, so it does not apply here, and 'invented'
    // is not in the rubric at all
    const score = reduceSamples(
      [sample(4, { 'claims-match': 'pass', grounded: 'fail', invented: 'fail' })],
      resolved
    )
    expect(score.perDimension.honesty.median).toBe(4)
  })

  it('drops a dimension whose criteria are all na', () => {
    const score = reduceSamples([sample(2, { 'claims-match': 'na' })], resolved)
    expect(score.perDimension.honesty.median).toBeNaN()
    expect(score.weighted).toBe(2)
  })

  it('blends half and half and keeps the mechanical cap', () => {
    const grade = (mechanicalFailure: boolean): Grade => ({
      score: mechanicalFailure ? 1.6 : 4,
      pass: !mechanicalFailure,
      mechanicalFailure,
      checks: [],
    })
    expect(totalScore(grade(false), 2)).toBe(3)
    expect(totalScore(grade(true), 4)).toBe(1.6)
  })
})
