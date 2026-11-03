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

// Two nodes wired layer -> renderer, the smallest graph edgesValid can reason about
function result(overrides: Partial<BenchResult> = {}): BenchResult {
  return {
    taskId: 'test',
    provider: { id: 'webllm', model: 'm', contextWindow: 4096 },
    knobs: {},
    setupApply: null,
    turns: [turn()],
    finalProject: {
      nodes: [
        { id: '/layer', type: 'ScatterplotLayerOp', position: { x: 0, y: 0 }, data: {} },
        { id: '/deck', type: 'DeckRendererOp', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: '/layer.out.layer->/deck.par.layers',
          source: '/layer',
          target: '/deck',
          sourceHandle: 'out.layer',
          targetHandle: 'par.layers',
        },
      ],
    } as unknown as BenchResult['finalProject'],
    finalOps: {
      '/layer': { inputs: { getFillColor: '#ff0000ff', getRadius: 10 }, outputs: ['layer'] },
      '/deck': { inputs: { layers: [] }, outputs: ['vis'] },
    },
    initialOperatorErrors: [],
    operatorErrors: [],
    registry: {
      ScatterplotLayerOp: { inputs: ['data', 'getFillColor', 'getRadius'], outputs: ['layer'] },
      DeckRendererOp: { inputs: ['layers', 'basemap'], outputs: ['vis'] },
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
        { type: 'nodeTypesPresent', types: ['ScatterplotLayerOp'] },
        { type: 'nodeTypesPresent', types: ['HeatmapLayerOp'] },
      ],
      { result: result() }
    )
    expect(graded.score).toBe(2)
    expect(graded.pass).toBe(false)
    expect(graded.mechanicalFailure).toBe(false)
  })

  it('caps the score at 40% when a mechanical check fails', () => {
    const broken = result({ operatorErrors: [{ id: '/layer', error: 'boom' }] })
    const graded = grade(
      [
        { type: 'nodeTypesPresent', types: ['ScatterplotLayerOp'] },
        { type: 'nodeTypesPresent', types: ['DeckRendererOp'] },
        { type: 'nodeCount', min: 2 },
        { type: 'noNewOperatorErrors' },
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
    const answered = result({ turns: [turn({ reply: 'Use {{/threshold.par.value}} in SQL' })] })

    it('needs every pattern by default', () => {
      expect(check({ type: 'answerMatches', patterns: ['threshold', 'par'] }, answered).pass).toBe(
        true
      )
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
    it('passes a graph whose handles all exist', () => {
      expect(check({ type: 'edgesValid' }).pass).toBe(true)
    })

    it('fails an edge into a handle the operator does not have', () => {
      const r = result()
      r.finalProject?.edges?.push({
        id: 'bad',
        source: '/layer',
        target: '/deck',
        sourceHandle: 'out.layer',
        targetHandle: 'par.color',
      } as never)
      const outcome = check({ type: 'edgesValid' }, r)
      expect(outcome.pass).toBe(false)
      expect(outcome.detail).toContain('DeckRendererOp has no input color')
    })

    it('fails a nested handle, which the graph looks up whole and never connects', () => {
      const r = result()
      r.finalProject?.edges?.push({
        id: 'nested',
        source: '/layer',
        target: '/deck',
        sourceHandle: 'out.layer',
        targetHandle: 'par.basemap.zoom',
      } as never)
      const outcome = check({ type: 'edgesValid' }, r)
      expect(outcome.pass).toBe(false)
      expect(outcome.detail).toContain('DeckRendererOp has no input basemap.zoom')
    })

    it('fails an edge to a node that does not exist', () => {
      const r = result()
      r.finalProject?.edges?.push({
        id: 'dangling',
        source: '/gone',
        target: '/deck',
        sourceHandle: 'out.layer',
        targetHandle: 'par.layers',
      } as never)
      expect(check({ type: 'edgesValid' }, r).detail).toContain('no node /gone')
    })

    it('accepts handles only the live operator has', () => {
      const r = result()
      r.finalOps['/deck'].inputs.custom = 1
      r.finalProject?.edges?.push({
        id: 'dynamic',
        source: '/layer',
        target: '/deck',
        sourceHandle: 'out.layer',
        targetHandle: 'par.custom',
      } as never)
      expect(check({ type: 'edgesValid' }, r).pass).toBe(true)
    })
  })

  it('finds edges by node type', () => {
    const c: Check = {
      type: 'edgeExists',
      sourceType: 'ScatterplotLayerOp',
      target: '/deck',
      targetHandle: 'par.layers',
    }
    expect(check(c).pass).toBe(true)
    expect(check({ ...c, targetHandle: 'par.basemap' }).pass).toBe(false)
  })

  describe('inputEquals', () => {
    it('compares colors across notations within tolerance', () => {
      const c: Check = {
        type: 'inputEquals',
        node: '/layer',
        input: 'getFillColor',
        value: '#f00',
      }
      expect(check(c).pass).toBe(true)
      expect(check({ ...c, value: [230, 20, 10], tolerance: 30 }).pass).toBe(true)
      expect(check({ ...c, value: '#00ff00', tolerance: 30 }).pass).toBe(false)
    })

    it('matches any node of a type', () => {
      const c: Check = {
        type: 'inputEquals',
        nodeType: 'ScatterplotLayerOp',
        input: 'getRadius',
        value: 10,
      }
      expect(check(c).pass).toBe(true)
    })

    it('fails when the node is gone', () => {
      const c: Check = { type: 'inputEquals', node: '/missing', input: 'x', value: 1 }
      expect(check(c).detail).toBe('no matching node')
    })
  })

  it('matches string inputs by pattern', () => {
    const r = result()
    r.finalOps['/layer'].inputs.expression = '[d.Longitude, d.Latitude]'
    const c: Check = {
      type: 'inputMatches',
      node: '/layer',
      input: 'expression',
      pattern: 'Longitude[\\s\\S]*Latitude',
    }
    expect(check(c, r).pass).toBe(true)
  })

  describe('operator errors', () => {
    it('ignores errors that were already there', () => {
      const r = result({
        initialOperatorErrors: [{ id: '/layer', error: 'offline' }],
        operatorErrors: [{ id: '/layer', error: 'offline' }],
      })
      expect(check({ type: 'noNewOperatorErrors' }, r).pass).toBe(true)
      expect(check({ type: 'operatorErrorsFixed' }, r).pass).toBe(false)
    })
  })

  it('requires something to have been applied', () => {
    expect(check({ type: 'applySucceeded' }).pass).toBe(false)
    const applied = result({ turns: [turn({ apply: { success: true } })] })
    expect(check({ type: 'applySucceeded' }, applied).pass).toBe(true)
    const failed = result({ turns: [turn({ apply: { success: false, error: 'bad edge' } })] })
    expect(check({ type: 'applySucceeded' }, failed).detail).toBe('bad edge')
  })

  it('passes anyOf when one branch passes', () => {
    const c: Check = {
      type: 'anyOf',
      checks: [
        { type: 'nodeTypesPresent', types: ['HeatmapLayerOp'] },
        { type: 'nodeTypesPresent', types: ['ScatterplotLayerOp'] },
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
