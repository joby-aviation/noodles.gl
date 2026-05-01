import { Temporal } from 'temporal-polyfill'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateMathOp, DateTimeOp } from './operators'
import { setOp } from './store'

describe('DateMathOp Timeline Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('works with DateTimeOp to create date math pipelines', async () => {
    const baseDateOp = new DateTimeOp('/base-date')
    const dateMathOp = new DateMathOp('/date-math')

    setOp(baseDateOp.id, baseDateOp)
    setOp(dateMathOp.id, dateMathOp)

    baseDateOp.inputs.date.setValue(Temporal.PlainDateTime.from('2026-01-01T00:00:00'))

    dateMathOp.inputs.operator.setValue('add')
    dateMathOp.inputs.duration.setValue({ value: 1, unit: 'days' })

    await baseDateOp.pull()

    dateMathOp.inputs.date.setValue(baseDateOp.outputData.date)
    await dateMathOp.pull()

    expect(dateMathOp.outputData.result.toString()).toBe('2026-01-02T00:00:00')

    dateMathOp.inputs.duration.setValue({ value: 5, unit: 'days' })
    await dateMathOp.pull()

    expect(dateMathOp.outputData.result.toString()).toBe('2026-01-06T00:00:00')
  })

  it('chains multiple DateMathOps together', async () => {
    const baseDateOp = new DateTimeOp('/base-date')
    const addDaysOp = new DateMathOp('/add-days')
    const subtractHoursOp = new DateMathOp('/subtract-hours')

    setOp(baseDateOp.id, baseDateOp)
    setOp(addDaysOp.id, addDaysOp)
    setOp(subtractHoursOp.id, subtractHoursOp)

    baseDateOp.inputs.date.setValue(Temporal.PlainDateTime.from('2026-01-01T12:00:00'))

    addDaysOp.inputs.operator.setValue('add')
    addDaysOp.inputs.duration.setValue({ value: 7, unit: 'days' })

    subtractHoursOp.inputs.operator.setValue('subtract')
    subtractHoursOp.inputs.duration.setValue({ value: 3, unit: 'hours' })

    await baseDateOp.pull()

    addDaysOp.inputs.date.setValue(baseDateOp.outputData.date)
    await addDaysOp.pull()

    subtractHoursOp.inputs.date.setValue(addDaysOp.outputData.result)
    await subtractHoursOp.pull()

    expect(subtractHoursOp.outputData.result.toString()).toBe('2026-01-08T09:00:00')
  })

  it('uses DateMathOp for comparison in data pipelines', async () => {
    const date1Op = new DateTimeOp('/date1')
    const date2Op = new DateTimeOp('/date2')
    const compareOp = new DateMathOp('/compare')

    setOp(date1Op.id, date1Op)
    setOp(date2Op.id, date2Op)
    setOp(compareOp.id, compareOp)

    date1Op.inputs.date.setValue(Temporal.PlainDateTime.from('2026-04-30T12:00:00'))
    date2Op.inputs.date.setValue(Temporal.PlainDateTime.from('2026-05-01T12:00:00'))

    compareOp.inputs.operator.setValue('isBefore')

    await date1Op.pull()
    await date2Op.pull()

    compareOp.inputs.date.setValue(date1Op.outputData.date)
    compareOp.inputs.dateB.setValue(date2Op.outputData.date)
    await compareOp.pull()

    expect(compareOp.outputData.result).toBe(true)

    date1Op.inputs.date.setValue(Temporal.PlainDateTime.from('2026-05-02T12:00:00'))
    await date1Op.pull()

    compareOp.inputs.date.setValue(date1Op.outputData.date)
    await compareOp.pull()

    expect(compareOp.outputData.result).toBe(false)
  })

  it('extracts date components for visualization', async () => {
    const dateOp = new DateTimeOp('/date')
    const yearOp = new DateMathOp('/year')
    const monthOp = new DateMathOp('/month')
    const dayOp = new DateMathOp('/day')

    setOp(dateOp.id, dateOp)
    setOp(yearOp.id, yearOp)
    setOp(monthOp.id, monthOp)
    setOp(dayOp.id, dayOp)

    dateOp.inputs.date.setValue(Temporal.PlainDateTime.from('2026-04-30T15:45:30'))

    yearOp.inputs.operator.setValue('year')
    monthOp.inputs.operator.setValue('month')
    dayOp.inputs.operator.setValue('day')

    await dateOp.pull()

    yearOp.inputs.date.setValue(dateOp.outputData.date)
    monthOp.inputs.date.setValue(dateOp.outputData.date)
    dayOp.inputs.date.setValue(dateOp.outputData.date)

    await yearOp.pull()
    await monthOp.pull()
    await dayOp.pull()

    expect(yearOp.outputData.result).toBe(2026)
    expect(monthOp.outputData.result).toBe(4)
    expect(dayOp.outputData.result).toBe(30)
  })

  it('formats dates for display', async () => {
    const dateOp = new DateTimeOp('/date')
    const formatOp = new DateMathOp('/format')

    setOp(dateOp.id, dateOp)
    setOp(formatOp.id, formatOp)

    dateOp.inputs.date.setValue(Temporal.PlainDateTime.from('2026-12-25T09:30:45'))

    formatOp.inputs.operator.setValue('format')
    formatOp.inputs.formatString.setValue('YYYY-MM-DD HH:mm:ss')

    await dateOp.pull()

    formatOp.inputs.date.setValue(dateOp.outputData.date)
    await formatOp.pull()

    expect(formatOp.outputData.result).toBe('2026-12-25 09:30:45')
  })

  it('calculates time differences for analytics', async () => {
    const startOp = new DateTimeOp('/start')
    const endOp = new DateTimeOp('/end')
    const diffOp = new DateMathOp('/diff')

    setOp(startOp.id, startOp)
    setOp(endOp.id, endOp)
    setOp(diffOp.id, diffOp)

    startOp.inputs.date.setValue(Temporal.PlainDateTime.from('2026-01-01T00:00:00'))
    endOp.inputs.date.setValue(Temporal.PlainDateTime.from('2026-01-15T12:00:00'))

    diffOp.inputs.operator.setValue('difference')
    diffOp.inputs.duration.setValue({ value: 0, unit: 'days' })

    await startOp.pull()
    await endOp.pull()

    diffOp.inputs.date.setValue(startOp.outputData.date)
    diffOp.inputs.dateB.setValue(endOp.outputData.date)
    await diffOp.pull()

    expect(diffOp.outputData.result).toBe(14)

    diffOp.inputs.duration.setValue({ value: 0, unit: 'hours' })
    await diffOp.pull()

    expect(diffOp.outputData.result).toBe(348)
  })
})
