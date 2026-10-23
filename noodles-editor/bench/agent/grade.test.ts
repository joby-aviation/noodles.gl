/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'
import type { BenchResult, BenchTurn } from '../../src/ai-chat/bench/bench-hook'
import { type Check, grade, toColor } from './grade'
import { parseTask } from './tasks'

function turn(overrides: Partial<BenchTurn> = {}): BenchTurn {
  return {
    prompt: 'do it',
    reply: '',
    steps: 1,
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    diagnostics: [],
    stopReasons: ['end_turn'],
    modificationsCount: 0,
    apply: null,
    ms: 1,
    firstEventMs: 1,
    ...overrides,
  }
}

// Two nodes wired layer -> deck, the smallest document edgesValid can reason about
function result(overrides: Partial<BenchResult> = {}): BenchResult {
  return {
    taskId: 'test',
    provider: { id: 'webllm', model: 'm', contextWindow: 4096 },
    knobs: {},
    setupApply: null,
    turns: [turn()],
    initialDoc: null,
    finalDoc: {
      version: 1,
      name: 'test',
      nodes: [
        { id: 'n1', op: 'scatter', name: 'layer', x: 0, y: 0, params: {} },
        { id: 'n2', op: 'deck', name: 'deck', x: 0, y: 0, params: {} },
      ],
      edges: [{ id: 'e1', source: 'n1', sourcePort: 'out', target: 'n2', targetPort: 'layers' }],
    },
    finalParams: {
      n1: { fillColor: '#ff0000ff', radiusScale: 10 },
      n2: { mapStyle: '' },
    },
    initialErrors: [],
    errors: [],
    registry: {
      scatter: {
        inputs: ['in', 'par:opacity'],
        outputs: ['out'],
        params: ['fillColor', 'radiusScale', 'opacity'],
      },
      deck: { inputs: ['layers', 'par:mapStyle'], outputs: ['vis'], params: ['mapStyle'] },
    },
    loadMs: 1,
    timedOut: false,
    ...overrides,
  }
}

const check = (c: Check, r = result(), consoleErrors: string[] = []) =>
  grade([c], { result: r, consoleErrors }).checks[0]

