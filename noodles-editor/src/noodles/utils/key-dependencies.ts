import { getKeysStore, type KeysConfig, type KeyType, useKeysStore } from '../keys-store'

// The keys operators can read. The AI keys are only the assistant's.
const KEY_TYPES: KeyType[] = ['mapbox', 'googleMaps', 'cesium', 'overpass']

// Settings stores a key on every keystroke, so wait for typing to stop before re-running
// operators that send requests with it
export const KEY_RERUN_DELAY_MS = 500

function activeKeys(): KeysConfig {
  const { getKey } = getKeysStore()
  return Object.fromEntries(KEY_TYPES.map(key => [key, getKey(key)]))
}

// The keys an operator would read now, among the values the host runner compares: a changed
// key runs the operator again on the next run
export function keyValues(keys: readonly KeyType[]): (string | undefined)[] {
  const { getKey } = getKeysStore()
  return keys.map(key => getKey(key))
}

// Calls `run` when a key operators read changes, e.g. when the user adds a missing key or
// chooses their own over the project's
export function onKeyChange(run: () => void, delay = KEY_RERUN_DELAY_MS): () => void {
  let applied = activeKeys()
  let timer: ReturnType<typeof setTimeout> | undefined

  const check = () => {
    timer = undefined
    const current = activeKeys()
    const changed = KEY_TYPES.some(key => current[key] !== applied[key])
    applied = current
    if (changed) run()
  }

  const unsubscribe = useKeysStore.subscribe((state, prev) => {
    clearTimeout(timer)
    timer = undefined
    // Opening a project replaces its keys before its document runs, and it runs with them
    if (state.projectKeyLoads !== prev.projectKeyLoads) {
      applied = activeKeys()
      return
    }
    timer = setTimeout(check, delay)
  })

  return () => {
    unsubscribe()
    clearTimeout(timer)
  }
}
