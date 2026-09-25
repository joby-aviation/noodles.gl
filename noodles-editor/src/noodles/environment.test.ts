import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { calculateRenderSurfaceSize } from '../render/render-surface'
import { useTimelineStore } from '../timeline/timeline-store'
import {
  createEnvironmentView,
  publishEnvironment,
  readEnvironment,
  resetEnvironment,
  subscribeToEnvironment,
} from './environment'
import {
  BoundingBoxOp,
  CodeOp,
  type IOperator,
  MouseOp,
  NumberOp,
  type Operator,
  TimeOp,
} from './operators'
import { DEFAULT_RENDER_SETTINGS } from './utils/render-settings-constants'

const createdOps: Pick<Operator<IOperator>, 'dispose'>[] = []
function track<T extends Pick<Operator<IOperator>, 'dispose'>>(op: T): T {
  createdOps.push(op)
  return op
}

beforeEach(() => {
  resetEnvironment()
  const store = useTimelineStore.getState()
  store.setPosition(0)
  store.setLength(10)
  store.setFps(30)
})

afterEach(() => {
  for (const op of createdOps) op.dispose()
  createdOps.length = 0
})

describe('timeline environment', () => {
  it('derives frame values from the timeline store', () => {
    const store = useTimelineStore.getState()
    store.setPosition(5)
    store.setLength(20)
    store.setFps(60)

    expect(readEnvironment('timeline')).toEqual({
      sequenceTime: 5,
      frame: 300,
      totalFrames: 1200,
      sequence: { length: 20, fps: 60 },
    })
  })

  it('floors fractional frames', () => {
    const store = useTimelineStore.getState()
    store.setPosition(1.234)
    store.setLength(15.5)
    store.setFps(30)

    const timeline = readEnvironment('timeline')
    expect(timeline.sequenceTime).toBe(1.234)
    expect(timeline.frame).toBe(37)
    expect(timeline.totalFrames).toBe(465)
  })

  it.each([
    ['position', () => useTimelineStore.getState().setPosition(5)],
    ['fps', () => useTimelineStore.getState().setFps(60)],
    ['length', () => useTimelineStore.getState().setLength(20)],
  ])('notifies on %s changes', (_, change) => {
    const listener = vi.fn()
    const unsubscribe = subscribeToEnvironment(['timeline'], listener)
    change()
    expect(listener).toHaveBeenCalledWith('timeline')
    unsubscribe()
  })

  it('ignores timeline store changes that do not affect the environment', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToEnvironment(['timeline'], listener)
    useTimelineStore.getState().setPlaybackSpeed(2)
    useTimelineStore.getState().setSelectedKeyframes(['k1'])
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})

describe('published environment', () => {
  it('defaults the render surface to the fixed render resolution including LOD', () => {
    expect(readEnvironment('renderSurface')).toEqual(
      calculateRenderSurfaceSize(DEFAULT_RENDER_SETTINGS.resolution, DEFAULT_RENDER_SETTINGS.lod)
    )
  })

  it('notifies on changes only, ignoring identical and invalid values', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToEnvironment(['renderSurface'], listener)

    publishEnvironment('renderSurface', { ...readEnvironment('renderSurface') })
    publishEnvironment('renderSurface', { width: Number.NaN, height: 500 })
    publishEnvironment('renderSurface', { width: 1000, height: 0 })
    publishEnvironment('pointer', { x: Number.POSITIVE_INFINITY, y: 0 })
    expect(listener).not.toHaveBeenCalled()

    publishEnvironment('renderSurface', { width: 1920, height: 1080 })
    expect(listener).toHaveBeenCalledExactlyOnceWith('renderSurface')
    expect(readEnvironment('renderSurface')).toEqual({ width: 1920, height: 1080 })
    unsubscribe()
  })

  it('only notifies listeners of the key that changed', () => {
    const clockListener = vi.fn()
    const pointerListener = vi.fn()
    const unsubscribeClock = subscribeToEnvironment(['clock'], clockListener)
    const unsubscribePointer = subscribeToEnvironment(['pointer'], pointerListener)

    publishEnvironment('pointer', { x: 10, y: 20 })
    expect(pointerListener).toHaveBeenCalledOnce()
    expect(clockListener).not.toHaveBeenCalled()

    unsubscribeClock()
    unsubscribePointer()
  })

  it('stores a copy so later mutation of the published object has no effect', () => {
    const point = { x: 1, y: 2 }
    publishEnvironment('pointer', point)
    point.x = 99
    expect(readEnvironment('pointer')).toEqual({ x: 1, y: 2 })
  })

  it('resets published values to their defaults', () => {
    publishEnvironment('pointer', { x: 10, y: 20 })
    resetEnvironment()
    expect(readEnvironment('pointer')).toEqual({ x: 0, y: 0 })
  })
})

