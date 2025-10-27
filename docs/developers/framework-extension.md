# Extending the Framework

## Creating New Operators

### Basic Operator Template

```typescript
export class CustomOperator extends Operator<CustomOperator> {
  static displayName = 'Custom Operator'
  static description = 'Description of what this operator does'

  createInputs() {
    return {
      data: new ArrayField(new DataField()),
      amount: new NumberField(50, { min: 0, max: 100 })
    }
  }

  createOutputs() {
    return {
      result: new DataField()
    }
  }

  execute({ data, amount }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Pure function implementation
    return {
      result: data.map(item => ({
        ...item,
        processed: item.value * amount
      }))
    }
  }
}
```

### Registration

```typescript
// Add to opTypes in operators.ts
export const opTypes = {
  // ... existing operators
  CustomOperator,
} as const
```

### Category Organization

```typescript
// Add to categories.ts
export const categories = {
  'Processing': [
    'CustomOperator',
    // ... other operators
  ],
  // ... other categories
}
```

## Creating New Fields

### Field Template

```typescript
export class CustomField extends Field<z.ZodString> {
  createSchema(options: CustomFieldOptions) {
    return z.string()
      .min(options.minLength || 0)
      .max(options.maxLength || 1000)
  }
}
```

### Type Safety

```typescript
// Use Zod schemas for runtime validation
const schema = z.object({
  name: z.string(),
  value: z.number().min(0)
})

// Leverage TypeScript for compile-time checking
type InputType = z.infer<typeof schema>
```

### UI Component

```typescript
// In field-components.tsx

const CustomFieldComponent = ({ field }) => {
  const [value, setValue] = useState(field.value)

  useEffect(() => {
    field.subscribe(v => setValue(v))
  }, [field.value])

  const onChange = (newValue: string) => {
    field.setValue(newValue)
  }

  return (
    <div className="custom-field">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Enter custom value..."
      />
    </div>
  )
}
export const inputComponents = {
  CustomField: CustomFieldComponent
}
```

## Migration System

### Creating Migrations

```typescript
// In __migrations__/005-new-feature.ts
export const up = (data: any) => {
  // Transform old data format to new format
  return {
    ...data,
    newField: 'defaultValue'
  }
}

export const down = (data: any) => {
  // Transform new data format back to old format
  const { newField, ...rest } = data
  return rest
}
```

### Running Migrations

Migrations run automatically when loading older save files:

```typescript
// Automatic migration on load
const migratedData = migrateSchema(savedData, currentVersion)
```

## Debugging

### Development Tools

- **Browser DevTools**: Inspect React components and state
- **RxJS DevTools**: Trace observable streams
- **Theatre.js Studio**: Debug timeline and keyframes

### Debugging Techniques

```typescript
// Add debug logging to operators
execute(inputs) {
  console.log('Operator inputs:', inputs)
  const result = processInputs(inputs)
  console.log('Operator output:', result)
  return result
}
```

### Common Issues

- **Circular Dependencies**: Check connection graph for cycles
- **Type Mismatches**: Verify field type compatibility
- **Performance**: Profile slow operators with large datasets
- **Memory Leaks**: Ensure proper subscription cleanup

## Performance Optimization

### Profiling

```typescript
// Measure operator execution time
const startTime = performance.now()
const result = operator.execute(inputs)
const duration = performance.now() - startTime
console.log(`Execution time: ${duration}ms`)
```

### Optimization Strategies

- **Memoization**: Cache expensive computations
- **Batching**: Group multiple updates
- **Lazy Loading**: Load data only when needed
- **Web Workers**: Offload heavy computations
