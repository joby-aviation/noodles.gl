import { createStore } from 'zustand/vanilla'
import type { PermissionRequest } from './agent/acp/session'
import type { ModificationProposal } from './modification-proposal'

// An ACP agent asking before it runs a tool. The turn waits on the answer.
export interface PermissionPrompt {
  request: PermissionRequest
  settle: (optionId: string | null) => void
}

// Where the chat panel's turn is. One turn runs at a time, and every way in (the
// Send button, Enter) claims it with begin, which is synchronous, so two sends in
// the same tick can't both start one.
//
// runId is the generation the run started under. New conversation, a loaded one
// and another project all bump the generation, so a run that settles after that
// belongs to none of them and its reply and proposal are dropped.
export type TurnState =
  | { phase: 'idle' }
  | {
      phase: 'sending'
      runId: number
      controller: AbortController
      // The reply so far, so it appears as it is generated rather than all at
      // once when the whole multi-step run finishes
      streamingText: string
      activeTools: string[]
      permission: PermissionPrompt | null
    }
  // A run that was abandoned and aborted but has not settled yet. Nothing of it
  // shows, but the provider is still busy with it (an ACP agent refuses a second
  // prompt, a local model runs one generation at a time), so the next send waits.
  | { phase: 'stopping'; runId: number }
  // An edit the assistant proposed, waiting on Accept or Reject. Sending is
  // blocked until it is resolved: the next run would be planned against a graph
  // the user has not decided on, and its own proposal would have nowhere to go.
  | { phase: 'proposal'; proposal: ModificationProposal }

const IDLE: TurnState = { phase: 'idle' }

export function createTurnStore() {
  let generation = 0
  const store = createStore<{ turn: TurnState }>(() => ({ turn: IDLE }))
  const get = () => store.getState().turn
  const set = (turn: TurnState) => store.setState({ turn })

  // Applies only to the run still on screen
  const updateRun = (
    runId: number,
    update: (turn: Extract<TurnState, { phase: 'sending' }>) => TurnState
  ) => {
    const turn = get()
    if (turn.phase === 'sending' && turn.runId === runId) set(update(turn))
  }

  return {
    store,

    // Claims the turn, or returns null while one runs, is stopping, or a
    // proposal waits
    begin(): { runId: number; signal: AbortSignal } | null {
      if (get().phase !== 'idle') return null
      const controller = new AbortController()
      set({
        phase: 'sending',
        runId: generation,
        controller,
        streamingText: '',
        activeTools: [],
        permission: null,
      })
      return { runId: generation, signal: controller.signal }
    },

    // Whether a run's reply still belongs on screen
    isCurrent(runId: number): boolean {
      return runId === generation
    },

    appendText(runId: number, text: string) {
      updateRun(runId, turn => ({ ...turn, streamingText: turn.streamingText + text }))
    },

    addTool(runId: number, name: string) {
      updateRun(runId, turn => ({ ...turn, activeTools: [...turn.activeTools, name] }))
    },

    // Shows the prompt on the turn in flight. False when there is none, so the
    // caller can refuse a request no turn of this conversation made.
    requestPermission(prompt: PermissionPrompt): boolean {
      const turn = get()
      if (turn.phase !== 'sending') return false
      set({ ...turn, permission: prompt })
      return true
    },

    // Clears the prompt on screen, or only the given one
    clearPermission(prompt?: PermissionPrompt) {
      const turn = get()
      if (turn.phase !== 'sending' || !turn.permission) return
      if (prompt && turn.permission !== prompt) return
      set({ ...turn, permission: null })
    },

    // Stop: the run ends, and what it produced so far is kept
    stop() {
      const turn = get()
      if (turn.phase === 'sending') turn.controller.abort()
    },

    // Called once a run settles, with the proposal it ended in, if any
    finish(runId: number, proposal: ModificationProposal | null) {
      const turn = get()
      if ((turn.phase === 'sending' || turn.phase === 'stopping') && turn.runId === runId) {
        set(proposal && runId === generation ? { phase: 'proposal', proposal } : IDLE)
      }
    },

    // Takes the pending proposal to accept or reject it
    takeProposal(): ModificationProposal | null {
      const turn = get()
      if (turn.phase !== 'proposal') return null
      set(IDLE)
      return turn.proposal
    },

    // The conversation or the project changed: aborts the run in flight and drops
    // the pending proposal. Returns whether there was a proposal to drop.
    abandon(): boolean {
      generation += 1
      const turn = get()
      switch (turn.phase) {
        case 'sending':
          set({ phase: 'stopping', runId: turn.runId })
          turn.controller.abort()
          turn.permission?.settle(null)
          return false
        case 'proposal':
          set(IDLE)
          return true
        default:
          return false
      }
    },
  }
}

export type TurnStore = ReturnType<typeof createTurnStore>
