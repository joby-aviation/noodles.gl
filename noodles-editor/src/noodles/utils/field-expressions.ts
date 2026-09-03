// Field expression engine — evaluates per-field "driver" expressions (TouchDesigner/Houdini
// expressions, Blender drivers). Any input field can be switched into expression mode where
// its value is computed from a JavaScript expression referencing other operators.
//
// Reactivity model:
// - Cross-op refs (`op('/x').out.val`, `{{/x.out.val}}`) become graph-model-owned
//   ReferenceEdges, which are wired as 'reference' connections. When the referenced field
//   emits, Field.addConnection calls evaluateExpression on the driven field.
// - Bare sibling refs (`par.foo`) are subscribed to directly here — siblings share the owning
//   operator's lifecycle, so these subscriptions can't go stale across renames/deletes.
// - Timeline refs (`sequenceTime`, `frame`, ...) subscribe to the timeline store.
//
// Registered into fields.ts via registerFieldExpressionEvaluator to avoid an import cycle.

import { skip } from 'rxjs/operators'
import { useTimelineStore } from '../../timeline/timeline-store'
import { debugSetValue } from '../../utils/debug'
import {
  type Field,
  mustacheRe,
  registerFieldExpressionEvaluator,
  selfParMustacheRe,
} from '../fields'
import { safeMode } from '../globals'
import { fnWithSource, freeExports } from '../operators'
import { getOp } from '../store'
import { getEnableExpressionDependencies } from './enable-expression-evaluator'
import { getTimelineContext } from './timeline-context'

const TIMELINE_IDENTIFIER_RE = /\b(?:sequenceTime|frame|totalFrames|sequence)\b/

// Monotonic token per field so late-resolving async evaluations can't clobber newer results
const evaluationTokens = new WeakMap<Field, number>()

// Fields currently being evaluated on this call stack. BehaviorSubject emissions are
// synchronous, so circular references (a: `par.b + 1`, b: `par.a + 1` — or longer cycles
// through cross-op reference connections) would otherwise recurse until the stack
// overflows. A field already evaluating higher up the stack skips re-entry: each change
// propagates one pass around the cycle and settles.
const evaluating = new Set<Field>()

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  if (keysA.length !== keysB.length) return false
  return keysA.every(k =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  )
}

// Replace mustache sugar ({{/path.out.val}}, {{par.field}}) with op() calls, matching CodeOp
export function preprocessExpression(expr: string, opId: string): string {
  return expr
    .trim()
    .replace(selfParMustacheRe, (_match, _inOut, fieldPath) => `op('${opId}').par.${fieldPath}`)
    .replace(
      mustacheRe,
      (_match, refOpId, inOut, fieldPath) => `op('${refOpId}').${inOut}.${fieldPath}`
    )
}

function applyResult(field: Field, result: unknown): void {
  let parsed = field.schema.safeParse(result)
  if (!parsed.success) {
    // Transformed fields parse input-space values (e.g. ColorField parses '#ffffffff'
    // and transforms to [r,g,b,a]), but expressions naturally produce value-space
    // results like [255, 255, 255, 255]. The field's static deserialize already maps
    // value space back to input space (colorToHex for ColorField), so retry through it.
    const ctor = field.constructor as typeof Field & { deserialize(value: unknown): unknown }
    try {
      const deserialized = ctor.deserialize(result)
      if (deserialized !== result) {
        parsed = field.schema.safeParse(deserialized)
      }
    } catch {
      // Fall through with the original parse error
    }
  }
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    field.expressionError$.next(
      `Expression result doesn't fit this field: ${issue?.message ?? 'invalid value'}`
    )
    return
  }
  field.expressionError$.next(null)
  // Skip the emit when the value is unchanged so self-referencing expressions
  // (e.g. `par.radius + 1` driving another sibling) converge instead of looping
  if (deepEqual(field.value, parsed.data)) return
  field.next(parsed.data)
  field.op?.markDirty()
}

export function evaluateFieldExpression(field: Field): void {
  const expr = field.expression
  if (expr === null) return
  if (expr.trim() === '') {
    field.expressionError$.next(null)
    return
  }
  // Field expressions are arbitrary JS, same trust model as CodeOp — safe mode must
  // block them too. The field keeps its last value; the error explains why it's stale.
  if (safeMode) {
    field.expressionError$.next('Expression evaluation is disabled in safe mode')
    return
  }
  if (evaluating.has(field)) return
  evaluating.add(field)
  try {
    evaluateGuarded(field, expr)
  } finally {
    evaluating.delete(field)
  }
}

