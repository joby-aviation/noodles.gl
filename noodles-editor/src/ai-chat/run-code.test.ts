import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberOp } from '../noodles/operators'
import { clearOps, setOp } from '../noodles/store'
import { registerPropertyMutationCallback } from '../noodles/utils/property-history'
import { capToolResult } from './agent/result-budget'
import { runCode } from './run-code'
import { getToolDefinition } from './tool-definitions'

// `data` on a successful ToolResult, narrowed for readability
function data(result: { data?: unknown }): Record<string, unknown> {
  return (result.data ?? {}) as Record<string, unknown>
}

// Constructing an operator does not put it in the store, and op() resolves through
// the store — so every test that calls op() has to register its operator
function makeNumberOp(id: string, value?: number): NumberOp {
  const op = new NumberOp(id)
  if (value !== undefined) op.inputs.val.setValue(value)
  setOp(id, op)
  return op
}

describe('runCode', () => {
  beforeEach(() => {
    clearOps()
  })

  it('returns the value the code returns', async () => {
    const result = await runCode({ code: 'return 6 * 7' })

    expect(result.success).toBe(true)
    expect(data(result).result).toBe(42)
  })

  it('runs a function body, not an expression', async () => {
    const result = await runCode({
      code: 'const xs = [1, 2, 3]\nlet total = 0\nfor (const x of xs) total += x\nreturn total',
    })

    expect(data(result).result).toBe(6)
  })

  it('reads operator outputs through op()', async () => {
    makeNumberOp('/num', 11)

    const result = await runCode({ code: "return op('/num').par.val * 2" })

    expect(result.success).toBe(true)
    expect(data(result).result).toBe(22)
  })

  it('names the operator when the path does not resolve', async () => {
    const result = await runCode({ code: "return op('/nope').par.val" })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/'\/nope' not found/)
  })

  it('exposes the CodeOp libraries', async () => {
    const result = await runCode({ code: 'return typeof d3.sum + " " + typeof turf.distance' })

    expect(data(result).result).toBe('function function')
  })

  it('surfaces a thrown error as a tool error rather than throwing', async () => {
    const result = await runCode({ code: 'throw new Error("no good")' })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no good/)
  })

  it('reports a syntax error without evaluating anything', async () => {
    const result = await runCode({ code: 'return (' })

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('rejects empty code', async () => {
    await expect(runCode({ code: '   ' })).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/non-empty/),
    })
  })

  it('awaits a returned promise', async () => {
    const result = await runCode({
      code: 'const v = await Promise.resolve(5)\nreturn v + 1',
    })

    expect(data(result).result).toBe(6)
  })

  it('gives up on a promise that never settles', async () => {
    const pending = runCode({ code: 'await new Promise(() => {})', timeoutMs: 20 })
    // setupTests installs fake timers, so the timeout has to be advanced by hand
    await vi.advanceTimersByTimeAsync(20)
    const result = await pending

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/timed out after 20ms/)
  })

  it('captures console output alongside the value', async () => {
    const result = await runCode({
      code: 'console.log("counting", 3)\nconsole.warn("careful")\nreturn "done"',
    })

    expect(data(result).result).toBe('done')
    expect(data(result).logs).toEqual(['counting 3', '[warn] careful'])
  })

  it('restores console after the run, including when the code throws', async () => {
    const before = console.log

    await runCode({ code: 'console.log("hi")\nthrow new Error("boom")' })

    expect(console.log).toBe(before)
  })

  it('keeps logs written before a throw', async () => {
    const result = await runCode({ code: 'console.log("got here")\nthrow new Error("boom")' })

    expect(result.success).toBe(false)
    expect(data(result).logs).toEqual(['got here'])
  })

  it('sends no logs key when nothing was logged', async () => {
    const result = await runCode({ code: 'return 1' })

    // undefined rather than absent; JSON.stringify drops it, so it costs no context
    expect(data(result).logs).toBeUndefined()
  })
})

