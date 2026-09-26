import { describe, expect, it } from 'vitest'
import { AGENT_EVAL_CASES } from './cases'

describe('AGENT_EVAL_CASES', () => {
  it('commits 200 cases split evenly across the four release categories', () => {
    expect(AGENT_EVAL_CASES).toHaveLength(200)
    for (const category of ['documentation', 'dataset', 'graph', 'safety']) {
      expect(AGENT_EVAL_CASES.filter(testCase => testCase.category === category)).toHaveLength(50)
    }
    expect(new Set(AGENT_EVAL_CASES.map(testCase => testCase.id)).size).toBe(200)
  })
})
