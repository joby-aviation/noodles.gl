// Editor state: the document, what is selected, where the playhead is.
//
// A plain store read through `useSyncExternalStore`, as d-d-d's editor has: one document and a
// few view fields, and the engine (DuckDB, the runtime) lives outside React and subscribes the
// same way components do.
//
// Undo is by document snapshot. Edits that arrive in a burst (a slider dragged, a keyframe
// moved) coalesce into one step, so undo goes back to where the drag began, not one pixel.

import type { EditorDoc } from '@noodles.gl/planner'
import { useSyncExternalStore } from 'react'

export interface EditorState {
  doc: EditorDoc
  /** Node ids. */
  selection: string[]
  /** The subnet being viewed; undefined is the root network. */
  network?: string
  /** Timeline seconds. */
  time: number
  /** Incremented by every `load`, so views can reset once per opened document. */
  loadId: number
  /** Edits since the last load or save. */
  dirty: boolean
  /** A parameter copied to paste as a reference, `nodeId.param`. */
  copiedParam?: string
  /**
   * Show what the planner made of the graph: SQL, relations, what each change costs, which
   * engine ran a node. For people working on Noodles; users see none of it.
   */
  debug?: boolean
}

type Listener = () => void

/** A document and the history depth it had: see `DocStore.mark`. */
export interface DocMark {
  doc: EditorDoc
  depth: number
}

const COALESCE_MS = 500
const HISTORY = 200

export const EMPTY_DOC: EditorDoc = { version: 1, name: 'Untitled', nodes: [], edges: [] }

export class DocStore {
  private state: EditorState
  private readonly listeners = new Set<Listener>()
  private undoStack: EditorDoc[] = []
  private redoStack: EditorDoc[] = []
  private lastEdit = 0
  private lastTag?: string

  constructor(doc: EditorDoc = EMPTY_DOC) {
    this.state = { doc, selection: [], time: 0, loadId: 0, dirty: false }
  }

  get = (): EditorState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** View state: never an undo step. */
  set(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch
    this.state = { ...this.state, ...next }
    for (const l of this.listeners) l()
  }

  /**
   * Change the document. `tag` names the gesture: consecutive edits with the same tag inside
   * the coalescing window are one undo step.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: an edit mutates the draft and returns nothing, or returns a new document
  edit(fn: (doc: EditorDoc) => EditorDoc | undefined | void, tag?: string): void {
    const now = performance.now()
    const coalesce = tag !== undefined && tag === this.lastTag && now - this.lastEdit < COALESCE_MS
    if (!coalesce) {
      this.undoStack.push(this.state.doc)
      if (this.undoStack.length > HISTORY) this.undoStack.shift()
      this.redoStack = []
    }
    this.lastEdit = now
    this.lastTag = tag
    const draft = structuredClone(this.state.doc)
    const result = fn(draft) ?? draft
    this.set({ doc: result, dirty: true })
  }

  /** Replace the document outright, e.g. opening a project. Clears history. */
  load(doc: EditorDoc): void {
    this.undoStack = []
    this.redoStack = []
    this.lastTag = undefined
    this.set(s => ({
      doc,
      selection: [],
      network: undefined,
      time: 0,
      loadId: s.loadId + 1,
      dirty: false,
    }))
  }

  /**
   * A point to come back to: the assistant's edits of a run are a proposal from here, kept
   * as one undo step (`squash`) or thrown away (`revert`).
   */
  mark(): DocMark {
    return { doc: this.state.doc, depth: this.undoStack.length }
  }

  /** Every edit since `m` as one undo step. */
  squash(m: DocMark): void {
    if (this.state.doc === m.doc) return
    this.undoStack.length = Math.min(this.undoStack.length, m.depth)
    this.undoStack.push(m.doc)
    this.redoStack = []
    this.lastTag = undefined
  }

  /** Back to the document at `m`, with the history since dropped. */
  revert(m: DocMark): void {
    this.undoStack.length = Math.min(this.undoStack.length, m.depth)
    this.redoStack = []
    this.lastTag = undefined
    this.set({ doc: m.doc, dirty: true })
  }

  canUndo = () => this.undoStack.length > 0
  canRedo = () => this.redoStack.length > 0

  undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(this.state.doc)
    this.lastTag = undefined
    this.set({ doc: prev, dirty: true })
  }

  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.state.doc)
    this.lastTag = undefined
    this.set({ doc: next, dirty: true })
  }
}

let current: DocStore | undefined

/** The editor's store. One per page: the engine and every view share it. */
export function docStore(): DocStore {
  current ??= new DocStore()
  return current
}

/** Subscribe a component to a slice of state. Return primitives or stable references. */
export function useEditor<T>(select: (s: EditorState) => T): T {
  const s = docStore()
  return useSyncExternalStore(s.subscribe, () => select(s.get()))
}