// A tool that can return anything at all is the one most likely to blow the budget,
// so the summary happens here rather than being left to result-budget's ladder.
describe('runCode result summaries', () => {
  beforeEach(() => {
    clearOps()
  })

  it('returns a short array as itself', async () => {
    const result = await runCode({ code: 'return [1, 2, 3]' })

    expect(data(result).result).toEqual([1, 2, 3])
  })

  it('samples a long array and reports its true length', async () => {
    const result = await runCode({ code: 'return Array.from({length: 5000}, (_, i) => i)' })

    const summary = data(result).result as { length: number; sample: number[]; note: string }
    expect(summary.length).toBe(5000)
    expect(summary.sample).toHaveLength(20)
    expect(summary.sample[0]).toBe(0)
    expect(summary.note).toMatch(/first 20 of 5000/)
  })

  it('never serializes the whole of a huge array', async () => {
    // 200k rows of an object each: serialized in full this is tens of megabytes, and
    // capToolResult would have to build that string before deciding to drop it
    const result = await runCode({
      code: 'return Array.from({length: 200000}, (_, i) => ({i, label: "row " + i}))',
    })

    const capped = capToolResult('run_code', result, 24_000)
    expect(capped.truncated).toBe(false)
    expect(capped.chars).toBeLessThan(2000)
  })

  it('shows NaN and Infinity instead of letting JSON turn them into null', async () => {
    const result = await runCode({ code: 'return {bad: 0/0, big: 1/0}' })

    expect(data(result).result).toEqual({ bad: '[NaN]', big: '[Infinity]' })
  })

  it('marks undefined so a bare return is distinguishable from null', async () => {
    expect(data(await runCode({ code: 'return' })).result).toBe('[undefined]')
    expect(data(await runCode({ code: 'return null' })).result).toBe(null)
  })

  it('describes a function rather than dropping it', async () => {
    const result = await runCode({ code: 'return function scale(d) { return d * 2 }' })

    expect(data(result).result).toBe('[Function: scale]')
  })

  it('cuts a cycle but keeps repeated siblings', async () => {
    const result = await runCode({
      code: 'const shared = {n: 1}\nconst root = {a: shared, b: shared}\nroot.self = root\nreturn root',
    })

    expect(data(result).result).toEqual({
      a: { n: 1 },
      b: { n: 1 },
      self: '[circular]',
    })
  })

  it('summarizes a typed array by length and sample', async () => {
    const result = await runCode({ code: 'return new Float32Array(1000).fill(2)' })

    const summary = data(result).result as { type: string; length: number; sample: number[] }
    expect(summary.type).toBe('Float32Array')
    expect(summary.length).toBe(1000)
    expect(summary.sample).toHaveLength(20)
  })

  it('reduces an operator to its path', async () => {
    makeNumberOp('/num')

    const result = await runCode({ code: "return op('/num')" })

    expect(data(result).result).toBe('[Operator /num]')
  })

  it('clips a long string and says how long it was', async () => {
    const result = await runCode({ code: 'return "x".repeat(9000)' })

    expect(data(result).result).toMatch(/^x{2000}…\[clipped, 9000 chars\]$/)
  })

  it('stops descending at a depth limit', async () => {
    const result = await runCode({
      code: 'let node = {leaf: true}\nfor (let i = 0; i < 12; i++) node = {child: node}\nreturn node',
    })

    expect(JSON.stringify(data(result).result)).toContain('nested too deep')
  })
})

describe('runCode and the undo history', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    registerPropertyMutationCallback(undefined)
  })

  it('reports nothing changed for a pure computation', async () => {
    registerPropertyMutationCallback(vi.fn())
    makeNumberOp('/num', 3)

    const result = await runCode({ code: "return op('/num').par.val" })

    expect(data(result).changedFieldValues).toBeUndefined()
  })

  it('records one undo entry when the code changes a field value', async () => {
    const record = vi.fn()
    registerPropertyMutationCallback(record)

    const op = makeNumberOp('/num', 1)

    const result = await runCode({ code: "op('/num').inputs.val.setValue(99)\nreturn 'set'" })

    expect(op.inputs.val.value).toBe(99)
    expect(data(result).changedFieldValues).toBe(true)
    expect(record).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0][0]).toBe('Run code')
  })
})

describe('the run_code tool definition', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is registered and marked as mutating', () => {
    const definition = getToolDefinition('run_code')

    expect(definition?.annotations.readOnlyHint).toBe(false)
    // The loop serializes a batch as soon as one call in it can mutate
    expect(definition?.annotations.destructiveHint).toBe(true)
  })

  it('is findable by the queries someone would actually type', async () => {
    const { scoreTools } = await import('./agent/tool-router')

    for (const query of ['run javascript', 'evaluate code', 'compute a statistic']) {
      expect(scoreTools(query).map(m => m.name)).toContain('run_code')
    }
  })
})