describe('grade', () => {
  it('scores the fraction of checks passed on a 0-4 scale', () => {
    const graded = grade(
      [
        { type: 'opsPresent', ops: ['scatter'] },
        { type: 'opsPresent', ops: ['heatmap'] },
      ],
      { result: result() }
    )
    expect(graded.score).toBe(2)
    expect(graded.pass).toBe(false)
    expect(graded.mechanicalFailure).toBe(false)
  })

  it('caps the score at 40% when a mechanical check fails', () => {
    const broken = result({ errors: [{ id: 'n1', error: 'boom' }] })
    const graded = grade(
      [
        { type: 'opsPresent', ops: ['scatter'] },
        { type: 'opsPresent', ops: ['deck'] },
        { type: 'nodeCount', min: 2 },
        { type: 'noNewErrors' },
      ],
      { result: broken }
    )
    // 3 of 4 would be 3.0 uncapped
    expect(graded.score).toBe(1.6)
    expect(graded.mechanicalFailure).toBe(true)
  })

  it('scores zero when no turn completed', () => {
    const graded = grade([{ type: 'nodeCount', min: 0 }], {
      result: result({ turns: [], error: 'model failed to load' }),
    })
    expect(graded.score).toBe(0)
    expect(graded.checks[0].detail).toBe('model failed to load')
  })

  it('fails a run that timed out, whatever its partial answer matched', () => {
    const graded = grade([{ type: 'nodeCount', min: 0 }], {
      result: result({ timedOut: true }),
    })
    expect(graded.pass).toBe(false)
    expect(graded.checks[0].detail).toBe('timed out before the last turn finished')
  })

  it('fails a run whose later turn errored', () => {
    const graded = grade([{ type: 'nodeCount', min: 0 }], {
      result: result({ error: 'the graph was still computing 15s after the last turn' }),
    })
    expect(graded.pass).toBe(false)
    expect(graded.score).toBe(0)
  })

  describe('answerMatches', () => {
    const answered = result({ turns: [turn({ reply: "Use ch('threshold/value') in SQL" })] })

    it('needs every pattern by default', () => {
      expect(
        check({ type: 'answerMatches', patterns: ['threshold', 'value'] }, answered).pass
      ).toBe(true)
      expect(check({ type: 'answerMatches', patterns: ['threshold', 'nope'] }, answered).pass).toBe(
        false
      )
    })

    it('needs one pattern with any', () => {
      const c: Check = { type: 'answerMatches', patterns: ['nope', 'THRESHOLD'], any: true }
      expect(check(c, answered).pass).toBe(true)
    })
  })

  describe('edgesValid', () => {
    const withEdge = (edge: Record<string, string>) => {
      const r = result()
      r.finalDoc?.edges.push({ id: 'e2', ...edge } as never)
      return check({ type: 'edgesValid' }, r)
    }

    it('passes a document whose ports all exist', () => {
      expect(check({ type: 'edgesValid' }).pass).toBe(true)
    })

    it("accepts a wire into a parameter's port", () => {
      const edge = { source: 'n1', sourcePort: 'out', target: 'n2', targetPort: 'par:mapStyle' }
      expect(withEdge(edge).pass).toBe(true)
    })

    it('fails an edge into a port the operator does not have', () => {
      const outcome = withEdge({
        source: 'n1',
        sourcePort: 'out',
        target: 'n2',
        targetPort: 'color',
      })
      expect(outcome.pass).toBe(false)
      expect(outcome.detail).toContain('deck has no input color')
    })

    it('fails an edge from a port the operator does not have', () => {
      const outcome = withEdge({
        source: 'n1',
        sourcePort: 'layer',
        target: 'n2',
        targetPort: 'layers',
      })
      expect(outcome.detail).toContain('scatter has no output layer')
    })

    it('fails an edge to a node that does not exist', () => {
      const edge = { source: 'gone', sourcePort: 'out', target: 'n2', targetPort: 'layers' }
      expect(withEdge(edge).detail).toContain('no node gone')
    })

    it("leaves a subnet's ports to its input and output nodes", () => {
      const r = result()
      r.finalDoc?.nodes.push({ id: 's', op: 'subnet', x: 0, y: 0, params: {} })
      r.finalDoc?.edges.push({
        id: 'e2',
        source: 'n1',
        sourcePort: 'out',
        target: 's',
        targetPort: 'rows',
      })
      expect(check({ type: 'edgesValid' }, r).pass).toBe(true)
    })
  })

  describe('edgeExists', () => {
    it('finds edges by operator and by path', () => {
      const c: Check = {
        type: 'edgeExists',
        sourceOp: 'scatter',
        target: '/deck',
        targetPort: 'layers',
      }
      expect(check(c).pass).toBe(true)
      expect(check({ ...c, targetPort: 'par:mapStyle' }).pass).toBe(false)
      expect(check({ ...c, target: '/elsewhere' }).pass).toBe(false)
    })

    it('matches any port when none is named', () => {
      expect(check({ type: 'edgeExists', source: 'n1', targetOp: 'deck' }).pass).toBe(true)
    })
  })

  describe('paramEquals', () => {
    it('compares colors across notations within tolerance', () => {
      const c: Check = { type: 'paramEquals', node: '/layer', param: 'fillColor', value: '#f00' }
      expect(check(c).pass).toBe(true)
      expect(check({ ...c, value: [230, 20, 10], tolerance: 30 }).pass).toBe(true)
      expect(check({ ...c, value: '#00ff00', tolerance: 30 }).pass).toBe(false)
    })

    it('finds a node by id, by path, or any node of an operator', () => {
      const c: Check = { type: 'paramEquals', node: 'n1', param: 'radiusScale', value: 10 }
      expect(check(c).pass).toBe(true)
      expect(check({ ...c, node: '/layer' }).pass).toBe(true)
      const byOp: Check = { type: 'paramEquals', op: 'scatter', param: 'radiusScale', value: 10 }
      expect(check(byOp).pass).toBe(true)
    })

    it('fails when the node is gone', () => {
      const c: Check = { type: 'paramEquals', node: '/missing', param: 'x', value: 1 }
      expect(check(c).detail).toBe('no matching node')
    })
  })

  it('matches string parameters by pattern', () => {
    const r = result()
    r.finalParams.n1.expression = '[Longitude, Latitude]'
    const c: Check = {
      type: 'paramMatches',
      node: '/layer',
      param: 'expression',
      pattern: 'Longitude[\\s\\S]*Latitude',
    }
    expect(check(c, r).pass).toBe(true)
  })

  describe('node errors', () => {
    it('ignores errors that were already there', () => {
      const r = result({
        initialErrors: [{ id: 'n1', error: 'offline' }],
        errors: [{ id: 'n1', error: 'offline' }],
      })
      expect(check({ type: 'noNewErrors' }, r).pass).toBe(true)
      expect(check({ type: 'errorsFixed' }, r).pass).toBe(false)
    })
  })

  describe('applySucceeded', () => {
    const edit = (success: boolean) => ({
      name: 'apply_modifications',
      params: {},
      success,
      preview: '',
    })

    it('requires something to have been applied', () => {
      expect(check({ type: 'applySucceeded' }).pass).toBe(false)
      const viaTool = result({ turns: [turn({ toolCalls: [edit(true)] })] })
      expect(check({ type: 'applySucceeded' }, viaTool).pass).toBe(true)
      const viaJson = result({ turns: [turn({ apply: { success: true } })] })
      expect(check({ type: 'applySucceeded' }, viaJson).pass).toBe(true)
    })

    it('forgives an edit the model fixed, not JSON the editor rejected after the run', () => {
      const retried = result({ turns: [turn({ toolCalls: [edit(false), edit(true)] })] })
      expect(check({ type: 'applySucceeded' }, retried).pass).toBe(true)
      const rejected = result({
        turns: [turn({ toolCalls: [edit(true)], apply: { success: false, error: 'bad edge' } })],
      })
      expect(check({ type: 'applySucceeded' }, rejected).detail).toBe('bad edge')
    })
  })

  it('passes anyOf when one branch passes', () => {
    const c: Check = {
      type: 'anyOf',
      checks: [
        { type: 'opsPresent', ops: ['heatmap'] },
        { type: 'opsPresent', ops: ['scatter'] },
      ],
    }
    expect(check(c).pass).toBe(true)
  })

  it('reports console errors the runner collected', () => {
    expect(check({ type: 'noConsoleErrors' }, result(), ['TypeError: x']).pass).toBe(false)
  })
})

