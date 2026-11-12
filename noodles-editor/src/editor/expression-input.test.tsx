// The expression input lists the input's columns as you type, takes one with Enter or a click,
// and holds back text that does not parse until the input loses focus
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StringField } from '../noodles/fields'
import type { ColumnInfo } from './expression-completion'
import { ExpressionInput, hasUnwrittenEdit } from './expression-input'

const columns: ColumnInfo[] = [
  { name: 'Latitude', type: 'DOUBLE' },
  { name: 'Longitude', type: 'DOUBLE' },
  { name: 'Magnitude', type: 'DOUBLE' },
]

function setup(mode: 'expr' | 'column', value = '') {
  const field = new StringField(value)
  render(<ExpressionInput id="Expression" field={field as never} mode={mode} columns={columns} />)
  const input = screen.getByRole('combobox') as HTMLTextAreaElement
  return { field, input }
}

const type = (input: HTMLTextAreaElement, value: string) => {
  fireEvent.change(input, { target: { value, selectionStart: value.length } })
  input.setSelectionRange(value.length, value.length)
  fireEvent.select(input)
}

const options = () => screen.queryAllByRole('option').map(o => o.firstChild?.textContent)

describe('ExpressionInput', () => {
  afterEach(() => cleanup())

  it('lists the columns when an empty expression gets focus', () => {
    const { input } = setup('expr')
    fireEvent.focus(input)
    expect(options()).toEqual(['Latitude', 'Longitude', 'Magnitude'])
  })

  it('takes the highlighted column with Enter, writing the expression once it parses', () => {
    const { field, input } = setup('expr', '0.0')
    fireEvent.focus(input)
    type(input, 'sqrt(Mag')
    // Half typed: not written yet
    expect(field.value).toBe('0.0')
    expect(options()).toEqual(['Magnitude'])
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('sqrt(Magnitude')
    type(input, 'sqrt(Magnitude)')
    expect(field.value).toBe('sqrt(Magnitude)')
  })

  it('writes what is there when the input loses focus, so an error shows', () => {
    const { field, input } = setup('expr', '0.0')
    fireEvent.focus(input)
    type(input, '[Longitude,')
    expect(field.value).toBe('0.0')
    fireEvent.blur(input)
    expect(field.value).toBe('[Longitude,')
  })

  it('counts text that does not parse yet as an open edit, until the input loses focus', () => {
    const { input } = setup('expr', '0.0')
    fireEvent.focus(input)
    type(input, '[Longitude,')
    expect(hasUnwrittenEdit()).toBe(true)
    fireEvent.blur(input)
    expect(hasUnwrittenEdit()).toBe(false)
  })

  it('moves through the list with the arrow keys and closes it with Escape', () => {
    const { input } = setup('expr')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(options()).toEqual([])
  })

  it('fills a column parameter with a clicked column', () => {
    const { field, input } = setup('column')
    fireEvent.focus(input)
    type(input, 'lon')
    fireEvent.mouseDown(screen.getByRole('option'))
    expect(field.value).toBe('Longitude')
    expect(options()).toEqual([])
  })
})
