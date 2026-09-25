# Creating and Modifying Noodles.gl Operators

### Basic Structure

```typescript
export class CustomOperator extends Operator<CustomOperator> {
  static displayName = 'Custom Processor'
  static description = 'Processes data with custom logic'

  createInputs() {
    return {
      data: new DataField(),
      threshold: new NumberField(50, { min: 0, max: 100 }),
    }
  }

  createOutputs() {
    return {
      result: new DataField(),
    }
  }

  execute({
    data,
    threshold,
  }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    return {
      result: data.filter(item => item.value > threshold)
    }
  }
}
```

### Registration (Critical!)

After creating the operator class, you must register it in two places:

**1. Add to `opTypes` object in `operators.ts`** (alphabetically):

```typescript
export const opTypes = {
  // ... other operators ...
  CustomOperator,  // Add your operator here
  // ... more operators ...
} as const
```

**2. Add to appropriate category in `components/categories.ts`**:

```typescript
export const categories = {
  data: [
    'FileOp',
    'DuckDbOp',
    'CustomOperator',  // Add here if it's a data source
    // ...
  ],
  // Or in another category:
  layer: [
    'GeoJsonLayerOp',
    // ...
  ],
  code: [
    'CodeOp',
    // ...
  ],
  // ... other categories
} as const
```

**Available categories:**

- `code` - Code execution and expressions
- `data` - Data sources and transformations
- `color` - Color manipulation
- `geojson` - GeoJSON utilities
- `layer` - Visualization layers
- `extension` - Deck.gl extensions
- `number` - Numeric operations
- `string` - String operations
- `utility` - General utilities
- `vector` - Vector math
- `view` - Camera and viewport
- `widget` - UI widgets
- `grouping` - Container/loop operators

### Reading Host State (Environment)

If `execute()` needs state from the editor rather than from an input (timeline position, render
surface size, clock, or pointer), declare it and read it from the second argument:

```typescript
export class BoundingBoxOp extends Operator<BoundingBoxOp> {
  static environment = ['renderSurface'] as const

  execute({ data, padding }, { renderSurface }: Environment = this.env) {
    // ...
  }
}
```

The operator re-executes when a declared key changes. Don't subscribe to stores, start RAF loops,
or add DOM listeners inside an operator. See
[architecture.md](architecture.md#environment-state) for the available keys and where they come from.

### Key Principles

1. **Pure Functions**: Operators should be deterministic
2. **Typed Inputs/Outputs**: Use Field types with Zod schemas
3. **Reactive**: Changes propagate automatically
4. **Memoized**: Results cached based on input values
5. **Register**: Add to `opTypes` object in `operators.ts` AND to a category in `components/categories.ts`

### Adding a New Operator
1. Create operator class in `operators.ts` or separate file
2. Define inputs with `createInputs()` method
3. Define outputs with `createOutputs()` method
4. Implement `execute()` method with pure function logic
5. **Register operator in `opTypes` object** in `operators.ts` (alphabetically)
6. **Add to appropriate category** in `components/categories.ts` using display name without "Op" suffix (e.g., `'File'` not `'FileOp'`)
7. **Write unit tests** (required for all operators)
8. Document behavior and limitations if complex
9. Test in UI with example projects

**Important:** Steps 5 and 6 are critical - the operator will not appear in the Add Node menu without these registrations!

### Modifying Existing Operator
1. Locate operator in `operators.ts`
2. Modify inputs, outputs, or execute logic
3. Consider migration if schema changes
4. **Update tests** to cover new behavior
5. Add tests for bug fixes to prevent regressions
6. Update documentation if behavior changes
7. Test in UI with example projects

### Debugging Data Flow
1. Check operator paths are correct (use absolute paths from root)
2. Verify edge connections in project JSON
3. Inspect field values with console logging
4. Check Zod schema validation errors
5. Use execution tracing for performance issues

### Creating Custom Field Type
1. Extend `Field` class in `fields.ts`
2. Implement `createSchema()` method with Zod schema
3. Set default value and options
4. Add custom UI component in `field-components.tsx` if needed
5. Register in field registry
