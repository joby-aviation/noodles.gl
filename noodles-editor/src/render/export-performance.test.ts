import { beforeEach, describe, expect, it } from 'vitest'
import type { OutOp } from '../noodles/operators'
import { clearOps } from '../noodles/store'

// Export render settings on OutOp. To see real export timing, set
// localStorage.debug = 'noodles:render*' in the browser console and run an export.

describe('Export render settings', () => {
  beforeEach(() => {
    clearOps()
  })

  it('should allow captureDelay to be configured', async () => {
    // Verify that captureDelay field exists on OutOp and accepts valid values
    const { OutOp } = await import('../noodles/operators')
    const outOp = new OutOp('/out') as OutOp

    // Default should be 50ms
    expect(outOp.inputs.captureDelay.value).toBe(50)

    // Should accept values in range 0-10000
    outOp.inputs.captureDelay.setValue(0)
    expect(outOp.inputs.captureDelay.value).toBe(0)

    outOp.inputs.captureDelay.setValue(100)
    expect(outOp.inputs.captureDelay.value).toBe(100)

    outOp.inputs.captureDelay.setValue(500)
    expect(outOp.inputs.captureDelay.value).toBe(500)
  })

  it('should allow waitForData to be configured', async () => {
    const { OutOp } = await import('../noodles/operators')
    const outOp = new OutOp('/out') as OutOp

    // Default should be true
    expect(outOp.inputs.waitForData.value).toBe(true)

    // Should accept boolean values
    outOp.inputs.waitForData.setValue(false)
    expect(outOp.inputs.waitForData.value).toBe(false)

    outOp.inputs.waitForData.setValue(true)
    expect(outOp.inputs.waitForData.value).toBe(true)
  })
})
