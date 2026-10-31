import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeysStore, useKeysStore } from '../keys-store'
import { KEY_RERUN_DELAY_MS, keyValues, onKeyChange } from './key-dependencies'

describe('onKeyChange', () => {
  let run: ReturnType<typeof vi.fn>
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
    run = vi.fn()
    stop = onKeyChange(run)
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('runs once typing stops', () => {
    getKeysStore().setBrowserKey('mapbox', 'pk.a')
    getKeysStore().setBrowserKey('mapbox', 'pk.ab')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS - 1)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs when a choice changes which key is used', () => {
    getKeysStore().setBrowserKey('mapbox', 'pk.mine')
    getKeysStore().setProjectKeys({ mapbox: 'pk.project' }, '/projects/a')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    run.mockClear()

    getKeysStore().setKeyOverride('mapbox', 'browser')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("doesn't run when the key in use stays the same", () => {
    getKeysStore().setProjectKeys({ mapbox: 'pk.project' }, '/projects/a')
    getKeysStore().setBrowserKey('mapbox', 'pk.mine')
    getKeysStore().setKeyOverride('mapbox', 'project')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    run.mockClear()

    getKeysStore().setBrowserKey('mapbox', 'pk.mine2')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(run).not.toHaveBeenCalled()
  })

  it("doesn't run for a project opening with its own keys", () => {
    getKeysStore().setProjectKeys({ mapbox: 'pk.project' }, '/projects/a')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    getKeysStore().setProjectKeys({ mapbox: 'pk.other' }, '/projects/b')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs when the last project key is cleared', () => {
    getKeysStore().setProjectKeys(undefined, '/projects/a')
    getKeysStore().setProjectKey('mapbox', 'pk.project')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    run.mockClear()

    getKeysStore().removeProjectKey('mapbox')
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('stops when unsubscribed', () => {
    getKeysStore().setBrowserKey('mapbox', 'pk.a')
    stop()
    vi.advanceTimersByTime(KEY_RERUN_DELAY_MS)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('keyValues', () => {
  it('reads the keys an operator would get now, in order', () => {
    useKeysStore.setState({ browserKeys: {}, keyOverrides: {}, projectKeys: undefined })
    getKeysStore().setBrowserKey('googleMaps', 'g.key')
    expect(keyValues(['googleMaps'])).toEqual(['g.key'])
  })
})
