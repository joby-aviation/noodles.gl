import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberOp } from '../operators'
import { clearOps } from '../store'

// Safe mode is read once at module load in globals.ts, so it's mocked at the module
// level here — hence a separate test file from field-expressions.test.ts, where every
// test needs expressions to actually evaluate.
vi.mock('../globals', async importOriginal => ({
  ...(await importOriginal<typeof import('../globals')>()),
  safeMode: true,
}))

describe('field expressions in safe mode', () => {
  beforeEach(() => {
    clearOps()
  })

  it('does not evaluate expressions and surfaces an error instead', () => {
    const op = new NumberOp('/num')
    op.inputs.val.setValue(7)
    op.inputs.val.setExpression('2 + 3')

    expect(op.inputs.val.value).toEqual(7)
    expect(op.inputs.val.expression).toEqual('2 + 3')
    expect(op.inputs.val.expressionError$.value).toMatch(/safe mode/)
  })

  it('keeps the expression serialized so clearing safe mode restores it', () => {
    const op = new NumberOp('/num')
    op.inputs.val.setExpression('40 + 2')

    expect(op.inputs.val.serialize()).toEqual({ $expr: '40 + 2' })
  })
})
