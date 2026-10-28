import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore, useKeysStore } from '../keys-store'
import { GeocoderOp, type IOperator, NumberOp, type Operator, OverpassOp } from '../operators'
import { KEY_RERUN_DELAY_MS, rerunOnKeyChange } from './key-dependencies'

describe('rerunOnKeyChange', () => {
  let ops: Operator<IOperator>[]
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useKeysStore.setState({
      browserKeys: {},
      keyOverrides: {},
      projectKeys: undefined,
      savedProjectKeys: undefined,
      projectId: undefined,
      rejectedKeys: {},
    })
    ops = [
      new GeocoderOp('/geocoder'),
      new OverpassOp('/overpass'),
      new NumberOp('/number'),
    ] as unknown as Operator<IOperator>[]
    for (const op of ops) vi.spyOn(op, 'markDirty')
    stop = rerunOnKeyChange(() => ops)
  })

  afterEach(() => {
    stop()
    for (const op of ops) op.dispose()
    vi.useRealTimers()
  })

  const marked = () => ops.filter(op => vi.mocked(op.markDirty).mock.calls.length > 0)

  it('re-runs the operators that read a key once typing stops', () => {
    getKeysStore().setBrowserKey('mapbox', 'pk.a')
    getKeysStore().setBrowserKey('mapbox', 'pk.ab')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS - 1)
    expect(marked()).toEqual([])

    vi.advanceTimersByTime(1)
    expect(marked()).toEqual([ops[0]])
    expect(ops[0].markDirty).toHaveBeenCalledTimes(1)
  })

  it('re-runs when a choice changes which key is used', () => {
    getKeysStore().setBrowserKey('mapbox', 'pk.mine')
    getKeysStore().setProjectKeys({ mapbox: 'pk.project' }, '/projects/a')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    vi.mocked(ops[0].markDirty).mockClear()

    getKeysStore().setKeyOverride('mapbox', 'browser')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(marked()).toEqual([ops[0]])
  })

  it("leaves operators alone when the key they'd get is the same", () => {
    getKeysStore().setProjectKeys({ mapbox: 'pk.project' }, '/projects/a')
    getKeysStore().setBrowserKey('mapbox', 'pk.mine')
    getKeysStore().setKeyOverride('mapbox', 'project')
    getKeysStore().setProjectKey('mapbox', 'pk.other')
    getKeysStore().setProjectKey('mapbox', 'pk.project')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(marked()).toEqual([])
  })

  it("doesn't re-run a newly loaded project's operators", () => {
    getKeysStore().setBrowserKey('overpass', 'https://example.com/api')
    getKeysStore().setProjectKeys({ mapbox: 'pk.project' }, '/projects/a')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(marked()).toEqual([])

    getKeysStore().setProjectKeys({ mapbox: 'pk.project' }, '/projects/b')
    getKeysStore().setProjectKeys({ mapbox: 'pk.other' }, '/projects/b')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(marked()).toEqual([])
  })

  it('holds locked operators', () => {
    ops[1].locked.next(true)
    vi.mocked(ops[1].markDirty).mockClear()
    getKeysStore().setBrowserKey('overpass', 'https://example.com/api')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(marked()).toEqual([])
  })

  it('stops when unsubscribed', () => {
    getKeysStore().setBrowserKey('mapbox', 'pk.a')
    stop()
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(marked()).toEqual([])
  })
})
