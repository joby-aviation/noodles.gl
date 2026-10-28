import { debugDirty } from '../../utils/debug'
import { getKeysStore, type KeysConfig, type KeyType, useKeysStore } from '../keys-store'
import type { IOperator, Operator } from '../operators'

// The keys operators can read. The AI keys are only the assistant's.
const KEY_TYPES: KeyType[] = ['mapbox', 'googleMaps', 'cesium', 'overpass']

// Settings stores a key on every keystroke, so wait for typing to stop before re-running
// operators that send requests with it
export const KEY_RERUN_DELAY_MS = 500

function activeKeys(): KeysConfig {
  const { getKey } = getKeysStore()
  return Object.fromEntries(KEY_TYPES.map(key => [key, getKey(key)]))
}

// Runs operators again when the key they read changes, e.g. when the user adds a missing
// key or chooses their own over the project's. Locked operators keep their output, and
// catch up when they're unlocked.
export function rerunOnKeyChange(
  getOps: () => Operator<IOperator>[],
  delay = KEY_RERUN_DELAY_MS
): () => void {
  let applied = activeKeys()
  let timer: ReturnType<typeof setTimeout> | undefined

  const rerun = () => {
    timer = undefined
    const current = activeKeys()
    const changed = KEY_TYPES.filter(key => current[key] !== applied[key])
    applied = current
    if (changed.length === 0) return
    for (const op of getOps()) {
      const { usesKeys } = op.constructor as typeof Operator
      if (op.locked.value || !usesKeys.some(key => changed.includes(key))) continue
      debugDirty('%s marked dirty by key change: %s', op.id, changed.join(', '))
      op.markDirty('key change')
    }
  }

  const unsubscribe = useKeysStore.subscribe((state, prev) => {
    clearTimeout(timer)
    timer = undefined
    // Loading a project replaces its keys before its operators are built, and those
    // operators run with the new keys anyway
    if (state.projectKeyLoads !== prev.projectKeyLoads) {
      applied = activeKeys()
      return
    }
    timer = setTimeout(rerun, delay)
  })

  return () => {
    unsubscribe()
    clearTimeout(timer)
  }
}
