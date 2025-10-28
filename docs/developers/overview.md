# Framework Developer Overview

Learn how to extend Noodles.gl by creating custom operators and fields. This guide is for developers who want to add new functionality to the framework.

## Architecture Overview

Noodles.gl uses a reactive programming model built on RxJS with the following core concepts:

- **Operators**: Processing nodes that transform data
- **Fields**: Typed inputs/outputs with validation and UI hints
- **Reactive Flow**: Automatic updates when upstream data changes

You can also read about [prior art with node-based tools](./node-based-tools.md).

## Development Setup

### Prerequisites
- Node.js (managed by Volta)
- Yarn with PnP mode
- TypeScript knowledge
- Familiarity with RxJS observables

### Getting Started
```bash
# Install dependencies
yarn install:all

# Start development server with hot reload
yarn start:app

# Run tests
yarn test:app
```

## Core Concepts for Developers

### Reactive Data Flow
```typescript
// Fields are RxJS observables
field.setValue(value) // Equivalent to field.next(field.schema.parse(value))

const currentValue = field.value

// Listen to changes
field.subscribe(value => {
  // Handle updates
})
```

### Type Safety
- All data validated with Zod schemas at runtime
- TypeScript provides compile-time safety
- Fields define both validation and UI hints

### Performance
- **Memoization**: Results cached to avoid recomputation
- **Lazy Evaluation**: Nodes only execute when inputs change
- **Pure Functions**: Operators should be deterministic

## What You Can Build

### Custom Operators
- **Data Sources**: New APIs, databases, file formats
- **Processors**: Custom algorithms and transformations
- **Visualizations**: New Deck.gl layers or rendering engines
- **Utilities**: Helper functions and data manipulation

### Custom Fields
- **Input Types**: Specialized UI controls
- **Validation**: Custom data validation rules
- **Complex Types**: Arrays, objects, and nested structures

### Extensions
- **Timeline Integration**: Animation-aware operators
- **External APIs**: Third-party service integrations
- **Export Formats**: New output and sharing options

## Development Workflow

### 1. Create an Operator
```typescript
export class CustomOperator extends Operator<CustomOperator> {
  static displayName = 'CustomOperator'
  static description = 'Description of what this operator does'

  createInputs() {
    return {
      data: new ArrayField(new UnknownField()),
      threshold: new NumberField(50, { min: 0, max: 100 })
    }
  }

  createOutputs() {
    return {
      result: new DataField()
    }
  }

  execute(props: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Pure function: inputs → outputs
    return { result: processedData }
  }
}
```

### 2. Add to opTypes

```typescript
// In operators.ts, add your operator to the opTypes export
export const opTypes = {
  // ... existing operators
  CustomOperator,
} as const
```

### 3. Add to categories

```typescript
// In categories.ts, add your operator to the appropriate category
export const categories = {
  'data': [
    'CustomOperator',
    // ... other operators
  ],
  // ... other categories
}
```

## Next Steps

- **[Creating Operators](./creating-operators)** - Build custom processing nodes
- **[Field System](./field-system)** - Understand inputs, outputs, and validation
- **[Data Flow](./data-flow)** - Master reactive programming patterns
- **[Path System](./paths-containers)** - Organization and referencing
- **[Contributing](./contributing.md)** - Contribute back to the framework

## Framework Philosophy

- **Composability**: Small, focused operators that work together
- **Type Safety**: Runtime validation with developer experience
- **Performance**: Efficient reactive updates and memoization
- **Extensibility**: Easy to add new operators and field types
- **Developer Experience**: Hot reload, debugging tools, clear APIs
