import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordGraphMutation, registerGraphMutationRecorder } from './graph-history'

afterEach(() => registerGraphMutationRecorder(undefined))

describe('recordGraphMutation', () => {
  it('hands the mutation to the registered recorder', () => {
    const recorder = vi.fn((_description: string, mutate: () => void) => mutate())
    const mutate = vi.fn()
    registerGraphMutationRecorder(recorder)

    recordGraphMutation('Apply assistant proposal', mutate)

    expect(recorder).toHaveBeenCalledOnce()
    expect(recorder.mock.calls[0][0]).toBe('Apply assistant proposal')
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('still runs the mutation when nothing is recording', () => {
    const mutate = vi.fn()
    recordGraphMutation('Apply assistant proposal', mutate)
    expect(mutate).toHaveBeenCalledOnce()
  })
})
