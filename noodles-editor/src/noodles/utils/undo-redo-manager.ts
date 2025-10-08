import { BehaviorSubject } from 'rxjs'
import type { NodesProjectJSON } from './serialization'

export interface UndoRedoSnapshot {
  id: string
  timestamp: number
  description: string
  projectState: NodesProjectJSON
}

export interface UndoRedoState {
  canUndo: boolean
  canRedo: boolean
  undoDescription?: string
  redoDescription?: string
}

export class UndoRedoManager {
  private history: UndoRedoSnapshot[] = []
  private currentIndex = -1
  private maxHistorySize = 50
  private state$ = new BehaviorSubject<UndoRedoState>({
    canUndo: false,
    canRedo: false,
  })

  constructor(
    private getCurrentState: () => NodesProjectJSON,
    private restoreState: (state: NodesProjectJSON) => void
  ) {}

  // Take a snapshot of the current state before making changes
  takeSnapshot(description: string): void {
    console.info(`Taking snapshot: ${description}`)
    const currentState = this.getCurrentState()

    // Don't take snapshot if state hasn't changed
    if (this.history.length > 0 && this.currentIndex >= 0) {
      const lastSnapshot = this.history[this.currentIndex]
      if (JSON.stringify(lastSnapshot.projectState) === JSON.stringify(currentState)) {
        console.info('Skipping duplicate snapshot')
        return
      }
    }

    const snapshot: UndoRedoSnapshot = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      description,
      projectState: currentState,
    }

    // Remove any history after current index (when user made changes after undoing)
    this.history = this.history.slice(0, this.currentIndex + 1)

    // Add new snapshot
    this.history.push(snapshot)
    this.currentIndex = this.history.length - 1

    console.info(
      `Snapshot added. History length: ${this.history.length}, current index: ${this.currentIndex}`
    )

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize)
      this.currentIndex = this.history.length - 1
    }

    this.updateState()
  }

  // Undo the last action
  undo(): void {
    if (!this.canUndo()) {
      console.log('Cannot undo - no history available')
      return
    }

    console.info(`Undoing to index ${this.currentIndex - 1}`)
    this.currentIndex--
    const snapshot = this.history[this.currentIndex]
    console.info(`Restoring snapshot: ${snapshot.description}`)
    this.restoreState(snapshot.projectState)
    this.updateState()
  }

  // Redo the next action
  redo(): void {
    if (!this.canRedo()) return

    console.info(`Redoing to index ${this.currentIndex + 1}`)
    this.currentIndex++
    const snapshot = this.history[this.currentIndex]
    console.info(`Restoring snapshot: ${snapshot.description}`)
    this.restoreState(snapshot.projectState)
    this.updateState()
  }

  // Check if undo is available
  canUndo(): boolean {
    const result = this.currentIndex > 0
    console.info(
      `canUndo: current=${this.currentIndex}, length=${this.history.length}, result=${result}`
    )
    return result
  }

  // Check if redo is available
  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1
  }

  // Get the current undo/redo state as an observable
  getState$() {
    return this.state$.asObservable()
  }

  // Get the current state synchronously
  getState(): UndoRedoState {
    return this.state$.value
  }

  // Clear all history
  clear(): void {
    this.history = []
    this.currentIndex = -1
    this.updateState()
  }

  // Get history for debugging
  getHistory(): UndoRedoSnapshot[] {
    return [...this.history]
  }

  private updateState(): void {
    const undoSnapshot = this.canUndo() ? this.history[this.currentIndex - 1] : undefined
    const redoSnapshot = this.canRedo() ? this.history[this.currentIndex + 1] : undefined

    this.state$.next({
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoDescription: undoSnapshot?.description,
      redoDescription: redoSnapshot?.description,
    })
  }
}
