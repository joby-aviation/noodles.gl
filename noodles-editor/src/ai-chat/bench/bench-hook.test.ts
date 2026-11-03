import { describe, expect, it } from 'vitest'
import { historyFor } from './bench-hook'

describe('historyFor', () => {
  const call = {
    name: 'apply_modifications',
    params: { modifications: [] },
    success: true,
    preview: '',
  }

  it('keeps the tool uses the chat panel keeps', () => {
    const [reply] = historyFor({ reply: 'Done.', toolCalls: [call], apply: { success: true } })
    expect(reply).toEqual({
      role: 'assistant',
      content: 'Done.',
      toolUses: [{ name: 'apply_modifications', params: { modifications: [] }, ok: true }],
    })
  })

  it('adds the note the chat shows when the editor rejected the edits', () => {
    // So a follow-up such as "why did that fail?" has the same context it would in chat
    const messages = historyFor({
      reply: 'Done.',
      toolCalls: [call],
      apply: { success: false, error: 'Cannot delete the last Output node.' },
    })
    expect(messages.at(-1)).toEqual({
      role: 'assistant',
      content: 'Failed to apply modifications: Cannot delete the last Output node.',
    })
  })
})
