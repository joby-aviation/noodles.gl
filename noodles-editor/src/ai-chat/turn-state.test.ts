import { describe, expect, it, vi } from 'vitest'
import type { ModificationProposal } from './modification-proposal'
import { createTurnStore } from './turn-state'

const proposal = { modifications: [], lines: [] } as unknown as ModificationProposal

describe('createTurnStore', () => {
  it('lets only one run claim the turn', () => {
    const turns = createTurnStore()
    expect(turns.begin()).not.toBeNull()
    expect(turns.begin()).toBeNull()
  })

  it('ends a run in its proposal, which blocks the next until taken', () => {
    const turns = createTurnStore()
    const run = turns.begin()
    if (!run) throw new Error('not claimed')
    turns.finish(run.runId, proposal)

    expect(turns.store.getState().turn.phase).toBe('proposal')
    expect(turns.begin()).toBeNull()
    expect(turns.takeProposal()).toBe(proposal)
    expect(turns.begin()).not.toBeNull()
  })

  it('keeps an abandoned run stopping until it settles, then drops its proposal', () => {
    const turns = createTurnStore()
    const run = turns.begin()
    if (!run) throw new Error('not claimed')
    turns.appendText(run.runId, 'old')
    turns.abandon()

    expect(run.signal.aborted).toBe(true)
    expect(turns.isCurrent(run.runId)).toBe(false)
    expect(turns.store.getState().turn).toEqual({ phase: 'stopping', runId: run.runId })
    expect(turns.begin()).toBeNull()

    // Late events from the old run go nowhere
    turns.appendText(run.runId, ' more')
    turns.finish(run.runId, proposal)
    expect(turns.store.getState().turn.phase).toBe('idle')
  })

  it('dismisses a permission prompt with the turn that showed it', () => {
    const turns = createTurnStore()
    expect(turns.requestPermission({ request: {} as never, settle: () => {} })).toBe(false)

    turns.begin()
    const settle = vi.fn()
    expect(turns.requestPermission({ request: {} as never, settle })).toBe(true)
    turns.abandon()
    expect(settle).toHaveBeenCalledWith(null)
  })

  it('reports a dropped proposal when abandoned', () => {
    const turns = createTurnStore()
    expect(turns.abandon()).toBe(false)
    const run = turns.begin()
    if (!run) throw new Error('not claimed')
    turns.finish(run.runId, proposal)
    expect(turns.abandon()).toBe(true)
    expect(turns.store.getState().turn.phase).toBe('idle')
  })
})