describe('subscribeToEnvironment', () => {
  it('tears down the shared timeline watcher when the last listener leaves', () => {
    const unwatch = vi.fn()
    const original = useTimelineStore.subscribe
    const subscribe = vi.spyOn(useTimelineStore, 'subscribe').mockImplementation(((
      ...args: Parameters<typeof original>
    ) => {
      const unsubscribe = original(...args)
      return () => {
        unwatch()
        unsubscribe()
      }
    }) as typeof original)

    const first = subscribeToEnvironment(['timeline'], vi.fn())
    const second = subscribeToEnvironment(['timeline'], vi.fn())
    expect(subscribe).toHaveBeenCalledOnce()

    first()
    expect(unwatch).not.toHaveBeenCalled()
    second()
    expect(unwatch).toHaveBeenCalledOnce()

    // A subscription after teardown starts a new watcher
    subscribeToEnvironment(['timeline'], vi.fn())()
    expect(subscribe).toHaveBeenCalledTimes(2)
    subscribe.mockRestore()
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToEnvironment(['timeline', 'pointer'], listener)
    unsubscribe()
    useTimelineStore.getState().setPosition(3)
    publishEnvironment('pointer', { x: 1, y: 1 })
    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies once per change for duplicate keys', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToEnvironment(['pointer', 'pointer'], listener)
    publishEnvironment('pointer', { x: 1, y: 1 })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })
})

describe('createEnvironmentView', () => {
  it('reads declared keys live', () => {
    const env = createEnvironmentView(['pointer'], 'TestOp')
    publishEnvironment('pointer', { x: 1, y: 2 })
    expect(env.pointer).toEqual({ x: 1, y: 2 })
    publishEnvironment('pointer', { x: 3, y: 4 })
    expect(env.pointer).toEqual({ x: 3, y: 4 })
  })

  it('throws when reading an undeclared key', () => {
    const env = createEnvironmentView(['pointer'], 'TestOp')
    expect(() => env.timeline).toThrow(
      "TestOp reads environment 'timeline' without declaring it in static environment"
    )
  })

  it('enumerates only declared keys', () => {
    const env = createEnvironmentView(['clock', 'timeline'], 'TestOp')
    expect(Object.keys(env).sort()).toEqual(['clock', 'timeline'])
  })
})

describe('Operator environment wiring', () => {
  it('marks operators dirty when a declared key changes', async () => {
    const op = track(new CodeOp('/code', { code: 'return sequenceTime' }))
    await op.pull()
    expect(op.dirty).toBe(false)

    const markDirty = vi.spyOn(op, 'markDirty')
    useTimelineStore.getState().setPosition(5)
    expect(markDirty).toHaveBeenCalledWith('environment: timeline')
    expect(op.dirty).toBe(true)
  })

  it('does not dirty operators for undeclared keys', async () => {
    const op = track(new BoundingBoxOp('/bbox'))
    await op.pull()
    useTimelineStore.getState().setPosition(5)
    publishEnvironment('pointer', { x: 1, y: 1 })
    expect(op.dirty).toBe(false)
  })

  it('marks multiple operators dirty independently', () => {
    const op1 = track(new CodeOp('/op1', { code: 'return sequenceTime' }))
    const op2 = track(new CodeOp('/op2', { code: 'return sequence.length' }))
    const spy1 = vi.spyOn(op1, 'markDirty')
    const spy2 = vi.spyOn(op2, 'markDirty')
    useTimelineStore.getState().setPosition(3)
    expect(spy1).toHaveBeenCalled()
    expect(spy2).toHaveBeenCalled()
  })

  it('unsubscribes when disposed', () => {
    const op = new CodeOp('/code', { code: 'return sequenceTime' })
    const markDirty = vi.spyOn(op, 'markDirty')
    op.dispose()
    useTimelineStore.getState().setPosition(5)
    expect(markDirty).not.toHaveBeenCalled()
  })

  it('operators without environment never subscribe', () => {
    expect(NumberOp.environment).toEqual([])
    const op = track(new NumberOp('/n'))
    const markDirty = vi.spyOn(op, 'markDirty')
    useTimelineStore.getState().setPosition(5)
    publishEnvironment('clock', { now: 1, tick: 1 })
    expect(markDirty).not.toHaveBeenCalled()
  })
})

describe('TimeOp', () => {
  it('reports the executor clock and timeline position', async () => {
    const op = track(new TimeOp('/time'))
    publishEnvironment('clock', { now: 1000, tick: 7 })
    useTimelineStore.getState().setPosition(2.5)

    expect(await op.pull()).toEqual({ now: 1000, sequenceTime: 2.5, tick: 7 })
  })

  it('re-runs on each clock tick', async () => {
    const op = track(new TimeOp('/time'))
    await op.pull()
    expect(op.dirty).toBe(false)

    publishEnvironment('clock', { now: 2000, tick: 8 })
    expect(op.dirty).toBe(true)
    expect((await op.pull()).tick).toBe(8)
  })
})

describe('MouseOp', () => {
  it('reports the published pointer position', async () => {
    const op = track(new MouseOp('/mouse'))
    publishEnvironment('pointer', { x: 120, y: 45 })
    expect(await op.pull()).toEqual({ position: { x: 120, y: 45 } })

    publishEnvironment('pointer', { x: 10, y: 5 })
    expect(op.dirty).toBe(true)
    expect(await op.pull()).toEqual({ position: { x: 10, y: 5 } })
  })
})
