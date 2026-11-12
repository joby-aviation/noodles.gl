# Field System

Fields are the classes behind the parameter widgets. An operator's parameters are declared in its `OpDef` (see [Creating Operators](./creating-operators.md)), and the document stores their values. Fields remain as the backing for the widgets that edit those values, and as the inputs and outputs of the few host operators.

## Field Fundamentals

Fields serve two purposes:

1. **Data Schema**: Validate and normalize a value with a Zod schema
2. **UI**: Pick the widget that edits it, through `inputComponents` in `noodles-editor/src/noodles/components/field-components.tsx`

`noodles-editor/src/editor/field-adapter.ts` builds a field for each parameter of the selected node and keeps the two in step both ways: a widget's `setValue` writes the document (one undo step per gesture), and a document change (undo, an assistant edit, a keyframe) sets the field.

### Parameter Kinds and Fields

A planner parameter's `kind` picks its field:

| Kind | Field | Notes |
|------|-------|-------|
| `float`, `int` | `NumberField` | `min`, `max` and `step` from the parameter; `int` steps by 1 |
| `toggle` | `BooleanField` | |
| `menu` | `StringLiteralField` | The parameter's `options` |
| `color` | `ColorField` | The document stores `[r, g, b]` 0 to 255; the field edits `#rrggbb` |
| `code` | `CodeField` | SQL or JavaScript, from the parameter's `language` |
| `string`, `text`, `url`, `expr`, `column` | `StringField` | Text the planner reads |
| `field` | The class named by `field: { op, input }` | A widget a Noodles operator class owns |

A `field` parameter is how a deck operator borrows a richer widget: an extension list, a bounding box, a view state, a Bezier curve, a map style's overrides. The adapter builds the field from that class's input of the same name. A host operator's parameters are its own fields, built by its class.

## Core Field Types

### Primitive Fields

#### NumberField
```typescript
new NumberField(50, {
  min: 0,           // Hard minimum (validation enforced)
  max: 100,         // Hard maximum (validation enforced)
  softMin: 10,      // UI hint for slider minimum (not enforced)
  softMax: 90,      // UI hint for slider maximum (not enforced)
  step: 1,          // Increment step
})
```

**Soft vs Hard Limits:**
- `min`/`max`: Validation is enforced; values outside this range fail schema validation
- `softMin`/`softMax`: UI hints only; sliders use these bounds but values outside are allowed
- Defaults: `softMin: -Infinity`, `softMax: Infinity`

#### BooleanField
```typescript
new BooleanField(true)
```

#### ColorField
```typescript
new ColorField('#ff0000')  // stored as #rrggbbaa; a 6-digit hex gets ff alpha
```

### Geometric Fields

#### Point2DField
```typescript
new Point2DField([-74.0, 40.7], {
  returnType: 'tuple',  // [lng, lat], or 'object' for { lng, lat }
})
```

`Point3DField` adds an altitude, and `BboxField` holds two corners.

#### Vec2Field
```typescript
new Vec2Field([0, 0], {
  returnType: 'object',  // { x, y }, or 'tuple' for [x, y]
})
```

`Vec3Field` and `Vec4Field` work the same way.

### Data Fields

#### DataField
For open-ended data on a host operator's ports:
```typescript
new DataField([]) // Any array or object
```

#### CompoundPropsField
For specific object schemas:
```typescript
new CompoundPropsField({
  view: z.object({
    name: z.string(),
    value: z.number()
  })
})
```

### Advanced Fields

#### CodeField
For code input:
```typescript
new CodeField('return d', {
  language: 'javascript'
})
```

Also accepts `language: 'sql'`.

## Field Options

### Common Options
```typescript
{
  optional: true,          // Allow undefined values
  transform: (val) => val, // Transform the parsed value
  showByDefault: false,    // Hide the field until shown
}
```

## Connections

Wires are not between fields. In a document, edges join ports: `out` to `in` for tables, `out` to the deck's `layers` for layers, and `par:<name>` to drive a parameter from a number output:

```json
{ "id": "e1", "source": "n1", "sourcePort": "out", "target": "n2", "targetPort": "in" }
```

`canConnect(from, to)` in `@noodles.gl/planner` decides whether one port type may feed another, and the editor only lets a wire connect where it returns true. A host operator's inputs are parameters with `par:` handles, typed by their field: a `NumberField` takes a number, a `DataField` or `GeoJsonField` a table, a `LayerField` a layer.

## Custom Fields

Create a field type by extending `Field` with a `type` and a schema:

```typescript
export class CustomField extends Field<z.ZodString> {
  static type = 'custom'
  createSchema(options: CustomFieldOptions) {
    return z.string().min(options.minLength || 0)
  }
}
```

### UI Components
Register its widget under the same `type`:

```typescript
// In field-components.tsx
const CustomFieldComponent = ({ id, field, disabled }) => (
  <input
    value={field.value}
    onChange={e => field.setValue(e.target.value)}
    className="custom-input"
  />
)
export const inputComponents = {
  // ...
  custom: CustomFieldComponent,
}
```

A planner operator reaches the widget through a `field` parameter whose `{ op, input }` names an operator class that has a field of this type.

## Best Practices

### Field Design

- Provide sensible default values
- Set appropriate validation constraints
- Prefer a planner parameter kind; reach for a `field` parameter only when a richer widget is needed

### Type Safety

- Leverage Zod schemas for validation
- Use TypeScript for compile-time checking
- Handle validation errors gracefully

### User Experience

- Group related parameters with `folder`
- Hide parameters that don't apply with `when`
- Support keyboard navigation
