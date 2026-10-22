// A Noodles Field for each parameter of a document node, so the editor's field widgets edit
// documents. A field mirrors its parameter both ways: a widget's `setValue` writes the
// document (one undo step per gesture), and a document change (undo, an AI edit, a keyframe)
// sets the field.
//
// Host operators' parameters are their own Noodles fields, built by the operator class. The
// planner's parameter kinds map onto the field types whose widgets fit them.

import {
  type DocNode,
  isExpr,
  isRef,
  OPERATOR_INDEX,
  type ParamDef,
  type ParamValue,
} from '@noodles.gl/planner'
import {
  applySerializedFieldValue,
  BooleanField,
  CodeField,
  ColorField,
  type Field,
  NumberField,
  StringField,
  StringLiteralField,
} from '../noodles/fields'
import { type IOperator, type Operator, opTypes } from '../noodles/operators'
import { setParam } from './doc-ops'
import type { DocStore } from './doc-store'

type AnyField = Field
type OperatorClass = new (id: string, data?: unknown, locked?: boolean) => Operator<IOperator>

const hex = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')

/** A planner color, `[r, g, b]` 0–255, as a field's `#rrggbb`. */
export const colorToFieldHex = (rgb: unknown): string =>
  Array.isArray(rgb)
    ? `#${rgb.slice(0, 3).map(Number).map(hex).join('')}`
    : String(rgb ?? '#ffffff')

/** A field's `#rrggbb[aa]` as a planner color. */
export const fieldHexToColor = (value: string): number[] => {
  const h = value.replace(/^#/, '')
  return [0, 2, 4].map(i => Number.parseInt(h.slice(i, i + 2), 16) || 0)
}

/** A field for one of the planner's parameter kinds. */
function plannerField(def: ParamDef): AnyField {
  const range = { min: def.min, max: def.max, step: def.step }
  switch (def.kind) {
    case 'float':
      return new NumberField(Number(def.default ?? 0), range) as unknown as AnyField
    case 'int':
      return new NumberField(Number(def.default ?? 0), {
        ...range,
        step: def.step ?? 1,
      }) as unknown as AnyField
    case 'toggle':
      return new BooleanField(Boolean(def.default)) as unknown as AnyField
    case 'menu':
      return new StringLiteralField(
        String(def.default ?? ''),
        (def.options ?? []).map(o => ({ value: String(o.value), label: o.label }))
      ) as unknown as AnyField
    case 'color':
      return new ColorField(colorToFieldHex(def.default)) as unknown as AnyField
    case 'code':
      return new CodeField(String(def.default ?? ''), {
        language: def.language === 'sql' ? 'sql' : 'javascript',
      }) as unknown as AnyField
    default:
      // string, text, url, expr, column: text the planner reads.
      return new StringField(String(def.default ?? '')) as unknown as AnyField
  }
}

/** A planner parameter's document value as a field value. */
function toFieldValue(def: ParamDef, value: ParamValue | undefined): unknown {
  const v = value ?? (def.default as ParamValue)
  if (def.kind === 'color') return colorToFieldHex(v)
  if (def.kind === 'float' || def.kind === 'int') return Number(v ?? 0)
  if (def.kind === 'toggle') return v === true || v === 'true' || v === 1
  return typeof v === 'string' ? v : String(v ?? '')
}

/** A field value as the planner parameter's document value. */
function fromFieldValue(def: ParamDef, value: unknown): ParamValue {
  if (def.kind === 'color') return fieldHexToColor(String(value))
  return value as ParamValue
}

export interface ParamBinding {
  def: ParamDef
  field: AnyField
  /** An expression or a reference drives the parameter; the widget shows it read-only. */
  driven?: string
}

/** The fields of one node, kept in step with its parameters while the node is shown. */
export class NodeFields {
  readonly bindings = new Map<string, ParamBinding>()
  private readonly host?: Operator<IOperator>
  private readonly written = new Map<string, string>()
  private readonly subscriptions: { unsubscribe(): void }[] = []
  private applying = false

  constructor(
    private readonly store: DocStore,
    private node: DocNode
  ) {
    const op = OPERATOR_INDEX.get(node.op)
    const Class = (opTypes as unknown as Record<string, OperatorClass>)[node.op]
    if (op?.category === 'host' && Class) this.host = new Class(`${node.id}#ui`, undefined, false)
    for (const def of op?.params ?? []) {
      const field = this.host
        ? ((this.host.inputs as unknown as Record<string, AnyField>)[def.name] ?? plannerField(def))
        : plannerField(def)
      this.bindings.set(def.name, { def, field })
    }
    this.sync(node)
    for (const [name, binding] of this.bindings) {
      // A BehaviorSubject emits its value on subscribe; the first emission is not an edit.
      let first = true
      const sub = binding.field.subscribe(value => {
        if (first) {
          first = false
          return
        }
        if (!this.applying) this.write(name, binding, value)
      })
      this.subscriptions.push(sub)
    }
  }

  /** Bring the fields to a node's current parameters, without writing anything back. */
  sync(node: DocNode): void {
    this.node = node
    this.applying = true
    try {
      for (const [name, binding] of this.bindings) {
        const value = node.params[name]
        binding.driven = isExpr(value)
          ? `= ${value.expr}`
          : isRef(value)
            ? `→ ${value.ref}`
            : undefined
        if (binding.driven) continue
        const key = JSON.stringify(value ?? null)
        if (this.written.get(name) === key) continue
        this.written.set(name, key)
        try {
          if (this.host) {
            if (value !== undefined) applySerializedFieldValue(binding.field, value)
            else binding.field.setValue(binding.field.defaultValue as never)
          } else {
            binding.field.setValue(toFieldValue(binding.def, value) as never)
          }
        } catch {
          // A value the widget's schema refuses keeps the widget at its last value.
        }
      }
    } finally {
      this.applying = false
    }
  }

  private write(name: string, binding: ParamBinding, fieldValue: unknown): void {
    const value = this.host
      ? (binding.field.serialize() as ParamValue)
      : fromFieldValue(binding.def, fieldValue)
    const key = JSON.stringify(value ?? null)
    if (this.written.get(name) === key) return
    this.written.set(name, key)
    const id = this.node.id
    const time = this.store.get().time
    this.store.edit(doc => setParam(doc, id, name, value, time), `p:${id}.${name}`)
  }

  dispose(): void {
    for (const s of this.subscriptions) s.unsubscribe()
    ;(this.host as { dispose?: () => void } | undefined)?.dispose?.()
  }
}
