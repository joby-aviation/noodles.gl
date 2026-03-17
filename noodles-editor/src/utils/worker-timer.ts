// Web Worker-based timer utilities that are not throttled by tab visibility.
// Browsers throttle RAF and main-thread setTimeout/setInterval to ~1fps (or 1s minimum)
// when a tab is hidden. Worker timers fire at full rate regardless of visibility.

const workerSource = /* js */ `
let nextId = 1
const timers = new Map()

self.onmessage = (e) => {
  const { type, id, delay } = e.data
  if (type === 'setTimeout') {
    const handle = setTimeout(() => {
      timers.delete(id)
      self.postMessage({ id, ts: performance.now() })
    }, delay)
    timers.set(id, handle)
  } else if (type === 'setInterval') {
    const handle = setInterval(() => {
      self.postMessage({ id, ts: performance.now() })
    }, delay)
    timers.set(id, handle)
  } else if (type === 'clear') {
    const handle = timers.get(id)
    clearTimeout(handle)
    clearInterval(handle)
    timers.delete(id)
  }
}
`

// Singleton worker shared across all callers
let worker: Worker | null = null
let nextId = 1
const callbacks = new Map<number, { fn: (ts: number) => void; once: boolean }>()

function getWorker(): Worker {
  if (!worker) {
    const blob = new Blob([workerSource], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    worker = new Worker(url)
    worker.onmessage = (e: MessageEvent<{ id: number; ts: number }>) => {
      const entry = callbacks.get(e.data.id)
      if (!entry) return
      if (entry.once) callbacks.delete(e.data.id)
      entry.fn(e.data.ts)
    }
  }
  return worker
}

// Drop-in replacement for setTimeout, not throttled when tab is hidden.
// Returns a cancel function.
export function workerSetTimeout(callback: () => void, delayMs: number): () => void {
  const id = nextId++
  callbacks.set(id, { fn: callback, once: true })
  getWorker().postMessage({ type: 'setTimeout', id, delay: delayMs })
  return () => {
    callbacks.delete(id)
    getWorker().postMessage({ type: 'clear', id })
  }
}

// Drop-in replacement for setInterval, not throttled when tab is hidden.
// Callback receives a performance.now() timestamp from the worker.
// Returns a cancel function.
export function workerSetInterval(
  callback: (timestamp: number) => void,
  intervalMs: number
): () => void {
  const id = nextId++
  callbacks.set(id, { fn: callback, once: false })
  getWorker().postMessage({ type: 'setInterval', id, delay: intervalMs })
  return () => {
    callbacks.delete(id)
    getWorker().postMessage({ type: 'clear', id })
  }
}
