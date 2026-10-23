import { describe, expect, it } from 'vitest'
import type { IOperator, Operator } from '../operators'
import {
  readsTimeline,
  subscribeOpToTimeline,
  unsubscribeOpFromTimeline,
} from './timeline-dependencies'

describe('timeline dependencies', () => {
  it('remembers which operators read the timeline until they stop', () => {
    const op = { id: '/code' } as Operator<IOperator>
    expect(readsTimeline('/code')).toBe(false)
    subscribeOpToTimeline(op)
    expect(readsTimeline('/code')).toBe(true)
    unsubscribeOpFromTimeline('/code')
    expect(readsTimeline('/code')).toBe(false)
  })
})
