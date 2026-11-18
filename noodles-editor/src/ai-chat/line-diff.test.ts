import { describe, expect, it } from 'vitest'
import { asText, lineDiff } from './line-diff'

describe('lineDiff', () => {
  it('marks the lines a change added and removed, keeping the rest', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ])
  })

  it('cuts unchanged stretches far from a change to one skip', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 10', 'line ten')
    const diff = lineDiff(before, after, 2) ?? []
    expect(diff[0]).toEqual({ kind: 'skip', count: 8 })
    expect(diff.filter(l => l.kind === 'add')).toEqual([{ kind: 'add', text: 'line ten' }])
    expect(diff[diff.length - 1]).toEqual({ kind: 'skip', count: 7 })
  })

  it('gives up on a value too long to diff', () => {
    const long = Array.from({ length: 3000 }, (_, i) => String(i)).join('\n')
    expect(lineDiff(long, `${long}\nmore`)).toBeUndefined()
  })
})

describe('asText', () => {
  it('reads code as text, from a string, older lines, or an expression', () => {
    expect(asText('return d')).toBe('return d')
    expect(asText(['const a = 1', 'return a'])).toBe('const a = 1\nreturn a')
    expect(asText({ expr: 'sin(T)' })).toBe('sin(T)')
    expect(asText(42)).toBeUndefined()
  })
})
