import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { DateFormatOp, DateMathOp, DatePartsOp } from './operators'
import { isAccessor } from './utils/accessor-helpers'

const dt = (s: string) => Temporal.PlainDateTime.from(s)

type Accessor<T> = (d: { when: Temporal.PlainDateTime }) => T

describe('DateMathOp', () => {
  const base = {
    date: dt('2026-04-30T12:00:00'),
    dateB: dt('2026-04-30T12:00:00'),
    amount: 1,
    unit: 'days',
    t: 0,
  }

  it('adds and subtracts durations', () => {
    const op = new DateMathOp('/date-math')
    const added = op.execute({ ...base, operator: 'add', amount: 2, unit: 'weeks' })
    expect(String(added.result)).toBe('2026-05-14T12:00:00')

    const subtracted = op.execute({ ...base, operator: 'subtract', amount: 3, unit: 'hours' })
    expect(String(subtracted.result)).toBe('2026-04-30T09:00:00')
  })

  it('keeps the fraction in difference', () => {
    const op = new DateMathOp('/date-math')
    const result = op.execute({
      ...base,
      operator: 'difference',
      dateB: dt('2026-05-01T00:00:00'),
      unit: 'days',
    })
    expect(result.result).toBe(0.5)
  })

  it('measures difference in calendar units', () => {
    const op = new DateMathOp('/date-math')
    const result = op.execute({
      ...base,
      operator: 'difference',
      date: dt('2026-01-31T00:00:00'),
      dateB: dt('2026-03-31T00:00:00'),
      unit: 'months',
    })
    expect(result.result).toBe(2)
  })

  it('returns a negative difference when dateB is earlier', () => {
    const op = new DateMathOp('/date-math')
    const result = op.execute({
      ...base,
      operator: 'difference',
      dateB: dt('2026-04-30T09:00:00'),
      unit: 'hours',
    })
    expect(result.result).toBe(-3)
  })

  it('compares dates', () => {
    const op = new DateMathOp('/date-math')
    const later = dt('2026-05-01T12:00:00')
    expect(op.execute({ ...base, operator: 'isBefore', dateB: later }).result).toBe(true)
    expect(op.execute({ ...base, operator: 'isAfter', dateB: later }).result).toBe(false)
    expect(op.execute({ ...base, operator: 'equals' }).result).toBe(true)
  })

  it('interpolates and clamps t', () => {
    const op = new DateMathOp('/date-math')
    const dateB = dt('2026-05-01T12:00:00')
    const half = op.execute({ ...base, operator: 'interpolate', dateB, t: 0.5 })
    expect(String(half.result)).toBe('2026-05-01T00:00:00')

    const past = op.execute({ ...base, operator: 'interpolate', dateB, t: 2 })
    expect(String(past.result)).toBe('2026-05-01T12:00:00')
  })

  it('returns an accessor when the date is an accessor', () => {
    const op = new DateMathOp('/date-math')
    const result = op.execute({
      ...base,
      operator: 'add',
      date: (d: { when: Temporal.PlainDateTime }) => d.when,
    })
    expect(isAccessor(result.result)).toBe(true)
    const fn = result.result as Accessor<Temporal.PlainDateTime>
    expect(String(fn({ when: dt('2026-01-01T00:00:00') }))).toBe('2026-01-02T00:00:00')
  })

  it('returns an accessor when amount is an accessor', () => {
    const op = new DateMathOp('/date-math')
    const result = op.execute({
      ...base,
      operator: 'add',
      amount: (d: { n: number }) => d.n,
    })
    const fn = result.result as (d: { n: number }) => Temporal.PlainDateTime
    expect(String(fn({ n: 3 }))).toBe('2026-05-03T12:00:00')
  })

  it('ignores accessors on inputs the operator does not read', () => {
    const op = new DateMathOp('/date-math')
    const result = op.execute({
      ...base,
      operator: 'add',
      dateB: (d: { when: Temporal.PlainDateTime }) => d.when,
      t: () => 0.5,
    })
    expect(isAccessor(result.result)).toBe(false)
  })

  it('shows only the inputs the operator uses', () => {
    const op = new DateMathOp('/date-math')
    expect(op.isFieldVisible('amount')).toBe(true)
    expect(op.isFieldVisible('dateB')).toBe(false)

    op.inputs.operator.setValue('difference')
    expect(op.isFieldVisible('dateB')).toBe(true)
    expect(op.isFieldVisible('unit')).toBe(true)
    expect(op.isFieldVisible('amount')).toBe(false)
    expect(op.isFieldVisible('t')).toBe(false)

    op.inputs.operator.setValue('interpolate')
    expect(op.isFieldVisible('t')).toBe(true)
    expect(op.isFieldVisible('unit')).toBe(false)
  })
})

describe('DatePartsOp', () => {
  it('splits a date into components', () => {
    const op = new DatePartsOp('/date-parts')
    const parts = op.execute({ date: dt('2026-04-30T15:45:30.250') })
    expect(parts).toEqual({
      year: 2026,
      month: 4,
      day: 30,
      hour: 15,
      minute: 45,
      second: 30,
      millisecond: 250,
      dayOfWeek: 4,
      dayOfYear: 120,
      weekOfYear: 18,
    })
  })

  it('returns an accessor for each part when the date is an accessor', () => {
    const op = new DatePartsOp('/date-parts')
    const parts = op.execute({ date: (d: { when: Temporal.PlainDateTime }) => d.when })
    const item = { when: dt('2024-12-25T09:30:00') }
    expect((parts.year as unknown as Accessor<number>)(item)).toBe(2024)
    expect((parts.month as unknown as Accessor<number>)(item)).toBe(12)
    expect((parts.hour as unknown as Accessor<number>)(item)).toBe(9)
  })
})

describe('DateFormatOp', () => {
  const date = dt('2026-04-05T09:07:03.040')

  it('formats with tokens', () => {
    const op = new DateFormatOp('/date-format')
    expect(op.execute({ date, pattern: 'YYYY-MM-DD HH:mm:ss.SSS' }).text).toBe(
      '2026-04-05 09:07:03.040'
    )
  })

  it('replaces every occurrence of a token', () => {
    const op = new DateFormatOp('/date-format')
    expect(op.execute({ date, pattern: 'MM/DD (MM)' }).text).toBe('04/05 (04)')
  })

  it('falls back to ISO 8601 for an empty pattern', () => {
    const op = new DateFormatOp('/date-format')
    expect(op.execute({ date, pattern: '' }).text).toBe('2026-04-05T09:07:03.04')
  })

  it('returns an accessor when the date is an accessor', () => {
    const op = new DateFormatOp('/date-format')
    const { text } = op.execute({
      date: (d: { when: Temporal.PlainDateTime }) => d.when,
      pattern: 'YYYY',
    })
    expect((text as unknown as Accessor<string>)({ when: date })).toBe('2026')
  })
})