function evaluateGuarded(field: Field, expr: string): void {
  const op = field.op
  const opId = op?.id ?? ''
  const fieldPath = field.pathToProps.join('.')

  ensureReactiveSubscriptions(field, expr)

  const token = (evaluationTokens.get(field) ?? 0) + 1
  evaluationTokens.set(field, token)

  try {
    const processed = preprocessExpression(expr, opId)
    const fn = fnWithSource(
      [
        'op',
        'par',
        'me',
        'sequenceTime',
        'frame',
        'totalFrames',
        'sequence',
        ...Object.keys(freeExports),
      ],
      `return (${processed})`,
      `${fieldPath} expression`
    )
    const safeOp = (path: string) => {
      const target = getOp(path, opId)
      if (!target) {
        throw new Error(`Operator '${path}' not found`)
      }
      return target
    }
    const timeline = getTimelineContext()
    const result = fn(
      safeOp,
      op?.par,
      op,
      timeline.sequenceTime,
      timeline.frame,
      timeline.totalFrames,
      timeline.sequence,
      ...Object.values(freeExports)
    )

    if (result instanceof Promise) {
      result
        .then(resolved => {
          if (evaluationTokens.get(field) === token && field.expression === expr) {
            applyResult(field, resolved)
          }
        })
        .catch((err: unknown) => {
          if (evaluationTokens.get(field) === token && field.expression === expr) {
            field.expressionError$.next(err instanceof Error ? err.message : String(err))
          }
        })
      return
    }

    applyResult(field, result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    debugSetValue('%s expression error: %s', fieldPath, message)
    field.expressionError$.next(message)
  }
}

// Set up the subscriptions the reference-edge machinery can't provide: bare `par.x`
// sibling references and timeline identifiers. Idempotent per (field, expression) —
// Field.setExpression clears the previous cleanup before calling the evaluator.
function ensureReactiveSubscriptions(field: Field, expr: string): void {
  if (field.expressionCleanup) return

  const cleanups: Array<() => void> = []
  // Assign eagerly (closure sees later pushes) so re-entrant evaluations during setup
  // don't double-subscribe
  field.expressionCleanup = () => {
    for (const cleanup of cleanups) cleanup()
    field.expressionCleanup = null
  }

  // Same-op references: bare `par.x` plus op()/mustache forms that resolve back to the
  // owning operator (e.g. `{{par.x}}` preprocesses to `op('/self').par.x`). These share
  // the op's lifecycle so direct subscriptions are safe. Cross-op refs are handled by
  // ReferenceEdges instead.
  const processed = preprocessExpression(expr, field.op?.id ?? '')
  const owner = field.op
  const seen = new Set<Field>()
  for (const dep of getEnableExpressionDependencies(processed)) {
    let target: Field | undefined
    if (dep.type === 'local-par') {
      target = owner?.inputs?.[dep.field] as Field | undefined
    } else if (dep.opPath && owner && getOp(dep.opPath, owner.id) === owner) {
      const fields = dep.type === 'remote-par' ? owner.inputs : owner.outputs
      target = fields?.[dep.field] as Field | undefined
    }
    // Never subscribe a field to itself — a driven field referencing its own value
    // would re-trigger forever
    if (!target || target === field || seen.has(target)) continue
    seen.add(target)
    // skip(1) drops the BehaviorSubject replay of the current value — the initial
    // evaluation is about to happen in evaluateFieldExpression anyway
    const sub = target.pipe(skip(1)).subscribe(() => {
      if (field.expression !== null) evaluateFieldExpression(field)
    })
    cleanups.push(() => sub.unsubscribe())
  }

  if (TIMELINE_IDENTIFIER_RE.test(processed)) {
    const unsub = useTimelineStore.subscribe(
      state => ({
        position: state.position,
        fps: state.sequence.fps,
        length: state.sequence.length,
      }),
      () => {
        if (field.expression !== null) evaluateFieldExpression(field)
      },
      {
        equalityFn: (a, b) => a.position === b.position && a.fps === b.fps && a.length === b.length,
      }
    )
    cleanups.push(unsub)
  }
}

registerFieldExpressionEvaluator(evaluateFieldExpression)
