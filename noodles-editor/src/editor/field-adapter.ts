// A Noodles Field for each parameter of a document node, so the editor's field widgets edit
// documents. A field mirrors its parameter both ways: a widget's `setValue` writes the
// document (one undo step per gesture), and a document change (undo, an AI edit, a keyframe)
// sets the field.
//
// Host operators' parameters are their own Noodles fields, built by the operator class. The
// planner's parameter kinds map onto the field types whose widgets fit them.

import {
  type DocNode,
  evaluateTrack,
  isExpr,
  isRef,
  OPERATOR_INDEX,
  type ParamDef,
  type ParamValue,
  type Timeline,
} from '@noodles.gl/planner'
import {
  applySerializedFieldValue,
  BooleanField,
  CodeField,
  ColorField,
  DataField,
  ExtensionField,
  type Field,
  ListField,
  NumberField,
  StringField,
  StringLiteralField,
} from '../noodles/fields'
import { type IOperator, type Operator, opTypes } from '../noodles/operators'
import { trackFieldEdit } from '../noodles/utils/field-edit-analytics'
import { setParam } from './doc-ops'
import type { DocStore } from './doc-store'
import { dismissStarterHint } from './ui-store'

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
  // Only the bounds the parameter has: an undefined one would override the field's infinite
  // default, and its schema would refuse every value
  const range = Object.fromEntries(
    Object.entries({ min: def.min, max: def.max, step: def.step }).filter(
      ([, v]) => v !== undefined
    )
  )
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
  /** The field is a Noodles operator's own, holding its serialized values as they are. */
  owned?: boolean
}

/** The fields of one node, kept in step with its parameters while the node is shown. */
export class NodeFields {
  readonly bindings = new Map<string, ParamBinding>()
  private readonly host?: Operator<IOperator>
  // Noodles operators whose fields edit a deck operator's values, one per class
  private readonly owners = new Map<string, Operator<IOperator>>()
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
      const hosted = (this.host?.inputs as unknown as Record<string, AnyField> | undefined)?.[
        def.name
      ]
      const owned = hosted ?? this.ownedField(def)
      this.bindings.set(def.name, { def, field: owned ?? plannerField(def), owned: !!owned })
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

  /**
   * A field a Noodles class supplies for a `field` parameter: `{ op, input }` names the class
   * and input whose widget edits it (a deck operator's bounding box, view state), and
   * `{ list: 'extensions' }` is a list of extensions, edited by wiring.
   */
  private ownedField(def: ParamDef): AnyField | undefined {
    const ref = def.field as
      | { op?: string; input?: string; list?: string; wired?: string }
      | undefined
    if (def.kind !== 'field' || !ref) return undefined
    if (ref.list === 'extensions') return new ListField(new ExtensionField()) as unknown as AnyField
    // Set by wiring only: rows, a layer, objects
    if (ref.wired) return new DataField() as unknown as AnyField
    const Class = ref.op ? (opTypes as unknown as Record<string, OperatorClass>)[ref.op] : undefined
    if (!Class || !ref.op || !ref.input) return undefined
    let owner = this.owners.get(ref.op)
    if (!owner) {
      owner = new Class(`${this.node.id}#ui-${ref.op}`, undefined, false)
      this.owners.set(ref.op, owner)
    }
    return (owner.inputs as unknown as Record<string, AnyField>)[ref.input]
  }

  /**
   * Bring the fields to a node's current parameters, without writing anything back. A
   * keyframed parameter shows its value at the playhead.
   */
  sync(node: DocNode, timeline?: Timeline, time = 0): void {
    this.node = node
    this.applying = true
    try {
      for (const [name, binding] of this.bindings) {
        const track = timeline?.tracks.find(t => t.target === `${node.id}.${name}`)
        const keyed = track ? evaluateTrack(track, time) : undefined
        const value = keyed ?? node.params[name]
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
          if (binding.owned) {
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
    const value = binding.owned
      ? (binding.field.serialize() as ParamValue)
      : fromFieldValue(binding.def, fieldValue)
    const key = JSON.stringify(value ?? null)
    if (this.written.get(name) === key) return
    this.written.set(name, key)
    const id = this.node.id
    const time = this.store.get().time
    this.store.edit(doc => setParam(doc, id, name, value, time), `p:${id}.${name}`)
    trackFieldEdit({ source: 'properties_panel', operatorType: this.node.op, field: binding.field })
    dismissStarterHint()
  }

  dispose(): void {
    for (const s of this.subscriptions) s.unsubscribe()
    ;(this.host as { dispose?: () => void } | undefined)?.dispose?.()
    for (const owner of this.owners.values()) (owner as { dispose?: () => void }).dispose?.()
  }
}
