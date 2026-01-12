# Data Flow Architecture

The Noodles.gl system uses reactive programming principles to manage data flow through the node graph, ensuring efficient updates and consistent state.

## Reactive Programming Model

### RxJS Foundation

The system is built on RxJS observables for reactive data flow:

```typescript
field.setValue(value) // equivalent to field.next(field.schema.parse(value))

const value = field.value

// Listen to changes and re-render UI
field.subscribe(value => {
  // Update logic
})
```

### Data Flow Principles

1. **Unidirectional**: Data flows from outputs to inputs
2. **Reactive**: Changes propagate automatically
3. **Lazy**: Nodes only execute when upstream values change
4. **Memoized**: Results are cached to avoid recomputation

## Connection System

### Edge Structure in Project Serialization

In the project serialization format (noodles.json), edges connect operators through their input and output handles:

```typescript
// Edge format
{
  "id": "/add-1.out.result->/viewer.par.data", // Unique edge ID
  "source": "/add-1",            // Source node ID
  "target": "/viewer",           // Target node ID
  "sourceHandle": "out.result",  // Name of the output field
  "targetHandle": "par.data"     // Name of the input field
}
```

### Example Connection

```typescript
// Two nodes, in the `nodes` array:
{
  "id": "/data-loader",
  "type": "FileOp",
  "data": {
    "inputs": {
      "format": "csv",
      "url": "@/data.csv"
    },
  }
},
{
  "id": "/filter",
  "type": "FilterOperator",
  "data": {
    "inputs": {
      "columnName": "age",
      "condition": "greater than",
      "value": 30
    },
  }
}

// Edge connecting them, in the `edges` array:
{
  "id": "/data-loader.out.data->/filter.par.data",
  "source": "/data-loader",  // Source node ID, matches data-loader operator
  "target": "/filter",       // Target node ID, matches filter operator
  "sourceHandle": "out.data",    // Connect from data-loader's "data" output
  "targetHandle": "par.data"     // to filter's "data" input
}
```

### Reactive references in CodeField

When writing code expressions in a `CodeField`, you can reference other operators in the graph using path-based syntax:

```typescript
// In a CodeField expression, reference other operators
const upstream = op('/data-loader').out.data
const filtered = op('./filter').par.data
```

This will get parsed into a special `ReferenceEdge` in the edges array that connects the output of the referenced operator to the CodeField's input.

You can also use mustache syntax for reactive references in fields that support it (like DuckDbOp):

```sql
SELECT * FROM 'data.csv' WHERE age > {{/age.par.value}}
```

### Creating Connections Programmatically

```typescript
// Connect nodes using field references
sourceNode.fields.output.addConnection(
  targetNode.fields.input
)
```

### Connection Lifecycle

1. **Validation**: Check type compatibility
2. **Subscription**: Set up reactive subscription
3. **Data Flow**: Values flow from source to target
4. **Cleanup**: Remove subscriptions when disconnected

### Connection Rules

- **Type Safety**: Zod schemas ensure type compatibility
- **Single Input**: Each input accepts one connection
- **Multiple Outputs**: Outputs can connect to many inputs
- **Cycle Detection**: Prevents circular dependencies

## Execution Model

### Operator Execution

```typescript
class AddOperator extends Operator<AddOperator> {
  static displayName = 'Add'
  static description = 'Add two numbers'

  createInputs() {
    return {
      a: new NumberField(0, { step: 1 }),
      b: new NumberField(0, { step: 1 }),
    }
  }

  createOutputs() {
    return {
      sum: new NumberField(),
    }
  }

  execute({ a, b }: ExtractProps<typeof this.inputs>): ExtractProps<typeof this.outputs> {
    // Pure function transformation
    return { sum: a + b }
  }
}
```

### Execution Triggers

- **Input Changes**: When connected field values update
- **Parameter Changes**: When operator parameters change
- **Manual Trigger**: Explicit re-execution requests

### Execution Order

1. **Topological Sort**: Determine execution order
2. **Dependency Resolution**: Execute upstream nodes first
3. **Parallel Execution**: Independent branches run concurrently
4. **Result Propagation**: Outputs trigger downstream execution

