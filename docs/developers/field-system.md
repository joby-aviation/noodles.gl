# Field System

Fields are the classes behind the parameter widgets, in `noodles-editor/src/noodles/fields.ts`. An operator declares its parameters in its `OpDef` (see [Creating Operators](./creating-operators.md)), and the document stores their values. Fields do two jobs on top of that:

1. **Validate** a value with a Zod schema.
2. **Pick the widget** that edits it, through `inputComponents` in `noodles-editor/src/noodles/components/field-components.tsx`, keyed by the field's `type`.

A field is an RxJS `BehaviorSubject`: `field.value` reads it, `field.setValue(v)` parses and sets it, and `field.subscribe` follows it. Host operators also use fields for their inputs and outputs.

## From parameter to widget

`noodles-editor/src/editor/field-adapter.ts` builds a field for each parameter of the selected node and keeps the two in step both ways. A widget's `setValue` writes the document (one undo step per gesture), and a document change (undo, an assistant edit, a keyframe at the playhead) sets the field.

A planner parameter's `kind` picks its field:

| Kind | Field | Notes |
|------|-------|-------|
| `float`, `int` | `NumberField` | `min`, `max` and `step` from the parameter; `int` steps by 1 |
| `toggle` | `BooleanField` | |
| `menu` | `StringLiteralField` | The parameter's `options` |
| `color` | `ColorField` | The document stores `[r, g, b]` from 0 to 255; the field edits `#rrggbb` |
| `code` | `CodeField` | SQL when the parameter's `language` is `sql`, otherwise JavaScript |
| `string`, `text`, `url`, `expr`, `column` | `StringField` | Text the planner reads |
| `field` | Named by the parameter's `field` | See below |

A `field` parameter borrows a richer widget from a Noodles operator class. `field: { op, input }` names the class and its input, and the adapter builds that field: a bounding box, a view state, a Bezier curve, a map style's overrides. `field: { list: 'extensions' }` is a list of layer extensions, set by wiring.

## Common fields

```typescript
new NumberField(50, { min: 0, max: 100, softMin: 10, softMax: 90, step: 1 })
new BooleanField(true)
new StringField('')
new ColorField('#ff0000')                                  // stored as #rrggbbaa
new CodeField('return d', { language: 'javascript' })      // or 'sql', 'json', 'overpass-ql'
new Point2DField([-74.0, 40.7], { returnType: 'tuple' })   // [lng, lat]; 'object' gives { lng, lat }
new Vec2Field([0, 0], { returnType: 'object' })            // { x, y }
new DataField()                                            // rows or objects on a host operator's port
new CompoundPropsField({ name: new StringField(''), size: new NumberField(1) })
```

- `min` and `max` are enforced by the schema. `softMin` and `softMax` only bound the slider, so a typed value outside them is allowed.
- `Point3DField` adds an altitude, `BboxField` holds two corners, and `Vec3Field` and `Vec4Field` work like `Vec2Field`.

Every field also takes these options:

```typescript
{
  optional: true,          // allow undefined
  transform: v => v,       // transform the parsed value
  showByDefault: false,    // hide the field until shown
  label: 'Radius',         // name shown in the UI; defaults to the humanized key
  description: '...',      // one-line help shown in the UI
}
```

## Ports and connections

Wires join ports, not fields. In a document, edges go `out` to `in` for tables, `out` to the deck's `layers` for layers, and to `par:<name>` to drive a parameter from a number output. `canConnect(from, to)` in `@noodles.gl/planner` decides whether one port type can feed another, and the editor only lets a wire connect where it returns true.

A host operator's inputs are parameters with `par:` handles, typed by their field: a `NumberField` takes a number, a `DataField` or `GeoJsonField` takes a table, and a `LayerField` takes a layer.

## A custom field

Extend `Field` with a `type` and a schema:

```typescript
export class SlugField extends Field<z.ZodString> {
  static type = 'slug'
  static defaultValue = ''
  createSchema() {
    return z.string().regex(/^[a-z0-9-]*$/)
  }
}
```

Register its widget under the same `type` in `field-components.tsx`. A widget subscribes to the field and calls `setValue`:

```tsx
function SlugFieldComponent({ field, disabled }: { field: SlugField; disabled: boolean }) {
  const [value, setValue] = useState(field.value)
  useEffect(() => {
    const sub = field.subscribe(setValue)
    return () => sub.unsubscribe()
  }, [field])
  return <input value={value} disabled={disabled} onChange={e => field.setValue(e.target.value)} />
}

export const inputComponents = {
  // ...
  slug: SlugFieldComponent,
}
```

A planner operator reaches the widget through a `field` parameter whose `{ op, input }` names an operator class with a field of this type. Prefer a planner parameter kind; reach for a custom field only when no kind fits.
