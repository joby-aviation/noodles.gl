import { describe, expect, it } from 'vitest'
import {
  applyCompletion,
  type ColumnInfo,
  completionsAt,
  usableColumns,
  wordAt,
} from './expression-completion'

const columns: ColumnInfo[] = [
  { name: 'Latitude', type: 'DOUBLE' },
  { name: 'Longitude', type: 'DOUBLE' },
  { name: 'Magnitude', type: 'DOUBLE' },
  { name: 'place', type: 'VARCHAR' },
  { name: 'position', type: 'FLOAT[2]' },
  { name: 'position_0', type: 'FLOAT' },
  { name: 'position_1', type: 'FLOAT' },
  { name: 'event type', type: 'VARCHAR' },
]

const labels = (r: ReturnType<typeof completionsAt>) => r?.items.map(i => i.label) ?? []

describe('expression completion', () => {
  it('offers columns an expression can name, a vector once', () => {
    expect(usableColumns(columns).map(c => c.name)).toEqual([
      'Latitude',
      'Longitude',
      'Magnitude',
      'place',
      'position',
    ])
  })

  it('lists every column in an empty expression, to show what the rows hold', () => {
    expect(labels(completionsAt('expr', '', 0, columns))).toEqual([
      'Latitude',
      'Longitude',
      'Magnitude',
      'place',
      'position',
    ])
  })

  it('filters by the word at the caret, prefix matches first, then functions', () => {
    const text = '[Lon, '
    expect(labels(completionsAt('expr', text, 4, columns))).toEqual(['Longitude'])
    const found = completionsAt('expr', 'sq', 2, columns)
    expect(found?.items[0]).toMatchObject({ kind: 'function', label: 'sqrt', insert: 'sqrt(' })
    // Matches inside a name come after those starting with it
    expect(labels(completionsAt('expr', 'it', 2, columns)).slice(0, 3)).toEqual([
      'Latitude',
      'Longitude',
      'Magnitude',
    ])
  })

  it('offers geo and string functions with their parameters', () => {
    const found = completionsAt('expr', 'hex', 3, columns)
    expect(found?.items.find(i => i.label === 'hex_color')?.detail).toBe('hex_color(s)')
  })

  it('suggests nothing in a string, a number or after a swizzle dot', () => {
    expect(wordAt("place == 'La", 12)).toBeUndefined()
    expect(wordAt('2.5', 3)).toBeUndefined()
    expect(wordAt('position.x', 10)).toBeUndefined()
    // Straight after a name, a new one cannot start without an operator
    expect(wordAt('Magnitude ', 10)).toBeUndefined()
    expect(wordAt('Magnitude * ', 12)).toEqual({ start: 12, end: 12, text: '' })
  })

  it('replaces the word with the completion and puts the caret after it', () => {
    const text = 'sqrt(Mag) * 2'
    const found = completionsAt('expr', text, 8, columns)
    expect(found?.items[0].label).toBe('Magnitude')
    expect(applyCompletion(text, found!.word, found!.items[0])).toEqual({
      text: 'sqrt(Magnitude) * 2',
      caret: 14,
    })
  })

  it("opens a function's parenthesis, or steps into one already there", () => {
    const fn = completionsAt('expr', 'sq', 2, columns)!.items[0]
    expect(applyCompletion('sq', { start: 0, end: 2, text: 'sq' }, fn)).toEqual({
      text: 'sqrt(',
      caret: 5,
    })
    expect(applyCompletion('sq(x)', { start: 0, end: 2, text: 'sq' }, fn)).toEqual({
      text: 'sqrt(x)',
      caret: 5,
    })
  })

  it('completes a column parameter as a whole, and goes quiet once it names one', () => {
    const found = completionsAt('column', 'mag', 3, columns)
    expect(labels(found)).toEqual(['Magnitude'])
    expect(found?.word).toEqual({ start: 0, end: 3, text: 'mag' })
    expect(completionsAt('column', 'Magnitude', 9, columns)).toBeUndefined()
  })
})
