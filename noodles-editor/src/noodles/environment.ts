// Environment state: values an operator depends on that come from the host editor
// rather than from graph inputs (timeline position, render surface size, clock, pointer).
//
// Operators declare the keys they read with `static environment = [...]`. The base
// Operator passes a view of those keys to execute() as `env` and marks the operator
// dirty when any of them change, so execute() stays a function of (inputs, env) and
// operators never subscribe to stores, run their own RAF loops, or listen to the DOM.
//
// Sources:
// - timeline: derived from the timeline store
// - renderSurface, pointer: published by TimelineEditor
// - clock: published by the GraphExecutor loop once per frame

import { calculateRenderSurfaceSize } from '../render/render-surface'
import { useTimelineStore } from '../timeline/timeline-store'
import { DEFAULT_RENDER_SETTINGS } from './utils/render-settings-constants'

export interface TimelineEnvironment {
  sequenceTime: number
  frame: number
  totalFrames: number
  sequence: {
    length: number
    fps: number
  }
}

export interface RenderSurfaceEnvironment {
  width: number
  height: number
}

export interface ClockEnvironment {
  // Wall-clock time in ms at the start of the current executor frame
  now: number
  // Executor frames since the session started
  tick: number
}

export interface PointerEnvironment {
  // Pointer position in render-surface pixels (unscaled)
  x: number
  y: number
}

export interface Environment {
  timeline: TimelineEnvironment
  renderSurface: RenderSurfaceEnvironment
  clock: ClockEnvironment
  pointer: PointerEnvironment
}

export type EnvironmentKey = keyof Environment

// Keys whose values are published by the host; timeline is derived from its own store
export type PublishedEnvironmentKey = Exclude<EnvironmentKey, 'timeline'>

export const ENVIRONMENT_KEYS: readonly EnvironmentKey[] = [
  'timeline',
  'renderSurface',
  'clock',
  'pointer',
]

interface EnvironmentSource<T> {
  read(): T
  // Starts watching the underlying source; returns a teardown
  watch(onChange: () => void): () => void
}

interface PublishedSource<T> extends EnvironmentSource<T> {
  publish(value: T): void
  reset(): void
}

const isPositiveFinite = (value: number) => Number.isFinite(value) && value > 0

function readTimeline(): TimelineEnvironment {
  const { position, sequence } = useTimelineStore.getState()
  return {
    sequenceTime: position,
    frame: Math.floor(position * sequence.fps),
    totalFrames: Math.floor(sequence.length * sequence.fps),
    sequence: {
      length: sequence.length,
      fps: sequence.fps,
    },
  }
}

const timelineSource: EnvironmentSource<TimelineEnvironment> = {
  read: readTimeline,
  watch: onChange =>
    useTimelineStore.subscribe(
      state => ({
        position: state.position,
        fps: state.sequence.fps,
        length: state.sequence.length,
      }),
      onChange,
      {
        equalityFn: (a, b) => a.position === b.position && a.fps === b.fps && a.length === b.length,
      }
    ),
}

function createPublishedSource<T extends object>(
  createDefault: () => T,
  isValid: (value: T) => boolean
): PublishedSource<T> {
  let value = createDefault()
  const listeners = new Set<() => void>()

  const set = (next: T) => {
    const keys = Object.keys(next) as (keyof T)[]
    const unchanged = keys.every(key => next[key] === value[key])
    if (unchanged) return
    value = { ...next }
    for (const listener of [...listeners]) listener()
  }

  return {
    read: () => value,
    watch: onChange => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    publish: next => {
      if (isValid(next)) set(next)
    },
    reset: () => set(createDefault()),
  }
}

const publishedSources: { [K in PublishedEnvironmentKey]: PublishedSource<Environment[K]> } = {
  renderSurface: createPublishedSource(
    () =>
      calculateRenderSurfaceSize(DEFAULT_RENDER_SETTINGS.resolution, DEFAULT_RENDER_SETTINGS.lod),
    size => isPositiveFinite(size.width) && isPositiveFinite(size.height)
  ),
  clock: createPublishedSource(
    () => ({ now: Date.now(), tick: 0 }),
    clock => Number.isFinite(clock.now) && Number.isFinite(clock.tick)
  ),
  pointer: createPublishedSource(
    () => ({ x: 0, y: 0 }),
    pointer => Number.isFinite(pointer.x) && Number.isFinite(pointer.y)
  ),
}

const sources: { [K in EnvironmentKey]: EnvironmentSource<Environment[K]> } = {
  timeline: timelineSource,
  ...publishedSources,
}

export function readEnvironment<K extends EnvironmentKey>(key: K): Environment[K] {
  return sources[key].read()
}

// Publish a host-owned environment value. Unchanged and invalid values are ignored.
export function publishEnvironment<K extends PublishedEnvironmentKey>(
  key: K,
  value: Environment[K]
): void {
  publishedSources[key].publish(value)
}

// Restore published values to their defaults (tests, editor teardown)
export function resetEnvironment(): void {
  for (const source of Object.values(publishedSources)) source.reset()
}

// One watcher per key, shared by every listener and torn down when the last one leaves
type EnvironmentListener = (key: EnvironmentKey) => void
const listenersByKey = new Map<EnvironmentKey, Set<EnvironmentListener>>()
const unwatchByKey = new Map<EnvironmentKey, () => void>()

// Call `onChange` whenever any of `keys` changes. Returns an unsubscribe function.
export function subscribeToEnvironment(
  keys: readonly EnvironmentKey[],
  onChange: EnvironmentListener
): () => void {
  const uniqueKeys = [...new Set(keys)]
  for (const key of uniqueKeys) {
    let listeners = listenersByKey.get(key)
    if (!listeners) {
      const created = new Set<EnvironmentListener>()
      listeners = created
      listenersByKey.set(key, created)
      unwatchByKey.set(
        key,
        sources[key].watch(() => {
          for (const listener of [...created]) listener(key)
        })
      )
    }
    listeners.add(onChange)
  }

  return () => {
    for (const key of uniqueKeys) {
      const listeners = listenersByKey.get(key)
      if (!listeners?.delete(onChange) || listeners.size > 0) continue
      unwatchByKey.get(key)?.()
      unwatchByKey.delete(key)
      listenersByKey.delete(key)
    }
  }
}

// Build the `env` object passed to execute(). Declared keys read the current value on
// access, so closures an operator returns (e.g. deck.gl accessors) see fresh values.
// Undeclared keys throw, keeping each operator's declaration honest.
export function createEnvironmentView(keys: readonly EnvironmentKey[], owner: string): Environment {
  const declared = new Set(keys)
  const view = {} as Environment
  for (const key of ENVIRONMENT_KEYS) {
    Object.defineProperty(view, key, {
      enumerable: declared.has(key),
      get: declared.has(key)
        ? () => readEnvironment(key)
        : () => {
            throw new Error(
              `${owner} reads environment '${key}' without declaring it in static environment`
            )
          },
    })
  }
  return Object.freeze(view)
}