describe('toColor', () => {
  it('reads short, long and alpha hex and arrays', () => {
    expect(toColor('#f00')).toEqual([255, 0, 0, 255])
    expect(toColor('#FF000080')).toEqual([255, 0, 0, 128])
    expect(toColor([1, 2, 3])).toEqual([1, 2, 3, 255])
    expect(toColor('red')).toBeNull()
  })
})

// Every committed task has to parse, and its checks have to be ones grade() knows
const taskFiles = import.meta.glob('./tasks/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('task files', () => {
  it('has three tasks per tier', () => {
    const tiers = Object.entries(taskFiles).map(
      ([path, text]) => parseTask(text as string, path).tier
    )
    for (const tier of ['T1', 'T2', 'T3', 'T4']) {
      expect(
        tiers.filter(t => t === tier),
        tier
      ).toHaveLength(3)
    }
  })

  it.each(Object.entries(taskFiles))('%s parses and grades', (path, text) => {
    const task = parseTask(text as string, path)
    expect(task.id).toBe(path.replace('./tasks/', '').replace('.md', ''))
    // Grading an empty run exercises every check type without throwing
    expect(() => grade(task.grader.checks, { result: result() })).not.toThrow()
  })

  it('rejects a task without checks', () => {
    expect(() => parseTask('---\nid: x\ntier: T1\nstart: blank\n---\nhi', 'x.md')).toThrow(
      /grader.checks/
    )
  })
})
