import { debugHistory } from '../../utils/debug'
import type { IOperator, Operator } from '../operators'
import { getOp } from '../store'
import type { OpId } from './id-utils'
import { getBaseName } from './path-utils'

export interface LockChange {
  // The operator, which keeps its object through renames, and its id when changed
  op: Operator<IOperator>
  opId: OpId
  // Lock state after the change
  locked: boolean
  // Outputs held before an unlock, kept in memory so undo can put them back
  outputsBefore?: Record<string, unknown>
}

type LockChangeCallback = (description: string, change: LockChange) => void

let _lockChangeCallback: LockChangeCallback | undefined

export function registerLockChangeCallback(cb: LockChangeCallback | undefined) {
  _lockChangeCallback = cb
}

// Unlocking re-executes and replaces the held result, so ask first when there is one
export function shouldConfirmUnlock(op: Operator<IOperator>): boolean {
  return op.locked.value && op.hasOutput
}

// Lock or unlock from the UI and record it in the undo history
export function setLockedWithHistory(op: Operator<IOperator>, locked: boolean) {
  if (op.locked.value === locked) return
  const outputsBefore = !locked && op.hasOutput ? op.outputData : undefined
  op.locked.next(locked)
  _lockChangeCallback?.(`${locked ? 'Lock' : 'Unlock'} ${getBaseName(op.id)}`, {
    op,
    opId: op.id,
    locked,
    outputsBefore,
  })
}

// Renames aren't in the undo history, so follow the operator rather than its old id.
// If it was deleted and the delete undone, a new operator holds the old id.
function findOp(change: LockChange) {
  return getOp(change.op.id) === change.op ? change.op : getOp(change.opId)
}

export function undoLockChange(change: LockChange) {
  const op = findOp(change)
  if (!op) {
    debugHistory('Cannot undo lock change, %s not found', change.opId)
    return
  }
  const { outputsBefore } = change
  if (change.locked || !outputsBefore) {
    op.locked.next(!change.locked)
    return
  }

  // Relock before restoring: the lock subscription only marks dirty on unlock,
  // and pull() serves held outputs without executing once locked
  op.locked.next(true)
  op.setOutputValues(outputsBefore)
  // The run started by the unlock may still be in flight (e.g. a directions call).
  // pull() waits for it, then the held outputs go back over its result.
  op.pull()
    .catch(() => {})
    .finally(() => {
      if (op.locked.value) op.setOutputValues(outputsBefore)
    })
}

export function redoLockChange(change: LockChange) {
  const op = findOp(change)
  if (!op) {
    debugHistory('Cannot redo lock change, %s not found', change.opId)
    return
  }
  op.locked.next(change.locked)
}