## Memoization Strategy

### Automatic Caching

```typescript
// Results cached based on input hash
const cachedResult = memoize(operator.execute, inputs)
```

### Cache Invalidation

- **Input Changes**: Clear cache when inputs change
- **Parameter Updates**: Invalidate on configuration changes
- **Manual Clearing**: Explicit cache clearing for debugging

### Memory Management

- **LRU Eviction**: Remove least recently used results
- **Size Limits**: Prevent unbounded cache growth
- **Weak References**: Allow garbage collection

## Performance Optimization

### Batching Updates

```typescript
// Batch multiple changes to avoid cascading updates
batch(() => {
  node1.fields.param1.setValue(value1)
  node2.fields.param2.setValue(value2)
})
```

### Debouncing

```typescript
// Debounce rapid changes to reduce computation
field.pipe(
  debounceTime(100),
  distinctUntilChanged()
).subscribe(value => {
  // Process debounced value
})
```

### Selective Updates

- **Change Detection**: Only update when values actually change
- **Shallow Comparison**: Use object references for arrays/objects
- **Dirty Tracking**: Mark nodes that need re-execution

## Error Handling

### Error Propagation

```typescript
try {
  const result = operator.execute(inputs)
  field.next(result)
} catch (error) {
  field.error(error)  // Propagate error downstream
}
```

### Error Recovery

- **Graceful Degradation**: Continue execution with partial data
- **Default Values**: Fall back to safe defaults
- **Error Boundaries**: Isolate errors to prevent cascade failures

### Debugging Support

- **Execution Tracing**: Track data flow through graph
- **Performance Profiling**: Measure execution times
- **State Inspection**: Examine intermediate values

## Operator References in CodeField

When writing code expressions in a `CodeField`, you can reference other operators in the graph using path-based syntax:

### Path Resolution Rules

Operator paths use Unix-style notation, allowing both absolute and relative references. Slash (`/`) is used as the separator and special symbols like `.` and `..` denote the current and parent containers, respectively:

```typescript
// Absolute paths (from root)
op('/data-loader')              // Root level operator
op('/analysis/filter')          // Nested in analysis container

// Relative paths (from current operator)
op('./sibling')                 // Same container
op('../parent-sibling')         // Parent container
op('local-name')                // Same container (shorthand)
```

### Example Usage in CodeField

```typescript
// In a CodeField expression, reference other operators
const upstream = op('/data-loader').out.data
const filtered = op('./filter').out.data
```

Note: This path-based syntax is only used within CodeField expressions for programmatic operator references. For regular node-to-node connections in the graph, use the edge format with `sourceHandle` and `targetHandle` as described in the Connection System section.

## Integration Points

### Theatre.js Timeline

```typescript
import { useVal } from '@theatre/react'

// Subscribe to keyframed field values
const sheetObject = sheet.object('myObject', { value: types.number(0) })
const animatedValue = useVal(sheetObject.props.value)
```

### Deck.gl Rendering

```typescript
// Connect node outputs to Deck.gl layers
const layers = nodeGraph.getLayerNodes().map(node =>
  node.execute(inputs)
)
```

### External Data Sources

```typescript
// Reactive data loading
const dataStream = fromFetch('/api/data').pipe(
  map(response => response.json()),
  catchError(error => of(fallbackData))
)
```

## Best Practices

### Graph Design

- **Minimize Connections**: Reduce complexity where possible
- **Logical Grouping**: Group related operations
- **Clear Naming**: Use descriptive node and field names
- **Documentation**: Comment complex data transformations

### Performance

- **Avoid Deep Graphs**: Limit nesting depth
- **Batch Operations**: Group related changes
- **Profile Bottlenecks**: Identify slow operations
- **Optimize Hot Paths**: Focus on frequently executed nodes

### Debugging

- **Incremental Building**: Test small graph sections
- **Data Inspection**: Examine intermediate results
- **Error Logging**: Capture and log execution errors
- **Visual Debugging**: Use graph visualization tools

### Maintenance

- **Version Control**: Track graph changes
- **Migration Scripts**: Handle schema updates
- **Testing**: Unit test individual operators
- **Documentation**: Maintain up-to-date docs
