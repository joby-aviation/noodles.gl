# Field System

Fields define the inputs and outputs of operators, providing both data validation and UI hints for the node editor interface.

## Field Fundamentals

Fields serve dual purposes:

1. **Data Schema**: Validate and type-check data using Zod schemas
2. **UI Hints**: Tell the interface how to render input controls

```typescript
// Example field definition
const numberField = new NumberField(50, {
  min: 0,
  max: 100,
  step: 1,
})
```

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
- `min`/`max`: Validation is enforced - values outside this range will fail schema validation
- `softMin`/`softMax`: UI hints only - sliders use these bounds but values outside are allowed
- Defaults: `softMin: -Infinity`, `softMax: Infinity`

Use soft limits when you want to guide users toward reasonable values while still allowing edge cases (e.g., a radius that's usually 0-100 but could be larger).

#### BooleanField
```typescript
new BooleanField(true)
```

#### ColorField
```typescript
new ColorField('#ff0000', {
  accessor: true, // Allow this field to connect to Accessor functions
  transform: hexToColor // Convert to a [R, G, B] tuple array for Deck
})
```

### Geometric Fields

#### PointField
```typescript
new Point2DField([-74.0, 40.7], {
  returnType: 'tuple',  // [lng, lat] or 'object' for { lng, lat }
})
```

#### Vec2Field
```typescript
new Vec2Field([0, 0], {
  returnType: 'object',  // { x, y } or 'tuple' for [x, y]
})
```

### Data Fields

#### DataField
For open-ended data structures:
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
For JavaScript code input:
```typescript
new CodeField('return data.length', {
  language: 'javascript'
})
```

Also accepts SQL.

## Field Options

### Common Options
```typescript
{
  optional: true,        // Allow undefined values
  accessor: true,        // Mark as accessor function
  transform: (val) => val // Transform function
}
```

### Validation
Fields use Zod schemas for runtime validation:

```typescript
// Custom validation
new StringField('user@example.com', {
  schema: z.string().email(),  // Email validation
})
```

## Field Connections

### Creating Connections

Connections between fields are managed through the graph transformation system. In the UI, simply drag from an output handle to an input handle. Programmatically, connections are created via the edge format in project files:

```typescript
// Edge format in noodles.json
{
  "id": "/nodeA.out.data->/nodeB.par.input",
  "source": "/nodeA",
  "target": "/nodeB",
  "sourceHandle": "out.data",
  "targetHandle": "par.input"
}
```

### Connection Rules

- **Type Compatibility**: Output type should match input type (warnings shown for mismatches)
- **Single Input**: Each input accepts only one connection
- **Multiple Outputs**: Outputs can connect to multiple inputs
- **No Cycles**: Connections cannot create circular dependencies

### Connection Validation

```typescript
import { canConnect } from './utils/can-connect'

// Check if two fields are type-compatible
const isCompatible = canConnect(sourceField, targetField)
```

## Custom Fields

Create custom field types by extending base classes:

```typescript
export class CustomField extends Field<z.ZodString> {
  createSchema(options: CustomFieldOptions) {
    return z.string().min(options.minLength || 0)
  }

  static component = 'CustomFieldComponent'  // UI component name
}
```

### UI Components
Register custom UI components:

```typescript
// In field-components.tsx

const CustomFieldComponent = ({ id, field, disabled }) => (
  <input
    value={field.value}
    onChange={e => onChange(e.target.value)}
    className="custom-input"
  />
)
export const inputComponents = {
  CustomField: CustomFieldComponent
}
```

## Best Practices

### Field Design

- Use descriptive names and labels
- Provide sensible default values
- Set appropriate validation constraints
- Include helpful placeholder text

### Type Safety

- Leverage Zod schemas for validation
- Use TypeScript for compile-time checking
- Handle validation errors gracefully
- Provide clear error messages

### Performance

- Avoid expensive validation in hot paths
- Use memoization for complex transformations
- Batch updates when possible
- Minimize unnecessary re-renders

### User Experience

- Group related fields logically
- Use appropriate input types for data
- Provide visual feedback for validation
- Support keyboard navigation
