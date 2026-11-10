// An operator's run state lives in three channels: pullExecutionStatus (cache
// validity), the public dirty flag (GraphExecutor scheduling) and
// executionState (what the UI shows about the last run). These tests pin how
// the three line up after each path through pull().

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberField } from './fields'
import { Operator, PullExecutionStatus } from './operators'
import type { ExtractProps } from './utils/extract-props'

class StateOp extends Operator<StateOp> {
  static displayName = 'State'
  fail = false
  gate: Promise<void> | null = null

  createInputs() {
    return { value: new NumberField(1) }
  }

  createOutputs() {
    return { result: new NumberField() }
  }

  async execute({ value }: ExtractProps<typeof this.inputs>) {
    if (this.gate) await this.gate
    if (this.fail) throw new Error('boom')
    return { result: value * 2 }
  }
}

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

// Let pull() get past the upstream pulls and the input snapshot, so a mark
// from here on lands mid-execute rather than being absorbed by the snapshot
// (setupTests fakes timers, so flush microtasks instead of waiting on setTimeout)
const afterSnapshot = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function channels(op: Operator<StateOp>) {
  return {
    status: op.pullExecutionStatus,
    dirty: op.dirty,
    executionState: op.executionState.value.status,
  }
}

describe('Operator run-state channels', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('agree after a successful run', async () => {
    const op = new StateOp('/op')
    await op.pull()
    expect(channels(op)).toEqual({
      status: PullExecutionStatus.CLEAN,
      dirty: false,
      executionState: 'success',
    })
  })

  it('clear dirty when a run fails, so the executor does not retry it', async () => {
    const op = new StateOp('/op')
    op.fail = true
    await expect(op.pull()).rejects.toThrow('boom')
    expect(channels(op)).toEqual({
      status: PullExecutionStatus.ERROR,
      dirty: false,
      executionState: 'error',
    })
  })

  it('let ERROR win over a mark that arrived mid-run, on every channel', async () => {
    const op = new StateOp('/op')
    const gate = deferred()
    op.gate = gate.promise
    op.fail = true
    const pull = op.pull()
    await afterSnapshot()
    op.markDirty()
    gate.resolve()
    await expect(pull).rejects.toThrow('boom')
    expect(channels(op)).toEqual({
      status: PullExecutionStatus.ERROR,
      dirty: false,
      executionState: 'error',
    })
  })

  it('stay dirty after a run that was marked mid-flight; executionState reports that run', async () => {
    const op = new StateOp('/op')
    const gate = deferred()
    op.gate = gate.promise
    const pull = op.pull()
    await afterSnapshot()
    op.markDirty()
    gate.resolve()
    await pull
    expect(channels(op)).toEqual({
      status: PullExecutionStatus.DIRTY,
      dirty: true,
      executionState: 'success',
    })

    op.gate = null
    await op.pull()
    expect(channels(op)).toEqual({
      status: PullExecutionStatus.CLEAN,
      dirty: false,
      executionState: 'success',
    })
  })

  it('go back to dirty when a failed operator is marked, keeping the last error on screen', async () => {
    const op = new StateOp('/op')
    op.fail = true
    await expect(op.pull()).rejects.toThrow('boom')
    op.markDirty()
    expect(channels(op)).toEqual({
      status: PullExecutionStatus.DIRTY,
      dirty: true,
      executionState: 'error',
    })

    op.fail = false
    await op.pull()
    expect(channels(op)).toEqual({
      status: PullExecutionStatus.CLEAN,
      dirty: false,
      executionState: 'success',
    })
  })

  it('serve a locked operator clean without touching executionState', async () => {
    const op = new StateOp('/op', undefined, true)
    op.setOutputValues({ result: 42 })
    await expect(op.pull()).resolves.toEqual({ result: 42 })
    expect(channels(op)).toEqual({
      status: PullExecutionStatus.CLEAN,
      dirty: false,
      executionState: 'idle',
    })
  })

  it('agree after setCachedOutput and clearCache', () => {
    const op = new StateOp('/op')
    op.setCachedOutput({ result: 3 })
    expect(channels(op)).toMatchObject({ status: PullExecutionStatus.CLEAN, dirty: false })
    op.clearCache()
    expect(channels(op)).toMatchObject({ status: PullExecutionStatus.DIRTY, dirty: true })
  })
})
