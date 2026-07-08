import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimelineStore } from '../../timeline/timeline-store'
import {
  applySerializedFieldValue,
  isSerializedExpression,
  NumberField,
  StringField,
} from '../fields'
import { NumberOp } from '../operators'
import { clearOps, setOp } from '../store'
import { evaluateFieldExpression, preprocessExpression } from './field-expressions'
import { applyOperatorInputs, captureOperatorInputs } from './property-history'

// Flush pending microtasks (the test setup uses fake timers, so setTimeout won't fire)
const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('field expression mode', () => {
  beforeEach(() => {
    clearOps()
  })

  describe('setExpression / clearExpression', () => {
    it('evaluates a literal expression immediately', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('2 + 3')
      expect(op.inputs.val.value).toEqual(5)
      expect(op.inputs.val.expression).toEqual('2 + 3')
      expect(op.inputs.val.expressionError$.value).toBeNull()
    })

    it('keeps the last evaluated value after clearExpression', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('40 + 2')
      expect(op.inputs.val.value).toEqual(42)
      op.inputs.val.clearExpression()
      expect(op.inputs.val.expression).toBeNull()
      expect(op.inputs.val.value).toEqual(42)
    })

    it('setValue does not exit expression mode but updates the value', () => {
      // Literal writes while driven are allowed (e.g. timeline bindings); the next
      // evaluation overwrites them
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('10')
      op.inputs.val.setValue(99)
      expect(op.inputs.val.value).toEqual(99)
      op.inputs.val.evaluateExpression()
      expect(op.inputs.val.value).toEqual(10)
    })

    it('supports math utilities and Math global', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('Math.max(1, 7) + d3.mean([1, 2, 3])')
      expect(op.inputs.val.value).toEqual(9)
    })
  })

  describe('cross-operator references', () => {
    it('references another operator output with op()', () => {
      const source = new NumberOp('/source')
      source.outputs.val.setValue(21)
      setOp('/source', source)

      const target = new NumberOp('/target')
      target.inputs.val.setExpression("op('/source').out.val * 2")
      expect(target.inputs.val.value).toEqual(42)
    })

    it('references another operator with mustache syntax', () => {
      const source = new NumberOp('/source')
      source.outputs.val.setValue(10)
      setOp('/source', source)

      const target = new NumberOp('/target')
      target.inputs.val.setExpression('{{/source.out.val}} + 1')
      expect(target.inputs.val.value).toEqual(11)
    })

    it('re-evaluates when a referenced field emits through a reference connection', () => {
      const source = new NumberOp('/source')
      source.outputs.val.setValue(5)
      setOp('/source', source)

      const target = new NumberOp('/target')
      target.inputs.val.setExpression("op('/source').out.val + 100")
      expect(target.inputs.val.value).toEqual(105)

      // transform-graph wires ReferenceEdges as 'reference' connections like this
      target.inputs.val.addConnection('ref-edge-1', source.outputs.val, 'reference')

      source.outputs.val.setValue(50)
      expect(target.inputs.val.value).toEqual(150)
    })

    it('reports an error for unknown operator paths', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setValue(7)
      op.inputs.val.setExpression("op('/does-not-exist').out.val")
      expect(op.inputs.val.expressionError$.value).toMatch(/not found/)
      // Value falls back to the last good value
      expect(op.inputs.val.value).toEqual(7)
    })
  })

  describe('sibling parameter references', () => {
    // NumberOp only has one input, so build a small two-input op for sibling tests
    class TwoFieldOp extends NumberOp {
      createInputs() {
        return {
          val: new NumberField(0, { step: 1 }),
          other: new NumberField(3, { step: 1 }),
        }
      }
    }

    it('reads sibling values via par', () => {
      const op = new TwoFieldOp('/two')
      setOp('/two', op)
      op.inputs.val.setExpression('par.other * 10')
      expect(op.inputs.val.value).toEqual(30)
    })

    it('re-evaluates when the sibling changes', () => {
      const op = new TwoFieldOp('/two')
      setOp('/two', op)
      op.inputs.val.setExpression('par.other + 1')
      expect(op.inputs.val.value).toEqual(4)

      op.inputs.other.setValue(10)
      expect(op.inputs.val.value).toEqual(11)
    })

    it('supports the {{par.field}} shorthand', () => {
      const op = new TwoFieldOp('/two')
      setOp('/two', op)
      op.inputs.val.setExpression('{{par.other}} * 2')
      expect(op.inputs.val.value).toEqual(6)

      op.inputs.other.setValue(5)
      expect(op.inputs.val.value).toEqual(10)
    })

    it('does not loop on self-references', () => {
      const op = new TwoFieldOp('/two')
      setOp('/two', op)
      op.inputs.val.setValue(1)
      // References its own value: evaluates once per trigger instead of spinning
      op.inputs.val.setExpression('par.val + 1')
      expect(op.inputs.val.value).toEqual(2)
    })

    it('does not stack-overflow on mutual sibling references', () => {
      const op = new TwoFieldOp('/two')
      setOp('/two', op)
      op.inputs.val.setExpression('par.other + 1')
      // Divergent circular arithmetic: without the re-entrancy guard this recurses
      // synchronously until the stack overflows
      expect(() => op.inputs.other.setExpression('par.val + 1')).not.toThrow()
      expect(Number.isFinite(op.inputs.val.value as number)).toBe(true)
      expect(Number.isFinite(op.inputs.other.value as number)).toBe(true)

      // Each change still propagates one pass around the cycle and settles
      op.inputs.other.setValue(10)
      expect(op.inputs.val.value).toEqual(11)
    })

    it('does not stack-overflow on cross-op reference cycles', () => {
      const a = new NumberOp('/a')
      const b = new NumberOp('/b')
      setOp('/a', a)
      setOp('/b', b)
      a.inputs.val.setExpression("op('/b').par.val + 1")
      b.inputs.val.setExpression("op('/a').par.val + 1")
      // Wire the reference connections both ways, as transform-graph would
      a.inputs.val.addConnection('ref-b-a', b.inputs.val, 'reference')
      expect(() => b.inputs.val.addConnection('ref-a-b', a.inputs.val, 'reference')).not.toThrow()
      expect(Number.isFinite(a.inputs.val.value as number)).toBe(true)
      expect(Number.isFinite(b.inputs.val.value as number)).toBe(true)
    })

    it('cleans up sibling subscriptions on clearExpression', () => {
      const op = new TwoFieldOp('/two')
      setOp('/two', op)
      op.inputs.val.setExpression('par.other + 1')
      expect(op.inputs.val.expressionCleanup).not.toBeNull()
      op.inputs.val.clearExpression()
      expect(op.inputs.val.expressionCleanup).toBeNull()

      const before = op.inputs.val.value
      op.inputs.other.setValue(500)
      expect(op.inputs.val.value).toEqual(before)
    })
  })

  describe('timeline references', () => {
    it('evaluates and re-evaluates on timeline position changes', () => {
      useTimelineStore.getState().setPosition(0)
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('sequenceTime * 10')
      expect(op.inputs.val.value).toEqual(0)

      useTimelineStore.getState().setPosition(2)
      expect(op.inputs.val.value).toEqual(20)

      op.inputs.val.clearExpression()
      useTimelineStore.getState().setPosition(0)
      expect(op.inputs.val.value).toEqual(20)
    })
  })

  describe('error handling', () => {
    it('reports syntax errors without changing the value', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setValue(1)
      op.inputs.val.setExpression('2 +')
      expect(op.inputs.val.expressionError$.value).toBeTruthy()
      expect(op.inputs.val.value).toEqual(1)
    })

    it('reports schema mismatches without changing the value', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setValue(1)
      op.inputs.val.setExpression("'not a number'")
      expect(op.inputs.val.expressionError$.value).toMatch(/doesn't fit/)
      expect(op.inputs.val.value).toEqual(1)
    })

    it('recovers after the expression is fixed', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('2 +')
      expect(op.inputs.val.expressionError$.value).toBeTruthy()
      op.inputs.val.setExpression('2 + 2')
      expect(op.inputs.val.expressionError$.value).toBeNull()
      expect(op.inputs.val.value).toEqual(4)
    })
  })

  describe('async expressions', () => {
    it('applies resolved promise values', async () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('await Promise.resolve(123)')
      await flushMicrotasks()
      expect(op.inputs.val.value).toEqual(123)
    })

    it('ignores stale async results', async () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('await new Promise(r => setTimeout(() => r(1), 20))')
      op.inputs.val.setExpression('7')
      expect(op.inputs.val.value).toEqual(7)
      await vi.advanceTimersByTimeAsync(40)
      expect(op.inputs.val.value).toEqual(7)
    })
  })

  describe('serialization', () => {
    it('serializes the expression instead of the value', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('1 + 1')
      expect(op.inputs.val.serialize()).toEqual({ $expr: '1 + 1' })
      expect(isSerializedExpression(op.inputs.val.serialize())).toBe(true)
    })

    it('round-trips through applySerializedFieldValue', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('6 * 7')
      const serialized = op.inputs.val.serialize()

      const restored = new NumberOp('/num2')
      applySerializedFieldValue(restored.inputs.val, serialized)
      expect(restored.inputs.val.expression).toEqual('6 * 7')
      expect(restored.inputs.val.value).toEqual(42)
    })

    it('clears expression mode when a plain value is applied', () => {
      const op = new NumberOp('/num')
      op.inputs.val.setExpression('6 * 7')
      applySerializedFieldValue(op.inputs.val, 5)
      expect(op.inputs.val.expression).toBeNull()
      expect(op.inputs.val.value).toEqual(5)
    })

    it('applies { $expr } payloads passed to the Operator constructor', () => {
      const op = new NumberOp('/num', { val: { $expr: '10 + 5' } } as never)
      expect(op.inputs.val.expression).toEqual('10 + 5')
      expect(op.inputs.val.value).toEqual(15)
    })

    it('round-trips through property history capture/apply', () => {
      const op = new NumberOp('/num')
      setOp('/num', op)
      op.inputs.val.setExpression('2 ** 5')
      const snapshot = captureOperatorInputs()
      expect(snapshot).toBeTruthy()

      op.inputs.val.clearExpression()
      op.inputs.val.setValue(1)

      applyOperatorInputs(snapshot as string)
      expect(op.inputs.val.expression).toEqual('2 ** 5')
      expect(op.inputs.val.value).toEqual(32)

      // And undo the other way: snapshot of the literal state restores literal mode
      const literalOp = new NumberOp('/lit')
      setOp('/lit', literalOp)
      literalOp.inputs.val.setValue(3)
      const literalSnapshot = captureOperatorInputs() as string
      literalOp.inputs.val.setExpression('100')
      applyOperatorInputs(literalSnapshot)
      expect(literalOp.inputs.val.expression).toBeNull()
      expect(literalOp.inputs.val.value).toEqual(3)
    })
  })

  describe('preprocessExpression', () => {
    it('rewrites mustache references to op() calls', () => {
      expect(preprocessExpression('{{/a.out.val}} + {{par.x}}', '/self')).toEqual(
        "op('/a').out.val + op('/self').par.x"
      )
    })
  })

  describe('string fields', () => {
    it('drives string fields with template literals', () => {
      const source = new NumberOp('/source')
      source.outputs.val.setValue(3)
      setOp('/source', source)

      const field = new StringField('')
      const op = new NumberOp('/holder')
      field.op = op
      field.pathToProps = ['/holder', 'par', 'label']
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the template literal is intentionally inside the expression source
      field.setExpression("`count: ${op('/source').out.val}`")
      expect(field.value).toEqual('count: 3')
    })
  })

  describe('evaluateFieldExpression direct call', () => {
    it('is a no-op for fields in literal mode', () => {
      const field = new NumberField(5)
      evaluateFieldExpression(field)
      expect(field.value).toEqual(5)
      expect(field.expressionError$.value).toBeNull()
    })
  })
})
