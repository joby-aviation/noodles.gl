import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '../types'
import { trimTranscript } from './json-tools'

const ask = (text: string): AgentMessage => ({ role: 'user', content: [{ type: 'text', text }] })
const answer = (text: string): AgentMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
})
const call = (id: string): AgentMessage => ({
  role: 'assistant',
  content: [{ type: 'tool_use', id, name: 'list_nodes', input: {} }],
})
const result = (id: string): AgentMessage => ({
  role: 'user',
  content: [{ type: 'tool_result', toolUseId: id, content: `nodes for ${id}` }],
})

describe('trimTranscript', () => {
  // The shape after the first tool call. Keeping only the result would lose both
  // the task and which tool produced it.
  it('keeps a task, call and result whole', () => {
    const messages = [ask('add a layer'), call('a'), result('a')]
    expect(trimTranscript(messages)).toEqual(messages)
  })

  it('keeps the task and the latest call/result pair', () => {
    const messages = [ask('add a layer'), call('a'), result('a'), call('b'), result('b')]
    expect(trimTranscript(messages)).toEqual([ask('add a layer'), call('b'), result('b')])
  })

  // With earlier conversation in front, the first turn is an old question and the
  // request being worked on sits in the middle
  it('keeps the current request when it is not the first turn', () => {
    const messages = [
      ask('first question'),
      answer('first answer'),
      ask('add a layer'),
      call('a'),
      result('a'),
      call('b'),
      result('b'),
    ]
    expect(trimTranscript(messages)).toEqual([
      ask('first question'),
      ask('add a layer'),
      call('b'),
      result('b'),
    ])
  })

  it('drops the middle of a plain conversation', () => {
    const messages = [ask('first'), answer('second'), ask('third'), answer('fourth'), ask('fifth')]
    expect(trimTranscript(messages)).toEqual([ask('first'), answer('fourth'), ask('fifth')])
  })
})
